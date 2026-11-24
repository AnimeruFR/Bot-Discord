const Discord = require('discord.js')
const { formatReason, auditReason, checkHierarchy, fetchMember, parseDuree, formatDuree } = require('../Fonctions/moderation')
const { DUREE_MAX_MUTE } = require('../Fonctions/sanctions')
const { sendModLog } = require('../Fonctions/logs')
const db = require('../Fonctions/db')

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
            maxLength: 400
        }
    ],

    async run(bot, message, args) {
        // Réponse différée : relire le membre et agir peut dépasser les 3 s permises par Discord
        await message.deferReply()
        const user = args.getUser("membre")
        const raisonBrute = args.getString("raison")

        const { duree, erreur: erreurDuree } = parseDuree(args.getString("temps"), { min: 1000, max: DUREE_MAX_MUTE })
        if (erreurDuree) return message.editReply(erreurDuree)
        const temps = formatDuree(duree)
        const reason = formatReason(raisonBrute)

        const member = await fetchMember(message.guild, user.id)
        if (!member) return message.editReply("Ce membre n'est pas sur le serveur !")

        const erreur = checkHierarchy(message, member, "mute")
        if (erreur) return message.editReply(erreur)
        if (!member.moderatable) return message.editReply("Je ne peux pas mute ce membre (rôle trop haut pour moi) !")
        if (member.isCommunicationDisabled()) return message.editReply("Ce membre est déjà mute !")

        await member.timeout(duree, auditReason(message, raisonBrute))
        const numero = db.addCase(message.guild.id, { userId: user.id, moderatorId: message.user.id, type: "mute", reason: raisonBrute, durationMs: duree })
        await message.editReply(`${message.user} a mute ${user} pendant ${temps} pour la raison : ***${reason}*** (sanction n°${numero})`)
        await sendModLog(message, { action: "mute", cible: user, raison: raisonBrute, details: `Durée : ${temps}` })
        await user.send(`Tu as été mute sur le serveur ${message.guild.name} pendant ${temps} pour la raison : ***${reason}***`).catch(() => {})
    }
}
