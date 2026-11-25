const Discord = require('discord.js')
const { avertir } = require('../../Fonctions/actionsMod')
const { refuser } = require('../../Fonctions/erreurs')
const { t } = require('../../Fonctions/i18n')

module.exports = {
    name: "warn",
    description: "Warn un membre",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    // Le rôle staff du serveur (/config) suffit : aucune action avec les pouvoirs propres du bot
    roleStaffSuffit: true,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre à warn",
            required: true
        }, {
            type: "string",
            name: "raison",
            description: "La raison du warn",
            required: false,
            maxLength: 400
        }
    ],

    async run(bot, message, args) {
        // Réponse différée : relire le membre et agir peut dépasser les 3 s permises par Discord.
        // Tout refus passe par refuser() : il reste visible de l'auteur seulement.
        await message.deferReply()
        const user = args.getUser("membre")
        const r = await avertir(message, user, args.getString("raison"))
        if (r.erreur) return refuser(message, r.erreur)

        await message.editReply(t(message, "mod.warn.reponse", { moderateur: message.user, user, reason: r.reason, id: r.id, total: r.total }) + (r.prevenu ? "" : t(message, "mod.warn.pas_prevenu")))
        if (r.auto) await message.followUp(t(message, "mod.warn.seuil", { total: r.total, user, auto: r.auto }))
    }
}
