process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const db = require('../Fonctions/db')
const eco = require('../Fonctions/economie')
const { ecouter, retirerEcouteurs, jourParis } = require('../Fonctions/evenements')
const { t } = require('../Fonctions/i18n')

const JOUR = 24 * 3600 * 1000

// Faux GuildMember : arrivé il y a 30 jours par défaut
const membre = (guildId, id, { jours = 30, timeout = null, bot = false } = {}) => ({
    id, guild: { id: guildId }, joinedTimestamp: Date.now() - jours * JOUR, communicationDisabledUntilTimestamp: timeout, user: { id, bot }
})

// Crédit hors plafond et sans réduction, pour préparer un solde
const donner = (m, montant) => eco.crediter(m, montant, { source: "test", sansReduction: true })

const compteur = (guildId, userId) =>
    db.sqlAll("SELECT * FROM eco_compteurs WHERE guild_id = ? AND user_id = ? AND day = ?", [guildId, userId, jourParis()])[0]

test("monnaie, formatage et réglages", () => {
    const G = "900000000000000001"
    assert.deepStrictEqual(eco.monnaie(G), { nom: "Éclats", emoji: "✦" })
    assert.strictEqual(eco.formater(G, 1234), "1 234 ✦")
    assert.strictEqual(eco.formater(G, 1000000), "1 000 000 ✦")
    assert.strictEqual(eco.formater(G, 12), "12 ✦")
    assert.deepStrictEqual(eco.reglages(G), { plafondJour: 800, multiplicateur: 1 })

    eco.definirReglages(G, { nom: "Perles", emoji: "🦪", plafondJour: 2000, multiplicateur: 0.5 })
    assert.deepStrictEqual(eco.monnaie(G), { nom: "Perles", emoji: "🦪" })
    assert.deepStrictEqual(eco.reglages(G), { plafondJour: 2000, multiplicateur: 0.5 })
    eco.definirReglages(G, { multiplicateur: 2 })
    assert.deepStrictEqual(eco.reglages(G), { plafondJour: 2000, multiplicateur: 2 }, "un champ absent ne change pas")
    eco.definirReglages(G, { nom: null, plafondJour: null })
    assert.strictEqual(eco.monnaie(G).nom, "Éclats", "null : retour au défaut")
    assert.strictEqual(eco.reglages(G).plafondJour, 800)

    for (const faux of [{ plafondJour: 299 }, { plafondJour: 2001 }, { plafondJour: 500.5 }, { multiplicateur: 0.4 },
        { multiplicateur: 2.1 }, { multiplicateur: NaN }, { multiplicateur: "1" }, { nom: "  " }, { nom: "x".repeat(33) }, { emoji: 5 }]) {
        assert.throws(() => eco.definirReglages(G, faux), RangeError, JSON.stringify(faux))
    }
    assert.strictEqual(eco.reglages(G).multiplicateur, 2, "une valeur refusée ne change rien")

    // Textes des refus : présents dans les deux langues avec la monnaie
    for (const refus of ["module", "gele", "sanctionne", "plafond_solde", "solde", "soi_meme", "bot", "compte_recent", "plafond_envoi",
        "plafond_reception", "montant_trop_petit", "destinataire_indisponible", "destinataire_plafond_solde"]) {
        for (const langue of ["fr", "en"]) assert.notStrictEqual(t(langue, `eco.refus.${refus}`, { monnaie: "Éclats" }), `eco.refus.${refus}`)
    }
})

test("compte créé à la volée, montants invalides", () => {
    const G = "900000000000000002"
    assert.deepStrictEqual(eco.compte(G, "1"), { balance: 0, frozen: false, streak: 0, lastDailyAt: null })
    const m = membre(G, "1")
    for (const faux of [0, -5, 1.5, NaN, "10", Infinity]) {
        assert.throws(() => eco.crediter(m, faux, { source: "test" }), RangeError)
        assert.throws(() => eco.debiter(G, "1", faux, { source: "test" }), RangeError)
    }
    assert.throws(() => eco.crediter(m, 10, {}), RangeError, "source obligatoire")
    assert.strictEqual(eco.verifierCoherence(G, "inconnu"), true)
})

test("double dépense : 50 débits simultanés pour un solde qui n'en permet qu'un", async () => {
    const G = "900000000000000003", m = membre(G, "1")
    donner(m, 100)
    const resultats = await Promise.all(Array.from({ length: 50 }, async () => {
        const r = eco.debiter(G, "1", 100, { source: "achat" })
        assert.ok(eco.compte(G, "1").balance >= 0, "solde jamais négatif")
        return r
    }))
    assert.strictEqual(resultats.filter(r => r.ok).length, 1)
    assert.strictEqual(resultats.filter(r => !r.ok && r.refus === "solde").length, 49)
    assert.strictEqual(eco.compte(G, "1").balance, 0)
    assert.strictEqual(eco.journal(G, "1").length, 2, "un crédit et un seul débit au journal")
    assert.ok(eco.verifierCoherence(G, "1"))

    // Compte gelé : aucun débit
    donner(m, 50)
    eco.geler(G, "1", true)
    assert.deepStrictEqual(eco.debiter(G, "1", 10, { source: "achat" }), { ok: false, refus: "gele" })
    eco.geler(G, "1", false)
    assert.deepStrictEqual(eco.debiter(G, "1", 10, { source: "achat" }), { ok: true, solde: 40 })
})

test("journal : somme des delta = solde après des opérations aléatoires", () => {
    const G = "900000000000000004"
    const membres = ["1", "2", "3", "4"].map(id => membre(G, id))
    // Générateur pseudo-aléatoire déterministe (même suite à chaque lancement)
    let graine = 42
    const hasard = n => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine % n }
    for (let i = 0; i < 400; i++) {
        const a = membres[hasard(4)], b = membres[hasard(4)]
        switch (hasard(5)) {
            case 0: eco.crediter(a, 1 + hasard(300), { source: "jeu", actif: true }); break
            case 1: eco.crediter(a, 1 + hasard(300), { source: "daily" }); break
            case 2: eco.debiter(G, a.id, 1 + hasard(300), { source: "achat" }); break
            case 3: eco.transferer(a, b, 1 + hasard(200)); break
            default: if (hasard(20) === 0) eco.reinitialiser(G, a.id, "999")
        }
        for (const m of membres) assert.ok(eco.compte(G, m.id).balance >= 0)
    }
    for (const m of membres) {
        assert.ok(eco.verifierCoherence(G, m.id), `cohérence du membre ${m.id}`)
        const dernier = eco.journal(G, m.id, { limite: 1 })[0]
        if (dernier) assert.strictEqual(dernier.balanceAfter, eco.compte(G, m.id).balance, "balance_after de la dernière ligne")
    }
    // Pagination du journal
    const page1 = eco.journal(G, "1", { limite: 5 })
    const page2 = eco.journal(G, "1", { limite: 5, avant: page1.at(-1).id })
    assert.strictEqual(page1.length, 5)
    assert.ok(page1.every((l, i) => i === 0 || l.id < page1[i - 1].id), "du plus récent au plus ancien")
    assert.ok(page2.every(l => l.id < page1.at(-1).id))
})

test("plafond du jour des gains actifs et compteurs", () => {
    const G = "900000000000000005", m = membre(G, "1")
    eco.definirReglages(G, { plafondJour: 300 })
    assert.deepStrictEqual(eco.crediter(m, 200, { source: "jeu", actif: true }), { ok: true, credite: 200, solde: 200, plafonne: false })
    assert.deepStrictEqual(eco.crediter(m, 200, { source: "jeu", actif: true }), { ok: true, credite: 100, solde: 300, plafonne: true })
    assert.deepStrictEqual(eco.crediter(m, 50, { source: "jeu", actif: true }), { ok: true, credite: 0, solde: 300, plafonne: true },
        "plafond atteint : ok mais rien")
    assert.strictEqual(compteur(G, "1").active_earned, 300)
    // Les gains hors plafond passent toujours et ne comptent pas
    assert.strictEqual(eco.crediter(m, 500, { source: "daily" }).credite, 500)
    assert.strictEqual(compteur(G, "1").active_earned, 300)
    assert.strictEqual(eco.journal(G, "1").length, 3, "pas de ligne pour un crédit nul")
    assert.ok(eco.verifierCoherence(G, "1"))
    // Plafond par membre : un autre membre n'est pas touché
    assert.strictEqual(eco.crediter(membre(G, "2"), 250, { source: "jeu", actif: true }).credite, 250)
})

test("multiplicateur du serveur (gains actifs seulement)", () => {
    const G = "900000000000000006", m = membre(G, "1")
    eco.definirReglages(G, { multiplicateur: 1.5 })
    assert.strictEqual(eco.crediter(m, 100, { source: "jeu", actif: true }).credite, 150)
    assert.strictEqual(eco.crediter(m, 100, { source: "daily" }).credite, 100)
    eco.definirReglages(G, { multiplicateur: 0.5 })
    assert.strictEqual(eco.crediter(m, 15, { source: "jeu", actif: true }).credite, 7, "arrondi bas")
    assert.strictEqual(compteur(G, "1").active_earned, 157, "le plafond compte le gain multiplié")
    // Le multiplicateur s'applique avant le plafond
    eco.definirReglages(G, { multiplicateur: 2, plafondJour: 300 })
    const r = eco.crediter(m, 100, { source: "jeu", actif: true })
    assert.deepStrictEqual([r.credite, r.plafonne], [143, true])
})

test("réduction de 50 % pendant les 7 premiers jours", () => {
    const G = "900000000000000007", nouveau = membre(G, "1", { jours: 2 })
    assert.strictEqual(eco.crediter(nouveau, 101, { source: "daily" }).credite, 50, "moitié, arrondi bas")
    assert.strictEqual(eco.crediter(nouveau, 101, { source: "succes", sansReduction: true }).credite, 101)
    assert.strictEqual(eco.crediter(nouveau, 1, { source: "message", actif: true }).credite, 0)
    eco.definirReglages(G, { multiplicateur: 2 })
    assert.strictEqual(eco.crediter(nouveau, 100, { source: "jeu", actif: true }).credite, 100, "multiplié puis réduit")
    assert.strictEqual(eco.crediter(membre(G, "2", { jours: 7.01 }), 100, { source: "daily" }).credite, 100, "après 7 jours : plein tarif")
    const inconnu = { ...membre(G, "3"), joinedTimestamp: null }
    assert.strictEqual(eco.crediter(inconnu, 100, { source: "daily" }).credite, 50, "date d'arrivée inconnue : prudence")
    assert.ok(eco.verifierCoherence(G, "1"))
})

test("plafond de solde (1 000 000)", () => {
    const G = "900000000000000008", m = membre(G, "1")
    donner(m, 999990)
    const r = eco.crediter(m, 100, { source: "daily" })
    assert.deepStrictEqual([r.ok, r.credite, r.solde], [true, 10, 1000000], "gain rogné au maximum")
    assert.deepStrictEqual(eco.crediter(m, 1, { source: "daily" }), { ok: false, refus: "plafond_solde" })
    assert.strictEqual(eco.compte(G, "1").balance, eco.SOLDE_MAX)
    // Un transfert ne fait pas dépasser le maximum au destinataire
    const autre = membre(G, "2")
    donner(autre, 500)
    assert.deepStrictEqual(eco.transferer(autre, m, 100), { ok: false, refus: "destinataire_plafond_solde" })
    assert.ok(eco.verifierCoherence(G, "1"))
})

test("transferts : frais, plafonds, refus", () => {
    const G = "900000000000000009"
    const [a, b, c, d, e] = ["1", "2", "3", "4", "5"].map(id => membre(G, id))
    for (const m of [a, c, d, e]) donner(m, 10000)
    const paiements = []
    ecouter("paiement", donnees => paiements.push(donnees))

    // Frais de 2 % retenus sur le montant, détruits
    assert.deepStrictEqual(eco.transferer(a, b, 1000), { ok: true, envoye: 1000, frais: 20, recu: 980 })
    assert.strictEqual(eco.compte(G, "1").balance, 9000)
    assert.strictEqual(eco.compte(G, "2").balance, 980)
    assert.deepStrictEqual(paiements, [{ guildId: G, userId: "1", to: "2", amount: 980, source: "paiement" }])
    const [ligneA] = eco.journal(G, "1", { limite: 1 }), [ligneB] = eco.journal(G, "2", { limite: 1 })
    assert.deepStrictEqual([ligneA.delta, ligneA.otherId, ligneA.source], [-1000, "2", "paiement"])
    assert.deepStrictEqual([ligneB.delta, ligneB.otherId], [980, "1"])
    assert.deepStrictEqual(eco.transferer(a, b, 10), { ok: true, envoye: 10, frais: 1, recu: 9 }, "frais minimum 1")
    assert.deepStrictEqual(eco.transferer(a, b, 1), { ok: false, refus: "montant_trop_petit" })
    assert.deepStrictEqual(eco.transferer(a, b, 100, { source: "marche", fraisPourcent: 8 }), { ok: true, envoye: 100, frais: 8, recu: 92 })

    // Plafond d'envoi : 2 000 par jour (1 110 déjà envoyés)
    assert.deepStrictEqual(eco.transferer(a, b, 891), { ok: false, refus: "plafond_envoi" })
    assert.strictEqual(eco.transferer(a, b, 890).ok, true)
    assert.strictEqual(compteur(G, "1").sent, 2000)
    // Plafond de réception : 5 000 par jour (b a déjà reçu 1 954 de a)
    assert.strictEqual(eco.transferer(c, b, 2000).ok, true)
    assert.deepStrictEqual(eco.transferer(d, b, 2000), { ok: false, refus: "plafond_reception" })
    assert.strictEqual(eco.transferer(d, b, 1100).ok, true)
    assert.strictEqual(compteur(G, "2").received, 1954 + 1960 + 1078)

    // Solde insuffisant, soi-même, bot
    assert.deepStrictEqual(eco.transferer(membre(G, "8"), e, 100), { ok: false, refus: "solde" })
    assert.deepStrictEqual(eco.transferer(e, e, 10), { ok: false, refus: "soi_meme" })
    assert.deepStrictEqual(eco.transferer(e, membre(G, "6", { bot: true }), 10), { ok: false, refus: "bot" })
    // Compte récent, dans les deux sens
    const nouveau = membre(G, "7", { jours: 3 })
    donner(nouveau, 500)
    assert.deepStrictEqual(eco.transferer(e, nouveau, 10), { ok: false, refus: "compte_recent" })
    assert.deepStrictEqual(eco.transferer(nouveau, e, 10), { ok: false, refus: "compte_recent" })
    // Gelé
    eco.geler(G, "5", true)
    assert.deepStrictEqual(eco.transferer(e, d, 10), { ok: false, refus: "gele" })
    assert.deepStrictEqual(eco.transferer(d, e, 10), { ok: false, refus: "destinataire_indisponible" })
    eco.geler(G, "5", false)
    // Sanctionné : timeout en cours (un timeout passé ne compte plus)
    assert.deepStrictEqual(eco.transferer({ ...e, communicationDisabledUntilTimestamp: Date.now() + 60000 }, d, 10), { ok: false, refus: "sanctionne" })
    assert.deepStrictEqual(eco.transferer(d, { ...e, communicationDisabledUntilTimestamp: Date.now() + 60000 }, 10), { ok: false, refus: "destinataire_indisponible" })
    assert.strictEqual(eco.transferer({ ...e, communicationDisabledUntilTimestamp: Date.now() - 1000 }, d, 10).ok, true)
    // Sanctionné : quarantaine
    db.sqlRun("INSERT INTO quarantines (guild_id, user_id, roles, moderator_id, reason, created_at) VALUES (?, ?, '[]', '9', 'test', ?)", [G, "5", Date.now()])
    assert.deepStrictEqual(eco.transferer(e, d, 10), { ok: false, refus: "sanctionne" })
    assert.deepStrictEqual(eco.transferer(d, e, 10), { ok: false, refus: "destinataire_indisponible" })
    assert.deepStrictEqual(eco.crediter(e, 10, { source: "daily" }), { ok: false, refus: "sanctionne" }, "rien reçu en quarantaine")
    db.sqlRun("DELETE FROM quarantines WHERE guild_id = ?", [G])

    assert.strictEqual(paiements.length, 7, "un événement par transfert réussi")
    retirerEcouteurs()
    for (const id of ["1", "2", "3", "4", "5", "7"]) assert.ok(eco.verifierCoherence(G, id))
})

test("transfert : un destinataire gelé, sanctionné ou hors module reçoit le même refus générique", () => {
    const G = "900000000000000020", d = membre(G, "1"), e = membre(G, "2")
    donner(d, 500)
    eco.geler(G, "2", true)
    const gele = eco.transferer(d, e, 10)
    eco.geler(G, "2", false)
    const sanctionne = eco.transferer(d, { ...e, communicationDisabledUntilTimestamp: Date.now() + 60000 }, 10)
    assert.deepStrictEqual(gele, { ok: false, refus: "destinataire_indisponible" })
    assert.deepStrictEqual(sanctionne, gele, "rien ne distingue un gel d'une sanction")
    assert.strictEqual(eco.compte(G, "1").balance, 500, "rien n'a bougé")
})

test("rembourser : sans contrôle de droits, hors plafond du jour, sans réduction, rogné au solde maximum", () => {
    const G = "900000000000000021"
    // Membre récent, gelé et sanctionné : le remboursement passe quand même, entier
    const m = membre(G, "1", { jours: 1, timeout: Date.now() + 60000 })
    donner(membre(G, "1"), 1000)
    eco.debiter(G, "1", 400, { source: "boutique" })
    eco.geler(G, "1", true)
    db.setModule(G, "communaute.economie", false)
    assert.strictEqual(eco.peutJouer(m), "module")
    const r = eco.rembourser(G, "1", 400, { details: { article: 7 } })
    assert.deepStrictEqual(r, { ok: true, credite: 400, solde: 1000, rogne: false })
    const [ligne] = eco.journal(G, "1", { limite: 1 })
    assert.deepStrictEqual([ligne.delta, ligne.source, ligne.details], [400, "remboursement", '{"article":7}'])
    assert.strictEqual(compteur(G, "1")?.active_earned ?? 0, 0, "le plafond du jour n'est pas touché")

    // Plafond du jour déjà atteint : le remboursement n'est pas limité
    const H = "900000000000000022", p = membre(H, "1")
    eco.crediter(p, 5000, { source: "jeu", actif: true, sansReduction: true })
    assert.strictEqual(compteur(H, "1").active_earned, 800)
    eco.debiter(H, "1", 300, { source: "boutique" })
    assert.strictEqual(eco.rembourser(H, "1", 300).credite, 300)

    // Solde maximum : crédit rogné
    const I = "900000000000000023"
    for (const montant of [250000, 250000, 250000, 249000]) donner(membre(I, "1"), montant)
    assert.strictEqual(eco.compte(I, "1").balance, 999000)
    const rogne = eco.rembourser(I, "1", 5000)
    assert.deepStrictEqual(rogne, { ok: true, credite: 1000, solde: 1000000, rogne: true })
    assert.ok(eco.verifierCoherence(I, "1"))
    assert.deepStrictEqual(eco.rembourser(I, "1", 50), { ok: true, credite: 0, solde: 1000000, rogne: true })
    assert.strictEqual(eco.journal(I, "1").length, 5, "4 crédits + le remboursement rogné ; rien d'écrit quand rien n'entre")
    assert.throws(() => eco.rembourser(I, "1", 0), RangeError)
})

test("remise à zéro par le staff", () => {
    const G = "900000000000000010", m = membre(G, "1")
    donner(m, 750)
    assert.strictEqual(eco.reinitialiser(G, "1", "999"), 750)
    assert.strictEqual(eco.compte(G, "1").balance, 0)
    const [ligne] = eco.journal(G, "1", { limite: 1 })
    assert.deepStrictEqual([ligne.delta, ligne.balanceAfter, ligne.source, ligne.otherId], [-750, 0, "reinitialisation", "999"])
    assert.strictEqual(eco.journal(G, "1").length, 2, "aucune ligne supprimée")
    assert.ok(eco.verifierCoherence(G, "1"))
    assert.strictEqual(eco.reinitialiser(G, "1", "999"), 0)
    assert.strictEqual(eco.journal(G, "1").length, 2, "rien à écrire pour un solde nul")
})

test("peutJouer : module, gel, timeout, quarantaine", () => {
    const G = "900000000000000011", m = membre(G, "1")
    assert.strictEqual(eco.peutJouer(m), null)
    db.setModule(G, "communaute.economie", false)
    assert.strictEqual(eco.peutJouer(m), "module")
    assert.deepStrictEqual(eco.crediter(m, 10, { source: "daily" }), { ok: false, refus: "module" })
    db.setModule(G, "communaute.economie", true)
    db.setModule(G, "communaute", false)
    assert.strictEqual(eco.peutJouer(m), "module", "module parent désactivé")
    db.setModule(G, "communaute", true)
    eco.geler(G, "1", true)
    assert.strictEqual(eco.peutJouer(m), "gele")
    assert.strictEqual(eco.compte(G, "1").frozen, true)
    eco.geler(G, "1", false)
    assert.strictEqual(eco.peutJouer(membre(G, "1", { timeout: Date.now() + 60000 })), "sanctionne")
    assert.strictEqual(eco.peutJouer(membre(G, "2")), null)
    assert.deepStrictEqual(eco.compte(G, "2").balance, 0)
})

test("classement et rang", () => {
    const G = "900000000000000012"
    donner(membre(G, "1"), 300)
    donner(membre(G, "2"), 900)
    donner(membre(G, "3"), 300)
    donner(membre(G, "4"), 5000)
    eco.compte(G, "5")
    eco.geler(G, "4", true)
    assert.deepStrictEqual(eco.classement(G), [{ userId: "2", balance: 900 }, { userId: "1", balance: 300 }, { userId: "3", balance: 300 }])
    assert.deepStrictEqual(eco.classement(G, { limite: 1, decalage: 1 }), [{ userId: "1", balance: 300 }])
    assert.deepStrictEqual(["2", "1", "3", "4", "5", "inconnu"].map(id => eco.rang(G, id)), [1, 2, 3, null, null, null])
})
