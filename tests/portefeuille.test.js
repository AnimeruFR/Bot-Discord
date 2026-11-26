process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('assert')
const { EventEmitter } = require('events')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const economie = require('../Fonctions/economie')
const { controler } = require('../Fonctions/garde')
const { setSalonFamille } = require('../Fonctions/logs')

const solde = require('../Commandes/Communaute/Economie/solde')
const payer = require('../Commandes/Communaute/Economie/payer')
const classement = require('../Commandes/Communaute/Social/classement')
const eco = require('../Commandes/Moderation/eco')

const { Flags } = Discord.PermissionsBitField
const G = "111111111111111111"
const ANCIEN = Date.now() - 30 * 24 * 3600 * 1000

// Faux salon de logs : on y lit ce que sendModLog envoie
const envoyes = []
const salonLogs = {
    isTextBased: () => true, permissionsFor: () => ({ has: () => true }), send: async m => envoyes.push(m)
}
const guild = { id: G, members: { me: {} }, channels: { cache: new Map([["999999999999999999", salonLogs]]) } }

function membre(id, { recent = false, bot = false } = {}) {
    const user = { id, bot, toString: () => `<@${id}>` }
    return { id, guild, user, joinedTimestamp: recent ? Date.now() - 3600 * 1000 : ANCIEN, communicationDisabledUntilTimestamp: null }
}
const id = n => String(200000000000000000n + BigInt(n))
const alice = membre(id(1)), bob = membre(id(2)), robot = membre(id(3), { bot: true }), nouveau = membre(id(4), { recent: true })

function options(valeurs, membres = {}) {
    return {
        getString: n => valeurs[n] ?? null, getInteger: n => valeurs[n] ?? null, getNumber: n => valeurs[n] ?? null,
        getUser: n => membres[n]?.user ?? null, getMember: n => membres[n] ?? null
    }
}

// Faux interaction : enregistre les réponses ; clics = boutons que le « joueur » va presser, dans l'ordre
function interaction(auteur, { clics = [], perms = Flags.ManageGuild } = {}) {
    const collecteur = new EventEmitter()
    const message = {
        awaitMessageComponent: async () => {
            if (!clics.length) throw new Error("temps écoulé")
            return clics.shift()
        },
        createMessageComponentCollector: () => collecteur
    }
    const i = {
        id: "i1", guild, guildId: G, channelId: "333333333333333333", user: auteur.user, member: auteur, locale: "fr",
        memberPermissions: new Discord.PermissionsBitField(perms),
        inGuild: () => true, isButton: () => false,
        reponses: [], suivis: [], editions: [], collecteur,
        reply: async r => { i.reponses.push(r); return { resource: { message } } },
        editReply: async r => { i.editions.push(r) },
        followUp: async r => { i.suivis.push(r) },
        deferred: false, replied: false
    }
    return i
}

const clic = (customId, auteur, { perms = Flags.ManageGuild } = {}) => {
    const c = { customId, user: auteur.user, memberPermissions: new Discord.PermissionsBitField(perms), mises: [], differe: false }
    c.update = async r => { c.mises.push(r) }
    c.deferUpdate = async () => { c.differe = true }
    c.reply = async r => { c.mises.push(r) }
    return c
}



// Alimente un compte sans passer par un jeu
const donner = (m, montant) => economie.crediter(m, montant, { source: "test", sansReduction: true })

test("/eco : refusé à un non-staff par la garde, accepté avec ManageGuild", async () => {
    const declaration = { ...eco, module: "moderation", sousModule: null }
    const sans = interaction(alice, { perms: 0n })
    sans.member = { ...alice, roles: { cache: new Set() } }
    const refus = await controler(sans, declaration)
    assert.ok(refus, "membre sans permission refusé")

    const staff = interaction(bob)
    staff.member = { ...bob, roles: { cache: new Set() } }
    assert.strictEqual(await controler(staff, declaration), null)
    assert.strictEqual(eco.permission, Discord.PermissionFlagsBits.ManageGuild)
})

test("/solde : solde, série et rang, public ; un bot est refusé", async () => {
    donner(alice, 300)
    const i = interaction(alice)
    await solde.run(null, i, options({}, {}))
    const champs = i.reponses[0].embeds[0].data.fields
    assert.ok(champs[0].value.startsWith("300"), "solde affiché")
    assert.strictEqual(i.reponses[0].flags, undefined, "réponse publique")

    const bot = interaction(alice)
    await solde.run(null, bot, options({}, { membre: robot }))
    assert.ok(bot.reponses[0].flags, "refus éphémère pour un bot")
})

test("/payer : soi-même, bot et compte récent refusés", async () => {
    donner(alice, 1000)
    donner(nouveau, 100)
    const soi = interaction(alice)
    await payer.run(null, soi, options({ montant: 10 }, { membre: alice }))
    assert.ok(soi.reponses[0].flags && /vous-même/.test(soi.reponses[0].content))

    const versBot = interaction(alice)
    await payer.run(null, versBot, options({ montant: 10 }, { membre: robot }))
    assert.ok(versBot.reponses[0].flags && /bots/.test(versBot.reponses[0].content))

    const avant = economie.compte(G, alice.id).balance
    const versNouveau = interaction(alice)
    await payer.run(null, versNouveau, options({ montant: 10 }, { membre: nouveau }))
    assert.ok(versNouveau.reponses[0].flags && /7 jours/.test(versNouveau.reponses[0].content))

    const deNouveau = interaction(nouveau)
    await payer.run(null, deNouveau, options({ montant: 10 }, { membre: alice }))
    assert.ok(deNouveau.reponses[0].flags && /7 jours/.test(deNouveau.reponses[0].content))
    assert.strictEqual(economie.compte(G, alice.id).balance, avant, "aucun mouvement")
})

test("/payer : paiement direct jusqu'à 500, public, avec frais", async () => {
    const avantA = economie.compte(G, alice.id).balance, avantB = economie.compte(G, bob.id).balance
    const i = interaction(alice)
    await payer.run(null, i, options({ montant: 100 }, { membre: bob }))
    assert.strictEqual(i.reponses.length, 1)
    assert.strictEqual(i.reponses[0].flags, undefined, "annonce publique")
    assert.ok(!i.reponses[0].components, "pas de confirmation")
    assert.strictEqual(economie.compte(G, alice.id).balance, avantA - 100)
    assert.strictEqual(economie.compte(G, bob.id).balance, avantB + 98, "2 % de frais")
})

test("/payer : confirmation au-delà de 500 (annulation, expiration, validation)", async () => {
    donner(alice, 600)
    const avantA = economie.compte(G, alice.id).balance, avantB = economie.compte(G, bob.id).balance

    const annule = interaction(alice, { clics: [clic("payer-non-i1", alice)] })
    await payer.run(null, annule, options({ montant: 501 }, { membre: bob }))
    assert.ok(annule.reponses[0].components.length && annule.reponses[0].flags, "boutons éphémères")
    assert.strictEqual(economie.compte(G, alice.id).balance, avantA, "rien tant qu'on n'a pas confirmé")

    const expire = interaction(alice)
    await payer.run(null, expire, options({ montant: 501 }, { membre: bob }))
    assert.strictEqual(economie.compte(G, alice.id).balance, avantA, "pas de clic : annulé")

    const valide = interaction(alice, { clics: [clic("payer-oui-i1", alice)] })
    await payer.run(null, valide, options({ montant: 501 }, { membre: bob }))
    assert.strictEqual(economie.compte(G, alice.id).balance, avantA - 501)
    assert.strictEqual(economie.compte(G, bob.id).balance, avantB + 491, "501 moins 10 de frais")
    assert.strictEqual(valide.suivis.length, 1, "annonce publique après confirmation")
    assert.strictEqual(valide.suivis[0].flags, undefined)
})

test("/classement monnaie : la place du membre est affichée même hors de la page", async () => {
    const dernier = membre(id(100))
    for (let n = 0; n < 12; n++) donner(membre(id(10 + n)), 10000 - n * 100)
    donner(dernier, 5) // plus petit solde : après les 12 autres et les comptes de test
    const i = interaction(dernier)
    await classement.run(null, i, options({ type: "monnaie" }))
    const premiere = i.reponses[0]
    const description = premiere.embeds[0].data.description
    assert.ok(description.includes(`<@${id(10)}>`), "le premier est en page 1")
    assert.ok(!description.includes(`<@${dernier.id}> :`), "le membre n'est pas dans la page")
    assert.ok(/Votre place : \*\*#\d+\*\*/.test(description), "sa place est en bas")
    assert.strictEqual(premiere.components.length, 1, "boutons de pagination")

    // Page suivante : par l'auteur seulement
    const autre = clic(`classement-suiv-i1`, bob)
    i.collecteur.emit("collect", autre)
    await new Promise(r => setImmediate(r))
    assert.ok(autre.mises[0].flags, "un autre membre est refusé en éphémère")

    const suivant = clic(`classement-suiv-i1`, dernier)
    i.collecteur.emit("collect", suivant)
    await new Promise(r => setImmediate(r))
    const page2 = suivant.mises[0].embeds[0].data
    assert.ok(page2.description.includes(`<@${dernier.id}> :`), "le membre apparaît en page 2")
    assert.ok(/Votre place/.test(page2.description))
    assert.ok(page2.footer.text.includes("2/"))
})

test("/classement niveau et jeux", async () => {
    db.sqlRun("INSERT INTO xp (guild_id, user_id, xp, level) VALUES (?, ?, ?, ?), (?, ?, ?, ?)", [G, alice.id, 500, 3, G, bob.id, 900, 4])
    db.sqlRun("INSERT INTO stats_joueur (guild_id, user_id, stat, value) VALUES (?, ?, 'parties_gagnees', ?)", [G, bob.id, 7])

    const niveaux = interaction(alice)
    await classement.run(null, niveaux, options({ type: "niveau" }))
    const d = niveaux.reponses[0].embeds[0].data.description
    assert.ok(d.indexOf(`<@${bob.id}>`) < d.indexOf(`<@${alice.id}>`), "bob (900 XP) devant alice")
    assert.ok(d.includes("**#2**"), "alice est 2e")

    const jeux = interaction(alice)
    await classement.run(null, jeux, options({ type: "jeux" }))
    const j = jeux.reponses[0].embeds[0].data.description
    assert.ok(j.includes("7 victoires") && j.includes("pas encore classé"), "alice n'a aucune victoire")
})

test("/eco : gel, dégel, journal et logs de la famille économie", async () => {
    // Sans salon économie : pas de log, même s'il y a un salon général
    const avant = envoyes.length
    const gel = interaction(alice)
    await eco.run(null, gel, options({ action: "geler" }, { membre: bob }))
    assert.strictEqual(economie.compte(G, bob.id).frozen, true)
    assert.strictEqual(envoyes.length, avant, "pas de salon économie : pas de log")
    assert.strictEqual(economie.peutJouer(bob), "gele")

    setSalonFamille(G, "economie", "999999999999999999")
    const degel = interaction(alice)
    await eco.run(null, degel, options({ action: "degeler" }, { membre: bob }))
    assert.strictEqual(economie.compte(G, bob.id).frozen, false)
    assert.strictEqual(envoyes.length, avant + 1, "log dans le salon économie")
    assert.ok(degel.reponses[0].flags, "éphémère")

    const j = interaction(alice)
    await eco.run(null, j, options({ action: "journal" }, { membre: bob }))
    assert.ok(j.reponses[0].flags && /paiement/.test(j.reponses[0].embeds[0].data.description))

    const sansMembre = interaction(alice)
    await eco.run(null, sansMembre, options({ action: "journal" }))
    assert.ok(sansMembre.reponses[0].flags && /membre/.test(sansMembre.reponses[0].content))
})

test("/eco reinitialiser : confirmation, journal cohérent, annulation", async () => {
    donner(bob, 250)
    const avant = economie.compte(G, bob.id).balance
    assert.ok(avant > 0)

    const non = interaction(alice, { clics: [clic("eco-non-i1", alice)] })
    await eco.run(null, non, options({ action: "reinitialiser" }, { membre: bob }))
    assert.strictEqual(economie.compte(G, bob.id).balance, avant, "annulé : rien ne bouge")

    const sansDroit = interaction(alice, { clics: [clic("eco-oui-i1", alice, { perms: 0n })] })
    await eco.run(null, sansDroit, options({ action: "reinitialiser" }, { membre: bob }))
    assert.strictEqual(economie.compte(G, bob.id).balance, avant, "droit retiré pendant la confirmation")

    const oui = interaction(alice, { clics: [clic("eco-oui-i1", alice)] })
    const c = oui // le clic renvoyé par awaitMessageComponent est celui de la file
    await eco.run(null, c, options({ action: "reinitialiser" }, { membre: bob }))
    assert.strictEqual(economie.compte(G, bob.id).balance, 0)
    assert.strictEqual(economie.verifierCoherence(G, bob.id), true, "somme du journal = solde")
    assert.ok(db.sqlAll("SELECT 1 FROM eco_journal WHERE guild_id = ? AND user_id = ? AND source = 'reinitialisation'", [G, bob.id]).length === 1)
})

test("/eco reglages : valeurs prises en compte, refus propre sans réglage", async () => {
    const vide = interaction(alice)
    await eco.run(null, vide, options({ action: "reglages" }))
    assert.ok(vide.reponses[0].flags && /au moins un réglage/.test(vide.reponses[0].content))

    const ok = interaction(alice)
    await eco.run(null, ok, options({ action: "reglages", plafond: 1000, multiplicateur: 1.5, nom: "Pépites", emoji: "💎" }))
    assert.deepStrictEqual(economie.reglages(G), { plafondJour: 1000, multiplicateur: 1.5 })
    assert.deepStrictEqual(economie.monnaie(G), { nom: "Pépites", emoji: "💎" })

    // Hors bornes (la commande les limite déjà côté Discord, definirReglages les revérifie)
    const hors = interaction(alice)
    await eco.run(null, hors, options({ action: "reglages", plafond: 50 }))
    assert.ok(hors.reponses[0].flags && /refusé/.test(hors.reponses[0].content))
    assert.strictEqual(economie.reglages(G).plafondJour, 1000)
})
