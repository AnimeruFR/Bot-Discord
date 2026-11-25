const Discord = require('discord.js')
const { banAvecConfirmation } = require('../../Fonctions/sanctions')
const { autocompleterRaison } = require('../../Fonctions/raisons')

module.exports = {
    name: "ban",
    description: "Ban un membre",
    permission: Discord.PermissionFlagsBits.BanMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre à bannir",
            required: true
        }, {
            type: "string",
            name: "raison",
            description: "La raison du bannissement",
            required: true,
            autocomplete: true,
            maxLength: 400
        }
    ],

    autocomplete: (bot, interaction) => autocompleterRaison(interaction),

    async run(bot, message, args) {
        await banAvecConfirmation(message, { user: args.getUser("membre"), raisonBrute: args.getString("raison") })
    }
}
