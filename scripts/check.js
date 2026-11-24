// Vérifications hors ligne : aucune connexion à Discord, aucun token nécessaire
// Base en mémoire : les tests ne touchent jamais à data/bot.db
process.env.DATABASE_PATH = ":memory:"

const assert = require('assert')
const Discord = require('discord.js')
const loadCommands = require('../Loader/loadCommands')
const { buildSlashCommand } = require('../Loader/loadSlashCommands')
const { checkHierarchy, formatReason, auditReason } = require('../Fonctions/moderation')
const { ticketOwnerId } = require('../Fonctions/tickets')

// 1. Toutes les commandes se chargent et produisent une définition valide
const bot = { commands: new Discord.Collection() }
loadCommands(bot, { silencieux: true })
for (const command of bot.commands.values()) buildSlashCommand(command).toJSON()
console.log(`OK : ${bot.commands.size} commandes valides`)

// 2. Hiérarchie des rôles
const role = position => ({ comparePositionTo: other => position - other.position, position })
const fakeInteraction = (userId, position) => ({
    user: { id: userId },
    guild: { ownerId: "owner" },
    client: { user: { id: "bot" } },
    member: { roles: { highest: role(position) } }
})
const target = (id, position) => ({ id, roles: { highest: role(position) } })

assert.ok(checkHierarchy(fakeInteraction("mod", 5), target("mod", 1), "ban"), "se bannir soi-même")
assert.ok(checkHierarchy(fakeInteraction("mod", 5), target("owner", 1), "ban"), "bannir le propriétaire")
assert.ok(checkHierarchy(fakeInteraction("mod", 5), target("bot", 1), "ban"), "bannir le bot")
assert.ok(checkHierarchy(fakeInteraction("mod", 5), target("x", 5), "ban"), "rôle égal")
assert.ok(checkHierarchy(fakeInteraction("mod", 5), target("x", 9), "ban"), "rôle supérieur")
assert.strictEqual(checkHierarchy(fakeInteraction("mod", 5), target("x", 2), "ban"), null, "rôle inférieur")
assert.strictEqual(checkHierarchy(fakeInteraction("owner", 1), target("x", 9), "ban"), null, "le propriétaire peut tout")
console.log("OK : hiérarchie des rôles")

// 3. Raisons
assert.strictEqual(formatReason(null), "Aucune raison fournie")
assert.strictEqual(formatReason("   "), "Aucune raison fournie")
assert.ok(!formatReason("***gras***").includes("***"), "markdown échappé")
assert.ok(formatReason("[Faire appel](https://exemple.com)").startsWith("\\["), "lien déguisé échappé")
assert.ok(auditReason({ user: { tag: "mod" } }, "x".repeat(2000)).length <= 512, "raison d'audit tronquée")
console.log("OK : raisons")

// 4. Détection des tickets
const salon = (name, topic, type = Discord.ChannelType.GuildText) => ({ name, topic, type })
assert.strictEqual(ticketOwnerId(salon("ticket-bob", "123456789012345678")), "123456789012345678")
assert.strictEqual(ticketOwnerId(salon("general", "123456789012345678")), null)
assert.strictEqual(ticketOwnerId(salon("ticket-bob", "pas un id")), null)
assert.strictEqual(ticketOwnerId(salon("ticket-bob", "123456789012345678", Discord.ChannelType.GuildVoice)), null)
assert.strictEqual(ticketOwnerId(salon("ferme-bob", "123456789012345678")), "123456789012345678")
assert.strictEqual(ticketOwnerId(null), null)
console.log("OK : détection des tickets")

// 5. Base de données
const db = require('../Fonctions/db')
const G1 = "111111111111111111", G2 = "222222222222222222", U = "333333333333333333", MOD = "444444444444444444"

const w1 = db.addWarn(G1, U, MOD, "spam")
const w2 = db.addWarn(G1, U, MOD, "'); DROP TABLE warns; --")
db.addWarn(G2, U, MOD, "autre serveur")
assert.strictEqual(db.countWarns(G1, U), 2)
assert.strictEqual(db.listWarns(G1, U)[0].reason, "'); DROP TABLE warns; --", "injection SQL stockée comme simple texte")
assert.strictEqual(db.listWarns(G1, U, 1).length, 1, "limite respectée")
assert.strictEqual(db.getWarn(G2, w1), undefined, "un serveur ne voit pas les warns d'un autre")
assert.strictEqual(db.removeWarn(G2, w1), false, "un serveur ne supprime pas les warns d'un autre")
assert.strictEqual(db.removeWarn(G1, w2), true)
assert.strictEqual(db.countWarns(G1, U), 1)
assert.strictEqual(db.countWarns(G2, U), 1)
console.log("OK : warns (isolation par serveur, injection SQL)")

assert.strictEqual(db.getLogChannel(G1), null)
db.setLogChannel(G1, "555555555555555555")
assert.strictEqual(db.getLogChannel(G1), "555555555555555555")
db.setLogChannel(G1, null)
assert.strictEqual(db.getLogChannel(G1), null)
console.log("OK : salon de logs")

assert.strictEqual(db.getTicketCooldown(G1, U), 0)
db.setTicketCooldown(G1, U)
assert.ok(Date.now() - db.getTicketCooldown(G1, U) < 1000)
db.purgeTicketCooldowns(Date.now() + 1)
assert.strictEqual(db.getTicketCooldown(G1, U), 0, "purge des vieux délais")
console.log("OK : délai des tickets")

assert.deepStrictEqual(db.getTicketConfig(G1), { categoryId: null, staffRoleId: null })
db.setLogChannel(G1, "555555555555555555")
db.setTicketConfig(G1, "666666666666666666", "777777777777777777")
assert.deepStrictEqual(db.getTicketConfig(G1), { categoryId: "666666666666666666", staffRoleId: "777777777777777777" })
assert.strictEqual(db.getLogChannel(G1), "555555555555555555", "la config des tickets n'écrase pas le salon de logs")
db.setLogChannel(G1, null)
assert.strictEqual(db.getTicketConfig(G1).staffRoleId, "777777777777777777", "le salon de logs n'écrase pas la config des tickets")
assert.deepStrictEqual(db.getTicketConfig(G2), { categoryId: null, staffRoleId: null }, "config isolée par serveur")
db.setTicketConfig(G1, null, "121212121212121212")
assert.deepStrictEqual(db.getTicketConfig(G1), { categoryId: "666666666666666666", staffRoleId: "121212121212121212" }, "changer le rôle garde la catégorie")
db.resetTicketConfig(G1)
assert.deepStrictEqual(db.getTicketConfig(G1), { categoryId: null, staffRoleId: null }, "réinitialisation")
console.log("OK : configuration des tickets")

// 6. Rôle staff
const { roleValide } = require('../Fonctions/tickets')
const roles = new Discord.Collection([
    [G1, { id: G1, managed: false }],
    ["888888888888888888", { id: "888888888888888888", managed: true }],
    ["999999999999999999", { id: "999999999999999999", managed: false }]
])
const guildFactice = { id: G1, roles: { cache: roles } }
assert.ok(!roleValide(guildFactice, G1), "@everyone refusé")
assert.ok(!roleValide(guildFactice, "888888888888888888"), "rôle de bot refusé")
assert.ok(!roleValide(guildFactice, "123"), "rôle inexistant refusé")
assert.ok(!roleValide(guildFactice, null))
assert.ok(roleValide(guildFactice, "999999999999999999"))
console.log("OK : rôle staff")

// 7. Transcript (250 messages factices, pagination par 100)
const { buildTranscript } = require('../Fonctions/transcript')
const faux = Array.from({ length: 250 }, (_, i) => ({
    id: String(1000 + i),
    content: i === 0 ? "premier\nsur deux lignes" : `message ${i}`,
    createdTimestamp: Date.UTC(2026, 0, 1) + i * 60000,
    author: { tag: "membre", id: U },
    attachments: new Discord.Collection(i === 5 ? [["a", { name: "preuve.png", url: "https://cdn.exemple/preuve.png" }]] : []),
    embeds: []
}))
const salonFactice = {
    name: "ticket-bob",
    createdTimestamp: Date.UTC(2026, 0, 1),
    client: { application: { fetch: async () => ({ flags: new Discord.ApplicationFlagsBitField(0) }) } },
    messages: {
        // Comme Discord : du plus récent au plus ancien, avant l'ID "before"
        fetch: async ({ limit, before }) => {
            const avant = faux.filter(m => !before || Number(m.id) < Number(before)).reverse().slice(0, limit)
            return new Discord.Collection(avant.map(m => [m.id, m]))
        }
    }
}
buildTranscript(salonFactice, { fermePar: { tag: "modo", id: MOD }, auteurId: U }).then(({ texte, nombre }) => {
    assert.strictEqual(nombre, 250, "toutes les pages sont lues")
    assert.ok(texte.indexOf("premier") < texte.indexOf("message 249"), "ordre chronologique")
    assert.ok(texte.includes("premier\n    sur deux lignes"), "lignes multiples indentées")
    assert.ok(texte.includes("[pièce jointe] preuve.png"), "pièces jointes listées")
    assert.ok(texte.includes("Message Content Intent"), "avertissement si l'intent est absent")
    console.log("OK : transcript")
})

// 8. Transcript trop gros : on garde les messages les plus récents sous la limite d'envoi de Discord
const { MAX_OCTETS_TRANSCRIPT, sendAttachments } = require('../Fonctions/transcript')
const enorme = Array.from({ length: 1000 }, (_, i) => ({
    id: String(10000 + i),
    content: `${i} ` + "😀".repeat(2000), // ~8 Ko par message, ~8 Mo au total
    createdTimestamp: Date.UTC(2026, 0, 1) + i * 1000,
    author: { tag: "membre", id: U },
    attachments: new Discord.Collection(),
    embeds: []
}))
const gros = { ...salonFactice, messages: { fetch: async ({ limit, before }) => {
    const avant = enorme.filter(m => !before || Number(m.id) < Number(before)).reverse().slice(0, limit)
    return new Discord.Collection(avant.map(m => [m.id, m]))
} } }
buildTranscript(gros, { fermePar: { tag: "modo", id: MOD }, auteurId: U }).then(({ texte, nombre }) => {
    assert.ok(Buffer.byteLength(texte, "utf8") <= MAX_OCTETS_TRANSCRIPT + 4096, "taille sous la limite")
    assert.ok(nombre < 1000 && texte.includes("999 "), "on garde les plus récents")
    assert.ok(texte.includes("tronqué"), "troncature signalée")
    console.log("OK : transcript tronqué sous la limite de taille")
})

// 9. Pièces jointes : seul le CDN de Discord est téléchargé, rien de trop lourd
const envois = []
const logsFactice = { send: async m => envois.push(m) }
sendAttachments(logsFactice, [
    { name: "piege.png", url: "http://169.254.169.254/latest/meta-data", size: 10 },
    { name: "enorme.mp4", url: "https://cdn.discordapp.com/x/enorme.mp4", size: 50 * 1024 * 1024 }
], "ticket-bob").then(ignorees => {
    assert.deepStrictEqual(ignorees.sort(), ["enorme.mp4", "piege.png"], "hôte inconnu et fichier trop lourd ignorés")
    assert.strictEqual(envois.length, 0, "aucun téléchargement ni envoi")
    console.log("OK : pièces jointes filtrées")
}).then(async () => {
    // fetch simulé : 404 -> ignorée, 503 puis 200 -> retentée et envoyée, redirection interdite
    const appels = []
    const reponses = { "/supprime.png": [404], "/instable.png": [503, 200] }
    global.fetch = async (url, options) => {
        assert.strictEqual(options.redirect, "error", "pas de redirection suivie")
        appels.push(url.pathname)
        const status = reponses[url.pathname].shift()
        return { ok: status === 200, status, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(4) }
    }
    envois.length = 0
    const ignorees = await sendAttachments(logsFactice, [
        { name: "supprime.png", url: "https://cdn.discordapp.com/supprime.png", size: 4 },
        { name: "instable.png", url: "https://cdn.discordapp.com/instable.png", size: 4 }
    ], "ticket-bob")
    assert.deepStrictEqual(ignorees, ["supprime.png"], "fichier supprimé ignoré")
    assert.strictEqual(appels.filter(a => a === "/instable.png").length, 2, "erreur passagère retentée")
    assert.strictEqual(envois.length, 1, "fichier instable finalement envoyé")
    console.log("OK : téléchargement des pièces jointes (404, nouvel essai)")
})
