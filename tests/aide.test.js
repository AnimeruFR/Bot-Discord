process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const loadCommands = require('../Loader/loadCommands')
const interactionCreate = require('../Events/interactionCreate')

const { Flags } = Discord.PermissionsBitField
const G = "111111111111111111", STAFF = "555555555555555555"
const bot = { commands: new Discord.Collection(), user: { displayAvatarURL: () => "https://cdn.discordapp.com/x.png", username: "bot" } }
loadCommands(bot, { silencieux: true })
const help = bot.commands.get("help")
const moderation = [...bot.commands.values()].filter(c => c.module === "moderation").map(c => c.name)

function membre({ perms = [], roles = [], guild = true, choix = null, focus = "" } = {}) {
    const reponses = []
    return {
        reponses, guildId: guild ? G : null, guild: guild ? { id: G } : null, locale: "fr", user: { id: "777777777777777777" },
        inGuild: () => guild, memberPermissions: guild ? new Discord.PermissionsBitField(perms) : null,
        member: guild ? { roles: { cache: new Set(roles) } } : null,
        options: { getString: () => choix, getFocused: () => focus },
        isAutocomplete: () => true,
        reply: async r => reponses.push(r), respond: async r => reponses.push(r)
    }
}
const noms = i => help.commandesVisibles(bot, i).map(c => c.name)
const texteEmbed = r => JSON.stringify(r.embeds[0].toJSON())

test("un membre normal ne voit aucune commande staff, ni dans /help ni en MP", () => {
    for (const i of [membre(), membre({ guild: false })]) {
        const visibles = noms(i)
        assert.ok(visibles.includes("help") && visibles.includes("ping"))
        for (const nom of moderation) assert.ok(!visibles.includes(nom), nom)
    }
})

test("le staff (permission ou rôle staff) voit les commandes de modération", () => {
    assert.ok(noms(membre({ perms: Flags.ModerateMembers })).includes("ban"))
    db.setStaffRole(G, STAFF)
    assert.ok(noms(membre({ roles: [STAFF] })).includes("warn"))
    db.setStaffRole(G, null)
})

test("un module désactivé disparaît de /help", () => {
    db.setModule(G, "communaute.animation", false)
    assert.ok(!noms(membre()).includes("quoi"))
    db.setModule(G, "communaute.animation", true)
    assert.ok(noms(membre()).includes("quoi"))
})

test("/help groupe par module et cache la Modération au membre", async () => {
    const i = membre()
    await help.run(bot, i, i.options)
    const texte = texteEmbed(i.reponses[0])
    assert.ok(texte.includes("Général") && texte.includes("Communauté"))
    assert.ok(!texte.includes("Modération") && !texte.includes("`ban`"))
    const s = membre({ perms: Flags.BanMembers | Flags.ModerateMembers })
    await help.run(bot, s, s.options)
    assert.ok(texteEmbed(s.reponses[0]).includes("Modération"))
})

test("/help ban : « inconnue » pour un membre, détail pour le staff", async () => {
    const i = membre({ choix: "ban" })
    await help.run(bot, i, i.options)
    assert.ok(!i.reponses[0].embeds && i.reponses[0].content)
    const s = membre({ choix: "ban", perms: Flags.BanMembers })
    await help.run(bot, s, s.options)
    assert.ok(texteEmbed(s.reponses[0]).includes("ban"))
})

test("l'autocomplétion ne propose pas les commandes staff à un membre", async () => {
    const i = membre({ focus: "ban" })
    await interactionCreate(bot, i)
    assert.deepStrictEqual(i.reponses[0], [])
    const s = membre({ focus: "ban", perms: Flags.BanMembers })
    await interactionCreate(bot, s)
    assert.ok(s.reponses[0].some(c => c.name === "ban"))
})
