const { onGuildCreate } = require('../Fonctions/privacy')

module.exports = async (bot, guild) => {
    try {
        onGuildCreate(guild)
    } catch (err) {
        console.error("Erreur sur guildCreate :", err.message)
    }
}
