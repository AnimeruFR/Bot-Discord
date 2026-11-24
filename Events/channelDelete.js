const db = require('../Fonctions/db')

// Salon supprimé : on oublie son verrouillage éventuel
module.exports = async (bot, channel) => {
    try {
        if (channel.guildId) db.removeLock(channel.guildId, channel.id)
    } catch (err) {
        console.error("Erreur sur channelDelete :", err.message)
    }
}
