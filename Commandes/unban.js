const Discord = require('discord.js')
const { formatReason, auditReason } = require('../Fonctions/moderation')

module.exports = {
    name: "unban",
    description: "Déban un membre",
    permission: Discord.PermissionFlagsBits.BanMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "utilisateur",
            description: "L'utilisateur à débannir",
            required: true
        }, {
            type: "string",
            name: "raison",
            description: "La raison du débannissement",
            required: false,
            maxLength: 400
        }
    ],

    async run(bot, message, args) {
        const user = args.getUser("utilisateur")
        const reason = formatReason(args.getString("raison"))

        if (!await message.guild.bans.fetch(user.id).catch(() => null)) return message.reply("Cet utilisateur n'est pas banni !")

        await message.guild.members.unban(user, auditReason(message, args.getString("raison")))
        await message.reply(`${message.user} a unban ${user.tag} pour la raison : ***${reason}***`)
    }
}
