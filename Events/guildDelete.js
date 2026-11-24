const { onGuildDelete } = require('../Fonctions/privacy')

module.exports = async (bot, guild) => {
    try {
        if (onGuildDelete(guild)) console.log(`Bot retiré du serveur ${guild.id} : données effacées dans 30 jours`)
    } catch (err) {
        console.error("Erreur sur guildDelete :", err.message)
    }
}
