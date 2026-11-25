process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const loadCommands = require('../Loader/loadCommands')
const { verifierAcces, verifierDeclaration, estStaff } = require('../Fonctions/staff')
const interactionCreate = require('../Events/interactionCreate')

const { Flags } = Discord.PermissionsBitField
const G = "111111111111111111", STAFF = "555555555555555555", AUTRE = "666666666666666666"

const bot = { commands: new Discord.Collection() }
loadCommands(bot, { silencieux: true })
const moderation = [...bot.commands.values()].filter(c => c.module === "moderation")

// Fausse interaction de commande : permissions et rôles du membre au choix
function fausse({ perms = [], roles = [], rolesBruts = false, guild = true, commande = "x" } = {}) {
    const bits = new Discord.PermissionsBitField(perms)
    const reponses = []
    return {
        reponses, commandName: commande, guildId: guild ? G : null, locale: "fr", user: { id: "777777777777777777" },
        channel: null, guild: guild ? { id: G, roles: { cache: new Map() } } : null,
        inGuild: () => guild,
        memberPermissions: guild ? bits : null,
        member: guild ? { roles: rolesBruts ? roles : { cache: new Set(roles) } } : null,
        isAutocomplete: () => false, isChatInputCommand: () => true, isRepliable: () => true,
        options: {}, replied: false, deferred: false,
        reply: async r => reponses.push(r), followUp: async r => reponses.push(r)
    }
}

test("toutes les commandes de modération déclarent une permission bigint et ne marchent pas en MP", () => {
    assert.ok(moderation.length >= 20)
    for (const c of moderation) {
        assert.strictEqual(typeof c.permission, "bigint", c.name)
        assert.ok(!c.dm, `${c.name} en MP`)
    }
})

test("une commande de modération mal déclarée empêche le chargement", () => {
    assert.throws(() => verifierDeclaration({ name: "x", module: "moderation", permission: "Aucune" }))
    assert.throws(() => verifierDeclaration({ name: "x", module: "moderation", permission: 0n }))
    assert.throws(() => verifierDeclaration({ name: "x", module: "moderation", permission: Flags.BanMembers, dm: true }))
    assert.doesNotThrow(() => verifierDeclaration({ name: "x", module: "general", permission: "Aucune" }))
})

test("chaque commande de modération refuse un membre sans permission ni rôle staff", async () => {
    db.setStaffRole(G, null)
    for (const c of moderation) {
        assert.strictEqual(await verifierAcces(fausse({ commande: c.name }), c), false, c.name)
        assert.strictEqual(await verifierAcces(fausse({ roles: [AUTRE], commande: c.name }), c), false, `${c.name} avec un rôle quelconque`)
        assert.strictEqual(await verifierAcces(fausse({ guild: false, commande: c.name }), c), false, `${c.name} hors serveur`)
    }
})

test("chaque commande de modération accepte un membre qui a sa permission", async () => {
    for (const c of moderation) assert.strictEqual(await verifierAcces(fausse({ perms: c.permission }), c), true, c.name)
})

test("le rôle staff suffit seulement pour les commandes qui le déclarent", async () => {
    db.setStaffRole(G, STAFF)
    const suffit = moderation.filter(c => c.roleStaffSuffit).map(c => c.name).sort()
    assert.deepStrictEqual(suffit, ["historique", "unwarn", "warn", "warns"])
    for (const c of moderation) {
        const attendu = Boolean(c.roleStaffSuffit)
        assert.strictEqual(await verifierAcces(fausse({ roles: [STAFF] }), c), attendu, `${c.name} (rôle en cache)`)
        assert.strictEqual(await verifierAcces(fausse({ roles: [STAFF], rolesBruts: true }), c), attendu, `${c.name} (membre brut de l'API)`)
    }
    // Un rôle staff ne fait jamais bannir, expulser ou effacer des messages
    for (const nom of ["ban", "tempban", "kick", "mute", "clear", "lock", "automod", "setlogs"]) {
        assert.strictEqual(await verifierAcces(fausse({ roles: [STAFF] }), bot.commands.get(nom)), false, nom)
    }
    db.setStaffRole(G, null)
    assert.strictEqual(await verifierAcces(fausse({ roles: [STAFF] }), bot.commands.get("warn")), false, "rôle retiré de la config")
})

test("hors Modération, seule la permission déclarée compte", async () => {
    assert.strictEqual(await verifierAcces(fausse(), bot.commands.get("ping")), true)
    const giveaway = bot.commands.get("giveaway")
    assert.strictEqual(await verifierAcces(fausse(), giveaway), false)
    assert.strictEqual(await verifierAcces(fausse({ perms: giveaway.permission }), giveaway), true)
})

test("estStaff : permission de modération ou rôle staff", () => {
    db.setStaffRole(G, STAFF)
    assert.strictEqual(estStaff(fausse()), false)
    assert.strictEqual(estStaff(fausse({ perms: Flags.ModerateMembers })), true)
    assert.strictEqual(estStaff(fausse({ roles: [STAFF] })), true)
    assert.strictEqual(estStaff(fausse({ guild: false })), false)
    db.setStaffRole(G, null)
})

test("de bout en bout : la commande n'est jamais exécutée pour un membre refusé", async () => {
    let executee = false
    const piege = { name: "piege", module: "moderation", permission: Flags.BanMembers, run: async () => { executee = true } }
    const faux = { commands: new Discord.Collection([["piege", piege]]) }
    const i = fausse({ commande: "piege" })
    await interactionCreate(faux, i)
    assert.strictEqual(executee, false)
    assert.ok(i.reponses[0].flags, "refus éphémère")
    await interactionCreate(faux, fausse({ commande: "piege", perms: Flags.BanMembers }))
    assert.strictEqual(executee, true)
})
