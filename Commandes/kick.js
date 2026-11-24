const Discord = require('discord.js')
const { formatReason, auditReason, checkHierarchy, fetchMember } = require('../Fonctions/moderation')
const { sendModLog } = require('../Fonctions/logs')
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
        if (!member) return message.editReply("Ce membre n'est pas sur le serveur !")

        const erreur = checkHierarchy(message, member, "kick")
        if (erreur) return message.editReply(erreur)
        if (!member.kickable) return message.editReply("Je ne peux pas kick ce membre (rôle trop haut pour moi) !")

        await user.send(`Tu as été kick du serveur ${message.guild.name} pour la raison : ***${reason}***`).catch(() => {})

        await member.kick(auditReason(message, raisonBrute))
        const numero = db.addCase(message.guild.id, { userId: user.id, moderatorId: message.user.id, type: "kick", reason: raisonBrute })
        await message.editReply(`${message.user} a kick ${user} pour la raison : ***${reason}*** (sanction n°${numero})`)
        await sendModLog(message, { action: "kick", cible: user, raison: raisonBrute })
    }
}
