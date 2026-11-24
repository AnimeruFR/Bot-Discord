const Discord = require('discord.js')
const { formatReason, auditReason, checkHierarchy } = require('../Fonctions/moderation')
const { sendModLog } = require('../Fonctions/logs')

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
        const user = args.getUser("membre")
        const member = args.getMember("membre")
        if (!member) return message.reply("Ce membre n'est pas sur le serveur !")

        const reason = formatReason(args.getString("raison"))

        const erreur = checkHierarchy(message, member, "unmute")
        if (erreur) return message.reply(erreur)
        if (!member.moderatable) return message.reply("Je ne peux pas unmute ce membre (rôle trop haut pour moi) !")
        if (!member.isCommunicationDisabled()) return message.reply("Ce membre n'est pas mute !")

        await member.timeout(null, auditReason(message, args.getString("raison")))
        await message.reply(`${message.user} a unmute ${user} pour la raison : ***${reason}***`)
        await sendModLog(message, { action: "unmute", cible: user, raison: args.getString("raison") })
        await user.send(`Tu as été unmute sur le serveur ${message.guild.name} pour la raison : ***${reason}***`).catch(() => {})
    }
}
