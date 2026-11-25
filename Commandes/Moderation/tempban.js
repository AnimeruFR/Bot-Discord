const Discord = require('discord.js')
const { refuser } = require('../../Fonctions/erreurs')
const { parseDuree } = require('../../Fonctions/moderation')
const { banAvecConfirmation, DUREE_MAX_TEMPBAN } = require('../../Fonctions/sanctions')
const { autocompleterRaison } = require('../../Fonctions/raisons')

module.exports = {
    name: "tempban",
    description: "Ban un membre pendant une durée limitée (déban automatique)",
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
            name: "duree",
            description: "Durée du ban (ex : 1h, 3d, 2w ; 365 jours maximum)",
            required: true,
            maxLength: 20
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
        const { duree, erreur } = parseDuree(args.getString("duree"), { max: DUREE_MAX_TEMPBAN, cible: message })
        if (erreur) return refuser(message, erreur)
        await banAvecConfirmation(message, { user: args.getUser("membre"), raisonBrute: args.getString("raison"), duree })
    }
}
