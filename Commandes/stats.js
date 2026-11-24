const Discord = require('discord.js')
const { couleur } = require('../Fonctions/apparence')
const { formatDuree } = require('../Fonctions/moderation')
const db = require('../Fonctions/db')

const JOUR = 24 * 60 * 60 * 1000

// Statistiques calculées à partir des lignes de tickets (fonction pure, testée dans check.js)
function calculerStats(tickets, types) {
    const nomType = id => types.find(t => t.id === id)?.nom ?? "Sans type"
    const pris = tickets.filter(t => t.claimed_at)
    const notes = tickets.filter(t => t.rating)
    const parType = new Map()
    const parStaff = new Map()
    for (const t of tickets) parType.set(nomType(t.type_id), (parType.get(nomType(t.type_id)) ?? 0) + 1)
    for (const t of pris.filter(t => t.claimed_by)) parStaff.set(t.claimed_by, (parStaff.get(t.claimed_by) ?? 0) + 1)
    return {
        total: tickets.length,
        enCours: tickets.filter(t => t.status === "ouvert").length,
        fermes: tickets.filter(t => t.status !== "ouvert").length,
        delaiPriseEnCharge: pris.length ? pris.reduce((s, t) => s + (t.claimed_at - t.created_at), 0) / pris.length : null,
        noteMoyenne: notes.length ? notes.reduce((s, t) => s + t.rating, 0) / notes.length : null,
        nombreNotes: notes.length,
        parType: [...parType.entries()].sort((a, b) => b[1] - a[1]),
        topStaff: [...parStaff.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    }
}

module.exports = {
    name: "stats",
    description: "Statistiques des tickets sur les 30 derniers jours",
    permission: Discord.PermissionFlagsBits.ManageGuild,
    dm: false,
    category: "Information",
    options: [],
    calculerStats,

    async run(bot, message) {
        const guildId = message.guild.id
        const s = calculerStats(db.ticketsSince(guildId, Date.now() - 30 * JOUR), db.listTicketTypes(guildId))
        if (s.total === 0) return message.reply({ content: "Aucun ticket ouvert ces 30 derniers jours.", flags: Discord.MessageFlags.Ephemeral })

        const embed = new Discord.EmbedBuilder()
            .setColor(couleur(message.guild))
            .setTitle("Tickets – 30 derniers jours")
            .addFields(
                { name: "Ouverts", value: String(s.total), inline: true },
                { name: "En cours", value: String(s.enCours), inline: true },
                { name: "Fermés", value: String(s.fermes), inline: true },
                { name: "Prise en charge moyenne", value: s.delaiPriseEnCharge === null ? "—" : formatDuree(Math.max(1000, s.delaiPriseEnCharge)), inline: true },
                { name: "Note moyenne", value: s.noteMoyenne === null ? "—" : `${s.noteMoyenne.toFixed(1)} / 5 (${s.nombreNotes} note(s))`, inline: true },
                // Noms de types écrits par les admins : échappés pour ne pas casser la mise en forme
                { name: "Par type", value: s.parType.map(([nom, n]) => `${Discord.escapeMarkdown(nom)} : ${n}`).join("\n").slice(0, 1024) },
                { name: "Staff le plus actif", value: s.topStaff.length ? s.topStaff.map(([id, n], i) => `${i + 1}. <@${id}> : ${n}`).join("\n") : "Aucune prise en charge" }
            )
            .setFooter({ text: "Tickets suivis depuis la mise à jour du lot F" })

        await message.reply({ embeds: [embed], flags: Discord.MessageFlags.Ephemeral })
    }
}
