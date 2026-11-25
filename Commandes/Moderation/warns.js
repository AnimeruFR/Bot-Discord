const Discord = require('discord.js')
const { couleur } = require('../../Fonctions/apparence')
const { formatReason } = require('../../Fonctions/moderation')
const { t } = require('../../Fonctions/i18n')
const db = require('../../Fonctions/db')

module.exports = {
    name: "warns",
    description: "Affiche les avertissements d'un membre",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    // Le rôle staff du serveur (/config) suffit : aucune action avec les pouvoirs propres du bot
    roleStaffSuffit: true,
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
        if (total === 0) return message.reply({ content: t(message, "mod.warns.aucun", { user }), flags: Discord.MessageFlags.Ephemeral })

        const warns = db.listWarns(message.guild.id, user.id, 10)
        const lignes = warns.map(w => {
            const date = Math.floor(w.created_at / 1000)
            return t(message, "mod.warns.ligne", { id: w.id, date, moderateur: w.moderator_id, reason: formatReason(w.reason).slice(0, 300) })
        })

        const embed = new Discord.EmbedBuilder()
            .setColor(couleur(message.guild))
            .setTitle(t(message, "mod.warns.titre", { user: user.tag }))
            .setThumbnail(user.displayAvatarURL())
            .setDescription(lignes.join("\n\n"))
            .setFooter({ text: t(message, total > 10 ? "mod.warns.pied_plus" : "mod.warns.pied", { total }) })

        await message.reply({ embeds: [embed], flags: Discord.MessageFlags.Ephemeral })
    }
}
