const { t } = require('../../Fonctions/i18n')

module.exports = {

    name: "ping",
    description: "affiche le ping du bot",
    permission: "Aucune",
    dm: true,
    category: "Information",

    async run(bot,message, args) {
        await message.reply(t(message, "ping.reponse", { ping: bot.ws.ping }))
    }
}