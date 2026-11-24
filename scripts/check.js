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
