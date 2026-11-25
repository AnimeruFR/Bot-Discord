const Discord = require('discord.js')
const { couleur } = require('../../Fonctions/apparence')
const { formatReason, formatDuree } = require('../../Fonctions/moderation')
const { t, langueDe } = require('../../Fonctions/i18n')
const db = require('../../Fonctions/db')

const AFFICHES = 10
const TYPES = ["warn", "unwarn", "mute", "unmute", "kick", "ban", "tempban", "unban"]

module.exports = {
    name: "historique",
    description: "Affiche l'historique des sanctions d'un membre",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    // Le rôle staff du serveur (/config) suffit : aucune action avec les pouvoirs propres du bot
    roleStaffSuffit: true,
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
        if (total === 0) return message.reply({ content: t(message, "mod.historique.aucune", { user }), flags: Discord.MessageFlags.Ephemeral })

        const tempban = db.getTempban(message.guild.id, user.id)
        // Raisons coupées à 200 caractères : 10 lignes restent sous la limite de 4096 caractères d'un embed
        const lignes = db.listCases(message.guild.id, user.id, AFFICHES).map(c => {
            const duree = c.duration_ms ? ` (${formatDuree(c.duration_ms, langueDe(message))})` : ""
            const auto = c.auto ? t(message, "mod.historique.auto") : ""
            const nom = TYPES.includes(c.type) ? t(message, `mod.type.${c.type}`) : c.type
            return t(message, "mod.historique.ligne", { id: c.id, nom, duree, date: Math.floor(c.created_at / 1000), moderateur: c.moderator_id, auto, reason: formatReason(c.reason).slice(0, 200) })
        })
        if (tempban) lignes.unshift(t(message, "mod.historique.tempban_en_cours", { fin: Math.floor(tempban / 1000) }))

        const embed = new Discord.EmbedBuilder()
            .setColor(couleur(message.guild))
            .setTitle(t(message, "mod.historique.titre", { user: user.tag }))
            .setThumbnail(user.displayAvatarURL())
            .setDescription(lignes.join("\n\n").slice(0, 4096))
            .setFooter({ text: t(message, total > AFFICHES ? "mod.historique.pied_plus" : "mod.historique.pied", { total, affiches: AFFICHES }) })

        await message.reply({ embeds: [embed], flags: Discord.MessageFlags.Ephemeral })
    }
}
