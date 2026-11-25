process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const { avertir, muter } = require('../Fonctions/actionsMod')
const { role, erreurDiscord } = require('./aides')

const { Flags } = Discord.PermissionsBitField
const MOD = "444444444444444444", CIBLE = "333333333333333334"

let compteurGuild = 0
const nouvelleGuild = () => `7777777777777777${String(++compteurGuild).padStart(2, "0")}`

// Faux membre cible et fausse interaction (le modérateur a le rôle 5, la cible le rôle 1 par défaut)
function monde({ perm = Flags.ModerateMembers, membre = {}, absent = false } = {}) {
    const guildId = nouvelleGuild()
    const appels = { timeout: [], mp: [] }
    const cible = {
        id: CIBLE, roles: { highest: role(1) }, moderatable: true,
        isCommunicationDisabled: () => false, communicationDisabledUntilTimestamp: null,
        timeout: async (duree, raison) => { appels.timeout.push({ duree, raison }) },
        ...membre
    }
    const user = { id: CIBLE, send: async msg => { appels.mp.push(msg) } }
    const interaction = {
        guild: {
            id: guildId, ownerId: "owner", name: "serveur",
            members: {
                fetch: async () => {
                    if (absent) throw erreurDiscord(Discord.RESTJSONErrorCodes.UnknownMember)
                    return cible
                }
            }
        },
        user: { id: MOD, tag: "modo" }, client: { user: { id: "bot" } },
        member: { roles: { highest: role(5) } },
        memberPermissions: new Discord.PermissionsBitField(perm)
    }
    return { guildId, interaction, user, cible, appels }
}

test("avertir : membre absent", async () => {
    const { guildId, interaction, user } = monde({ absent: true })
    const res = await avertir(interaction, user, "spam")
    assert.ok(res.erreur)
    assert.strictEqual(db.countWarns(guildId, CIBLE), 0)
})

test("avertir : cible au-dessus du modérateur, rien n'est écrit", async () => {
    const { guildId, interaction, user } = monde({ membre: { roles: { highest: role(9) } } })
    const res = await avertir(interaction, user, "spam")
    assert.ok(res.erreur)
    assert.strictEqual(db.countWarns(guildId, CIBLE), 0)
    assert.strictEqual(db.countCases(guildId, CIBLE), 0)
})

test("avertir : seuil ban que le modérateur ne peut pas appliquer", async () => {
    const { guildId, interaction, user } = monde({ perm: Flags.ModerateMembers })
    db.setThreshold(guildId, 1, "ban", null)
    const res = await avertir(interaction, user, "spam")
    assert.match(res.erreur, /ban/)
    assert.strictEqual(db.countWarns(guildId, CIBLE), 0, "aucun warn enregistré")
    assert.strictEqual(db.countCases(guildId, CIBLE), 0)
})

test("avertir : warn normal", async () => {
    const { guildId, interaction, user, appels } = monde()
    const res = await avertir(interaction, user, "  insulte  ")
    assert.strictEqual(res.erreur, undefined)
    assert.strictEqual(res.total, 1)
    assert.strictEqual(res.auto, null)
    assert.strictEqual(res.prevenu, true)
    assert.strictEqual(appels.mp.length, 1)
    assert.strictEqual(db.countWarns(guildId, CIBLE), 1)
    const historique = db.listCases(guildId, CIBLE)
    assert.strictEqual(historique.length, 1)
    assert.strictEqual(historique[0].warn_id, res.id)
    assert.strictEqual(historique[0].reason, "insulte")

    const second = await avertir(interaction, user, "")
    assert.strictEqual(second.total, 2)
})

test("avertir : MP fermés, le warn est quand même enregistré", async () => {
    const { guildId, interaction, user } = monde()
    user.send = async () => { throw new Error("MP fermés") }
    const res = await avertir(interaction, user, "spam")
    assert.strictEqual(res.prevenu, false)
    assert.strictEqual(db.countWarns(guildId, CIBLE), 1)
})

test("avertir : seuil mute applicable, timeout appelé et texte auto renvoyé", async () => {
    const { guildId, interaction, user, appels } = monde({ perm: Flags.ModerateMembers })
    db.setThreshold(guildId, 2, "mute", 3600000)
    const premier = await avertir(interaction, user, "a")
    assert.strictEqual(premier.auto, null)
    assert.strictEqual(appels.timeout.length, 0)

    const second = await avertir(interaction, user, "b")
    assert.strictEqual(second.total, 2)
    assert.ok(second.auto, "texte de la sanction automatique")
    assert.strictEqual(appels.timeout.length, 1)
    assert.strictEqual(appels.timeout[0].duree, 3600000)
    assert.ok(db.listCases(guildId, CIBLE).some(c => c.type === "mute"), "case mute automatique")
})

test("muter : membre absent", async () => {
    const { interaction, user } = monde({ absent: true })
    const res = await muter(interaction, user, 600000, "spam")
    assert.ok(res.erreur)
})

test("muter : cible au-dessus du modérateur", async () => {
    const { guildId, interaction, user, appels } = monde({ membre: { roles: { highest: role(9) } } })
    const res = await muter(interaction, user, 600000, "spam")
    assert.ok(res.erreur)
    assert.strictEqual(appels.timeout.length, 0)
    assert.strictEqual(db.countCases(guildId, CIBLE), 0)
})

test("muter : membre déjà muet", async () => {
    const { guildId, interaction, user, appels } = monde({ membre: { isCommunicationDisabled: () => true } })
    const res = await muter(interaction, user, 600000, "spam")
    assert.ok(res.erreur)
    assert.strictEqual(appels.timeout.length, 0)
    assert.strictEqual(db.countCases(guildId, CIBLE), 0)
})

test("muter : membre non modérable", async () => {
    const { guildId, interaction, user, appels } = monde({ membre: { moderatable: false } })
    const res = await muter(interaction, user, 600000, "spam")
    assert.ok(res.erreur)
    assert.strictEqual(appels.timeout.length, 0)
    assert.strictEqual(db.countCases(guildId, CIBLE), 0)
})

test("muter : mute normal", async () => {
    const { guildId, interaction, user, appels } = monde()
    const res = await muter(interaction, user, 600000, "spam")
    assert.strictEqual(res.erreur, undefined)
    assert.ok(res.numero)
    assert.ok(res.temps)
    assert.strictEqual(appels.timeout.length, 1)
    assert.strictEqual(appels.timeout[0].duree, 600000)
    assert.match(appels.timeout[0].raison, /spam/)
    const cases = db.listCases(guildId, CIBLE)
    assert.strictEqual(cases.length, 1)
    assert.strictEqual(cases[0].type, "mute")
    assert.strictEqual(cases[0].duration_ms, 600000)
    assert.strictEqual(appels.mp.length, 1)
})
