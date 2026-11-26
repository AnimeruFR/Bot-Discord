process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const db = require('../Fonctions/db')
const economie = require('../Fonctions/economie')
const { emettre } = require('../Fonctions/evenements')
const succes = require('../Fonctions/succes')
const quetes = require('../Fonctions/quetes')

const G = "111111111111111111"
const membres = new Map()

// Faux membre ancien (pas de réduction « nouveau »)
function membre(userId) {
    if (!membres.has(userId)) {
        membres.set(userId, { id: userId, guild: { id: G }, user: { bot: false }, joinedTimestamp: 1000, communicationDisabledUntilTimestamp: null })
    }
    return membres.get(userId)
}
succes.configurerClient({ guilds: { cache: new Map([[G, { members: { fetch: async id => membres.get(id) } }]]) } })

const solde = userId => economie.compte(G, userId).balance
const instant = (jour, heure = 12) => Date.UTC(2026, 10, jour, heure)

test("catalogues : au moins 40 succès, 15 quêtes du jour, 5 de la semaine, récompenses dans les bornes", () => {
    assert.ok(succes.catalogue.length >= 40)
    assert.strictEqual(new Set(succes.catalogue.map(s => s.id)).size, succes.catalogue.length, "identifiants uniques")
    for (const s of succes.catalogue) {
        assert.ok(s.nom.fr && s.nom.en && s.description.fr && s.description.en, s.id)
        assert.ok(s.recompense >= 50 && s.recompense <= 1000, `récompense de ${s.id}`)
        const effets = succes.EFFETS[s.condition.evenement]({ streak: 1, level: 1, amount: 1 })
        assert.ok(effets.some(([stat]) => stat === s.condition.stat), `${s.id} : la stat ${s.condition.stat} vient de ${s.condition.evenement}`)
    }
    assert.ok(quetes.catalogue.jour.length >= 15 && quetes.catalogue.semaine.length >= 5)
    for (const q of quetes.catalogue.jour) assert.ok(q.recompense >= 40 && q.recompense <= 80, q.id)
    for (const q of quetes.catalogue.semaine) assert.strictEqual(q.recompense, 600, q.id)
})

test("un succès n'est obtenu qu'une fois, même avec deux événements simultanés, et la récompense n'est versée qu'une fois", async () => {
    const U = "200000000000000001"
    membre(U)
    const donnees = { guildId: G, userId: U, streak: 3 }
    const [a, b] = await Promise.all([succes.enregistrer("daily", donnees), succes.enregistrer("daily", donnees)])
    assert.strictEqual(a.length + b.length, 2, "premier_daily et serie_3, une seule fois chacun")
    assert.strictEqual(solde(U), 100, "50 + 50")
    assert.strictEqual(db.sqlAll("SELECT * FROM succes WHERE guild_id = ? AND user_id = ?", [G, U]).length, 2)
    await succes.enregistrer("daily", donnees)
    assert.strictEqual(solde(U), 100, "rien de plus au 3e événement")
    assert.strictEqual(db.sqlAll("SELECT COUNT(*) AS n FROM eco_journal WHERE user_id = ? AND source = 'succes'", [U])[0].n, 2)
})

test("compteurs : addition, maximum, parties_gagnees tenu à jour", async () => {
    const U = "200000000000000002"
    membre(U)
    for (let i = 0; i < 3; i++) await succes.enregistrer("partie:gagnee", { guildId: G, userId: U, game: "pfc" })
    await succes.enregistrer("partie:jouee", { guildId: G, userId: U, game: "pfc" })
    await succes.enregistrer("niveau", { guildId: G, userId: U, level: 12 })
    await succes.enregistrer("niveau", { guildId: G, userId: U, level: 7 })
    await succes.enregistrer("paiement", { guildId: G, userId: U, to: "x", amount: 400 })
    const stats = succes.lireStats(G, U)
    assert.strictEqual(stats.parties_gagnees, 3)
    assert.strictEqual(stats.parties_jouees, 1)
    assert.strictEqual(stats.niveau_max, 12, "le maximum ne redescend pas")
    assert.strictEqual(stats.monnaie_donnee, 400)
    const liste = succes.liste(G, U)
    assert.ok(liste.find(s => s.id === "premiere_victoire").obtenuLe)
    assert.strictEqual(liste.find(s => s.id === "victoires_10").valeur, 3)
    assert.strictEqual(liste.find(s => s.id === "niveau_10").obtenuLe > 0, true)
})

test("membre introuvable : succès obtenu sans récompense ; compte gelé : idem", async () => {
    const absent = "200000000000000003"
    await succes.enregistrer("drop:ramasse", { guildId: G, userId: absent })
    assert.ok(succes.liste(G, absent).find(s => s.id === "premier_drop").obtenuLe)
    assert.strictEqual(db.sqlAll("SELECT COUNT(*) AS n FROM eco_journal WHERE user_id = ?", [absent])[0].n, 0)

    const gele = "200000000000000004"
    membre(gele)
    economie.geler(G, gele, true)
    await succes.enregistrer("mot:trouve", { guildId: G, userId: gele })
    assert.ok(succes.liste(G, gele).find(s => s.id === "premier_mot").obtenuLe)
    assert.strictEqual(solde(gele), 0)
})

test("le bus alimente succès et quêtes", async () => {
    const U = "200000000000000005"
    membre(U)
    emettre("quiz:bonne_reponse", { guildId: G, userId: U })
    await new Promise(r => setImmediate(r))
    assert.strictEqual(succes.lireStats(G, U).quiz_bonnes, 1)
})

test("quêtes : mêmes quêtes toute la journée, autres le lendemain, lignes créées à la première lecture", () => {
    const U = "200000000000000006"
    assert.strictEqual(db.sqlAll("SELECT COUNT(*) AS n FROM quetes WHERE user_id = ?", [U])[0].n, 0)
    const ids = (liste, type) => liste.filter(q => q.type === type).map(q => q.id).join(",")
    const matin = quetes.quetesDuMembre(G, U, { instant: instant(10, 8) })
    const soir = quetes.quetesDuMembre(G, U, { instant: instant(10, 22) })
    assert.strictEqual(ids(matin, "jour"), ids(soir, "jour"))
    assert.strictEqual(matin.filter(q => q.type === "jour").length, 3)
    assert.strictEqual(matin.filter(q => q.type === "semaine").length, 1)
    assert.strictEqual(new Set(matin.filter(q => q.type === "jour").map(q => q.id)).size, 3)

    const jours = [10, 11, 12, 13, 14].map(j => ids(quetes.quetesDuMembre(G, U, { instant: instant(j) }), "jour"))
    assert.ok(new Set(jours).size > 1, "le tirage change d'un jour à l'autre")
    // Autre membre, même jour : tirage indépendant mais déterministe
    const V = "200000000000000007"
    assert.strictEqual(ids(quetes.quetesDuMembre(G, V, { instant: instant(10) }), "jour"), ids(quetes.quetesDuMembre(G, V, { instant: instant(10, 20) }), "jour"))
})

test("semaine de Paris au format AAAA-Wnn", () => {
    assert.strictEqual(quetes.semaineParis(Date.UTC(2026, 0, 1, 12)), "2026-W01")
    assert.strictEqual(quetes.semaineParis(Date.UTC(2026, 10, 23, 12)), "2026-W48", "lundi")
    assert.strictEqual(quetes.semaineParis(Date.UTC(2026, 10, 29, 12)), "2026-W48", "dimanche")
    assert.strictEqual(quetes.semaineParis(Date.UTC(2026, 10, 30, 12)), "2026-W49")
    assert.strictEqual(quetes.semaineParis(Date.UTC(2027, 0, 1, 12)), "2026-W53", "1er janvier 2027 : encore la semaine 53 de 2026")
    // Dimanche 23 h 30 UTC = lundi 0 h 30 à Paris
    assert.strictEqual(quetes.semaineParis(Date.UTC(2026, 10, 29, 23, 30)), "2026-W49")
})

// Fait progresser toutes les quêtes du jour et de la semaine jusqu'à l'objectif
function toutTerminer(userId, t) {
    for (const q of quetes.quetesDuMembre(G, userId, { instant: t })) {
        const def = [...quetes.catalogue.jour, ...quetes.catalogue.semaine].find(d => d.id === q.id)
        for (let i = 0; i < q.goal + 2; i++) quetes.avancer(def.evenement, { guildId: G, userId }, { instant: t })
    }
}

test("quêtes : la progression plafonne à l'objectif, réclamer deux fois = une seule récompense", () => {
    const U = "200000000000000008"
    const m = membre(U)
    const t = instant(10)
    assert.strictEqual(quetes.reclamer(m, { instant: t }).rien, true, "rien de terminé au départ")
    toutTerminer(U, t)
    const avant = quetes.quetesDuMembre(G, U, { instant: t })
    assert.ok(avant.every(q => q.progress === q.goal && !q.claimed))
    const attendu = avant.reduce((somme, q) => somme + q.recompense, 0)

    const premiere = quetes.reclamer(m, { instant: t })
    assert.strictEqual(premiere.reclamees.length, 4)
    assert.strictEqual(premiere.total, attendu)
    assert.strictEqual(solde(U), attendu)
    const seconde = quetes.reclamer(m, { instant: t })
    assert.strictEqual(seconde.rien, true)
    assert.strictEqual(solde(U), attendu, "pas de seconde récompense")
    // Une progression après réclamation ne change rien
    quetes.avancer("daily", { guildId: G, userId: U }, { instant: t })
    assert.ok(quetes.quetesDuMembre(G, U, { instant: t }).every(q => q.claimed))
})

test("quête hebdomadaire : une seule récompense de 600 pour toute la semaine, nouvelle semaine = nouvelle quête", () => {
    const U = "200000000000000009"
    const m = membre(U)
    const lundi = instant(9), mercredi = instant(11)
    const hebdo = t => quetes.quetesDuMembre(G, U, { instant: t }).find(q => q.type === "semaine")
    const q = hebdo(lundi)
    assert.strictEqual(hebdo(mercredi).id, q.id, "même quête toute la semaine")
    assert.strictEqual(hebdo(mercredi).period, q.period)
    const def = quetes.catalogue.semaine.find(d => d.id === q.id)
    for (let i = 0; i < q.goal; i++) quetes.avancer(def.evenement, { guildId: G, userId: U }, { instant: i % 2 ? lundi : mercredi })
    assert.strictEqual(hebdo(mercredi).progress, q.goal, "la progression s'additionne sur la semaine")
    const resultat = quetes.reclamer(m, { instant: mercredi })
    assert.ok(resultat.reclamees.some(r => r.id === q.id && r.montant === 600))
    assert.strictEqual(quetes.reclamer(m, { instant: instant(12) }).reclamees.some(r => r.id === q.id), false)
    assert.notStrictEqual(hebdo(instant(17)).period, q.period, "semaine suivante")
    assert.strictEqual(hebdo(instant(17)).claimed, false)
})

test("quêtes : compte gelé = récompense refusée et pas perdue", () => {
    const U = "200000000000000010"
    const m = membre(U)
    const t = instant(10)
    toutTerminer(U, t)
    economie.geler(G, U, true)
    const refus = quetes.reclamer(m, { instant: t })
    assert.strictEqual(refus.refus, "gele")
    assert.strictEqual(refus.reclamees.length, 0)
    assert.ok(quetes.quetesDuMembre(G, U, { instant: t }).every(q => !q.claimed), "rien marqué comme réclamé")
    economie.geler(G, U, false)
    assert.strictEqual(quetes.reclamer(m, { instant: t }).reclamees.length, 4)
})
