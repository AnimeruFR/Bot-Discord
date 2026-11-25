process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const { traiterTempbans } = require('../Fonctions/tempbans')
const { appliquerSeuil, sanctionInterdite, marqueurTempban } = require('../Fonctions/sanctions')
const { role, erreurDiscord } = require('./aides')

const { Flags } = Discord.PermissionsBitField
const G2 = "222222222222222222", G5 = "555555555555555553", G6 = "555555555555555554", G7 = "555555555555555556"
const U2 = "333333333333333334", MOD = "444444444444444444"

test("historique des sanctions", async () => {
    const idWarn = db.addWarn(G5, U2, MOD, "insulte")
    const numeroKick = db.addCase(G5, { userId: U2, moderatorId: MOD, type: "kick", reason: "  " })
    let historique = db.listCases(G5, U2)
    assert.strictEqual(historique.length, 2, "le warn apparaît dans l'historique")
    assert.strictEqual(historique[0].id, numeroKick, "du plus récent au plus ancien")
    assert.strictEqual(historique[0].reason, "Aucune raison fournie")
    assert.strictEqual(historique[1].warn_id, idWarn)
    db.removeWarn(G5, idWarn)
    historique = db.listCases(G5, U2)
    assert.strictEqual(historique[1].reason, "(avertissement retiré)", "raison d'un warn retiré effacée de l'historique")
    assert.strictEqual(db.countCases(G2, U2), 0, "historique isolé par serveur")
    assert.strictEqual(db.purgeOldCases(Date.now() - 1000), 0, "rien de récent n'est purgé")
})

test("seuils, verrous et effacement RGPD des nouvelles tables", async () => {
    db.setThreshold(G5, 3, "mute", 3600000)
    db.setThreshold(G5, 3, "kick", null)
    assert.deepStrictEqual(db.listThresholds(G5).map(s => [s.warns, s.action]), [[3, "kick"]], "un seul seuil par nombre de warns")
    assert.strictEqual(db.getThreshold(G2, 3), null, "seuils isolés par serveur")

    db.setTempban(G5, U2, Date.now() + 1000)
    assert.ok(db.addLock(G5, "999999999999999990", { SendMessages: null }))
    assert.strictEqual(db.addLock(G5, "999999999999999990", {}), false, "un salon ne se verrouille qu'une fois")
    assert.strictEqual(db.deleteGuildData(G5), 5, "historique, seuils, tempbans et verrous effacés par /privacy")
    assert.strictEqual(db.listThresholds(G5).length, 0)
})

test("débans automatiques (retard, déban manuel, re-ban, permission perdue puis retrouvée)", async () => {
    const passe = Date.now() - 1000
    // A = tempban normal, B = re-banni à la main, C = déjà débanni, D = permission perdue,
    // E = pas encore fini, F = marqueur imité (autre date que celle en base)
    const bans = {
        A: { user: { id: "A" }, reason: `${marqueurTempban(passe)} modo : spam` },
        B: { user: { id: "B" }, reason: "modo : re-banni définitivement" },
        D: { user: { id: "D" }, reason: `${marqueurTempban(passe)} modo : x` },
        E: { user: { id: "E" }, reason: `${marqueurTempban(passe + 3600000)} modo : x` },
        F: { user: { id: "F" }, reason: `${marqueurTempban(passe)} faux marqueur` }
    }
    const debannis = []
    const guildTest = {
        id: G6, available: true, channels: { cache: new Discord.Collection() },
        bans: {
            fetch: async ({ user }) => {
                if (!bans[user]) throw erreurDiscord(Discord.RESTJSONErrorCodes.UnknownBan)
                return bans[user]
            },
            remove: async user => {
                if (user === "D") throw erreurDiscord(Discord.RESTJSONErrorCodes.MissingPermissions)
                debannis.push(user)
            }
        }
    }
    for (const u of ["A", "B", "C", "D"]) db.setTempban(G6, u, passe)
    db.setTempban(G6, "E", passe + 3600000)
    db.setTempban(G6, "F", passe - 5)
    db.setTempban(G7, "A", passe)
    const botTest = { user: { id: "bot", tag: "bot" }, guilds: { cache: new Discord.Collection([[G6, guildTest]]) } }

    assert.strictEqual(await traiterTempbans(botTest), 1, "un seul déban")
    assert.deepStrictEqual(debannis, ["A"], "seul le vrai tempban expiré est levé")
    assert.strictEqual(db.getTempban(G6, "A"), null)
    assert.strictEqual(db.getTempban(G6, "B"), null, "re-banni à la main : entrée oubliée, pas de déban")
    assert.strictEqual(db.getTempban(G6, "C"), null, "déjà débanni : on n'insiste pas")
    assert.strictEqual(db.getTempban(G6, "D"), passe, "permission perdue : échéance d'origine gardée")
    assert.ok(!db.expiredTempbans().some(t => t.user_id === "D"), "permission perdue : nouvel essai plus tard seulement")
    assert.ok(db.getTempban(G6, "E"), "pas encore terminé : rien ne change")
    assert.strictEqual(db.getTempban(G6, "F"), null, "marqueur imité : pas de déban")
    assert.ok(db.getTempban(G7, "A"), "serveur absent : entrée gardée")
    assert.strictEqual(db.listCases(G6, "A")[0].type, "unban")

    // 6 h plus tard, la permission est revenue : le ban reporté est bien levé (le marqueur correspond toujours)
    guildTest.bans.remove = async user => debannis.push(user)
    assert.strictEqual(await traiterTempbans(botTest, Date.now() + 7 * 3600000), 2, "D (reporté) et E (arrivé à échéance) levés")
    assert.deepStrictEqual(debannis.sort(), ["A", "D", "E"])
    assert.strictEqual(db.getTempban(G6, "D"), null)
})

test("sanctions automatiques (seuil exact, permission du modérateur)", async () => {
    db.setThreshold(G6, 2, "ban", null)
    const membreCible = { id: U2, roles: { highest: role(1) }, bannable: true }
    const interactionSeuil = perm => ({
        guild: {
            id: G6, ownerId: "owner", name: "test",
            members: { fetch: async () => membreCible },
            bans: { create: async () => { throw new Error("ne doit pas bannir") } }
        },
        user: { id: MOD, tag: "modo" }, client: { user: { id: "bot" } },
        member: { roles: { highest: role(5) } },
        memberPermissions: new Discord.PermissionsBitField(perm)
    })
    assert.strictEqual(await appliquerSeuil(interactionSeuil(Flags.ModerateMembers), { id: U2 }, 1), null, "pas de seuil à 1 warn")
    assert.match(await appliquerSeuil(interactionSeuil(Flags.ModerateMembers), { id: U2 }, 2), /non appliquée.*permission/, "modérateur sans BanMembers : pas de ban")
    assert.strictEqual(await appliquerSeuil(interactionSeuil(Flags.ModerateMembers), { id: U2 }, 3), null, "seuil exact uniquement")
})

test("warn refusé si le seuil atteint est une sanction que l'auteur ne peut pas appliquer", async () => {
    const G8 = "555555555555555557"
    db.setThreshold(G8, 2, "ban", null)
    const interaction = perm => ({ guild: { id: G8 }, memberPermissions: new Discord.PermissionsBitField(perm) })
    assert.match(sanctionInterdite(interaction(Flags.ModerateMembers), 2), /ban/, "sans BanMembers : refusé")
    assert.strictEqual(sanctionInterdite(interaction(Flags.ModerateMembers | Flags.BanMembers), 2), null, "avec la permission : accepté")
    assert.strictEqual(sanctionInterdite(interaction(Flags.ModerateMembers), 1), null, "pas de seuil à ce total")
})

test("unwarn d'un membre absent : le rôle staff seul ne suffit pas", async () => {
    const G9 = "555555555555555558"
    const unwarn = require('../Commandes/Moderation/unwarn')
    const idWarn = db.addWarn(G9, U2, "admin", "spam")
    const reponses = []
    const interaction = perm => ({
        guild: { id: G9, members: { fetch: async () => { throw new Error("absent") } } },
        user: { id: MOD }, memberPermissions: new Discord.PermissionsBitField(perm),
        reply: async r => reponses.push(r)
    })
    const args = { getInteger: () => idWarn, getString: () => null }
    const bot = { users: { fetch: async () => null } }

    await unwarn.run(bot, interaction(0n), args)
    assert.ok(db.getWarn(G9, idWarn), "refusé : le warn est toujours là")
    assert.match(reponses[0].content, /rôle staff/)

    await unwarn.run(bot, interaction(Flags.ModerateMembers), args)
    assert.ok(!db.getWarn(G9, idWarn), "avec la permission : le warn est retiré")
})
