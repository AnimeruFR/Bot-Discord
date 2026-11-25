const { traiterExecution } = require('../Fonctions/automod')

// Un message bloqué par AutoMod : dossier, log et, si /automod dossiers est activé, avertissement.
// Il faut la permission « Gérer le serveur » pour recevoir cet événement.
module.exports = async (bot, execution) => {
    try {
        await traiterExecution(bot, execution)
    } catch (err) {
        console.error("Erreur sur autoModerationActionExecution :", err.message)
    }
}
