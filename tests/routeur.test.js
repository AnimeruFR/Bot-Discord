process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('assert')
const Discord = require('discord.js')
const { creerRouteur } = require('../Fonctions/routeur')
const loadCommands = require('../Loader/loadCommands')

const { Flags } = Discord.PermissionsBitField
const G = "111111111111111111"

// Faux composant : type et customId au choix, permissions du membre au choix
function clic(customId, { type = "bouton", perms = [], guild = true } = {}) {
    return {
        customId, guildId: guild ? G : null, locale: "fr",
        isButton: () => type === "bouton", isAnySelectMenu: () => type === "menu", isModalSubmit: () => type === "modal",
        inGuild: () => guild,
        memberPermissions: guild ? new Discord.PermissionsBitField(perms) : null,
        member: guild ? { roles: { cache: new Set() } } : null
    }
}

test("id exact et préfixe sont routés vers le bon gestionnaire", async () => {
    const r = creerRouteur(), appels = []
    r.enregistrer({ id: "close", types: ["bouton"], public: true, gestionnaire: () => appels.push("close") })
    r.enregistrer({ prefixe: "jeu:", types: ["bouton", "menu"], public: true, gestionnaire: (_, i) => appels.push(i.customId) })
    assert.strictEqual(await r.router(null, clic("close")), true)
    assert.strictEqual(await r.router(null, clic("jeu:42", { type: "menu" })), true)
    assert.strictEqual(await r.router(null, clic("closeX")), false, "un id exact ne capte pas un id plus long")
    assert.strictEqual(await r.router(null, clic("close", { type: "modal" })), false, "mauvais type")
    assert.strictEqual(await r.router(null, clic("confirmer-ban")), false, "inconnu : laissé au collecteur de la commande")
    assert.deepStrictEqual(appels, ["close", "jeu:42"])
})

test("déclarations invalides ou en collision refusées", () => {
    const r = creerRouteur(), g = () => {}
    r.enregistrer({ prefixe: "jeu:", types: ["bouton"], gestionnaire: g })
    assert.throws(() => r.enregistrer({ prefixe: "jeu:", types: ["bouton"], gestionnaire: g }), /déjà pris/)
    assert.throws(() => r.enregistrer({ id: "jeu:1", types: ["bouton"], gestionnaire: g }), /déjà pris/)
    assert.throws(() => r.enregistrer({ prefixe: "je", types: ["bouton"], gestionnaire: g }), /finit par/)
    assert.throws(() => r.enregistrer({ id: "x", prefixe: "y:", types: ["bouton"], gestionnaire: g }), /soit un id/)
    assert.throws(() => r.enregistrer({ id: "x", types: ["clavier"], gestionnaire: g }), /types/)
    assert.throws(() => r.enregistrer({ id: "x", types: ["bouton"] }), /gestionnaire/)
    assert.doesNotThrow(() => r.enregistrer({ prefixe: "jeu:", types: ["modal"], gestionnaire: g }), "même préfixe, autre type")
})

test("un composant du module Modération passe par la garde staff", async () => {
    const r = creerRouteur()
    let execute = 0, refus = 0
    r.enregistrerCommande({
        name: "signaler", module: "moderation", permission: Flags.ModerateMembers,
        composants: [{ prefixe: "mod:", types: ["bouton"], gestionnaire: () => execute++ }]
    })
    const refuser = async () => refus++
    assert.strictEqual(await r.router(null, clic("mod:warn:1"), refuser), true)
    assert.deepStrictEqual([execute, refus], [0, 1], "membre sans droit : refusé, gestionnaire jamais appelé")
    await r.router(null, clic("mod:warn:1", { perms: Flags.ModerateMembers }), refuser)
    assert.deepStrictEqual([execute, refus], [1, 1])
    await r.router(null, clic("mod:warn:1", { guild: false, perms: Flags.ModerateMembers }), refuser)
    assert.deepStrictEqual([execute, refus], [1, 2], "hors serveur : refusé")
})

test("les composants existants sont tous enregistrés, sans collision", async () => {
    const bot = { commands: new Discord.Collection(), routeur: creerRouteur() }
    loadCommands(bot, { silencieux: true })
    const appeles = []
    for (const route of bot.routeur.routes) {
        assert.ok(route.public, `${route.id ?? route.prefixe} : composant cliqué par les membres, déclaré public`)
        route.gestionnaire = (_, i) => appeles.push(i.customId)
    }
    for (const [id, type] of [["ticket", "bouton"], ["close", "bouton"], ["claim", "bouton"], ["note:12", "bouton"],
        ["ticket-type", "menu"], ["ticket-form:3", "modal"], ["role:7", "bouton"], ["giveaway:9", "bouton"]]) {
        assert.strictEqual(await bot.routeur.router(bot, clic(id, { type })), true, id)
    }
    assert.strictEqual(appeles.length, 8)
})
