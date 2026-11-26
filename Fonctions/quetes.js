const crypto = require('crypto')
const db = require('./db')
const { ecouter, jourParis } = require('./evenements')
const { moduleActif } = require('./modules')
const { crediter } = require('./economie')
const catalogue = require('../data-statique/quetes.json')

// Quêtes du jour et de la semaine (idée #45). Contrat : le chargement du module abonne ses écouteurs au bus (Fonctions/evenements.js).
//
// Chaque membre a 3 quêtes du jour (période AAAA-MM-JJ) et 1 quête de la semaine (période AAAA-Wnn), heure de Paris.
// Le tirage est déterministe (graine = serveur + membre + période) : même résultat toute la journée, autre résultat
// demain. Les lignes de la table quetes sont créées à la première lecture ou au premier événement de la période, et
// c'est ensuite la table qui fait foi (modifier le catalogue ne change pas les quêtes déjà tirées).
// Récompense : crediter(..., { actif: false, sansReduction: false }), versée une seule fois (claimed).

const MODULE = "communaute.niveaux"
const NOMBRE_JOUR = 3
const NOMBRE_SEMAINE = 1
const EVENEMENTS = [...new Set([...catalogue.jour, ...catalogue.semaine].map(q => q.evenement))]
const parId = new Map([...catalogue.jour, ...catalogue.semaine].map(q => [q.id, q]))

// Semaine ISO (lundi au dimanche) du jour de Paris donné : "2026-W48"
function semaineParis(instant = Date.now()) {
    const [annee, mois, jour] = jourParis(instant).split("-").map(Number)
    const date = new Date(Date.UTC(annee, mois - 1, jour))
    date.setUTCDate(date.getUTCDate() + 3 - (date.getUTCDay() + 6) % 7) // le jeudi de la semaine décide de l'année
    const premiere = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
    const numero = 1 + Math.round(((date - premiere) / 86400000 - 3 + (premiere.getUTCDay() + 6) % 7) / 7)
    return `${date.getUTCFullYear()}-W${String(numero).padStart(2, "0")}`
}

// Générateur pseudo-aléatoire à graine (mulberry32)
function aleatoire(graine) {
    let etat = graine >>> 0
    return () => {
        etat = (etat + 0x6D2B79F5) >>> 0
        let x = Math.imul(etat ^ (etat >>> 15), 1 | etat)
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
}

// n quêtes de la réserve, d'événements différents tant que possible
function tirer(reserve, n, graineTexte) {
    const hasard = aleatoire(crypto.createHash("sha256").update(graineTexte).digest().readUInt32BE(0))
    const melange = [...reserve]
    for (let i = melange.length - 1; i > 0; i--) {
        const j = Math.floor(hasard() * (i + 1));
        [melange[i], melange[j]] = [melange[j], melange[i]]
    }
    const choisies = []
    for (const q of melange) if (choisies.length < n && !choisies.some(c => c.evenement === q.evenement)) choisies.push(q)
    for (const q of melange) if (choisies.length < n && !choisies.includes(q)) choisies.push(q)
    return choisies
}

// Lignes d'une période : créées à la première lecture avec le tirage du jour
function lignesPeriode(guildId, userId, period, reserve, n) {
    const lire = () => db.sqlAll("SELECT * FROM quetes WHERE guild_id = ? AND user_id = ? AND period = ? ORDER BY quest", [guildId, userId, period])
    let lignes = lire()
    if (!lignes.length) {
        for (const q of tirer(reserve, n, `${guildId}:${userId}:${period}`)) {
            db.sqlRun("INSERT OR IGNORE INTO quetes (guild_id, user_id, period, quest, progress, goal) VALUES (?, ?, ?, ?, 0, ?)", [guildId, userId, period, q.id, q.objectif])
        }
        lignes = lire()
    }
    return lignes
}

// Quêtes du jour puis de la semaine du membre, avec le détail du catalogue (quêtes retirées du catalogue ignorées)
function quetesDuMembre(guildId, userId, { instant = Date.now() } = {}) {
    const jour = jourParis(instant), semaine = semaineParis(instant)
    const lignes = [
        ...lignesPeriode(guildId, userId, jour, catalogue.jour, NOMBRE_JOUR).map(l => ({ ...l, type: "jour" })),
        ...lignesPeriode(guildId, userId, semaine, catalogue.semaine, NOMBRE_SEMAINE).map(l => ({ ...l, type: "semaine" }))
    ]
    return lignes.filter(l => parId.has(l.quest)).map(l => ({
        id: l.quest, type: l.type, period: l.period, progress: l.progress, goal: l.goal, claimed: l.claimed === 1,
        terminee: l.progress >= l.goal, recompense: parId.get(l.quest).recompense, nom: parId.get(l.quest).nom
    }))
}

// Un événement fait avancer d'un cran les quêtes en cours qui l'attendent (jamais au-delà de l'objectif)
function avancer(evenement, { guildId, userId } = {}, { instant = Date.now() } = {}) {
    if (!guildId || !userId || !EVENEMENTS.includes(evenement) || !moduleActif(guildId, MODULE)) return
    for (const q of quetesDuMembre(guildId, userId, { instant })) {
        if (parId.get(q.id).evenement !== evenement || q.claimed) continue
        db.sqlRun("UPDATE quetes SET progress = MIN(goal, progress + 1) WHERE guild_id = ? AND user_id = ? AND period = ? AND quest = ? AND claimed = 0",
            [guildId, userId, q.period, q.id])
    }
}

// Verse les récompenses des quêtes terminées et pas encore réclamées. Le marquage « claimed » est un UPDATE
// conditionnel dans une transaction : deux réclamations simultanées ne peuvent pas payer deux fois. Si crediter
// refuse (compte gelé...), le marquage est annulé pour que le membre puisse réclamer plus tard.
// Renvoie { reclamees: [{ id, montant }], total, refus, rien }
function reclamer(membre, { instant = Date.now() } = {}) {
    const guildId = membre.guild.id, userId = membre.id
    const resultat = { reclamees: [], total: 0, refus: null, rien: false }
    const aReclamer = quetesDuMembre(guildId, userId, { instant }).filter(q => q.terminee && !q.claimed)
    if (!aReclamer.length) return { ...resultat, rien: true }

    for (const q of aReclamer) {
        const marquee = db.transaction(() => db.sqlRun(
            "UPDATE quetes SET claimed = 1 WHERE guild_id = ? AND user_id = ? AND period = ? AND quest = ? AND claimed = 0 AND progress >= goal",
            [guildId, userId, q.period, q.id]) === 1)
        if (!marquee) continue
        const paiement = crediter(membre, q.recompense, { source: "quete", actif: false, sansReduction: false, details: { quete: q.id, period: q.period } })
        if (!paiement.ok) {
            db.sqlRun("UPDATE quetes SET claimed = 0 WHERE guild_id = ? AND user_id = ? AND period = ? AND quest = ?", [guildId, userId, q.period, q.id])
            resultat.refus = paiement.refus
            break
        }
        resultat.reclamees.push({ id: q.id, montant: paiement.credite })
        resultat.total += paiement.credite
    }
    return resultat
}

for (const evenement of EVENEMENTS) ecouter(evenement, donnees => avancer(evenement, donnees))

module.exports = { quetesDuMembre, avancer, reclamer, semaineParis, catalogue, NOMBRE_JOUR }
