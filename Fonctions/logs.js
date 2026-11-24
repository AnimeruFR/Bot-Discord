const Discord = require('discord.js')
const db = require('./db')
const { formatReason } = require('./moderation')

const { Flags } = Discord.PermissionsBitField

const COULEURS = {
    ban: 0xE74C3C, unban: 0x2ECC71, kick: 0xE67E22, mute: 0xF1C40F, unmute: 0x2ECC71,
    warn: 0xF39C12, unwarn: 0x3498DB, clear: 0x95A5A6, ticket: 0x9B59B6, tempban: 0xC0392B,
    lock: 0x7F8C8D, unlock: 0x2ECC71, slowmode: 0x95A5A6, automod: 0x34495E, config: 0x3498DB
}

// Renvoie le salon de logs du serveur s'il existe encore et que le bot peut y écrire
function getLogChannel(guild) {
    const id = db.getLogChannel(guild.id)
    const channel = id ? guild.channels.cache.get(id) : null
    if (!channel?.isTextBased()) return null
    if (!channel.permissionsFor(guild.members.me)?.has([Flags.ViewChannel, Flags.SendMessages, Flags.EmbedLinks])) return null
    return channel
}

// Envoie une entrée dans le salon de logs. Ne lève jamais d'erreur : un log raté ne doit pas faire échouer l'action.
async function sendModLog(interaction, { action, cible, raison, details }) {
    try {
        const channel = getLogChannel(interaction.guild)
        if (!channel) return

        const embed = new Discord.EmbedBuilder()
            .setColor(COULEURS[action] ?? 0x95A5A6)
            .setTitle(`Modération : ${action}`)
            .addFields({ name: "Modérateur", value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true })
            .setTimestamp()

        if (cible) embed.addFields({ name: "Cible", value: `${cible} (\`${cible.id}\`)`, inline: true })
        if (raison !== undefined) embed.addFields({ name: "Raison", value: formatReason(raison).slice(0, 1024) })
        if (details) embed.addFields({ name: "Détails", value: String(details).slice(0, 1024) })

        await channel.send({ embeds: [embed] })
    } catch (err) {
        console.error("Impossible d'envoyer le log de modération :", err.message)
    }
}

module.exports = { sendModLog, getLogChannel }
