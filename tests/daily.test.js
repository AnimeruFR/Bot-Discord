process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const db = require('../Fonctions/db')
const eco = require('../Fonctions/economie')
const metiers = require('../Fonctions/metiers')
const daily = require('../Commandes/Communaute/Economie/daily')
const { ecouter, retirerEcouteurs } = require('../Fonctions/evenements')

const HEURE = 3600 * 1000
const JOUR = 24 * HEURE

const membre = (guildId, id, { jours = 30, timeout = null } = {}) => ({
    id, guild: { id: guildId }, joinedTimestamp: Date.now() - jours * JOUR, communicationDisabledUntilTimestamp: timeout, user: { id, bot: false }
})

test("daily : 100 le premier jour, un seul par jour (double clic compris)", async () => {
    const m = membre("910000000000000001", "1")
    const recus = []
    retirerEcouteurs()
    ecouter("daily", d => recus.push(d))
    const [a, b] = await Promise.all([Promise.resolve().then(() => daily.reclamer(m)), Promise.resolve().then(() => daily.reclamer(m))])
    assert.strictEqual([a, b].filter(r => r.ok).length, 1, "un seul daily")
    const refuse = [a, b].find(r => !r.ok)
    assert.strictEqual(refuse.refus, "deja")
    assert.ok(refuse.prochain > Date.now(), "prochain daily dans le futur")
    const ok = [a, b].find(r => r.ok)
    assert.strictEqual(ok.credite, 100)
    assert.strictEqual(ok.serie, 1)
    assert.strictEqual(eco.compte(m.guild.id, m.id).balance, 100)
    assert.deepStrictEqual(recus, [{ guildId: m.guild.id, userId: "1", streak: 1 }])
    assert.ok(eco.verifierCoherence(m.guild.id, m.id))
    retirerEcouteurs()
})

test("daily : série +1 par jour, plafond à 10 (235), hors plafond actif", () => {
    const m = membre("910000000000000002", "2")
    const debut = Date.now()
    const montants = []
    for (let i = 0; i < 12; i++) {
        const r = daily.reclamer(m, debut + i * (JOUR + HEURE))
        assert.ok(r.ok, `jour ${i + 1}`)
        assert.strictEqual(r.serie, i + 1)
        montants.push(r.credite)
    }
    assert.deepStrictEqual(montants.slice(0, 3), [100, 115, 130])
    assert.strictEqual(montants[9], 235)
    assert.strictEqual(montants[11], 235, "plafonné à 235")
    assert.strictEqual(daily.montantPour(50), 235)
    const compteur = db.sqlAll("SELECT SUM(active_earned) AS s FROM eco_compteurs WHERE guild_id = ? AND user_id = ?", [m.guild.id, m.id])[0].s
    assert.ok(!compteur, "le daily ne compte pas dans le plafond du jour")
})

test("daily : série perdue après 48 h, conservée à 47 h", () => {
    const m = membre("910000000000000003", "3")
    const t0 = Date.now()
    daily.reclamer(m, t0)
    const deuxieme = daily.reclamer(m, t0 + 47 * HEURE)
    assert.strictEqual(deuxieme.serie, 2, "47 h : la série continue")
    const perdu = daily.reclamer(m, t0 + 47 * HEURE + 49 * HEURE)
    assert.strictEqual(perdu.serie, 1, "49 h : la série repart")
    assert.strictEqual(perdu.credite, 100)
    assert.ok(perdu.perdue)
})

test("daily : refusé si sanctionné, et la série n'avance pas", () => {
    const g = "910000000000000004"
    const sanctionne = membre(g, "4", { timeout: Date.now() + 60000 })
    assert.deepStrictEqual(daily.reclamer(sanctionne), { ok: false, refus: "sanctionne" })
    assert.strictEqual(eco.compte(g, "4").streak, 0)
    assert.ok(daily.reclamer(membre(g, "4")).ok, "une fois la sanction levée, le daily est disponible")
})

// --- /travail --------------------------------------------------------------------------------------------------

const G = "920000000000000001"
const sansDelai = m => db.sqlRun("UPDATE eco_metiers SET last_work_at = NULL WHERE guild_id = ? AND user_id = ?", [m.guild.id, m.id])

test("travail : sans métier refusé, premier choix gratuit, gain 30-60 + 3 par niveau", () => {
    const m = membre(G, "10")
    assert.strictEqual(metiers.travailler(m).refus, "sans_metier")
    assert.strictEqual(metiers.choisirMetier(m, "pirate").refus, "metier_inconnu")
    assert.deepStrictEqual(metiers.choisirMetier(m, "forgeron"), { ok: true, job: "forgeron", paye: 0 })
    assert.strictEqual(metiers.choisirMetier(m, "forgeron").refus, "meme_metier")
    assert.strictEqual(metiers.gainDe(1, () => 0), 33)
    assert.strictEqual(metiers.gainDe(1, () => 0.999999), 63)
    assert.strictEqual(metiers.gainDe(99, () => 0), 60, "niveau plafonné à 10")
    const r = metiers.travailler(m, { hasard: () => 0 })
    assert.ok(r.ok)
    assert.strictEqual(r.credite, 33)
    assert.ok(r.texte >= 1 && r.texte <= metiers.NB_TEXTES)
    assert.strictEqual(eco.compte(G, "10").balance, 33)
})

test("travail : délai d'une heure revérifié en base, annulé si le gain est refusé", () => {
    const m = membre(G, "11")
    metiers.choisirMetier(m, "cartographe")
    const t0 = Date.now()
    assert.ok(metiers.travailler(m, { maintenant: t0 }).ok)
    const tropTot = metiers.travailler(m, { maintenant: t0 + 59 * 60 * 1000 })
    assert.strictEqual(tropTot.refus, "cooldown")
    assert.strictEqual(tropTot.prochain, t0 + HEURE)
    assert.ok(metiers.travailler(m, { maintenant: t0 + HEURE }).ok, "après 1 h")
    assert.ok(eco.compte(G, "11").balance > 0)

    // Compte gelé : refus de l'économie, le délai ne reste pas pris et le compteur non plus
    const g = membre(G, "12")
    metiers.choisirMetier(g, "horloger")
    eco.geler(G, "12", true)
    assert.strictEqual(metiers.travailler(g).refus, "gele")
    assert.strictEqual(metiers.lireMetier(G, "12").lastWorkAt, null)
    assert.strictEqual(metiers.travauxDuJour(G, "12"), 0)
})

test("travail : 8 travaux par jour, le 9e ne rapporte rien mais l'explique", () => {
    const m = membre(G, "13")
    metiers.choisirMetier(m, "herboriste")
    let total = 0
    for (let i = 0; i < metiers.TRAVAUX_PAR_JOUR; i++) {
        sansDelai(m)
        const r = metiers.travailler(m, { hasard: () => 0 })
        assert.ok(r.ok, `travail ${i + 1}`)
        total += r.credite
    }
    sansDelai(m)
    const solde = eco.compte(G, "13").balance
    const neuvieme = metiers.travailler(m)
    assert.strictEqual(neuvieme.refus, "limite_jour")
    assert.strictEqual(eco.compte(G, "13").balance, solde, "aucun gain")
    assert.strictEqual(solde, total)
    assert.strictEqual(metiers.travauxDuJour(G, "13"), 8)
    assert.strictEqual(metiers.lireMetier(G, "13").lastWorkAt, null, "refus : le délai n'est pas pris")
})

test("travail : l'XP fait monter de niveau (20, 40, 60... XP) jusqu'au niveau 10", () => {
    assert.deepStrictEqual(metiers.niveauDepuisXp(0), { niveau: 1, reste: 0, requis: 20 })
    assert.deepStrictEqual(metiers.niveauDepuisXp(19), { niveau: 1, reste: 19, requis: 20 })
    assert.deepStrictEqual(metiers.niveauDepuisXp(20), { niveau: 2, reste: 0, requis: 40 })
    assert.strictEqual(metiers.niveauDepuisXp(900).niveau, 10)
    assert.strictEqual(metiers.niveauDepuisXp(99999).niveau, 10)
    assert.strictEqual(metiers.niveauDepuisXp(99999).requis, null)

    const m = membre(G, "14")
    metiers.choisirMetier(m, "archiviste")
    const evenements = []
    retirerEcouteurs()
    ecouter("travail", d => evenements.push(d))
    sansDelai(m)
    const un = metiers.travailler(m, { hasard: () => 0 })
    sansDelai(m)
    const deux = metiers.travailler(m, { hasard: () => 0 })
    assert.strictEqual(un.monte, false)
    assert.strictEqual(deux.monte, true)
    assert.strictEqual(deux.niveau, 2)
    assert.strictEqual(metiers.lireMetier(G, "14").level, 2)
    sansDelai(m)
    assert.strictEqual(metiers.travailler(m, { hasard: () => 0 }).gain, 36, "gain du niveau 2 : 30 + 6")
    assert.deepStrictEqual(evenements[1], { guildId: G, userId: "14", job: "archiviste", level: 2 })
    retirerEcouteurs()
})

test("travail : changer de métier coûte 1 000, refusé sans solde, repart au niveau 1", () => {
    const m = membre(G, "15")
    metiers.choisirMetier(m, "forgeron")
    for (let i = 0; i < 3; i++) {
        sansDelai(m)
        metiers.travailler(m)
    }
    assert.strictEqual(metiers.lireMetier(G, "15").level, 2)
    const avant = eco.compte(G, "15").balance
    assert.ok(avant < metiers.PRIX_CHANGEMENT)
    assert.strictEqual(metiers.choisirMetier(m, "horloger").refus, "solde")
    assert.strictEqual(metiers.lireMetier(G, "15").job, "forgeron", "métier inchangé")
    assert.strictEqual(eco.compte(G, "15").balance, avant)

    eco.crediter(m, 1500, { source: "test", sansReduction: true })
    const r = metiers.choisirMetier(m, "horloger")
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.paye, 1000)
    const apres = metiers.lireMetier(G, "15")
    assert.strictEqual(apres.job, "horloger")
    assert.strictEqual(apres.level, 1)
    assert.strictEqual(apres.xp, 0)
    assert.strictEqual(eco.compte(G, "15").balance, avant + 500)
    assert.ok(eco.verifierCoherence(G, "15"))
})

test("travail : un membre sanctionné ne travaille pas et ne change pas de métier", () => {
    const m = membre(G, "16")
    metiers.choisirMetier(m, "forgeron")
    const s = membre(G, "16", { timeout: Date.now() + 60000 })
    assert.strictEqual(metiers.travailler(s).refus, "sanctionne")
    assert.strictEqual(metiers.choisirMetier(s, "horloger").refus, "sanctionne")
    assert.strictEqual(metiers.lireMetier(G, "16").job, "forgeron")
    assert.strictEqual(eco.compte(G, "16").balance, 0)
})

test("travail : chaque métier a au moins 5 textes en français et en anglais", () => {
    const { t } = require('../Fonctions/i18n')
    assert.strictEqual(metiers.METIERS.length, 5)
    for (const job of metiers.METIERS) {
        for (const langue of ["fr", "en"]) {
            const textes = new Set()
            for (let i = 1; i <= metiers.NB_TEXTES; i++) {
                const cle = `travail.texte.${job}.${i}`
                const texte = t(langue, cle)
                assert.notStrictEqual(texte, cle, `${cle} (${langue})`)
                textes.add(texte)
            }
            assert.ok(textes.size >= 5)
        }
    }
})
