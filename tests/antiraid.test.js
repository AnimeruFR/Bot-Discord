process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const { decision, appliquerFiltre, setFiltreComptes } = require('../Fonctions/antiraid')

const JOUR = 86400000
const MAINTENANT = 1_800_000_000_000
const reglage = { minAgeJours: 7, action: "kick" }
const reglageRole = { minAgeJours: 7, action: "role", roleId: "r1" }
let compteur = 100

// Faux serveur et faux membre ; `appels` garde ce que le bot a fait
function faux({ bot = false, age = 1, kickable = true, roleExiste = true, haut = false, kickErreur = false } = {}) {
    const appels = []
    const id = `9000000000000${compteur++}`
    const guild = {
        id, name: "Serveur", memberCount: 5,
        roles: { cache: new Discord.Collection(roleExiste ? [["r1", { id: "r1", managed: false }]] : []) },
        channels: { cache: new Discord.Collection() },
        members: { me: { permissions: new Discord.PermissionsBitField(Discord.PermissionsBitField.Flags.ManageRoles), roles: { highest: { comparePositionTo: () => haut ? -1 : 1 } } } }
    }
    const member = {
        id: "u" + id, guild, kickable, toString: () => "<@u>",
        user: { id: "u" + id, bot, createdTimestamp: MAINTENANT - age * JOUR },
        send: async m => { appels.push(["mp", m]) },
        kick: async r => { if (kickErreur) throw new Error("refus"); appels.push(["kick", r]) },
        roles: { add: async (r, raison) => { appels.push(["role", r, raison]) } }
    }
    return { guild, member, appels }
}

test("decision : limite, compte ancien, filtre absent", () => {
    assert.strictEqual(decision(reglage, MAINTENANT - 7 * JOUR + 1, MAINTENANT), "kick")
    assert.strictEqual(decision(reglage, MAINTENANT - 7 * JOUR, MAINTENANT), null)
    assert.strictEqual(decision(reglage, MAINTENANT - 30 * JOUR, MAINTENANT), null)
    assert.strictEqual(decision(null, MAINTENANT, MAINTENANT), null)
    assert.strictEqual(decision(reglageRole, MAINTENANT, MAINTENANT), "role")
})

test("bot exempté", async () => {
    const { guild, member, appels } = faux({ bot: true })
    setFiltreComptes(guild.id, reglage)
    assert.deepStrictEqual(await appliquerFiltre(member, MAINTENANT), { action: null, ok: true })
    assert.strictEqual(appels.length, 0)
})

test("module modération désactivé : rien", async () => {
    const { guild, member, appels } = faux()
    setFiltreComptes(guild.id, reglage)
    db.setModule(guild.id, "moderation", false)
    assert.strictEqual((await appliquerFiltre(member, MAINTENANT)).action, null)
    assert.strictEqual(appels.length, 0)
})

test("kick : MP puis expulsion", async () => {
    const { guild, member, appels } = faux()
    setFiltreComptes(guild.id, reglage)
    assert.deepStrictEqual(await appliquerFiltre(member, MAINTENANT), { action: "kick", ok: true })
    assert.deepStrictEqual(appels.map(a => a[0]), ["mp", "kick"])
})

test("kick impossible (kickable false) : échec sans crash", async () => {
    const { guild, member, appels } = faux({ kickable: false })
    setFiltreComptes(guild.id, reglage)
    const r = await appliquerFiltre(member, MAINTENANT)
    assert.strictEqual(r.ok, false)
    assert.ok(r.motif)
    assert.strictEqual(appels.length, 0)
})

test("rôle en attente : ajouté, puis rôle disparu ou trop haut = échec sans crash", async () => {
    let f = faux()
    setFiltreComptes(f.guild.id, reglageRole)
    assert.deepStrictEqual(await appliquerFiltre(f.member, MAINTENANT), { action: "role", ok: true })
    assert.strictEqual(f.appels[0][0], "role")

    f = faux({ roleExiste: false })
    setFiltreComptes(f.guild.id, reglageRole)
    let r = await appliquerFiltre(f.member, MAINTENANT)
    assert.strictEqual(r.ok, false)
    assert.strictEqual(f.appels.length, 0)

    f = faux({ haut: true })
    setFiltreComptes(f.guild.id, reglageRole)
    r = await appliquerFiltre(f.member, MAINTENANT)
    assert.strictEqual(r.ok, false)
    assert.strictEqual(f.appels.length, 0)
})

test("bienvenue : pas envoyée si expulsé, envoyée sinon", async () => {
    const handler = require('../Events/guildMemberAdd')
    const preparer = f => {
        const envois = []
        f.guild.channels.cache.set("c1", { id: "c1", isTextBased: () => true, permissionsFor: () => ({ has: () => true }), send: async m => { envois.push(m) } })
        db.setWelcome(f.guild.id, "bienvenue", "c1", "Salut {membre}")
        return envois
    }
    // Compte récent : expulsé, pas de bienvenue (l'arrivée est dans le passé réel : on rend le compte tout neuf)
    let f = faux()
    f.member.user.createdTimestamp = Date.now()
    setFiltreComptes(f.guild.id, reglage)
    let envois = preparer(f)
    await handler({}, f.member)
    assert.strictEqual(envois.length, 0)
    assert.deepStrictEqual(f.appels.map(a => a[0]), ["mp", "kick"])

    // Compte ancien : bienvenue envoyée
    f = faux({ age: 30 })
    f.member.user.createdTimestamp = Date.now() - 30 * JOUR
    setFiltreComptes(f.guild.id, reglage)
    envois = preparer(f)
    await handler({}, f.member)
    assert.strictEqual(envois.length, 1)

    // Expulsion ratée : le membre reste, la bienvenue part
    f = faux({ kickErreur: true })
    f.member.user.createdTimestamp = Date.now()
    setFiltreComptes(f.guild.id, reglage)
    envois = preparer(f)
    await handler({}, f.member)
    assert.strictEqual(envois.length, 1)
})
