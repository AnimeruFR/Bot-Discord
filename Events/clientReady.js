const { startPrivacySchedule } = require('../Fonctions/privacy')
const { startBackupSchedule } = require('../Fonctions/backup')
const { startHeartbeat } = require('../Fonctions/heartbeat')
const { startTempbanSchedule } = require('../Fonctions/tempbans')
const { startTicketInactivitySchedule } = require('../Fonctions/ticketsInactifs')
const { startProgrammesSchedule } = require('../Fonctions/programmes')
const { startRapportHebdoSchedule } = require('../Fonctions/rapportHebdo')
const { startPartiesSchedule } = require('../Fonctions/parties')
const { startBoutiqueSchedule } = require('../Fonctions/boutique')
const { startAnniversairesSchedule } = require('../Fonctions/anniversaires')

let demarre = false

module.exports = async bot => {
    console.log(`${bot.user.tag} est bien en ligne ! (pense à lancer "npm run deploy" après avoir modifié une commande)`)

    // Tâches de fond, lancées une seule fois même si l'événement se répète
    if (demarre) return
    demarre = true
    startPrivacySchedule(bot)
    startBackupSchedule()
    startHeartbeat(bot)
    startTempbanSchedule(bot)
    startTicketInactivitySchedule(bot)
    startProgrammesSchedule(bot)
    startRapportHebdoSchedule(bot)
    startPartiesSchedule(bot)
    startBoutiqueSchedule(bot)
    startAnniversairesSchedule(bot)
}
