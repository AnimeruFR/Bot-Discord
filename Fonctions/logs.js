const Discord = require('discord.js')
const db = require('./db')
const { formatReason } = require('./moderation')

const { Flags } = Discord.PermissionsBitField

const COULEURS = {
    ban: 0xE74C3C, unban: 0x2ECC71, kick: 0xE67E22, mute: 0xF1C40F, unmute: 0x2ECC71,
    warn: 0xF39C12, unwarn: 0x3498DB, clear: 0x95A5A6, ticket: 0x9B59B6, tempban: 0xC0392B,
    lock: 0x7F8C8D, unlock: 0x2ECC71, slowmode: 0x95A5A6, automod: 0x34495E, config: 0x3498DB,
    roles: 0x5865F2, giveaway: 0xF1C40F, annonce: 0x1ABC9C, sondage: 0x1ABC9C
}

// Salons de logs séparés (idée #24) : chaque famille peut avoir son salon (/setlogs famille:…).
// Sans salon pour sa famille, un log va dans le salon général, SAUF les familles « sans repli » :
// le spam des jeux et de l'économie ne doit jamais noyer les alertes de modération. Les signalements en font partie :
// l'identité du signaleur ne doit jamais atterrir dans un salon plus large que celui choisi pour eux.
const FAMILLES = ["sanctions", "automod", "tickets", "membres", "signalements", "animation", "config", "jeux", "economie"]
const SANS_REPLI = ["jeux", "economie", "signalements"]

// Famille d'une action de sendModLog (action inconnue : sanctions)
const FAMILLE_ACTION = {
    automod: "automod", ticket: "tickets", config: "config",
    roles: "animation", giveaway: "animation", annonce: "animation", sondage: "animation",
    filtre: "membres", signalement: "signalements"
}
const familleDe = action => FAMILLE_ACTION[action] ?? "sanctions"

// Requêtes de la table log_channels (migration 004), préparées à la première utilisation
const lireFamille = (guildId, famille) => db.sqlAll("SELECT channel_id FROM log_channels WHERE guild_id = ? AND famille = ?", [guildId, famille])[0]?.channel_id ?? null

function salonsFamilles(guildId) {
    return Object.fromEntries(db.sqlAll("SELECT famille, channel_id FROM log_channels WHERE guild_id = ?", [guildId]).map(l => [l.famille, l.channel_id]))
}

// Salon d'une famille (null : la famille suit le salon général, ou n'a pas de logs si elle est sans repli)
function setSalonFamille(guildId, famille, channelId) {
    if (!FAMILLES.includes(famille)) throw new Error(`Famille de logs inconnue : ${famille}`)
    if (channelId) db.sqlRun(`INSERT INTO log_channels (guild_id, famille, channel_id) VALUES (?, ?, ?)
        ON CONFLICT (guild_id, famille) DO UPDATE SET channel_id = excluded.channel_id`, [guildId, famille, channelId])
    else db.sqlRun("DELETE FROM log_channels WHERE guild_id = ? AND famille = ?", [guildId, famille])
}

// Renvoie le salon de logs d'une famille (ou le salon général) s'il existe encore et que le bot peut y écrire
function getLogChannel(guild, famille = "sanctions") {
    const id = lireFamille(guild.id, famille) ?? (SANS_REPLI.includes(famille) ? null : db.getLogChannel(guild.id))
    const channel = id ? guild.channels.cache.get(id) : null
    if (!channel?.isTextBased()) return null
    if (!channel.permissionsFor(guild.members.me)?.has([Flags.ViewChannel, Flags.SendMessages, Flags.EmbedLinks])) return null
    return channel
}

// Envoie une entrée dans le salon de logs. Ne lève jamais d'erreur : un log raté ne doit pas faire échouer l'action.
async function sendModLog(interaction, { action, cible, raison, details, famille = familleDe(action) }) {
    try {
        const channel = getLogChannel(interaction.guild, famille)
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

// Envoie un embed déjà construit dans le salon d'une famille (événements sans modérateur : AutoMod, arrivées…).
// Ne lève jamais d'erreur. Renvoie true si le log est parti.
async function envoyerLog(guild, famille, embed) {
    try {
        const channel = getLogChannel(guild, famille)
        if (!channel) return false
        await channel.send({ embeds: [embed] })
        return true
    } catch (err) {
        console.error(`Impossible d'envoyer le log (${famille}) :`, err.message)
        return false
    }
}

module.exports = { sendModLog, envoyerLog, getLogChannel, setSalonFamille, salonsFamilles, familleDe, FAMILLES, SANS_REPLI, COULEURS }
