const Discord = require('discord.js')
const { formatReason, auditReason, checkHierarchy, fetchMember } = require('../../Fonctions/moderation')
const { sendModLog } = require('../../Fonctions/logs')
const { t } = require('../../Fonctions/i18n')
const db = require('../../Fonctions/db')

module.exports = {
    name: "unmute",
    description: "unmute un membre",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre à unmute",
            required: true
        }, {
            type: "string",
            name: "raison",
            description: "La raison du unmute",
            required: false,
            maxLength: 400
        }
    ],

    async run(bot, message, args) {
        // Réponse différée : relire le membre et agir peut dépasser les 3 s permises par Discord
        await message.deferReply()
        const user = args.getUser("membre")
        const raisonBrute = args.getString("raison")
        const reason = formatReason(raisonBrute)

        const member = await fetchMember(message.guild, user.id)
        if (!member) return message.editReply(t(message, "mod.absent"))

        const erreur = checkHierarchy(message, member, "unmute")
        if (erreur) return message.editReply(erreur)
        if (!member.moderatable) return message.editReply(t(message, "mod.unmute.pas_moderatable"))
        if (!member.isCommunicationDisabled()) return message.editReply(t(message, "mod.unmute.pas_mute"))

        await member.timeout(null, auditReason(message, raisonBrute))
        db.addCase(message.guild.id, { userId: user.id, moderatorId: message.user.id, type: "unmute", reason: raisonBrute })
        await message.editReply(t(message, "mod.unmute.reponse", { moderateur: message.user, user, reason }))
        await sendModLog(message, { action: "unmute", cible: user, raison: raisonBrute })
        await user.send(t(message.guild, "mod.unmute.mp", { serveur: message.guild.name, reason })).catch(() => {})
    }
}
