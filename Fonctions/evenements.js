const { EventEmitter } = require('events')
const { enHeureDeParis } = require('./dates')

// Bus d'événements interne de la Communauté (idée #44) : les jeux et l'économie annoncent ce qui s'est passé,
// les succès et les quêtes écoutent. Un écouteur qui échoue ne casse jamais l'action qui a émis l'événement.
//
// Événements (données : { guildId, userId, ... }) :
//   daily (streak), travail (job, level), achat (itemId), paiement (to, amount), niveau (level),
//   partie:jouee (game, players), partie:gagnee (game, players), quiz:bonne_reponse, rep:donnee (to), rep:recue (from)
//   objet:utilise (itemId), mot:trouve (essais, serie), enigme:trouvee (rang), drop:ramasse
//   players : identifiants de tous les joueurs de la partie (quand le jeu les donne) ; sert à repérer l'adversaire.
const bus = new EventEmitter()
bus.setMaxListeners(50)

function emettre(nom, donnees) {
    for (const ecouteur of bus.listeners(nom)) {
        try {
            const resultat = ecouteur(donnees)
            if (resultat?.catch) resultat.catch(err => console.error(`Écouteur de « ${nom} » en échec :`, err.message))
        } catch (err) {
            console.error(`Écouteur de « ${nom} » en échec :`, err.message)
        }
    }
}

const ecouter = (nom, fn) => bus.on(nom, fn)
const retirerEcouteurs = () => bus.removeAllListeners()

// Jour au format AAAA-MM-JJ, heure de Paris : sert de clé aux compteurs quotidiens (daily, plafonds, quêtes)
function jourParis(instant = Date.now()) {
    const { annee, mois, jour } = enHeureDeParis(instant)
    return `${annee}-${String(mois).padStart(2, "0")}-${String(jour).padStart(2, "0")}`
}

// --- Anti-farm : un partenaire ne compte qu'une fois par période ------------------------------------------------
// Deux comptes qui se renvoient de la réputation, des paiements ou des victoires ne doivent pas faire progresser
// quêtes et succès à l'infini. La trace des paires déjà vues est gardée en base (stats_joueur, clé « paire:... »),
// donc elle survit à un redémarrage ; les traces des périodes passées sont effacées à chaque nouvelle paire.
// Événements limités : rep:donnee (to), rep:recue (from), paiement (to), partie:gagnee (players).
const LIMITES_PARTENAIRE = new Set(["rep:donnee", "rep:recue", "paiement", "partie:gagnee"])

// Identifiants des partenaires d'un événement limité (tableau vide s'il n'y en a pas)
function partenaires(evenement, donnees) {
    const userId = String(donnees?.userId)
    if (evenement === "partie:gagnee") {
        // Sans liste de joueurs (ou partie solo) : pas d'adversaire connu, rien à limiter
        return Array.isArray(donnees?.players) ? [...new Set(donnees.players.map(String))].filter(id => id !== userId) : []
    }
    const autre = evenement === "rep:recue" ? donnees?.from : donnees?.to
    return autre && String(autre) !== userId ? [String(autre)] : []
}

// Vrai si au moins un des partenaires n'a pas encore compté pour (cle, periode) ; tous sont alors notés.
// cle distingue ce qui consomme la trace (ex. « succes:rep:donnee », « quete:jour:rep:donnee »).
function paireNouvelle(guildId, userId, cle, periode, ids) {
    const db = require('./db') // chargé ici : le bus lui-même n'a pas besoin de la base
    return db.transaction(() => {
        let nouveau = false
        for (const id of ids) {
            const ajoute = db.sqlRun("INSERT OR IGNORE INTO stats_joueur (guild_id, user_id, stat, value) VALUES (?, ?, ?, 1)",
                [guildId, userId, `paire:${cle}:${periode}:${id}`])
            if (ajoute === 1) nouveau = true
        }
        if (nouveau) {
            db.sqlRun("DELETE FROM stats_joueur WHERE guild_id = ? AND user_id = ? AND stat LIKE ? AND stat NOT LIKE ?",
                [guildId, userId, `paire:${cle}:%`, `paire:${cle}:${periode}:%`])
        }
        return nouveau
    })
}

// L'événement doit-il compter pour cette période ? Toujours vrai pour un événement non limité. Réputation et paiement
// sans partenaire connu ne comptent pas ; une victoire sans adversaire connu (jeu solo, liste absente) compte.
function peutCompter(guildId, userId, evenement, donnees, cle, periode) {
    if (!LIMITES_PARTENAIRE.has(evenement)) return true
    const ids = partenaires(evenement, donnees)
    if (!ids.length) return evenement === "partie:gagnee"
    return paireNouvelle(guildId, userId, cle, periode, ids)
}

module.exports = { emettre, ecouter, retirerEcouteurs, jourParis, peutCompter }
