const Discord = require('discord.js')
const { formatReason, auditReason, checkHierarchy, fetchMember } = require('../Fonctions/moderation')
const { sendModLog } = require('../Fonctions/logs')
const { t } = require('../Fonctions/i18n')
const db = require('../Fonctions/db')

module.exports = {
    name: "kick",
    description: "Kick un membre",
    permission: Discord.PermissionFlagsBits.KickMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre à kick",
            required: true
        }, {
            type: "string",
            name: "raison",
            description: "La raison du kick",
            required: true,
            maxLength: 400
        }
    ],

    async run(bot, message, args) {
        // Réponse différée : relire le membre et agir peut dépasser les 3 s permises par Discord
        await message.deferReply()
        const user = args.getUser("membre")
        const raisonBrute = args.getString("raison")
        const reason = formatReason(raisonBrute)

        // Rôles relus auprès de Discord : la hiérarchie est vérifiée sur des données à jour
        const member = await fetchMember(message.guild, user.id)
        if (!member) return message.editReply(t(message, "mod.absent"))

        const erreur = checkHierarchy(message, member, "kick")
        if (erreur) return message.editReply(erreur)
        if (!member.kickable) return message.editReply(t(message, "mod.kick.pas_kickable"))

        await user.send(t(message.guild, "mod.kick.mp", { serveur: message.guild.name, reason })).catch(() => {})

        await member.kick(auditReason(message, raisonBrute))
        const numero = db.addCase(message.guild.id, { userId: user.id, moderatorId: message.user.id, type: "kick", reason: raisonBrute })
        await message.editReply(t(message, "mod.kick.reponse", { moderateur: message.user, user, reason, numero }))
        await sendModLog(message, { action: "kick", cible: user, raison: raisonBrute })
    }
}
