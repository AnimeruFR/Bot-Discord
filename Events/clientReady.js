const { startPrivacySchedule } = require('../Fonctions/privacy')
const { startBackupSchedule } = require('../Fonctions/backup')
const { startHeartbeat } = require('../Fonctions/heartbeat')

let demarre = false

module.exports = async bot => {
    console.log(`${bot.user.tag} est bien en ligne ! (pense à lancer "npm run deploy" après avoir modifié une commande)`)

    // Tâches de fond, lancées une seule fois même si l'événement se répète
    if (demarre) return
    demarre = true
    startPrivacySchedule(bot)
    startBackupSchedule()
    startHeartbeat(bot)
}
