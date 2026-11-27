process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const eco = require('../Fonctions/economie')
const xp = require('../Fonctions/xp')
const paliers = require('../Fonctions/paliers')
const { ecouter, retirerEcouteurs } = require('../Fonctions/evenements')
const { role: faussRole } = require('./aides')
const rang = require('../Commandes/Communaute/Niveaux/rang')
const niveaux = require('../Commandes/Communaute/Niveaux/niveaux')

const { Flags } = Discord.PermissionsBitField
const JOUR = 24 * 3600 * 1000
const MINUTE = 61 * 1000 // un peu plus d'une minute : le délai est de 60 s pleines
const MERCREDI = Date.UTC(2026, 10, 25, 10, 0)
const SAMEDI = Date.UTC(2026, 10, 28, 10, 0)

// --- Faux objets Discord -----------------------------------------------------------------------------------------

// Rôle : seule la position compte pour la hiérarchie ; permissions au choix
function creerRole(guild, id, position, perms = []) {
    const r = Object.assign(faussRole(position), { id, managed: false, guild, permissions: new Discord.PermissionsBitField(perms) })
    guild.roles.cache.set(id, r)
    return r
}

// Serveur avec un bot qui a « Gérer les rôles » et un rôle en position 10
function creerGuild(id) {
    const guild = { id, ownerId: "1", preferredLocale: "fr", roles: { cache: new Discord.Collection() }, channels: { cache: new Discord.Collection() } }
    guild.members = { me: { id: "bot", guild, permissions: new Discord.PermissionsBitField([Flags.ManageRoles]), roles: { highest: faussRole(10) } } }
    return guild
}

function creerMembre(guild, id, { jours = 30, timeout = null, roles = [] } = {}) {
    const cache = new Discord.Collection()
    for (const r of roles) cache.set(r, { id: r })
    return {
        id, guild, joinedTimestamp: Date.now() - jours * JOUR, communicationDisabledUntilTimestamp: timeout, user: { id, bot: false, username: `u${id}` },
        roles: { cache, add: async r => { cache.set(r.id, r) }, remove: async r => { cache.delete(r.id) } }
    }
}

// Faux salon : enregistre les messages envoyés
function creerSalon(id, { parentId = null, parent = null } = {}) {
    const envois = []
    return { id, parentId, parent, envois, send: async contenu => envois.push(contenu) }
}

const creerMessage = (guild, member, channel) => ({ guild, member, channel, channelId: channel.id, author: { bot: false } })

// Un faux membre, un faux salon et un message dans un serveur neuf
function contexte(guildId, userId = "100", options = {}) {
    const guild = creerGuild(guildId)
    const channel = creerSalon("c1")
    guild.channels.cache.set(channel.id, channel)
    const member = creerMembre(guild, userId, options)
    return { guild, channel, member, message: creerMessage(guild, member, channel) }
}

const ligneXp = (guildId, userId) => db.sqlAll("SELECT * FROM xp WHERE guild_id = ? AND user_id = ?", [guildId, userId])[0]
const aleaMin = () => 0
const aleaMax = () => 0.999999

// --- Formule de niveau -------------------------------------------------------------------------------------------

test("formule de niveau : table de docs/ECONOMIE.md §6", () => {
    assert.strictEqual(xp.xpPourNiveau(0), 100)
    assert.strictEqual(xp.xpPourNiveau(1), 144)
    assert.strictEqual(xp.xpPourNiveau(10), 900)
    // XP cumulée du doc : niveaux 5, 10, 20, 30, 50 (la table correspond à la formule 100 + 40L + 4L²)
    for (const [niveau, cumulee] of [[5, 1020], [10, 3940], [20, 19480], [30, 54620], [50, 215700]]) {
        assert.strictEqual(xp.xpCumulee(niveau), cumulee, `XP cumulée du niveau ${niveau}`)
        assert.strictEqual(xp.niveauPourXp(cumulee), niveau)
        assert.strictEqual(xp.niveauPourXp(cumulee - 1), niveau - 1)
    }
    // La forme fermée vaut la somme terme à terme
    let somme = 0
    for (let niveau = 0; niveau <= 100; niveau++) {
        assert.strictEqual(xp.xpCumulee(niveau), somme)
        somme += xp.xpPourNiveau(niveau)
    }
    assert.strictEqual(xp.niveauPourXp(0), 0)
    assert.strictEqual(xp.niveauPourXp(99), 0)
    assert.strictEqual(xp.niveauPourXp(100), 1)
    assert.strictEqual(xp.niveauPourXp(3939), 9)
    assert.strictEqual(xp.niveauPourXp(3940), 10)

    assert.deepStrictEqual(xp.progression(150), { niveau: 1, dansNiveau: 50, pourNiveau: 144 })
    assert.deepStrictEqual(xp.progression(0), { niveau: 0, dansNiveau: 0, pourNiveau: 100 })
    assert.strictEqual(xp.barre(0, 100), "▱".repeat(10))
    assert.strictEqual(xp.barre(50, 100), "▰".repeat(5) + "▱".repeat(5))
    assert.strictEqual(xp.barre(99, 100), "▰".repeat(9) + "▱")
    assert.strictEqual(xp.barre(100, 100), "▰".repeat(10))
})

// --- Gain d'XP ---------------------------------------------------------------------------------------------------

test("un gain par minute, entre 15 et 25 XP", async () => {
    const G = "910000000000000001", { message, member } = contexte(G)
    const premier = await xp.gagnerXp(message, { maintenant: MERCREDI, alea: aleaMin })
    assert.strictEqual(premier.gain, 15)
    assert.strictEqual(await xp.gagnerXp(message, { maintenant: MERCREDI + 59 * 1000, alea: aleaMin }), null, "59 s plus tard : rien")
    assert.strictEqual(await xp.gagnerXp(message, { maintenant: MERCREDI + 30 * 1000, alea: aleaMin }), null)
    const second = await xp.gagnerXp(message, { maintenant: MERCREDI + MINUTE, alea: aleaMax })
    assert.strictEqual(second.gain, 25)
    assert.strictEqual(ligneXp(G, member.id).xp, 40)
    assert.strictEqual(ligneXp(G, member.id).day_xp, 40)

    // La base fait foi : un autre processus (ou un redémarrage) ne contourne pas la minute
    const autre = contexte(G, "101")
    db.sqlRun("INSERT INTO xp (guild_id, user_id, xp, level, last_gain_at) VALUES (?, ?, 50, 0, ?)", [G, "101", MERCREDI - 30 * 1000])
    assert.strictEqual(await xp.gagnerXp(autre.message, { maintenant: MERCREDI, alea: aleaMin }), null)
    assert.ok(await xp.gagnerXp(autre.message, { maintenant: MERCREDI + MINUTE, alea: aleaMin }))

    // Bornes sur beaucoup de tirages
    const { message: m } = contexte(G, "102")
    for (let i = 0; i < 40; i++) {
        const r = await xp.gagnerXp(m, { maintenant: MERCREDI + i * MINUTE })
        assert.ok(r.gain >= 15 && r.gain <= 25)
    }
})

test("plafond de 3 000 XP par jour, remis à zéro le lendemain", async () => {
    const G = "910000000000000002", { message, member } = contexte(G)
    let gains = 0
    for (let i = 0; i < 120; i++) if (await xp.gagnerXp(message, { maintenant: MERCREDI + i * MINUTE, alea: aleaMax })) gains++
    assert.strictEqual(gains, 120)
    assert.strictEqual(ligneXp(G, member.id).day_xp, 3000)
    assert.strictEqual(await xp.gagnerXp(message, { maintenant: MERCREDI + 130 * MINUTE, alea: aleaMax }), null, "plafond atteint")
    assert.strictEqual(ligneXp(G, member.id).xp, 3000)
    assert.strictEqual(xp.profilXp(G, member.id, MERCREDI + 130 * MINUTE).xpJour, 3000)

    // Dernier gain rogné : jamais plus de 3 000
    const { message: m2, member: u2 } = contexte(G, "200")
    db.sqlRun("INSERT INTO xp (guild_id, user_id, xp, level, day, day_xp) VALUES (?, ?, 2990, 0, ?, 2990)", [G, "200", require('../Fonctions/evenements').jourParis(MERCREDI)])
    assert.strictEqual((await xp.gagnerXp(m2, { maintenant: MERCREDI, alea: aleaMax })).gain, 10)
    assert.strictEqual(ligneXp(G, u2.id).day_xp, 3000)

    // Lendemain : le compteur repart
    const lendemain = await xp.gagnerXp(message, { maintenant: MERCREDI + JOUR, alea: aleaMin })
    assert.strictEqual(lendemain.gain, 15)
    assert.strictEqual(ligneXp(G, member.id).day_xp, 15)
    assert.strictEqual(xp.profilXp(G, member.id, MERCREDI + 130 * MINUTE).xpJour, 0, "le jour a changé : XP du jour à 0")
})

test("salons exclus (salon, catégorie, fil), module coupé, bots", async () => {
    const G = "910000000000000003", { guild, member } = contexte(G)
    const salon = creerSalon("s1")
    const dansCategorie = creerSalon("s2", { parentId: "cat1" })
    const fil = creerSalon("fil1", { parentId: "s1", parent: { parentId: "cat2" } })
    const t0 = MERCREDI

    assert.strictEqual(xp.definirExclusion(G, "s1", true), true)
    assert.strictEqual(xp.definirExclusion(G, "s1", true), false, "déjà exclu")
    assert.strictEqual(await xp.gagnerXp(creerMessage(guild, member, salon), { maintenant: t0 }), null, "salon exclu")
    assert.strictEqual(await xp.gagnerXp(creerMessage(guild, member, fil), { maintenant: t0 }), null, "fil d'un salon exclu")
    xp.definirExclusion(G, "cat1", true)
    assert.strictEqual(await xp.gagnerXp(creerMessage(guild, member, dansCategorie), { maintenant: t0 }), null, "salon d'une catégorie exclue")
    assert.strictEqual(ligneXp(G, member.id), undefined, "rien écrit")

    // Un salon exclu ne consomme pas la minute : un salon autorisé gagne tout de suite
    const autre = creerSalon("s3")
    assert.ok(await xp.gagnerXp(creerMessage(guild, member, autre), { maintenant: t0 }))
    // Réinclusion
    assert.strictEqual(xp.definirExclusion(G, "s1", false), true)
    assert.strictEqual(xp.definirExclusion(G, "s1", false), false)
    assert.ok(await xp.gagnerXp(creerMessage(guild, member, salon), { maintenant: t0 + MINUTE }))

    // Limite du nombre de salons exclus
    for (let i = 0; i < xp.MAX_EXCLUS - 1; i++) xp.definirExclusion(G, `x${i}`, true)
    assert.throws(() => xp.definirExclusion(G, "de-trop", true), RangeError)

    // Module Niveaux coupé : aucune XP
    const { message: m2 } = contexte(G, "300")
    db.setModule(G, "communaute.niveaux", false)
    assert.strictEqual(await xp.gagnerXp(m2, { maintenant: t0 }), null)
    db.setModule(G, "communaute.niveaux", true)
    assert.strictEqual(await xp.gagnerXp(m2, { maintenant: t0 + 30 * 1000 }), null, "le refus est retenu pour la minute")
    assert.ok(await xp.gagnerXp(m2, { maintenant: t0 + MINUTE }))

    // Bot : rien
    const { message: m3 } = contexte(G, "301")
    m3.author.bot = true
    assert.strictEqual(await xp.gagnerXp(m3, { maintenant: t0 }), null)
})

test("membre sanctionné ou gelé : rien, économie active ou non", async () => {
    const G = "910000000000000004", t0 = MERCREDI
    const timeout = contexte(G, "10", { timeout: Date.now() + 3600 * 1000 })
    assert.strictEqual(await xp.gagnerXp(timeout.message, { maintenant: t0, alea: aleaMin }), null, "timeout")
    const fini = contexte(G, "11", { timeout: Date.now() - 1000 })
    assert.ok(await xp.gagnerXp(fini.message, { maintenant: t0, alea: aleaMin }), "timeout terminé")

    const gele = contexte(G, "12")
    eco.geler(G, "12", true)
    assert.strictEqual(await xp.gagnerXp(gele.message, { maintenant: t0, alea: aleaMin }), null, "compte gelé")

    // Économie coupée : peutJouer répond « module », mais le timeout bloque quand même l'XP
    const G2 = "910000000000000005"
    db.setModule(G2, "communaute.economie", false)
    const t2 = contexte(G2, "13", { timeout: Date.now() + 3600 * 1000 })
    assert.strictEqual(await xp.gagnerXp(t2.message, { maintenant: t0, alea: aleaMin }), null, "timeout, économie coupée")
    const libre = contexte(G2, "14")
    assert.ok(await xp.gagnerXp(libre.message, { maintenant: t0, alea: aleaMin }), "XP sans économie")
    assert.strictEqual(db.sqlAll("SELECT COUNT(*) AS n FROM eco_comptes WHERE guild_id = ?", [G2])[0].n, 0, "aucun compte créé")
})

test("1 ✦ par gain quand l'économie est active", async () => {
    const G = "910000000000000006", { message, member } = contexte(G)
    await xp.gagnerXp(message, { maintenant: MERCREDI, alea: aleaMin })
    await xp.gagnerXp(message, { maintenant: MERCREDI + MINUTE, alea: aleaMin })
    assert.strictEqual(eco.compte(G, member.id).balance, 2)
    assert.ok(eco.verifierCoherence(G, member.id))
    // Membre récent : gain de 1 divisé par 2 = 0, rien d'écrit, mais l'XP est bien donnée
    const recent = contexte(G, "20", { jours: 1 })
    assert.ok(await xp.gagnerXp(recent.message, { maintenant: MERCREDI, alea: aleaMin }))
    assert.strictEqual(eco.compte(G, "20").balance, 0)
})

test("1 ✦ par gain d'XP, 100 ✦ par jour au plus, reparti de zéro le lendemain", async () => {
    const G = "910000000000000030", { message, member } = contexte(G)
    assert.strictEqual(xp.ECLATS_JOUR_MAX, 100)
    for (let n = 0; n < 130; n++) {
        const gain = await xp.gagnerXp(message, { maintenant: MERCREDI + n * MINUTE, alea: aleaMin })
        assert.ok(gain, `gain d'XP ${n + 1} : l'XP continue après le plafond de monnaie`)
    }
    assert.strictEqual(eco.compte(G, member.id).balance, 100, "100 ✦ au plus par jour")
    assert.strictEqual(db.sqlAll("SELECT COUNT(*) AS n FROM eco_journal WHERE guild_id = ? AND source = 'xp'", [G])[0].n, 100)
    assert.ok(eco.verifierCoherence(G, member.id))
    // Le lendemain, le compteur repart de zéro
    assert.ok(await xp.gagnerXp(message, { maintenant: MERCREDI + JOUR, alea: aleaMin }))
    assert.strictEqual(eco.compte(G, member.id).balance, 101)
})

// --- Bonus -------------------------------------------------------------------------------------------------------

test("week-end : samedi et dimanche, heure de Paris", () => {
    assert.strictEqual(xp.estWeekend(MERCREDI), false)
    assert.strictEqual(xp.estWeekend(SAMEDI), true)
    assert.strictEqual(xp.estWeekend(SAMEDI + JOUR), true)
    assert.strictEqual(xp.estWeekend(Date.UTC(2026, 10, 27, 23, 30)), true, "vendredi 23 h 30 UTC = samedi 0 h 30 à Paris")
    assert.strictEqual(xp.estWeekend(Date.UTC(2026, 10, 29, 23, 30)), false, "dimanche 23 h 30 UTC = lundi 0 h 30 à Paris")
})

test("bonus : plus grand de chaque type, week-end, total plafonné à ×2,5", async () => {
    const G = "910000000000000007"
    xp.definirBonus(G, "salon", "c1", 1.5)
    xp.definirBonus(G, "salon", "cat9", 2)
    xp.definirBonus(G, "role", "r1", 1.5)
    xp.definirBonus(G, "role", "r2", 2)
    assert.deepStrictEqual(xp.listerBonus(G, "role").map(b => b.multiplicateur), [2, 1.5])

    // Salon c1 (×1,5) dans la catégorie cat9 (×2) : le plus grand des salons, pas leur produit
    const guild = creerGuild(G)
    const salon = creerSalon("c1", { parentId: "cat9" })
    let membre = creerMembre(guild, "30", { roles: ["r1", "r2"] })
    let b = xp.multiplicateur(G, membre, salon, MERCREDI)
    assert.deepStrictEqual([b.salon, b.role, b.weekend, b.boost], [2, 2, 1, 1])
    assert.strictEqual(b.total, 2.5, "2 × 2 = 4, plafonné à 2,5")

    // Un seul bonus de rôle (×1,5) et un salon sans bonus
    membre = creerMembre(guild, "31", { roles: ["r1"] })
    b = xp.multiplicateur(G, membre, creerSalon("autre"), MERCREDI)
    assert.strictEqual(b.total, 1.5)
    assert.strictEqual(xp.multiplicateur(G, creerMembre(guild, "32"), creerSalon("autre"), MERCREDI).total, 1)

    // Week-end : seulement s'il est programmé
    assert.strictEqual(xp.multiplicateur(G, membre, creerSalon("autre"), SAMEDI).total, 1.5, "week-end non activé")
    xp.definirWeekend(G, true)
    assert.strictEqual(xp.multiplicateur(G, membre, creerSalon("autre"), SAMEDI).total, 2.5, "1,5 × 2 = 3, plafonné")
    assert.strictEqual(xp.multiplicateur(G, creerMembre(guild, "32"), creerSalon("autre"), SAMEDI).total, 2)
    assert.strictEqual(xp.multiplicateur(G, creerMembre(guild, "32"), creerSalon("autre"), MERCREDI).total, 1, "semaine")

    // Gain réel : 15 × 2,5 = 37,5 -> 38
    const message = creerMessage(guild, creerMembre(guild, "33", { roles: ["r2"] }), salon)
    const r = await xp.gagnerXp(message, { maintenant: SAMEDI, alea: aleaMin })
    assert.strictEqual(r.multiplicateur, 2.5)
    assert.strictEqual(r.gain, 38)

    // Retrait (×1) et limites
    xp.definirBonus(G, "role", "r2", 1)
    assert.deepStrictEqual(xp.listerBonus(G, "role").map(x => x.cible), ["r1"])
    for (const faux of [2.1, 3, NaN, "2", undefined]) assert.throws(() => xp.definirBonus(G, "salon", "z", faux), RangeError, String(faux))
    assert.throws(() => xp.definirBonus(G, "membre", "z", 1.5), RangeError, "un bonus ne vise ni un membre")
    const G2 = "910000000000000008"
    for (let i = 0; i < xp.MAX_BONUS; i++) xp.definirBonus(G2, "role", `r${i}`, 1.2)
    assert.throws(() => xp.definirBonus(G2, "role", "de-trop", 1.2), RangeError)
    assert.doesNotThrow(() => xp.definirBonus(G2, "role", "r0", 1.8), "modifier un bonus existant reste possible")
})

// --- Niveaux, paliers --------------------------------------------------------------------------------------------

test("passage de niveau : annonce, salon d'annonce, annonces coupées, événement", async () => {
    const G = "910000000000000009", evenements = []
    ecouter("niveau", e => evenements.push(e))
    const { guild, channel, message, member } = contexte(G)
    db.sqlRun("INSERT INTO xp (guild_id, user_id, xp, level) VALUES (?, ?, 95, 0)", [G, member.id])

    const r = await xp.gagnerXp(message, { maintenant: MERCREDI, alea: aleaMin })
    assert.strictEqual(r.niveau, 1)
    assert.strictEqual(r.ancienNiveau, 0)
    assert.strictEqual(ligneXp(G, member.id).level, 1)
    assert.strictEqual(channel.envois.length, 1)
    assert.match(channel.envois[0].content, /<@100>.*\*\*1\*\*/)
    assert.deepStrictEqual(channel.envois[0].allowedMentions, { parse: [] }, "aucune mention active")
    assert.deepStrictEqual(evenements, [{ guildId: G, userId: member.id, level: 1 }])

    // Pas de passage de niveau : ni message ni événement
    await xp.gagnerXp(message, { maintenant: MERCREDI + MINUTE, alea: aleaMin })
    assert.strictEqual(channel.envois.length, 1)
    assert.strictEqual(evenements.length, 1)

    // Salon d'annonce dédié
    const annonces = creerSalon("annonces")
    guild.channels.cache.set("annonces", annonces)
    xp.definirSalonAnnonce(G, "annonces")
    db.sqlRun("UPDATE xp SET xp = 240, level = 1 WHERE guild_id = ? AND user_id = ?", [G, member.id]) // niveau 2 à 244
    await xp.gagnerXp(message, { maintenant: MERCREDI + 2 * MINUTE, alea: aleaMin })
    assert.strictEqual(annonces.envois.length, 1)
    assert.strictEqual(channel.envois.length, 1, "pas dans le salon du message")
    assert.strictEqual(evenements.length, 2)

    // Annonces coupées : le niveau est quand même donné et l'événement émis
    xp.definirSalonAnnonce(G, xp.SANS_ANNONCE)
    db.sqlRun("UPDATE xp SET xp = 430, level = 2 WHERE guild_id = ? AND user_id = ?", [G, member.id]) // niveau 3 à 440
    await xp.gagnerXp(message, { maintenant: MERCREDI + 3 * MINUTE, alea: aleaMin })
    assert.strictEqual(ligneXp(G, member.id).level, 3)
    assert.strictEqual(annonces.envois.length, 1)
    assert.strictEqual(channel.envois.length, 1)
    assert.strictEqual(evenements.length, 3)

    // Salon d'annonce supprimé : repli sur le salon du message
    xp.definirSalonAnnonce(G, "disparu")
    db.sqlRun("UPDATE xp SET xp = 690, level = 3 WHERE guild_id = ? AND user_id = ?", [G, member.id]) // niveau 4 à 696
    await xp.gagnerXp(message, { maintenant: MERCREDI + 4 * MINUTE, alea: aleaMin })
    assert.strictEqual(channel.envois.length, 2)

    // Une annonce qui échoue (salon sans droit d'écriture) ne casse pas le gain
    channel.send = async () => { throw new Error("Missing Permissions") }
    db.sqlRun("UPDATE xp SET xp = 1010, level = 4 WHERE guild_id = ? AND user_id = ?", [G, member.id])
    const erreurs = console.error
    console.error = () => {}
    try {
        assert.ok(await xp.gagnerXp(message, { maintenant: MERCREDI + 5 * MINUTE, alea: aleaMin }))
    } finally {
        console.error = erreurs
    }
    retirerEcouteurs()
})

test("plusieurs niveaux d'un coup : tous les paliers franchis sont appliqués", async () => {
    const G = "910000000000000010", { guild, member } = contexte(G)
    const r3 = creerRole(guild, "p3", 5), r5 = creerRole(guild, "p5", 5), r8 = creerRole(guild, "p8", 5), r20 = creerRole(guild, "p20", 5)
    assert.ok(r3 && r5 && r8 && r20)
    paliers.definirPalier(G, { niveau: 3, roleId: "p3" })
    paliers.definirPalier(G, { niveau: 5, roleId: "p5", recompense: 50 })
    paliers.definirPalier(G, { niveau: 8, roleId: "p8", recompense: 100 })
    paliers.definirPalier(G, { niveau: 20, roleId: "p20" })

    // Mode cumul : de 2 à 12, les paliers 3, 5 et 8 sont franchis, pas le 20
    const bilan = await paliers.appliquerPaliers(member, 2, 12)
    assert.deepStrictEqual(bilan.roles.sort(), ["p3", "p5", "p8"])
    assert.strictEqual(bilan.recompense, 150)
    assert.strictEqual(eco.compte(G, member.id).balance, 150)
    assert.ok(member.roles.cache.has("p3") && member.roles.cache.has("p8") && !member.roles.cache.has("p20"))
    // Rien si le niveau ne monte pas, ou ne franchit aucun palier
    assert.deepStrictEqual(await paliers.appliquerPaliers(member, 12, 12), { roles: [], retires: [], recompense: 0 })
    assert.deepStrictEqual(await paliers.appliquerPaliers(member, 12, 19), { roles: [], retires: [], recompense: 0 })

    // Niveau d'un coup via le calcul : 0 -> niveau 10 se lit bien (3 940 XP)
    assert.strictEqual(xp.niveauPourXp(3940), 10)
})

test("paliers : mode remplace, un seul rôle gardé", async () => {
    const G = "910000000000000011", { guild, member } = contexte(G)
    for (const [id, niveau] of [["a", 2], ["b", 5], ["c", 9]]) {
        creerRole(guild, id, 5)
        paliers.definirPalier(G, { niveau, roleId: id })
    }
    paliers.definirMode(G, "remplace")
    assert.strictEqual(paliers.lireMode(G), "remplace")

    let bilan = await paliers.appliquerPaliers(member, 0, 6) // franchit 2 et 5 : seul le 5 est donné
    assert.deepStrictEqual(bilan.roles, ["b"])
    assert.deepStrictEqual([...member.roles.cache.keys()], ["b"])
    member.roles.cache.set("a", { id: "a" }) // un ancien rôle de palier encore porté
    bilan = await paliers.appliquerPaliers(member, 6, 9)
    assert.deepStrictEqual(bilan.roles, ["c"])
    assert.deepStrictEqual(bilan.retires.sort(), ["a", "b"])
    assert.deepStrictEqual([...member.roles.cache.keys()], ["c"], "seul le palier le plus haut est gardé")

    // Un rôle qui n'a rien à voir avec les paliers n'est jamais retiré
    member.roles.cache.set("autre", { id: "autre" })
    creerRole(guild, "d", 5)
    paliers.definirPalier(G, { niveau: 15, roleId: "d" })
    await paliers.appliquerPaliers(member, 9, 15)
    assert.deepStrictEqual([...member.roles.cache.keys()].sort(), ["autre", "d"])

    // Retour au mode cumul
    paliers.definirMode(G, "cumul")
    assert.strictEqual(paliers.lireMode(G), "cumul")
    assert.throws(() => paliers.definirMode(G, "autre"), RangeError)
})

test("paliers : rôle dangereux ou hors de portée refusé, revérifié à l'attribution", async () => {
    const G = "910000000000000012", { guild, member } = contexte(G)
    const config = creerMembre(guild, "9", { roles: [] })
    config.permissions = new Discord.PermissionsBitField([Flags.ManageRoles, Flags.ManageGuild])
    config.roles.highest = faussRole(8)

    const sain = creerRole(guild, "sain", 5)
    assert.strictEqual(paliers.refusRolePalier(guild, sain, config, "fr"), null)

    for (const perm of [Flags.Administrator, Flags.ManageRoles, Flags.BanMembers, Flags.MentionEveryone, Flags.ManageGuild]) {
        const dangereux = creerRole(guild, `d${perm}`, 5, [perm])
        assert.ok(paliers.refusRolePalier(guild, dangereux, config, "fr"), `permission ${perm} refusée`)
    }
    const gere = creerRole(guild, "gere", 5)
    gere.managed = true
    assert.ok(paliers.refusRolePalier(guild, gere, config, "fr"), "rôle géré par une intégration")
    assert.ok(paliers.refusRolePalier(guild, Object.assign(creerRole(guild, G, 1), { id: G }), config, "fr"), "@everyone")
    assert.ok(paliers.refusRolePalier(guild, creerRole(guild, "haut", 12), config, "fr"), "au-dessus du bot")
    assert.ok(paliers.refusRolePalier(guild, creerRole(guild, "egal", 8), config, "fr"), "au niveau du configurateur")
    // Configurateur sans « Gérer les rôles »
    const faible = creerMembre(guild, "8")
    faible.permissions = new Discord.PermissionsBitField([Flags.ManageGuild])
    faible.roles.highest = faussRole(9)
    assert.ok(paliers.refusRolePalier(guild, sain, faible, "fr"), "configurateur sans Gérer les rôles")
    // Bot sans « Gérer les rôles »
    const guild2 = creerGuild("910000000000000099")
    guild2.members.me.permissions = new Discord.PermissionsBitField([])
    assert.ok(paliers.refusRolePalier(guild2, creerRole(guild2, "x", 5), null, "fr"), "bot sans Gérer les rôles")

    // Le rôle est devenu dangereux après la création du palier : il n'est pas donné
    paliers.definirPalier(G, { niveau: 1, roleId: "sain", recompense: 10 })
    sain.permissions = new Discord.PermissionsBitField([Flags.Administrator])
    const bilan = await paliers.appliquerPaliers(member, 0, 1)
    assert.deepStrictEqual(bilan.roles, [])
    assert.ok(!member.roles.cache.has("sain"))
    assert.strictEqual(bilan.recompense, 10, "la récompense en monnaie reste due")

    // Rôle supprimé : ignoré sans erreur
    paliers.definirPalier(G, { niveau: 2, roleId: "fantome" })
    assert.deepStrictEqual((await paliers.appliquerPaliers(member, 1, 2)).roles, [])

    // Une erreur Discord sur un rôle n'empêche pas les autres
    const ok = creerRole(guild, "ok", 5), casse = creerRole(guild, "casse", 5)
    assert.ok(ok && casse)
    paliers.definirPalier(G, { niveau: 3, roleId: "casse" })
    paliers.definirPalier(G, { niveau: 4, roleId: "ok" })
    const ajout = member.roles.add
    member.roles.add = async r => { if (r.id === "casse") throw new Error("Missing Permissions"); return ajout(r) }
    const erreurs = console.error
    console.error = () => {}
    try {
        assert.deepStrictEqual((await paliers.appliquerPaliers(member, 2, 4)).roles, ["ok"])
    } finally {
        console.error = erreurs
    }
})

test("paliers : récompense sans économie, validation et limite", async () => {
    const G = "910000000000000013", { member } = contexte(G)
    db.setModule(G, "communaute.economie", false)
    paliers.definirPalier(G, { niveau: 4, recompense: 200 })
    assert.deepStrictEqual(await paliers.appliquerPaliers(member, 3, 4), { roles: [], retires: [], recompense: 0 }, "économie coupée : pas de récompense")

    assert.throws(() => paliers.definirPalier(G, { niveau: 0, roleId: "r" }), RangeError)
    assert.throws(() => paliers.definirPalier(G, { niveau: 201, roleId: "r" }), RangeError)
    assert.throws(() => paliers.definirPalier(G, { niveau: 2.5, roleId: "r" }), RangeError)
    assert.throws(() => paliers.definirPalier(G, { niveau: 6 }), RangeError, "ni rôle ni récompense")
    assert.throws(() => paliers.definirPalier(G, { niveau: 6, roleId: "r", recompense: -1 }), RangeError)
    assert.throws(() => paliers.definirPalier(G, { niveau: 6, roleId: "r", recompense: 5001 }), RangeError)

    const G2 = "910000000000000014"
    for (let i = 1; i <= paliers.MAX_PALIERS; i++) paliers.definirPalier(G2, { niveau: i, recompense: 5 })
    assert.throws(() => paliers.definirPalier(G2, { niveau: 100, recompense: 5 }), RangeError, "26e palier")
    assert.doesNotThrow(() => paliers.definirPalier(G2, { niveau: 1, recompense: 9 }), "remplacer un palier existant")
    assert.strictEqual(paliers.listerPaliers(G2).length, 25)
    assert.strictEqual(paliers.listerPaliers(G2)[0].recompense, 9)
    assert.strictEqual(paliers.retirerPalier(G2, 1), true)
    assert.strictEqual(paliers.retirerPalier(G2, 1), false)
})

test("de bout en bout : un gain fait monter le niveau, donne le palier et l'annonce", async () => {
    const G = "910000000000000015", { guild, channel, message, member } = contexte(G)
    creerRole(guild, "r1", 5)
    paliers.definirPalier(G, { niveau: 1, roleId: "r1", recompense: 30 })
    db.sqlRun("INSERT INTO xp (guild_id, user_id, xp, level) VALUES (?, ?, 99, 0)", [G, member.id])
    await xp.gagnerXp(message, { maintenant: MERCREDI, alea: aleaMin })
    assert.ok(member.roles.cache.has("r1"))
    assert.strictEqual(eco.compte(G, member.id).balance, 31, "30 de palier + 1 pour le message")
    assert.match(channel.envois[0].content, /<@&r1>/)
    assert.match(channel.envois[0].content, /30/)
})

test("rang et profil : classement, progression, XP du jour", () => {
    const G = "910000000000000016"
    for (const [id, valeur] of [["a", 500], ["b", 500], ["c", 900], ["d", 0]]) db.sqlRun("INSERT INTO xp (guild_id, user_id, xp, level) VALUES (?, ?, ?, ?)", [G, id, valeur, xp.niveauPourXp(valeur)])
    assert.strictEqual(xp.profilXp(G, "c").rang, 1)
    assert.strictEqual(xp.profilXp(G, "a").rang, 2, "égalité : l'identifiant le plus petit d'abord")
    assert.strictEqual(xp.profilXp(G, "b").rang, 3)
    assert.strictEqual(xp.profilXp(G, "d").rang, null, "0 XP : pas classé")
    assert.strictEqual(xp.profilXp(G, "inconnu").rang, null)
    const p = xp.profilXp(G, "c")
    assert.deepStrictEqual([p.niveau, p.dansNiveau, p.pourNiveau], [4, 900 - 696, 324])
    assert.strictEqual(p.xpJour, 0)
    assert.strictEqual(xp.profilXp("autre-serveur", "c").rang, null, "classement par serveur")
})

// --- Commandes ---------------------------------------------------------------------------------------------------

// Fausses options : seules les valeurs données sont lues
const options = valeurs => ({
    getString: n => valeurs[n] ?? null, getChannel: n => valeurs[n] ?? null, getRole: n => valeurs[n] ?? null,
    getNumber: n => valeurs[n] ?? null, getInteger: n => valeurs[n] ?? null, getBoolean: n => valeurs[n] ?? null, getUser: n => valeurs[n] ?? null
})

function creerInteraction(guild, member, args = {}) {
    const reponses = []
    return {
        reponses, guild, guildId: guild.id, member, user: member.user, locale: "fr",
        replied: false, deferred: false, reply: async r => reponses.push(r), options: options(args)
    }
}

test("/rang : embed avec niveau, barre, rang et XP du jour", async () => {
    const G = "910000000000000017", { guild, member } = contexte(G)
    db.sqlRun("INSERT INTO xp (guild_id, user_id, xp, level) VALUES (?, ?, 150, 1)", [G, member.id])
    const i = creerInteraction(guild, member)
    await rang.run(null, i, i.options)
    const embed = i.reponses[0].embeds[0].toJSON()
    assert.match(embed.description, /\*\*1\*\*/)
    assert.match(embed.description, /50 \/ 144 XP/)
    assert.match(embed.description, /▰{3}▱{7}/)
    assert.deepStrictEqual(embed.fields.map(f => f.value), ["n° 1", "150", "0 / 3000"])
    assert.ok(!i.reponses[0].flags, "réponse publique, sans mention")

    // Un bot n'a pas d'XP
    const bot = creerInteraction(guild, member, { membre: { id: "9", bot: true, username: "b" } })
    await rang.run(null, bot, bot.options)
    assert.ok(bot.reponses[0].flags, "refus éphémère")
})

test("/niveaux : réglages, paliers refusés pour un rôle dangereux", async () => {
    const G = "910000000000000018", { guild } = contexte(G)
    const admin = creerMembre(guild, "9")
    admin.permissions = new Discord.PermissionsBitField([Flags.ManageRoles, Flags.ManageGuild])
    admin.roles.highest = faussRole(8)
    admin.user = { id: "9" }
    const salon = { id: "c5", toString: () => "<#c5>" }
    const lancer = async valeurs => {
        const i = creerInteraction(guild, admin, valeurs)
        await niveaux.run(null, i, i.options)
        return i.reponses[0]
    }

    await lancer({ action: "exclure", salon })
    assert.deepStrictEqual(xp.lireConfig(G).exclus, ["c5"])
    assert.ok((await lancer({ action: "exclure", salon })).flags, "déjà exclu : refus")
    assert.ok((await lancer({ action: "exclure" })).flags, "salon manquant")
    await lancer({ action: "inclure", salon })
    assert.deepStrictEqual(xp.lireConfig(G).exclus, [])

    await lancer({ action: "bonus", salon, multiplicateur: 1.5 })
    assert.strictEqual(xp.listerBonus(G, "salon")[0].multiplicateur, 1.5)
    assert.ok((await lancer({ action: "bonus", multiplicateur: 1.5 })).flags, "ni salon ni rôle")
    assert.ok((await lancer({ action: "bonus", salon, role: creerRole(guild, "rb", 5), multiplicateur: 1.5 })).flags, "salon et rôle")
    assert.ok((await lancer({ action: "bonus", salon })).flags, "multiplicateur manquant")
    await lancer({ action: "bonus", salon, multiplicateur: 1 })
    assert.deepStrictEqual(xp.listerBonus(G, "salon"), [])

    const sain = creerRole(guild, "sain", 5), admin_role = creerRole(guild, "adm", 5, [Flags.Administrator])
    assert.ok((await lancer({ action: "palier", niveau: 3, role: admin_role })).flags, "rôle dangereux refusé")
    assert.deepStrictEqual(paliers.listerPaliers(G), [])
    assert.ok((await lancer({ action: "palier", niveau: 3 })).flags, "ni rôle ni récompense")
    await lancer({ action: "palier", niveau: 3, role: sain, recompense: 20 })
    assert.deepStrictEqual(paliers.listerPaliers(G), [{ niveau: 3, roleId: "sain", recompense: 20 }])
    assert.ok((await lancer({ action: "retirer_palier", niveau: 9 })).flags, "palier inconnu")
    await lancer({ action: "mode", mode: "remplace" })
    assert.strictEqual(xp.lireConfig(G).mode, "remplace")
    assert.ok((await lancer({ action: "mode" })).flags)

    await lancer({ action: "weekend", actif: true })
    assert.strictEqual(xp.lireConfig(G).weekend, true)
    await lancer({ action: "weekend" }) // bascule
    assert.strictEqual(xp.lireConfig(G).weekend, false)
    await lancer({ action: "salon_annonce", actif: false })
    assert.strictEqual(xp.lireConfig(G).salonAnnonce, xp.SANS_ANNONCE)
    await lancer({ action: "salon_annonce" })
    assert.strictEqual(xp.lireConfig(G).salonAnnonce, null)
    assert.ok((await lancer({ action: "salon_annonce", salon: { id: "v1", type: Discord.ChannelType.GuildVoice } })).flags, "salon vocal refusé")

    const voir = await lancer({ action: "voir" })
    assert.match(voir.content, /Niveau 3/)
    assert.match(voir.content, /<@&sain>/)
    assert.match(voir.content, /remplace/)
    await lancer({ action: "retirer_palier", niveau: 3 })
    assert.deepStrictEqual(paliers.listerPaliers(G), [])
})

// --- Critique du lot 3B : filtre des refus, cache des réglages, paliers, messageCreate ---------------------------

test("XP : les refus (sanction, module) sont retenus une minute, un salon exclu ne bloque pas les autres salons", async () => {
    const G = "910000000000000030"
    const { guild, member } = contexte(G, "40", { timeout: Date.now() + 3600 * 1000 })
    const salon = creerSalon("sx")
    const t0 = MERCREDI
    assert.strictEqual(await xp.gagnerXp(creerMessage(guild, member, salon), { maintenant: t0 }), null)
    // La sanction est levée : le refus reste mémorisé jusqu'à la minute suivante, sans retoucher la base
    member.communicationDisabledUntilTimestamp = null
    assert.strictEqual(await xp.gagnerXp(creerMessage(guild, member, salon), { maintenant: t0 + 30 * 1000 }), null, "refus retenu")
    assert.ok(await xp.gagnerXp(creerMessage(guild, member, salon), { maintenant: t0 + MINUTE }))

    // Salon exclu : le refus est propre à ce salon
    xp.definirExclusion(G, "ex", true)
    const exclu = creerSalon("ex"), libre = creerSalon("libre")
    const m2 = creerMembre(guild, "41")
    assert.strictEqual(await xp.gagnerXp(creerMessage(guild, m2, exclu), { maintenant: t0 }), null)
    assert.strictEqual(await xp.gagnerXp(creerMessage(guild, m2, exclu), { maintenant: t0 + 1000 }), null)
    assert.ok(await xp.gagnerXp(creerMessage(guild, m2, libre), { maintenant: t0 + 2000 }), "autre salon : gain immédiat")
})

test("XP : réglages en cache 60 s par serveur, invalidés par les écritures", async () => {
    const G = "910000000000000031"
    const { guild, member } = contexte(G, "50")
    const salon = creerSalon("cs")
    guild.channels.cache.set(salon.id, salon)
    assert.ok(await xp.gagnerXp(creerMessage(guild, member, salon), { maintenant: MERCREDI }), "réglages lus et mis en cache")
    // Écriture directe en base, sans passer par xp.js : le cache ne la voit pas encore
    db.sqlRun("INSERT INTO xp_config (guild_id, excluded_channels) VALUES (?, ?) ON CONFLICT (guild_id) DO UPDATE SET excluded_channels = excluded.excluded_channels",
        [G, JSON.stringify(["cs"])])
    assert.ok(await xp.gagnerXp(creerMessage(guild, member, salon), { maintenant: MERCREDI + MINUTE }), "encore en cache")
    xp.invaliderReglages(G)
    assert.strictEqual(await xp.gagnerXp(creerMessage(guild, member, salon), { maintenant: MERCREDI + 2 * MINUTE }), null, "cache vidé : salon exclu")
    // Une écriture par l'API (définir*) invalide tout de suite
    xp.definirExclusion(G, "cs", false)
    assert.ok(await xp.gagnerXp(creerMessage(guild, member, salon), { maintenant: MERCREDI + 3 * MINUTE }))
    xp.definirBonus(G, "salon", "cs", 2)
    const r = await xp.gagnerXp(creerMessage(guild, member, salon), { maintenant: MERCREDI + 4 * MINUTE, alea: aleaMin })
    assert.strictEqual(r.multiplicateur, 2, "bonus pris en compte sans attendre")
    paliers.definirMode(G, "remplace")
    assert.strictEqual(xp.lireConfig(G).mode, "remplace")
})

test("paliers : une erreur de crédit n'empêche pas de donner les rôles", async () => {
    const G = "910000000000000032", { guild, member } = contexte(G)
    creerRole(guild, "r1", 5)
    paliers.definirPalier(G, { niveau: 1, roleId: "r1", recompense: 50 })
    Object.defineProperty(member, "communicationDisabledUntilTimestamp", { get() { throw new Error("panne") } })
    const erreurs = console.error
    console.error = () => {}
    try {
        const bilan = await paliers.appliquerPaliers(member, 0, 1)
        assert.deepStrictEqual(bilan.roles, ["r1"])
        assert.strictEqual(bilan.recompense, 0)
    } finally {
        console.error = erreurs
    }
})

test("paliers : mode remplace, palier le plus haut inutilisable = meilleur palier utilisable", async () => {
    const G = "910000000000000033", { guild, member } = contexte(G)
    creerRole(guild, "bas", 5)
    creerRole(guild, "milieu", 5)
    creerRole(guild, "haut", 5, [Flags.Administrator])
    for (const [niveau, roleId] of [[2, "bas"], [5, "milieu"], [9, "haut"]]) paliers.definirPalier(G, { niveau, roleId })
    paliers.definirMode(G, "remplace")
    const bilan = await paliers.appliquerPaliers(member, 0, 10)
    assert.deepStrictEqual(bilan.roles, ["milieu"], "le rôle dangereux est sauté, le palier 5 est donné")
    assert.deepStrictEqual([...member.roles.cache.keys()], ["milieu"])
})

test("messageCreate : XP et drops partent en même temps, une panne n'arrête pas l'autre", async () => {
    const chemin = require.resolve('../Events/messageCreate')
    const cheminXp = require.resolve('../Fonctions/xp'), cheminDrops = require.resolve('../Fonctions/drops')
    const sauvegarde = [require.cache[cheminXp], require.cache[cheminDrops]]
    const journal = []
    let finirXp
    const attenteXp = new Promise(resolve => { finirXp = resolve })
    const fausse = (chemin, exports) => { require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports } }
    fausse(cheminXp, { gagnerXp: async () => { journal.push("xp début"); await attenteXp; journal.push("xp fin") } })
    fausse(cheminDrops, { peutEtreDrop: async () => { journal.push("drop"); throw new Error("panne de drop") } })
    delete require.cache[chemin]
    const erreurs = console.error
    const messages = []
    console.error = m => messages.push(m)
    try {
        const evenement = require('../Events/messageCreate')
        const message = { guild: { id: "1" }, author: { bot: false } }
        const fini = evenement({}, message)
        await new Promise(r => setImmediate(r))
        assert.deepStrictEqual(journal, ["xp début", "drop"], "le drop n'attend pas la fin de l'XP")
        finirXp()
        await fini
        assert.deepStrictEqual(journal, ["xp début", "drop", "xp fin"])
        assert.ok(messages.some(m => /drop/.test(m)), "la panne est journalisée")
        // Bots et messages privés : rien
        journal.length = 0
        await evenement({}, { guild: { id: "1" }, author: { bot: true } })
        await evenement({}, { guild: null, author: { bot: false } })
        assert.deepStrictEqual(journal, [])
    } finally {
        console.error = erreurs
        delete require.cache[chemin]
        require.cache[cheminXp] = sauvegarde[0]
        if (sauvegarde[1]) require.cache[cheminDrops] = sauvegarde[1]
        else delete require.cache[cheminDrops]
    }
})

test("paliers : le rôle staff du bot est refusé à la configuration et à l'attribution", async () => {
    const G = "910000000000000041", { guild, member } = contexte(G)
    const config = creerMembre(guild, "9")
    config.permissions = new Discord.PermissionsBitField([Flags.ManageRoles, Flags.ManageGuild])
    config.roles.highest = faussRole(8)
    const staff = creerRole(guild, "staff", 5)
    assert.strictEqual(paliers.refusRolePalier(guild, staff, config, "fr"), null, "pas encore réservé")
    paliers.definirPalier(G, { niveau: 1, roleId: "staff" })
    db.setStaffRole(G, "staff")
    assert.ok(paliers.refusRolePalier(guild, staff, config, "fr"), "refusé à la configuration")
    const bilan = await paliers.appliquerPaliers(member, 0, 1)
    assert.deepStrictEqual(bilan.roles, [], "refusé à l'attribution")
    assert.ok(!member.roles.cache.has("staff"))
})
