const Discord = require('discord.js')
const { formatReason, formatDuree } = require('../Fonctions/moderation')
const db = require('../Fonctions/db')

const AFFICHES = 10
const NOMS = {
    warn: "Avertissement", unwarn: "Warn retiré", mute: "Mute", unmute: "Unmute",
    kick: "Kick", ban: "Ban", tempban: "Ban temporaire", unban: "Déban"
}

module.exports = {
    name: "historique",
    description: "Affiche l'historique des sanctions d'un membre",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre dont on veut voir l'historique",
            required: true
        }
    ],

    async run(bot, message, args) {
        const user = args.getUser("membre")
        const total = db.countCases(message.guild.id, user.id)
        if (total === 0) return message.reply({ content: `${user} n'a aucune sanction enregistrée.`, flags: Discord.MessageFlags.Ephemeral })

        const tempban = db.getTempban(message.guild.id, user.id)
        // Raisons coupées à 200 caractères : 10 lignes restent sous la limite de 4096 caractères d'un embed
        const lignes = db.listCases(message.guild.id, user.id, AFFICHES).map(c => {
            const duree = c.duration_ms ? ` (${formatDuree(c.duration_ms)})` : ""
            const auto = c.auto ? " · automatique" : ""
            return `**n°${c.id} – ${NOMS[c.type] ?? c.type}${duree}** – <t:${Math.floor(c.created_at / 1000)}:d> par <@${c.moderator_id}>${auto}\n${formatReason(c.reason).slice(0, 200)}`
        })
        if (tempban) lignes.unshift(`⏳ Ban temporaire en cours, fin <t:${Math.floor(tempban / 1000)}:R>`)

        const embed = new Discord.EmbedBuilder()
            .setColor(bot.color)
            .setTitle(`Historique de ${user.tag}`)
            .setThumbnail(user.displayAvatarURL())
            .setDescription(lignes.join("\n\n").slice(0, 4096))
            .setFooter({ text: total > AFFICHES ? `${total} sanctions au total (${AFFICHES} dernières affichées)` : `${total} sanction(s) au total` })

        await message.reply({ embeds: [embed], flags: Discord.MessageFlags.Ephemeral })
    }
}
