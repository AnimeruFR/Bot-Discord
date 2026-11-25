const Discord = require('discord.js')
const { formatReason, auditReason, checkHierarchy, fetchMember, parseDuree, formatDuree } = require('../Fonctions/moderation')
const { DUREE_MAX_MUTE } = require('../Fonctions/sanctions')
const { sendModLog } = require('../Fonctions/logs')
const { t, langueDe } = require('../Fonctions/i18n')
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

        const { duree, erreur: erreurDuree } = parseDuree(args.getString("temps"), { min: 1000, max: DUREE_MAX_MUTE, cible: message })
        if (erreurDuree) return message.editReply(erreurDuree)
        const temps = formatDuree(duree, langueDe(message))
        const tempsFr = formatDuree(duree)
        const tempsMp = formatDuree(duree, langueDe(message.guild))
        const reason = formatReason(raisonBrute)

        const member = await fetchMember(message.guild, user.id)
        if (!member) return message.editReply(t(message, "mod.absent"))

        const erreur = checkHierarchy(message, member, "mute")
        if (erreur) return message.editReply(erreur)
        if (!member.moderatable) return message.editReply(t(message, "mod.mute.pas_moderatable"))
        if (member.isCommunicationDisabled()) return message.editReply(t(message, "mod.mute.deja"))

        await member.timeout(duree, auditReason(message, raisonBrute))
        const numero = db.addCase(message.guild.id, { userId: user.id, moderatorId: message.user.id, type: "mute", reason: raisonBrute, durationMs: duree })
        await message.editReply(t(message, "mod.mute.reponse", { moderateur: message.user, user, temps, reason, numero }))
        await sendModLog(message, { action: "mute", cible: user, raison: raisonBrute, details: `Durée : ${tempsFr}` })
        await user.send(t(message.guild, "mod.mute.mp", { serveur: message.guild.name, temps: tempsMp, reason })).catch(() => {})
    }
}
