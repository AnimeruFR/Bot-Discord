const Discord = require('discord.js')
const { formatReason, auditReason, checkHierarchy } = require('../Fonctions/moderation')

module.exports = {
    name: "ban",
    description: "Ban un membre",
    permission: Discord.PermissionFlagsBits.BanMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre à bannir",
            required: true
        }, {
            type: "string",
            name: "raison",
            description: "La raison du bannissement",
            required: true,
            maxLength: 400
        }
    ],

    async run(bot, message, args) {
        const user = args.getUser("membre")
        const reason = formatReason(args.getString("raison"))

        // On récupère toujours le membre (même hors cache) pour ne jamais sauter la vérification de hiérarchie
        const member = args.getMember("membre") ?? await message.guild.members.fetch(user.id).catch(() => null)

        if (member) {
            const erreur = checkHierarchy(message, member, "bannir")
            if (erreur) return message.reply(erreur)
            if (!member.bannable) return message.reply("Je ne peux pas bannir ce membre (rôle trop haut pour moi) !")
        } else if (user.id === message.user.id) {
            return message.reply("Vous ne pouvez pas vous bannir vous-même !")
        }

        if (await message.guild.bans.fetch(user.id).catch(() => null)) return message.reply("Ce membre est déjà banni !")

        // Le MP doit partir avant le ban, sinon le bot ne partage plus de serveur avec lui
        if (member) await user.send(`Tu as été banni du serveur ${message.guild.name} pour la raison : ***${reason}***`).catch(() => {})

        await message.guild.bans.create(user.id, { reason: auditReason(message, args.getString("raison")) })
        await message.reply(`${message.user} a banni ${user} pour la raison : ***${reason}***`)
    }
}
