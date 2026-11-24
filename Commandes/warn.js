const Discord = require('discord.js')
const { formatReason, checkHierarchy } = require('../Fonctions/moderation')

module.exports = {
    name: "warn",
    description: "Warn un membre",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre à warn",
            required: true
        }, {
            type: "string",
            name: "raison",
            description: "La raison du warn",
            required: false,
            maxLength: 400
        }
    ],

    async run(bot, message, args) {
        const user = args.getUser("membre")
        const member = args.getMember("membre")
        if (!member) return message.reply("Ce membre n'est pas sur le serveur !")

        const reason = formatReason(args.getString("raison"))

        const erreur = checkHierarchy(message, member, "warn")
        if (erreur) return message.reply(erreur)

        const prevenu = await user.send(`Tu as reçu un avertissement sur le serveur ${message.guild.name} pour la raison : ***${reason}***`)
            .then(() => true)
            .catch(() => false)

        await message.reply(`${message.user} a warn ${user} pour la raison : ***${reason}***${prevenu ? "" : "\n(Le membre n'a pas pu être prévenu en MP.)"}`)
    }
}
