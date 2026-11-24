const Discord = require('discord.js')
const ms = require('ms')
const { formatReason, auditReason, checkHierarchy } = require('../Fonctions/moderation')

const DUREE_MAX = 28 * 24 * 60 * 60 * 1000 // limite de Discord : 28 jours

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
        const user = args.getUser("membre")
        const member = args.getMember("membre")
        if (!member) return message.reply("Ce membre n'est pas sur le serveur !")

        const texteTemps = args.getString("temps").trim()
        const duree = texteTemps ? ms(texteTemps) : NaN
        if (!Number.isFinite(duree) || duree < 1000) return message.reply("Durée invalide ! Exemples : `10m`, `1h`, `2d`.")
        if (duree > DUREE_MAX) return message.reply("Le temps est trop long (28 jours maximum) !")
        const temps = ms(duree, { long: true })

        const reason = formatReason(args.getString("raison"))

        const erreur = checkHierarchy(message, member, "mute")
        if (erreur) return message.reply(erreur)
        if (!member.moderatable) return message.reply("Je ne peux pas mute ce membre (rôle trop haut pour moi) !")
        if (member.isCommunicationDisabled()) return message.reply("Ce membre est déjà mute !")

        await member.timeout(duree, auditReason(message, args.getString("raison")))
        await message.reply(`${message.user} a mute ${user} pendant ${temps} pour la raison : ***${reason}***`)
        await user.send(`Tu as été mute sur le serveur ${message.guild.name} pendant ${temps} pour la raison : ***${reason}***`).catch(() => {})
    }
}
