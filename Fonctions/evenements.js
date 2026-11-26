const { EventEmitter } = require('events')
const { enHeureDeParis } = require('./dates')

// Bus d'événements interne de la Communauté (idée #44) : les jeux et l'économie annoncent ce qui s'est passé,
// les succès et les quêtes écoutent. Un écouteur qui échoue ne casse jamais l'action qui a émis l'événement.
//
// Événements (données : { guildId, userId, ... }) :
//   daily (streak), travail (job, level), achat (itemId), paiement (to, amount), niveau (level),
//   message, partie:jouee (game), partie:gagnee (game), quiz:bonne_reponse, rep:donnee (to), rep:recue (from)
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

module.exports = { emettre, ecouter, retirerEcouteurs, jourParis }
