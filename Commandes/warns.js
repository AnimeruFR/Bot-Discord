const Discord = require('discord.js')
const { formatReason } = require('../Fonctions/moderation')
const db = require('../Fonctions/db')

module.exports = {
    name: "warns",
    description: "Affiche les avertissements d'un membre",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre dont on veut voir les warns",
            required: true
        }
    ],

    async run(bot, message, args) {
        const user = args.getUser("membre")
        const total = db.countWarns(message.guild.id, user.id)
        if (total === 0) return message.reply({ content: `${user} n'a aucun avertissement.`, flags: Discord.MessageFlags.Ephemeral })

        const warns = db.listWarns(message.guild.id, user.id, 10)
        const lignes = warns.map(w => {
            const date = Math.floor(w.created_at / 1000)
            return `**n°${w.id}** – <t:${date}:d> par <@${w.moderator_id}>\n${formatReason(w.reason).slice(0, 300)}`
        })

        const embed = new Discord.EmbedBuilder()
            .setColor(bot.color)
            .setTitle(`Avertissements de ${user.tag}`)
            .setThumbnail(user.displayAvatarURL())
            .setDescription(lignes.join("\n\n"))
            .setFooter({ text: total > 10 ? `${total} warns au total (10 derniers affichés)` : `${total} warn(s) au total` })

        await message.reply({ embeds: [embed], flags: Discord.MessageFlags.Ephemeral })
    }
}
