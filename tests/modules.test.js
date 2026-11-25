process.env.DATABASE_PATH = ":memory:"

const { test, afterEach } = require('node:test')
const assert = require('assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const modules = require('../Fonctions/modules')
const { creerRouteur } = require('../Fonctions/routeur')
const interactionCreate = require('../Events/interactionCreate')

const G = "111111111111111111", G2 = "222222222222222222", SALON = "333333333333333333", AUTRE = "444444444444444444"
const jeu = { name: "quiz", module: "communaute", sousModule: "jeux" }
const animation = { name: "giveaway", module: "communaute", sousModule: "animation" }
const warn = { name: "warn", module: "moderation", sousModule: null }
const aide = { name: "help", module: "general", sousModule: null }

afterEach(() => { delete process.env.DESACTIVER })

test("par défaut, tout est actif", () => {
    for (const c of [jeu, animation, warn, aide]) assert.strictEqual(modules.motifIndisponible(G, c), null, c.name)
})

test("désactiver un module ou un sous-module, serveur par serveur", () => {
    db.setModule(G, "communaute.jeux", false)
    assert.strictEqual(modules.motifIndisponible(G, jeu), "desactive")
    assert.strictEqual(modules.motifIndisponible(G, animation), null, "les autres sous-modules restent actifs")
    assert.strictEqual(modules.motifIndisponible(G2, jeu), null, "autre serveur non touché")

    db.setModule(G, "communaute.jeux", true)
    db.setModule(G, "communaute", false)
    assert.strictEqual(modules.motifIndisponible(G, jeu), "desactive", "module parent désactivé")
    assert.strictEqual(modules.motifIndisponible(G, animation), "desactive")
    db.setModule(G, "communaute", true)

    db.setModule(G, "moderation", false)
    assert.strictEqual(modules.motifIndisponible(G, warn), "desactive")
    db.setModule(G, "moderation", true)
    assert.strictEqual(modules.motifIndisponible(G, warn), null)
})

test("le module Général ne se désactive jamais, même en urgence", () => {
    db.setModule(G, "general", false)
    process.env.DESACTIVER = "general,commande:help"
    assert.strictEqual(modules.motifIndisponible(G, aide), null)
})

test("interrupteurs d'urgence (#96) : module, sous-module ou commande, sur tous les serveurs", () => {
    process.env.DESACTIVER = " Communaute.Jeux , commande:warn "
    assert.strictEqual(modules.motifIndisponible(G, jeu), "coupe")
    assert.strictEqual(modules.motifIndisponible(G2, jeu), "coupe")
    assert.strictEqual(modules.motifIndisponible(null, jeu), "coupe", "même hors serveur")
    assert.strictEqual(modules.motifIndisponible(G, warn), "coupe")
    assert.strictEqual(modules.motifIndisponible(G, animation), null)
    process.env.DESACTIVER = "communaute"
    assert.strictEqual(modules.motifIndisponible(G, animation), "coupe")
})

test("salons de jeux : seulement pour les sous-modules de jeu", () => {
    assert.strictEqual(modules.salonsRequis(G, AUTRE, jeu), null, "aucun salon choisi = partout")
    db.setSalonsJeux(G, [SALON])
    assert.strictEqual(modules.salonsRequis(G, SALON, jeu), null)
    assert.deepStrictEqual(modules.salonsRequis(G, AUTRE, jeu), [SALON])
    assert.strictEqual(modules.salonsRequis(G, AUTRE, animation), null, "l'Animation reste utilisable partout")
    assert.strictEqual(modules.salonsRequis(G, AUTRE, warn), null)
    assert.strictEqual(modules.salonsRequis(G2, AUTRE, jeu), null, "autre serveur")
    db.setSalonsJeux(G, [])
    assert.strictEqual(modules.salonsRequis(G, AUTRE, jeu), null)
})

test("modulesConnus liste les modules désactivables et les sous-modules présents", () => {
    assert.deepStrictEqual(modules.modulesConnus([jeu, animation, warn, aide, { ...jeu, name: "pendu" }]),
        ["moderation", "tickets", "communaute", "communaute.animation", "communaute.jeux"])
})

test("la purge d'un serveur efface aussi ses modules et salons de jeux", () => {
    db.setModule(G2, "communaute", false)
    db.setSalonsJeux(G2, [SALON])
    assert.ok(db.guildsWithData().includes(G2))
    db.deleteGuildData(G2)
    assert.deepStrictEqual(db.getModules(G2), {})
    assert.deepStrictEqual(db.getSalonsJeux(G2), [])
})

// De bout en bout : commande et composant d'un module désactivé ne s'exécutent pas
function fausse(extra) {
    const reponses = []
    return {
        reponses, guildId: G, channelId: SALON, locale: "fr", user: { id: "777777777777777777" },
        inGuild: () => true, memberPermissions: new Discord.PermissionsBitField([]), member: { roles: { cache: new Set() } },
        isAutocomplete: () => false, isChatInputCommand: () => false, isButton: () => false, isAnySelectMenu: () => false,
        isModalSubmit: () => false, isRepliable: () => true, replied: false, deferred: false, options: {},
        reply: async r => reponses.push(r), followUp: async r => reponses.push(r), ...extra
    }
}

test("de bout en bout : module désactivé = rien ne s'exécute", async () => {
    let executions = 0
    const commande = { name: "quiz", module: "communaute", sousModule: "jeux", permission: "Aucune", run: async () => executions++,
        composants: [{ prefixe: "quiz:", types: ["bouton"], public: true, gestionnaire: async () => executions++ }] }
    const bot = { commands: new Discord.Collection([["quiz", commande]]), routeur: creerRouteur() }
    bot.routeur.enregistrerCommande(commande)

    db.setModule(G, "communaute.jeux", false)
    const cmd = fausse({ commandName: "quiz", isChatInputCommand: () => true })
    await interactionCreate(bot, cmd)
    const clic = fausse({ customId: "quiz:1", isButton: () => true })
    await interactionCreate(bot, clic)
    assert.strictEqual(executions, 0)
    assert.ok(cmd.reponses[0].content.includes("/config") && clic.reponses[0].flags)

    db.setModule(G, "communaute.jeux", true)
    await interactionCreate(bot, fausse({ commandName: "quiz", isChatInputCommand: () => true }))
    await interactionCreate(bot, fausse({ customId: "quiz:1", isButton: () => true }))
    assert.strictEqual(executions, 2)

    db.setSalonsJeux(G, [AUTRE])
    const horsSalon = fausse({ commandName: "quiz", isChatInputCommand: () => true })
    await interactionCreate(bot, horsSalon)
    assert.strictEqual(executions, 2, "hors des salons de jeux : refusé")
    assert.ok(horsSalon.reponses[0].content.includes(`<#${AUTRE}>`))
    db.setSalonsJeux(G, [])
})

test("moduleActif et estCoupeCle : pour les événements et tâches sans commande (A2)", () => {
    assert.strictEqual(modules.moduleActif(G, "communaute.niveaux"), true)
    db.setModule(G, "communaute.niveaux", false)
    assert.strictEqual(modules.moduleActif(G, "communaute.niveaux"), false)
    db.setModule(G, "communaute.niveaux", true)
    db.setModule(G, "communaute", false)
    assert.strictEqual(modules.moduleActif(G, "communaute.niveaux"), false, "parent désactivé")
    db.setModule(G, "communaute", true)
    process.env.DESACTIVER = "communaute"
    assert.strictEqual(modules.estCoupeCle("communaute.economie"), true)
    assert.strictEqual(modules.moduleActif(G, "communaute.economie"), false, "coupé en urgence")
    assert.strictEqual(modules.moduleActif(G, "general"), true)
})
