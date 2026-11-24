const Discord = require('discord.js')
const { formatReason, auditReason, checkHierarchy, fetchMember } = require('../Fonctions/moderation')
const { sendModLog } = require('../Fonctions/logs')
const db = require('../Fonctions/db')

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
        if (!member) return message.editReply("Ce membre n'est pas sur le serveur !")

        const erreur = checkHierarchy(message, member, "unmute")
        if (erreur) return message.editReply(erreur)
        if (!member.moderatable) return message.editReply("Je ne peux pas unmute ce membre (rôle trop haut pour moi) !")
        if (!member.isCommunicationDisabled()) return message.editReply("Ce membre n'est pas mute !")

        await member.timeout(null, auditReason(message, raisonBrute))
        db.addCase(message.guild.id, { userId: user.id, moderatorId: message.user.id, type: "unmute", reason: raisonBrute })
        await message.editReply(`${message.user} a unmute ${user} pour la raison : ***${reason}***`)
        await sendModLog(message, { action: "unmute", cible: user, raison: raisonBrute })
        await user.send(`Tu as été unmute sur le serveur ${message.guild.name} pour la raison : ***${reason}***`).catch(() => {})
    }
}
