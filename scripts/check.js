// Vérifications hors ligne : aucune connexion à Discord, aucun token nécessaire
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
