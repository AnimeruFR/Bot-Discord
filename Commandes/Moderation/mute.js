const Discord = require('discord.js')
const { parseDuree } = require('../../Fonctions/moderation')
const { DUREE_MAX_MUTE } = require('../../Fonctions/sanctions')
const { muter } = require('../../Fonctions/actionsMod')
const { refuser } = require('../../Fonctions/erreurs')
const { t } = require('../../Fonctions/i18n')
const { autocompleterRaison } = require('../../Fonctions/raisons')

module.exports = {
    name: "mute",
    description: "mute un membre",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre à mute",
            required: true
        }, {
            type: "string",
            name: "temps",
            description: "Le temps du mute (ex : 10m, 1h, 2d)",
            required: true,
            maxLength: 20
        }, {
            type: "string",
            name: "raison",
            description: "La raison du mute",
            required: false,
            autocomplete: true,
            maxLength: 400
        }
    ],

    autocomplete: (bot, interaction) => autocompleterRaison(interaction),

    async run(bot, message, args) {
        // Réponse différée : relire le membre et agir peut dépasser les 3 s permises par Discord
        await message.deferReply()
        const user = args.getUser("membre")
        const raisonBrute = args.getString("raison")

        const { duree, erreur: erreurDuree } = parseDuree(args.getString("temps"), { min: 1000, max: DUREE_MAX_MUTE, cible: message })
        if (erreurDuree) return refuser(message, erreurDuree)
        const r = await muter(message, user, duree, raisonBrute)
        if (r.erreur) return refuser(message, r.erreur)
        await message.editReply(t(message, "mod.mute.reponse", { moderateur: message.user, user, temps: r.temps, reason: r.reason, numero: r.numero }))
    }
}
