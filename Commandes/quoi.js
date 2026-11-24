const { t } = require('../Fonctions/i18n')

module.exports = {

    name: "quoi",
    description: "répond feur",
    permission: "Aucune",
    dm: true,
    category: "Information",

    async run(bot, message,args) {
        await message.reply(t(message, "quoi.reponse"))
    }
}