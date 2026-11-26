const db = require('./db')
const { ecouter } = require('./evenements')
const { moduleActif } = require('./modules')
const { crediter } = require('./economie')
const catalogue = require('../data-statique/succes.json')

// Succès et badges (idée #44). Contrat : le chargement du module abonne ses écouteurs au bus (Fonctions/evenements.js).
//
// Chaque événement fait monter un ou plusieurs compteurs de stats_joueur (une ligne par stat, incrément atomique),
// puis on regarde quels succès de data-statique/succes.json atteignent leur seuil. Un succès n'est obtenu qu'une fois
// (INSERT OR IGNORE) et la récompense n'est versée que si cette insertion a bien eu lieu.
// Récompense : crediter(..., { actif: false, sansReduction: true }), hors plafond du jour et sans réduction « nouveau ».
// Si le membre est introuvable (parti du serveur) ou si crediter refuse (compte gelé, sanction...), le succès reste
// obtenu mais sans récompense : on ne met rien en attente.

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

const lireStats = (guildId, userId) =>
    Object.fromEntries(db.sqlAll("SELECT stat, value FROM stats_joueur WHERE guild_id = ? AND user_id = ?", [guildId, userId]).map(l => [l.stat, l.value]))

// Marque le succès comme obtenu ; vrai seulement pour le premier appel (même si deux événements arrivent en même temps)
const obtenir = (guildId, userId, id) =>
    db.sqlRun("INSERT OR IGNORE INTO succes (guild_id, user_id, achievement, earned_at) VALUES (?, ?, ?, ?)", [guildId, userId, id, Date.now()]) === 1

async function recompenser(guildId, userId, succes) {
    try {
        const membre = await client?.guilds.cache.get(guildId)?.members.fetch(userId)
        if (!membre) return null
        return crediter(membre, succes.recompense, { source: "succes", actif: false, sansReduction: true, details: { succes: succes.id } })
    } catch (err) {
        console.error(`Récompense du succès ${succes.id} impossible :`, err.message)
        return null
    }
}

// Traite un événement du bus. Renvoie les succès obtenus à cette occasion (liste d'objets du catalogue).
// Les compteurs et l'obtention sont écrits avant le premier await : rien ne peut s'intercaler entre les deux.
async function enregistrer(evenement, donnees) {
    const { guildId, userId } = donnees ?? {}
    const effets = EFFETS[evenement]
    if (!effets || !guildId || !userId || !moduleActif(guildId, MODULE)) return []

    const valeurs = {}
    for (const [stat, mode, valeur] of effets(donnees)) {
        if (!Number.isSafeInteger(valeur) || valeur < 0) continue
        valeurs[stat] = incrementerStat(guildId, userId, stat, mode, valeur)
    }
    const obtenus = catalogue.filter(s => s.condition.stat in valeurs && valeurs[s.condition.stat] >= s.condition.seuil && obtenir(guildId, userId, s.id))
    for (const succes of obtenus) await recompenser(guildId, userId, succes)
    return obtenus
}

// Tous les succès d'un membre : obtenus (avec la date) et à obtenir (avec la progression)
function liste(guildId, userId) {
    const stats = lireStats(guildId, userId)
    const dates = new Map(db.sqlAll("SELECT achievement, earned_at FROM succes WHERE guild_id = ? AND user_id = ?", [guildId, userId]).map(l => [l.achievement, l.earned_at]))
    return catalogue.map(s => ({ ...s, obtenuLe: dates.get(s.id) ?? null, valeur: Math.min(stats[s.condition.stat] ?? 0, s.condition.seuil) }))
}

for (const evenement of Object.keys(EFFETS)) ecouter(evenement, donnees => enregistrer(evenement, donnees))

module.exports = { configurerClient, enregistrer, liste, lireStats, catalogue, EFFETS }
