process.env.DATABASE_PATH = ":memory:"

const { test, beforeEach } = require('node:test')
const assert = require('assert')
const cooldowns = require('../Fonctions/cooldowns')

const G = "111111111111111111", U = "222222222222222222", V = "333333333333333333"
beforeEach(() => cooldowns.vider())

test("sans cooldown déclaré, la commande est toujours libre", () => {
    assert.strictEqual(cooldowns.prendre("ping", undefined, G, U), 0)
    assert.strictEqual(cooldowns.prendre("ping", 0, G, U), 0)
    assert.strictEqual(cooldowns.prendre("ping", 0, G, U), 0)
})

test("le 2e appel dans le délai est refusé avec le temps restant, puis libre après", () => {
    const t0 = 1_000_000
    assert.strictEqual(cooldowns.prendre("quiz", 5, G, U, t0), 0)
    assert.strictEqual(cooldowns.prendre("quiz", 5, G, U, t0 + 2000), 3000)
    assert.strictEqual(cooldowns.prendre("quiz", 5, G, U, t0 + 5000), 0, "libre pile à la fin du délai")
})

test("le délai est propre à chaque membre, serveur et commande", () => {
    const t0 = 1_000_000
    cooldowns.prendre("quiz", 60, G, U, t0)
    assert.strictEqual(cooldowns.prendre("quiz", 60, G, V, t0), 0, "autre membre")
    assert.strictEqual(cooldowns.prendre("quiz", 60, "999999999999999999", U, t0), 0, "autre serveur")
    assert.strictEqual(cooldowns.prendre("pendu", 60, G, U, t0), 0, "autre commande")
    assert.strictEqual(cooldowns.prendre("quiz", 60, null, U, t0), 0, "en MP")
})

test("deux appels au même instant : un seul passe", () => {
    const resultats = [1, 2].map(() => cooldowns.prendre("duel", 10, G, U, 5000))
    assert.deepStrictEqual(resultats.map(r => r === 0), [true, false])
})

test("liberer() rend la commande disponible", () => {
    cooldowns.prendre("quiz", 60, G, U)
    cooldowns.liberer("quiz", G, U)
    assert.strictEqual(cooldowns.prendre("quiz", 60, G, U), 0)
})

test("verifierCommande lit le champ cooldown de la commande", () => {
    const i = { guildId: G, user: { id: U } }
    assert.strictEqual(cooldowns.verifierCommande({ name: "x", cooldown: 3 }, i, 0), 0)
    assert.strictEqual(cooldowns.verifierCommande({ name: "x", cooldown: 3 }, i, 1000), 2000)
})

test("la purge retire les délais expirés", () => {
    cooldowns.prendre("a", 1, G, U, 0)
    cooldowns.prendre("b", 100, G, U, 0)
    cooldowns.purger(5000)
    assert.strictEqual(cooldowns.prendre("a", 1, G, U, 5000), 0)
    assert.ok(cooldowns.prendre("b", 100, G, U, 5000) > 0)
})

test("une commande qui échoue libère son délai (A8)", async () => {
    const Discord = require('discord.js')
    const interactionCreate = require('../Events/interactionCreate')
    let appels = 0
    const commande = { name: "fragile", module: "general", permission: "Aucune", cooldown: 60,
        run: async () => { appels++; if (appels === 1) throw new Error("panne") } }
    const bot = { commands: new Discord.Collection([["fragile", commande]]) }
    const appel = () => ({
        commandName: "fragile", guildId: G, channelId: "1", locale: "fr", user: { id: U },
        inGuild: () => true, memberPermissions: new Discord.PermissionsBitField([]), member: { roles: { cache: new Set() } },
        isAutocomplete: () => false, isChatInputCommand: () => true, isRepliable: () => true, options: {},
        replied: false, deferred: false, reply: async () => {}, followUp: async () => {}
    })
    const erreur = console.error
    console.error = () => {}
    try {
        await interactionCreate(bot, appel())
        await interactionCreate(bot, appel())
        await interactionCreate(bot, appel())
    } finally { console.error = erreur }
    assert.strictEqual(appels, 2, "réessai permis après l'échec, puis délai normal après le succès")
})
