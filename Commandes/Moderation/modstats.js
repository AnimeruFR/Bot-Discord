const Discord = require('discord.js')
const { couleur } = require('../../Fonctions/apparence')
const { t, langueDe } = require('../../Fonctions/i18n')
const { formatDuree } = require('../../Fonctions/moderation')
const { nomType } = require('../../Fonctions/cases')
const { estPremium, boutonAchat } = require('../../Fonctions/premium')
const { PERIODES_STATS, PERIODES_GRATUITES, statsModeration } = require('../../Fonctions/statsMod')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const TOP = 10

// « Ban : 3, Mute : 1 » (types les plus fréquents d'abord)
const detail = (message, types) => Object.entries(types).sort((a, b) => b[1] - a[1]).map(([type, n]) => `${nomType(message, type)} : ${n}`).join(", ")

module.exports = {
    name: "modstats",
    description: "Statistiques de modération : actions par modérateur, prise en charge des tickets",
    permission: Discord.PermissionFlagsBits.ManageGuild,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "string",
            name: "periode",
            description: "Période analysée (30 jours par défaut ; 90 et 365 jours : premium)",
            required: false,
            choices: [
                { name: "7 jours", value: "7" },
                { name: "30 jours", value: "30" },
                { name: "90 jours (premium)", value: "90" },
                { name: "365 jours (premium)", value: "365" }
            ]
        }
    ],

    async run(bot, message, args) {
        const periode = args.getString("periode") ?? "30"
        const duree = PERIODES_STATS[periode]
        if (!duree) return message.reply({ content: t(message, "stats.modstats.aucune"), flags: EPHEMERAL })
        if (!PERIODES_GRATUITES.includes(periode) && !await estPremium(bot, message.guildId, message)) {
            return message.reply({
                content: t(message, "premium.requis", { fonction: t(message, "stats.modstats.fonction_premium") }),
                components: boutonAchat(), flags: EPHEMERAL
            })
        }

        const s = statsModeration(message.guild.id, bot.user.id, Date.now() - duree)
        const embed = new Discord.EmbedBuilder()
            .setColor(couleur(message.guild))
            .setTitle(t(message, "stats.modstats.titre", { jours: periode }))
        if (!s.moderateurs.length && !s.auto.total && !s.ticketsPris) {
            return message.reply({ content: t(message, "stats.modstats.aucune"), flags: EPHEMERAL })
        }

        embed.addFields({
            name: t(message, "stats.modstats.moderateurs"),
            value: s.moderateurs.length
                ? s.moderateurs.slice(0, TOP).map((m, i) => `${i + 1}. <@${m.id}> : **${m.total}** (${detail(message, m.types)})`).join("\n").slice(0, 1024)
                : t(message, "stats.modstats.aucun_moderateur")
        })
        if (s.moderateurs.length > TOP) embed.setFooter({ text: t(message, "stats.modstats.pied_top", { top: TOP, total: s.moderateurs.length }) })
        embed.addFields(
            { name: t(message, "stats.modstats.auto"), value: s.auto.total ? `**${s.auto.total}** (${detail(message, s.auto.types)})`.slice(0, 1024) : "0", inline: true },
            {
                name: t(message, "stats.modstats.mediane"),
                value: s.medianePriseEnCharge === null ? "—" : t(message, "stats.modstats.mediane_valeur", {
                    duree: formatDuree(Math.max(1000, s.medianePriseEnCharge), langueDe(message)), tickets: s.ticketsPris
                }),
                inline: true
            }
        )
        await message.reply({ embeds: [embed], flags: EPHEMERAL, allowedMentions: { parse: [] } })
    }
}
