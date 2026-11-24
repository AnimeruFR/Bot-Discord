const Discord = require('discord.js')
const { formatReason, auditReason, checkHierarchy } = require('../Fonctions/moderation')

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
        const user = args.getUser("membre")
        const member = args.getMember("membre")
        if (!member) return message.reply("Ce membre n'est pas sur le serveur !")

        const reason = formatReason(args.getString("raison"))

        const erreur = checkHierarchy(message, member, "kick")
        if (erreur) return message.reply(erreur)
        if (!member.kickable) return message.reply("Je ne peux pas kick ce membre (rôle trop haut pour moi) !")

        await user.send(`Tu as été kick du serveur ${message.guild.name} pour la raison : ***${reason}***`).catch(() => {})

        await member.kick(auditReason(message, args.getString("raison")))
        await message.reply(`${message.user} a kick ${user} pour la raison : ***${reason}***`)
    }
}
