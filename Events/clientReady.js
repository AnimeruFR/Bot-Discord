const loadSlashCommands = require('../Loader/loadSlashCommands')

module.exports = async bot => {
    try {
        await loadSlashCommands(bot)
    } catch (err) {
        console.error("Impossible d'enregistrer les slash commandes :", err)
    }

    console.log(`${bot.user.tag} est bien en ligne !`)
}
