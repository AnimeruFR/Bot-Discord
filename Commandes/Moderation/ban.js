const Discord = require('discord.js')
const { banAvecConfirmation } = require('../../Fonctions/sanctions')

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
            maxLength: 400
        }
    ],

    async run(bot, message, args) {
        await banAvecConfirmation(message, { user: args.getUser("membre"), raisonBrute: args.getString("raison") })
    }
}
