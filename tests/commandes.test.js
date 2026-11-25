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
