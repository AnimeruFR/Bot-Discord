const db = require('./db')
const { purgerSauvegardesMigration } = require('./migrations')

const RETENTION = 30 * 24 * 60 * 60 * 1000 // données gardées 30 jours après le départ du bot (réinvitation par erreur)
const JOUR = 24 * 60 * 60 * 1000
const CONSERVATION_HISTORIQUE = 2 * 365 * JOUR

// Le bot a quitté un serveur. Attention : Discord envoie aussi guildDelete quand un serveur
// est seulement indisponible (panne) : dans ce cas on ne touche à rien.
function onGuildDelete(guild) {
    if (guild.available === false) return false
    db.markGuildLeft(guild.id)
    return true
}

// Le bot revient sur un serveur avant la fin du délai : on annule la suppression
function onGuildCreate(guild) {
    db.cancelGuildLeft(guild.id)
}

// Au démarrage : le bot a pu être retiré de serveurs pendant qu'il était éteint.
// Tout serveur qui a des données mais n'est plus dans la liste du bot est noté comme quitté.
function reconcile(serveursActuels) {
    let quittes = 0
    for (const guildId of db.guildsWithData()) {
        if (serveursActuels.has(guildId)) db.cancelGuildLeft(guildId)
        else if (db.markGuildLeft(guildId).changes > 0) quittes++
    }
    return quittes
}

// Efface les serveurs quittés depuis plus de RETENTION (sauf si le bot y est de nouveau)
function purge(serveursActuels, maintenant = Date.now()) {
    const effaces = []
    for (const guildId of db.guildsLeftBefore(maintenant - RETENTION)) {
        if (serveursActuels.has(guildId)) {
            db.cancelGuildLeft(guildId)
            continue
        }
        db.deleteGuildData(guildId)
        effaces.push(guildId)
    }
    return effaces
}

// Au démarrage puis une fois par jour
function startPrivacySchedule(bot) {
    const tourner = () => {
        try {
            const serveurs = new Set(bot.guilds.cache.keys())
            // Avec plusieurs shards (ShardingManager), ce processus ne voit qu'une partie des serveurs :
            // la réconciliation marquerait les autres comme quittés. Seuls les départs reçus par guildDelete comptent alors.
            const quittes = bot.shard ? 0 : reconcile(serveurs)
            const effaces = purge(serveurs)
            db.purgeTicketCooldowns(Date.now() - 10 * 60 * 1000) // délais de tickets expirés
            db.purgeOldCases(Date.now() - CONSERVATION_HISTORIQUE) // historique des sanctions de plus de 2 ans
            db.purgeOldWarns(Date.now() - CONSERVATION_HISTORIQUE) // avertissements de plus de 2 ans
            purgerSauvegardesMigration() // copies avant-migration-*.db de plus de 30 jours (elles contiennent la base entière)
            db.purgeOldTickets(Date.now() - 90 * JOUR) // suivi des tickets supprimés depuis plus de 90 jours
            db.purgeOldGiveaways(Date.now() - 30 * JOUR) // giveaways terminés depuis plus de 30 jours (participants, gagnants)
            db.purgePhase2({ deuxAns: Date.now() - CONSERVATION_HISTORIQUE, unAn: Date.now() - 365 * JOUR, unJour: Date.now() - JOUR })
            if (quittes || effaces.length) console.log(`RGPD : ${quittes} serveur(s) quitté(s) détecté(s), ${effaces.length} serveur(s) effacé(s)`)
        } catch (err) {
            console.error("Erreur pendant la purge RGPD :", err.message)
        }
    }
    tourner()
    return setInterval(tourner, JOUR).unref()
}

module.exports = { onGuildDelete, onGuildCreate, reconcile, purge, startPrivacySchedule, RETENTION }
