process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const { controler } = require('../Fonctions/garde')
const premium = require('../Fonctions/premium')
const stats = require('../Fonctions/statsMod')
const { traiterRapports } = require('../Fonctions/rapportHebdo')
const { chargerCommandes } = require('./aides')

const { Flags } = Discord.PermissionsBitField
const bot = chargerCommandes()
const G = "666666666666666601", AUTRE = "666666666666666602"
const BOT = "999999999999999901", M1 = "444444444444444401", M2 = "444444444444444402", U = "333333333333333301"
const HEURE = 60 * 60 * 1000, JOUR = 24 * HEURE

function interaction({ perms = [], guildId = G } = {}) {
    return {
        guildId, channelId: "333333333333333399", user: { id: M1 }, locale: "fr", inGuild: () => true,
        memberPermissions: new Discord.PermissionsBitField(perms), member: { roles: { cache: new Set() } }
    }
}

function ajouterCase(guildId, { mod = M1, type = "warn", auto = 0, il = 0, annulee = false, raison = "r" } = {}) {
    db.sqlRun("INSERT INTO cases (guild_id, user_id, moderator_id, type, reason, auto, created_at, cancelled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [guildId, U, mod, type, raison, auto, Date.now() - il, annulee ? Date.now() : null])
}

function noterConfig(guildId, moderatorId, details) {
    db.sqlRun("INSERT INTO config_audit (guild_id, moderator_id, details, created_at) VALUES (?, ?, ?, ?)", [guildId, moderatorId, details, Date.now()])
}

function ajouterTicket(guildId, id, { il, prisApres = null }) {
    const cree = Date.now() - il
    db.sqlRun("INSERT INTO tickets (channel_id, guild_id, owner_id, created_at, claimed_by, claimed_at) VALUES (?, ?, ?, ?, ?, ?)",
        [id, guildId, U, cree, prisApres === null ? null : M1, prisApres === null ? null : cree + prisApres])
}

// Fausse interaction de commande : enregistre la réponse
function commande(nom, options = {}) {
    const reponses = []
    const i = {
        ...interaction({ perms: [Flags.ManageGuild] }), client: { user: { id: BOT } }, guild: { id: G }, id: "1",
        reply: async r => { reponses.push(r); return { resource: { message: null } } }
    }
    const args = {
        getUser: n => options[n] ?? null, getString: n => options[n] ?? null
    }
    return { i, args, reponses, run: () => bot.commands.get(nom).run({ user: { id: BOT }, application: { entitlements: { fetch: async () => [] } } }, i, args) }
}

test("/journal et /modstats refusés à un non-staff, acceptés avec ManageGuild", async () => {
    for (const nom of ["journal", "modstats"]) {
        const c = bot.commands.get(nom)
        assert.strictEqual(c.permission, Flags.ManageGuild)
        assert.ok(await controler(interaction(), c), `${nom} refusé sans permission`)
        assert.ok(await controler(interaction({ perms: [Flags.ModerateMembers] }), c), `${nom} refusé avec une permission plus faible`)
        assert.strictEqual(await controler(interaction({ perms: [Flags.ManageGuild] }), c), null)
    }
})

test("filtres du journal : modérateur, type, période, config, autre serveur", () => {
    ajouterCase(G, { mod: M1, type: "ban", il: HEURE })
    ajouterCase(G, { mod: M2, type: "warn", il: 2 * HEURE })
    ajouterCase(G, { mod: M1, type: "warn", il: 3 * JOUR })
    ajouterCase(G, { mod: M1, type: "kick", il: 40 * JOUR })
    ajouterCase(AUTRE, { mod: M1, type: "ban", il: HEURE })
    noterConfig(G, M2, "Salon de logs modifié")
    noterConfig(AUTRE, M2, "Autre serveur")

    const tout = stats.entreesJournal(G, { depuis: Date.now() - 30 * JOUR })
    assert.strictEqual(tout.length, 4, "3 sanctions + 1 config, sans le kick de 40 j ni l'autre serveur")
    assert.deepStrictEqual(tout.map(e => e.created_at), [...tout.map(e => e.created_at)].sort((a, b) => b - a), "du plus récent au plus ancien")
    assert.strictEqual(stats.entreesJournal(G, { depuis: Date.now() - 24 * HEURE }).length, 3, "24 h : ban, warn, config")
    assert.strictEqual(stats.entreesJournal(G, { moderateurId: M2, depuis: 0 }).length, 2, "warn + config de M2")
    assert.deepStrictEqual(stats.entreesJournal(G, { type: "warn", depuis: 0 }).map(e => e.moderator_id).sort(), [M1, M2])
    const config = stats.entreesJournal(G, { type: "config", depuis: 0 })
    assert.ok(config.length === 1 && config[0].genre === "config")
})

test("/journal affiche une page éphémère (raisons échappées, filtre moderateur)", async () => {
    ajouterCase(G, { mod: M2, type: "mute", raison: "**gras** @everyone", il: 1000 })
    const c = commande("journal", { moderateur: { id: M2 }, periode: "24h" })
    await c.run()
    assert.strictEqual(c.reponses.length, 1)
    assert.ok(c.reponses[0].flags, "éphémère")
    const texte = c.reponses[0].embeds[0].toJSON().description
    assert.ok(texte.includes("\\*\\*gras\\*\\*"), "raison échappée")
    assert.ok(!texte.includes(`par <@${M1}>`), "seulement M2")
})

test("sanctions annulées exclues des stats, actions automatiques à part", () => {
    const g = "666666666666666610"
    ajouterCase(g, { mod: M1, type: "ban" })
    ajouterCase(g, { mod: M1, type: "ban", annulee: true })
    ajouterCase(g, { mod: M1, type: "warn" })
    ajouterCase(g, { mod: M2, type: "mute" })
    ajouterCase(g, { mod: BOT, type: "automod", auto: 1 })
    ajouterCase(g, { mod: BOT, type: "ban", auto: 1 })
    ajouterCase(g, { mod: BOT, type: "warn" }) // bot sans drapeau auto : compté en automatique aussi
    ajouterCase(g, { mod: M1, type: "kick", il: 40 * JOUR })

    const s = stats.statsModeration(g, BOT, Date.now() - 30 * JOUR)
    assert.deepStrictEqual(s.moderateurs.map(m => [m.id, m.total]), [[M1, 2], [M2, 1]])
    assert.deepStrictEqual(s.moderateurs[0].types, { ban: 1, warn: 1 })
    assert.strictEqual(s.auto.total, 3)
    assert.strictEqual(s.auto.types.automod, 1)
    assert.strictEqual(stats.statsModeration(g, BOT, Date.now() - 60 * JOUR).moderateurs[0].total, 3, "période plus large : le kick compte")
})

test("médiane de prise en charge des tickets", () => {
    assert.strictEqual(stats.mediane([]), null)
    assert.strictEqual(stats.mediane([5]), 5)
    assert.strictEqual(stats.mediane([9, 1, 5]), 5)
    assert.strictEqual(stats.mediane([1, 2, 3, 10]), 2.5)

    const g = "666666666666666620"
    ajouterTicket(g, "t1", { il: JOUR, prisApres: 10 * 60 * 1000 })
    ajouterTicket(g, "t2", { il: JOUR, prisApres: 30 * 60 * 1000 })
    ajouterTicket(g, "t3", { il: JOUR, prisApres: 2 * HEURE })
    ajouterTicket(g, "t4", { il: JOUR }) // jamais pris : ignoré
    ajouterTicket(g, "t5", { il: 60 * JOUR, prisApres: 5 * HEURE }) // hors période
    const s = stats.statsModeration(g, BOT, Date.now() - 30 * JOUR)
    assert.strictEqual(s.medianePriseEnCharge, 30 * 60 * 1000)
    assert.strictEqual(s.ticketsPris, 3)
})

test("période premium refusée sans premium, acceptée avec", async () => {
    const avant = process.env.PREMIUM_SKU_ID
    process.env.PREMIUM_SKU_ID = "123456789012345678"
    try {
        const gratuit = commande("modstats", { periode: "90" })
        await gratuit.run()
        assert.strictEqual(gratuit.reponses.length, 1)
        assert.ok(gratuit.reponses[0].flags && !gratuit.reponses[0].embeds, "message de refus éphémère, sans embed")
        assert.match(gratuit.reponses[0].content, /premium/i)

        const libre = commande("modstats", { periode: "30" })
        await libre.run()
        assert.ok(!libre.reponses[0].content?.includes("premium"), "30 jours reste gratuit")
    } finally {
        if (avant === undefined) delete process.env.PREMIUM_SKU_ID
        else process.env.PREMIUM_SKU_ID = avant
    }
    // Premium désactivé : tout est gratuit
    const c = commande("modstats", { periode: "365" })
    await c.run()
    assert.ok(!premium.premiumActif())
    assert.ok(!c.reponses[0].content?.includes("premium"))
})

test("est-ce lundi 9 h à Paris (été et hiver)", () => {
    assert.strictEqual(stats.estLundi9hParis(new Date("2026-11-23T08:10:00Z")), true, "hiver : 9 h 10 (UTC+1)")
    assert.strictEqual(stats.estLundi9hParis(new Date("2026-11-23T09:10:00Z")), false, "10 h 10 à Paris")
    assert.strictEqual(stats.estLundi9hParis(new Date("2026-07-06T07:30:00Z")), true, "été : 9 h 30 (UTC+2)")
    assert.strictEqual(stats.estLundi9hParis(new Date("2026-07-06T08:30:00Z")), false)
    assert.strictEqual(stats.estLundi9hParis(new Date("2026-11-24T08:10:00Z")), false, "mardi")
    assert.strictEqual(stats.estLundi9hParis(new Date("2026-11-22T23:30:00Z")), false, "dimanche 23 h 30 UTC = lundi 0 h 30 Paris")
})

test("déjà envoyé cette semaine : clé de semaine à l'heure de Paris", () => {
    assert.strictEqual(stats.cleSemaine(new Date("2026-11-23T08:10:00Z")), "2026-11-23")
    assert.strictEqual(stats.cleSemaine(new Date("2026-11-29T22:30:00Z")), "2026-11-23", "dimanche soir")
    assert.strictEqual(stats.cleSemaine(new Date("2026-11-29T23:30:00Z")), "2026-11-30", "lundi 0 h 30 à Paris")
    const envoyes = new Map()
    const cle = stats.cleSemaine(new Date("2026-11-23T08:10:00Z"))
    assert.strictEqual(stats.dejaEnvoye(envoyes, G, cle), false)
    envoyes.set(G, cle)
    assert.strictEqual(stats.dejaEnvoye(envoyes, G, cle), true)
    assert.strictEqual(stats.dejaEnvoye(envoyes, AUTRE, cle), false, "un autre serveur n'est pas concerné")
    assert.strictEqual(stats.dejaEnvoye(envoyes, G, stats.cleSemaine(new Date("2026-11-30T08:10:00Z"))), false, "semaine suivante")
})

test("rapport hebdomadaire : ne lève jamais, envoyé une seule fois", async () => {
    const g = "666666666666666630"
    ajouterCase(g, { type: "ban" })
    const envois = []
    const channel = { isTextBased: () => true, permissionsFor: () => ({ has: () => true }), send: async m => envois.push(m) }
    const guild = { id: g, available: true, members: { me: {} }, channels: { cache: new Map([["c1", channel]]) }, preferredLocale: "fr" }
    db.sqlRun("INSERT OR REPLACE INTO log_channels (guild_id, famille, channel_id) VALUES (?, 'sanctions', 'c1')", [g])
    const faux = { guilds: { cache: new Map([[g, guild]]) } }

    assert.strictEqual(await traiterRapports(faux, new Date("2026-11-24T08:10:00Z")), 0, "mardi : rien")
    assert.strictEqual(await traiterRapports(faux, new Date("2026-11-23T08:10:00Z")), 1)
    assert.strictEqual(await traiterRapports(faux, new Date("2026-11-23T08:40:00Z")), 0, "déjà envoyé cette semaine")
    assert.strictEqual(envois.length, 1)
    assert.ok(envois[0].embeds[0].toJSON().title)
    assert.strictEqual(await traiterRapports({ guilds: null }, new Date("2026-11-30T08:10:00Z")), 0, "bot cassé : pas d'exception")
})
