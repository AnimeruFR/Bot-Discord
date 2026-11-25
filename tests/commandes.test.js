process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const { chargerCommandes } = require('./aides')
const { buildSlashCommand } = require('../Loader/loadSlashCommands')

test("toutes les commandes se chargent et produisent une définition valide", async () => {
    const bot = chargerCommandes()
    assert.ok(bot.commands.size > 0, "au moins une commande chargée")
    for (const command of bot.commands.values()) buildSlashCommand(command).toJSON()
})

// Loader par module (idée #86) : le dossier décide du module
test("chaque commande appartient à un module connu", () => {
    const bot = chargerCommandes()
    const parModule = {}
    for (const c of bot.commands.values()) {
        assert.ok(["moderation", "communaute", "general"].includes(c.module), `module de ${c.name}`)
        assert.ok(c.module !== "communaute" || /^[a-z]+$/.test(c.sousModule ?? ""), `sous-module de ${c.name}`)
        parModule[c.module] = (parModule[c.module] ?? 0) + 1
    }
    assert.ok(parModule.moderation && parModule.communaute && parModule.general, "les trois modules ont des commandes")
    assert.strictEqual(require('../Loader/loadCommands').listerCommandes().length, bot.commands.size, "un fichier = une commande")
})
