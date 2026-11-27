const db = require('./db')
const { ecouter, jourParis, peutCompter } = require('./evenements')
const { moduleActif } = require('./modules')
const { crediter } = require('./economie')
const catalogue = require('../data-statique/succes.json')

// Succès et badges (idée #44). Contrat : le chargement du module abonne ses écouteurs au bus (Fonctions/evenements.js).
//
// Chaque événement fait monter un ou plusieurs compteurs de stats_joueur (une ligne par stat, incrément atomique),
// puis on regarde quels succès de data-statique/succes.json atteignent leur seuil. Un succès n'est obtenu qu'une fois
// (INSERT OR IGNORE) avec rewarded = 0 ; la récompense est versée ensuite, puis rewarded passe à 1.
// Récompense : crediter(..., { actif: false, sansReduction: true }), hors plafond du jour et sans réduction « nouveau ».
// Si le membre est introuvable (parti du serveur) ou si crediter refuse (compte gelé, sanction...), le succès reste
// obtenu avec rewarded = 0 : la récompense est retentée au prochain événement du membre et à l'affichage de la liste.
// Anti-farm : rep reçues/données, paiements et victoires ne comptent qu'une fois par partenaire et par jour (Paris),
// voir peutCompter dans Fonctions/evenements.js (trace des paires en base, clé « succes:<événement> »).

const MODULE = "communaute.niveaux"

// "+" : le compteur s'additionne ; "max" : le compteur garde la plus grande valeur vue
const EFFETS = {
    daily: d => [["daily_total", "+", 1], ["serie_max", "max", d.streak]],
    travail: d => [["travaux", "+", 1], ["metier_niveau_max", "max", d.level]],
    achat: () => [["achats", "+", 1]],
    paiement: d => [["paiements", "+", 1], ["monnaie_donnee", "+", d.amount]],
    niveau: d => [["niveau_max", "max", d.level]],
    "partie:jouee": () => [["parties_jouees", "+", 1]],
    "partie:gagnee": () => [["parties_gagnees", "+", 1]],
    "quiz:bonne_reponse": () => [["quiz_bonnes", "+", 1]],
    "rep:donnee": () => [["rep_donnees", "+", 1]],
    "rep:recue": () => [["rep_recues", "+", 1]],
    "mot:trouve": () => [["mots_trouves", "+", 1]],
    "enigme:trouvee": () => [["enigmes_trouvees", "+", 1]],
    "drop:ramasse": () => [["drops_ramasses", "+", 1]]
}

let client = null
// Appelé par main.js une fois le client créé : sert à retrouver le membre à récompenser
const configurerClient = bot => { client = bot }

// Ajoute à un compteur (ou garde le maximum) en une seule instruction ; renvoie la nouvelle valeur
function incrementerStat(guildId, userId, stat, mode, valeur) {
    const operation = mode === "max" ? "MAX(value, excluded.value)" : "value + excluded.value"
    const [ligne] = db.sqlAll(`INSERT INTO stats_joueur (guild_id, user_id, stat, value) VALUES (?, ?, ?, ?)
        ON CONFLICT (guild_id, user_id, stat) DO UPDATE SET value = ${operation} RETURNING value`, [guildId, userId, stat, valeur])
    return ligne.value
}

// Les lignes « paire:... » (trace anti-farm) ne sont pas des compteurs
const lireStats = (guildId, userId) =>
    Object.fromEntries(db.sqlAll("SELECT stat, value FROM stats_joueur WHERE guild_id = ? AND user_id = ? AND stat NOT LIKE 'paire:%'", [guildId, userId]).map(l => [l.stat, l.value]))

// Marque le succès comme obtenu (récompense en attente) ; vrai seulement pour le premier appel, même si deux événements arrivent en même temps
const obtenir = (guildId, userId, id) =>
    db.sqlRun("INSERT OR IGNORE INTO succes (guild_id, user_id, achievement, earned_at, rewarded) VALUES (?, ?, ?, ?, 0)", [guildId, userId, id, Date.now()]) === 1

const idsEnAttente = (guildId, userId) =>
    db.sqlAll("SELECT achievement FROM succes WHERE guild_id = ? AND user_id = ? AND rewarded = 0 ORDER BY earned_at", [guildId, userId]).map(l => l.achievement)

// Verse la récompense d'un succès obtenu. Le membre est cherché avant (asynchrone) ; ensuite tout est synchrone :
// la vérification « encore en attente », le crédit et le marquage ne peuvent pas être coupés par un autre événement.
// Un refus (gel, sanction, économie coupée...), une erreur ou un membre absent laissent rewarded à 0 : à retenter plus tard.
async function recompenser(guildId, userId, succes) {
    try {
        const membre = await client?.guilds.cache.get(guildId)?.members.fetch(userId)
        if (!membre) return null
        const attente = db.sqlAll("SELECT 1 AS un FROM succes WHERE guild_id = ? AND user_id = ? AND achievement = ? AND rewarded = 0", [guildId, userId, succes.id])
        if (!attente.length) return null
        const paiement = crediter(membre, succes.recompense, { source: "succes", actif: false, sansReduction: true, details: { succes: succes.id } })
        if (paiement.ok) db.sqlRun("UPDATE succes SET rewarded = 1 WHERE guild_id = ? AND user_id = ? AND achievement = ?", [guildId, userId, succes.id])
        return paiement
    } catch (err) {
        console.error(`Récompense du succès ${succes.id} impossible :`, err.message)
        return null
    }
}

// Retente les récompenses en attente d'un membre (nouveaux succès compris). Renvoie le nombre de succès payés.
async function verserEnAttente(guildId, userId) {
    let payes = 0
    for (const id of idsEnAttente(guildId, userId)) {
        const succes = catalogue.find(s => s.id === id)
        if (!succes) continue
        if ((await recompenser(guildId, userId, succes))?.ok) payes++
    }
    return payes
}

// Traite un événement du bus. Renvoie les succès obtenus à cette occasion (liste d'objets du catalogue).
// Les compteurs et l'obtention sont écrits avant le premier await : rien ne peut s'intercaler entre les deux.
async function enregistrer(evenement, donnees, { instant = Date.now() } = {}) {
    const { guildId, userId } = donnees ?? {}
    const effets = EFFETS[evenement]
    if (!effets || !guildId || !userId || !moduleActif(guildId, MODULE)) return []

    let obtenus = []
    // Un partenaire déjà compté aujourd'hui ne fait plus monter les compteurs
    if (peutCompter(guildId, userId, evenement, donnees, `succes:${evenement}`, jourParis(instant))) {
        const valeurs = {}
        for (const [stat, mode, valeur] of effets(donnees)) {
            if (!Number.isSafeInteger(valeur) || valeur < 0) continue
            valeurs[stat] = incrementerStat(guildId, userId, stat, mode, valeur)
        }
        obtenus = catalogue.filter(s => s.condition.stat in valeurs && valeurs[s.condition.stat] >= s.condition.seuil && obtenir(guildId, userId, s.id))
    }
    // Récompenses des nouveaux succès et de ceux restés en attente
    await verserEnAttente(guildId, userId)
    return obtenus
}

// Tous les succès d'un membre : obtenus (avec la date) et à obtenir (avec la progression).
// Si des récompenses sont restées en attente, on les retente en arrière-plan (l'affichage n'attend pas).
function liste(guildId, userId) {
    if (idsEnAttente(guildId, userId).length) verserEnAttente(guildId, userId).catch(err => console.error("Succès en attente :", err.message))
    const stats = lireStats(guildId, userId)
    const dates = new Map(db.sqlAll("SELECT achievement, earned_at FROM succes WHERE guild_id = ? AND user_id = ?", [guildId, userId]).map(l => [l.achievement, l.earned_at]))
    return catalogue.map(s => ({ ...s, obtenuLe: dates.get(s.id) ?? null, valeur: Math.min(stats[s.condition.stat] ?? 0, s.condition.seuil) }))
}

for (const evenement of Object.keys(EFFETS)) ecouter(evenement, donnees => enregistrer(evenement, donnees))

module.exports = { configurerClient, enregistrer, liste, lireStats, catalogue, EFFETS }
