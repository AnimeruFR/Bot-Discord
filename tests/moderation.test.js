process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const { checkHierarchy, formatReason, auditReason, parseDuree, formatDuree, fetchMember } = require('../Fonctions/moderation')
const verrou = require('../Fonctions/verrou')
const { role, erreurDiscord } = require('./aides')

const G5 = "555555555555555553", U2 = "333333333333333334"

const fakeInteraction = (userId, position) => ({
    user: { id: userId },
    guild: { ownerId: "owner" },
    client: { user: { id: "bot" } },
    member: { roles: { highest: role(position) } }
})
const target = (id, position) => ({ id, roles: { highest: role(position) } })

test("hiérarchie des rôles", async () => {
    assert.ok(checkHierarchy(fakeInteraction("mod", 5), target("mod", 1), "ban"), "se bannir soi-même")
    assert.ok(checkHierarchy(fakeInteraction("mod", 5), target("owner", 1), "ban"), "bannir le propriétaire")
    assert.ok(checkHierarchy(fakeInteraction("mod", 5), target("bot", 1), "ban"), "bannir le bot")
    assert.ok(checkHierarchy(fakeInteraction("mod", 5), target("x", 5), "ban"), "rôle égal")
    assert.ok(checkHierarchy(fakeInteraction("mod", 5), target("x", 9), "ban"), "rôle supérieur")
    assert.strictEqual(checkHierarchy(fakeInteraction("mod", 5), target("x", 2), "ban"), null, "rôle inférieur")
    assert.strictEqual(checkHierarchy(fakeInteraction("owner", 1), target("x", 9), "ban"), null, "le propriétaire peut tout")
})

test("raisons", async () => {
    assert.strictEqual(formatReason(null), "Aucune raison fournie")
    assert.strictEqual(formatReason("   "), "Aucune raison fournie")
    assert.ok(!formatReason("***gras***").includes("***"), "markdown échappé")
    assert.ok(formatReason("[Faire appel](https://exemple.com)").startsWith("\\["), "lien déguisé échappé")
    assert.ok(auditReason({ user: { tag: "mod" } }, "x".repeat(2000)).length <= 512, "raison d'audit tronquée")
})

test("durées", async () => {
    assert.strictEqual(parseDuree("1h", { max: 2 * 3600000 }).duree, 3600000)
    assert.ok(parseDuree("abc", { max: 1e9 }).erreur, "durée illisible refusée")
    assert.ok(parseDuree("30s", { max: 1e9 }).erreur, "moins d'une minute refusé par défaut")
    assert.ok(parseDuree("400d", { max: 365 * 86400000 }).erreur, "plus que le maximum refusé")
    assert.ok(parseDuree("-5m", { max: 1e9 }).erreur, "durée négative refusée")
    assert.strictEqual(formatDuree(90000000), "1 jour et 1 heure")
    assert.strictEqual(formatDuree(2 * 60000), "2 minutes")
})

const { Flags } = Discord.PermissionsBitField
const ow = (id, allow, deny) => ({ id, type: Discord.OverwriteType.Role, allow: new Discord.PermissionsBitField(allow), deny: new Discord.PermissionsBitField(deny) })
const overwrites = new Discord.Collection([
    [G5, ow(G5, Flags.AddReactions, Flags.CreatePrivateThreads)],
    ["777777777777777770", ow("777777777777777770", Flags.SendMessages, 0n)]
])
const modifs = []
const salonVerrou = {
    id: "999999999999999991",
    guild: { id: G5, roles: { everyone: { id: G5 } } },
    permissionOverwrites: { cache: overwrites, edit: async (cible, droits) => modifs.push(droits) }
}

test("verrouillage : état de @everyone et rôles qui écrivent encore", async () => {
    assert.deepStrictEqual(verrou.etatEveryone(salonVerrou), {
        SendMessages: null, SendMessagesInThreads: null, CreatePublicThreads: null, CreatePrivateThreads: false, AddReactions: true
    })
    assert.deepStrictEqual(verrou.rolesQuiEcriventEncore(salonVerrou), ["<@&777777777777777770>"], "rôle qui garde le droit d'écrire signalé")
})

test("/lock et /unlock", async () => {
    assert.strictEqual(await verrou.verrouiller(salonVerrou, "test"), true)
    assert.strictEqual(await verrou.verrouiller(salonVerrou, "test"), false, "double /lock refusé")
    assert.deepStrictEqual(modifs[0], { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false, CreatePrivateThreads: false, AddReactions: false })
    assert.strictEqual(await verrou.deverrouiller(salonVerrou, "test"), true)
    assert.deepStrictEqual(modifs[1], { SendMessages: null, SendMessagesInThreads: null, CreatePublicThreads: null, CreatePrivateThreads: false, AddReactions: true }, "état d'avant restauré")
    assert.strictEqual(await verrou.deverrouiller(salonVerrou, "test"), false, "rien à déverrouiller")
})

test("relecture des membres (erreurs)", async () => {
    const guildErreur = code => ({ members: { fetch: async () => { throw erreurDiscord(code) } } })
    assert.strictEqual(await fetchMember(guildErreur(Discord.RESTJSONErrorCodes.UnknownMember), U2), null)
    await assert.rejects(fetchMember(guildErreur(500), U2), "erreur passagère relancée")
})
