process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const db = require('../Fonctions/db')
const economie = require('../Fonctions/economie')
const { emettre, jourParis } = require('../Fonctions/evenements')
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
        // Un partenaire différent à chaque fois (anti-farm) et un montant suffisant
        for (let i = 0; i < q.goal + 2; i++) {
            const autre = `9000000000000000${i}`
            quetes.avancer(def.evenement, { guildId: G, userId, to: autre, from: autre, amount: 100, players: [userId, autre] }, { instant: t })
        }
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

// --- Anti-farm, récompenses rejouables, réclamation de la veille (critique du lot 3B) ---------------------------

// Remplace les quêtes du jour (ou de la semaine) d'un membre par une seule quête connue
function forcerQuete(userId, t, id, type = "jour") {
    const def = quetes.catalogue[type].find(q => q.id === id)
    const period = type === "jour" ? jourParis(t) : quetes.semaineParis(t)
    db.sqlRun("DELETE FROM quetes WHERE guild_id = ? AND user_id = ? AND period = ?", [G, userId, period])
    db.sqlRun("INSERT INTO quetes (guild_id, user_id, period, quest, progress, goal) VALUES (?, ?, ?, ?, 0, ?)", [G, userId, period, id, def.objectif])
}
const progression = (userId, t, id) => quetes.quetesDuMembre(G, userId, { instant: t }).find(q => q.id === id).progress

test("anti-farm quêtes : deux comptes qui se donnent la rep chaque jour ne valident la quête qu'une fois par paire", () => {
    const A = "200000000000000020", B = "200000000000000021", C = "200000000000000022"
    // Quête de la semaine (5 réputations données) : la paire A -> B ne compte qu'une fois pour toute la semaine
    forcerQuete(A, instant(9), "s_rep_5", "semaine")
    for (const j of [9, 10, 11, 12, 13, 14, 15]) {
        quetes.avancer("rep:donnee", { guildId: G, userId: A, to: B }, { instant: instant(j) })
        quetes.avancer("rep:donnee", { guildId: G, userId: B, to: A }, { instant: instant(j) })
    }
    assert.strictEqual(progression(A, instant(15), "s_rep_5"), 1, "7 jours de rep avec le même compte : 1 seul cran")
    quetes.avancer("rep:donnee", { guildId: G, userId: A, to: C }, { instant: instant(15) })
    assert.strictEqual(progression(A, instant(15), "s_rep_5"), 2, "un autre partenaire compte")

    // Quête du jour : une fois par paire et par jour ; le lendemain la paire compte de nouveau
    forcerQuete(A, instant(16), "j_gagner_2")
    for (let i = 0; i < 3; i++) quetes.avancer("partie:gagnee", { guildId: G, userId: A, players: [A, B] }, { instant: instant(16) })
    assert.strictEqual(progression(A, instant(16), "j_gagner_2"), 1, "3 victoires contre le même adversaire : 1 cran")
    quetes.avancer("partie:gagnee", { guildId: G, userId: A, players: [A, C] }, { instant: instant(16) })
    assert.strictEqual(progression(A, instant(16), "j_gagner_2"), 2)
    forcerQuete(A, instant(17), "j_gagner_2")
    quetes.avancer("partie:gagnee", { guildId: G, userId: A, players: [A, B] }, { instant: instant(17) })
    assert.strictEqual(progression(A, instant(17), "j_gagner_2"), 1, "le jour suivant, la paire recompte")

    // Sans liste de joueurs (jeu solo, ancienne émission) : pas d'adversaire, la victoire compte
    forcerQuete(A, instant(18), "j_gagner_2")
    quetes.avancer("partie:gagnee", { guildId: G, userId: A }, { instant: instant(18) })
    quetes.avancer("partie:gagnee", { guildId: G, userId: A, players: [A] }, { instant: instant(18) })
    assert.strictEqual(progression(A, instant(18), "j_gagner_2"), 2)
    // Réputation sans partenaire connu : ne compte pas
    forcerQuete(A, instant(18), "j_rep_donner")
    quetes.avancer("rep:donnee", { guildId: G, userId: A }, { instant: instant(18) })
    assert.strictEqual(progression(A, instant(18), "j_rep_donner"), 0)
})

test("quête de paiement : montant minimal de 50", () => {
    const A = "200000000000000023", t = instant(10)
    forcerQuete(A, t, "j_paiement")
    quetes.avancer("paiement", { guildId: G, userId: A, to: "200000000000000024", amount: 49 }, { instant: t })
    assert.strictEqual(progression(A, t, "j_paiement"), 0, "49 : trop peu")
    quetes.avancer("paiement", { guildId: G, userId: A, to: "200000000000000024", amount: 50 }, { instant: t })
    assert.strictEqual(progression(A, t, "j_paiement"), 1)
})

test("anti-farm succès : un partenaire ne compte qu'une fois par jour pour rep, paiements et victoires", async () => {
    const A = "200000000000000025", B = "200000000000000026", C = "200000000000000027"
    membre(A)
    const j1 = instant(10), j2 = instant(11)
    const vers = (evenement, donnees, t) => succes.enregistrer(evenement, { guildId: G, userId: A, ...donnees }, { instant: t })
    for (let i = 0; i < 3; i++) await vers("rep:donnee", { to: B }, j1)
    await vers("rep:recue", { from: B }, j1)
    await vers("rep:recue", { from: B }, j1)
    for (let i = 0; i < 3; i++) await vers("paiement", { to: B, amount: 400 }, j1)
    for (let i = 0; i < 3; i++) await vers("partie:gagnee", { players: [A, B] }, j1)
    let stats = succes.lireStats(G, A)
    assert.deepStrictEqual([stats.rep_donnees, stats.rep_recues, stats.paiements, stats.monnaie_donnee, stats.parties_gagnees], [1, 1, 1, 400, 1])

    await vers("rep:donnee", { to: C }, j1)
    await vers("partie:gagnee", { players: [A, C] }, j1)
    await vers("rep:donnee", { to: B }, j2)
    stats = succes.lireStats(G, A)
    assert.deepStrictEqual([stats.rep_donnees, stats.parties_gagnees], [3, 2], "autre partenaire, puis lendemain : ça compte")

    await vers("rep:donnee", {}, j2)
    await vers("partie:gagnee", {}, j2)
    await vers("partie:gagnee", { players: [A] }, j2)
    stats = succes.lireStats(G, A)
    assert.strictEqual(stats.rep_donnees, 3, "rep sans partenaire : ignorée")
    assert.strictEqual(stats.parties_gagnees, 4, "victoire sans adversaire connu : comptée")
    assert.ok(Object.keys(stats).every(c => !c.startsWith("paire:")), "la trace des paires n'est pas un compteur")
    const traces = db.sqlAll("SELECT stat FROM stats_joueur WHERE user_id = ? AND stat LIKE 'paire:succes:rep:donnee:%'", [A])
    assert.ok(traces.length > 0 && traces.every(l => l.stat.includes(jourParis(j2))), "les traces des jours passés sont effacées")
})

test("succès : récompense en attente (membre absent, compte gelé) retentée au prochain événement et à l'affichage", async () => {
    const U = "200000000000000030"
    // Membre absent du serveur : succès obtenu, rewarded = 0, rien de versé
    await succes.enregistrer("drop:ramasse", { guildId: G, userId: U })
    const ligne = () => db.sqlAll("SELECT rewarded FROM succes WHERE user_id = ? AND achievement = 'premier_drop'", [U])[0]
    assert.strictEqual(ligne().rewarded, 0)
    assert.strictEqual(solde(U), 0)
    // Le membre est là, compte gelé : refus, toujours en attente
    membre(U)
    economie.geler(G, U, true)
    await succes.enregistrer("drop:ramasse", { guildId: G, userId: U })
    assert.strictEqual(ligne().rewarded, 0)
    assert.strictEqual(solde(U), 0)
    // Dégel : le prochain événement verse, une seule fois
    economie.geler(G, U, false)
    await succes.enregistrer("drop:ramasse", { guildId: G, userId: U })
    assert.strictEqual(ligne().rewarded, 1)
    const montant = solde(U)
    assert.ok(montant > 0)
    await succes.enregistrer("drop:ramasse", { guildId: G, userId: U })
    assert.strictEqual(solde(U), montant)

    // Affichage de la liste : retente aussi
    const V = "200000000000000031"
    membre(V)
    economie.geler(G, V, true)
    await succes.enregistrer("drop:ramasse", { guildId: G, userId: V })
    economie.geler(G, V, false)
    succes.liste(G, V)
    await new Promise(r => setTimeout(r, 20))
    assert.strictEqual(solde(V), montant)
    assert.strictEqual(db.sqlAll("SELECT rewarded FROM succes WHERE user_id = ?", [V])[0].rewarded, 1)
    assert.strictEqual(db.sqlAll("SELECT COUNT(*) AS n FROM eco_journal WHERE user_id = ? AND source = 'succes'", [V])[0].n, 1)
})

test("quêtes : une quête terminée hier se réclame encore aujourd'hui, pas deux jours après", () => {
    const U = "200000000000000032", m = membre(U)
    const hier = instant(10)
    forcerQuete(U, hier, "j_daily")
    quetes.avancer("daily", { guildId: G, userId: U }, { instant: hier })
    assert.strictEqual(quetes.precedentesAReclamer(G, U, { instant: instant(11) }).length, 1)
    assert.strictEqual(quetes.precedentesAReclamer(G, U, { instant: instant(12) }).length, 0, "avant-hier : trop tard")
    const r = quetes.reclamer(m, { instant: instant(11) })
    assert.deepStrictEqual(r.reclamees.map(q => q.id), ["j_daily"])
    assert.strictEqual(quetes.reclamer(m, { instant: instant(11) }).reclamees.length, 0, "une seule fois")
})

test("quêtes : si crediter lève une exception, la quête reste réclamable", () => {
    const U = "200000000000000033", t = instant(10)
    const m = { id: U, guild: { id: G }, user: { bot: false }, joinedTimestamp: 1000 }
    Object.defineProperty(m, "communicationDisabledUntilTimestamp", { get() { throw new Error("panne") } })
    forcerQuete(U, t, "j_daily")
    quetes.avancer("daily", { guildId: G, userId: U }, { instant: t })
    assert.throws(() => quetes.reclamer(m, { instant: t }), /panne/)
    assert.strictEqual(quetes.quetesDuMembre(G, U, { instant: t }).find(q => q.id === "j_daily").claimed, false)
    assert.strictEqual(quetes.reclamer(membre(U), { instant: t }).reclamees.length, 1)
})

test("quête de paiement : un aller-retour le même jour ne compte pas, un autre bénéficiaire compte", () => {
    const [A, B, C] = ["200000000000000040", "200000000000000041", "200000000000000042"]
    const [mA, mB] = [membre(A), membre(B)]
    const t = Date.now() // le journal et le bus utilisent l'horloge réelle
    for (const m of [mA, mB, membre(C)]) economie.crediter(m, 500, { source: "test" })
    for (const U of [A, B]) forcerQuete(U, t, "j_paiement")

    assert.ok(economie.transferer(mA, mB, 100).ok)
    assert.strictEqual(progression(A, t, "j_paiement"), 1, "A paie B : la quête de A avance")
    // B rend la somme à A le même jour : même si le paiement est valable, il ne fait pas avancer la quête de B
    assert.ok(economie.transferer(mB, mA, 100).ok)
    assert.strictEqual(progression(B, t, "j_paiement"), 0, "aller-retour : ne compte pas")
    // Un autre bénéficiaire (qui n'a rien payé à B) compte
    assert.ok(economie.transferer(mB, membre(C), 100).ok)
    assert.strictEqual(progression(B, t, "j_paiement"), 1)
    // Un paiement de moins de 50 ne compte pas non plus
    const sous = "200000000000000043"
    forcerQuete(sous, t, "j_paiement")
    economie.crediter(membre(sous), 500, { source: "test" })
    assert.ok(economie.transferer(membre(sous), membre(C), 30).ok)
    assert.strictEqual(progression(sous, t, "j_paiement"), 0)
})
