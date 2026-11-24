const Discord = require('discord.js')
const db = require('./db')

const { Flags } = Discord.PermissionsBitField
const MAX_PAR_MINUTE = 10 // par serveur : au-delà (raid), les messages suivants sont ignorés
const envois = new Map() // serveur -> dates des derniers messages

// Remplace {membre}, {serveur} et {nombre} dans le message écrit par un administrateur
function rendre(message, { membre, serveur, nombre }) {
    return message
        .replaceAll("{membre}", membre)
        .replaceAll("{serveur}", Discord.escapeMarkdown(serveur))
        .replaceAll("{nombre}", String(nombre))
        .slice(0, 2000)
}

// Anti-raid : true si le serveur a encore le droit d'envoyer un message cette minute
function autorise(guildId, maintenant = Date.now()) {
    const recents = (envois.get(guildId) ?? []).filter(t => maintenant - t < 60000)
    if (recents.length >= MAX_PAR_MINUTE) {
        envois.set(guildId, recents)
        return false
    }
    recents.push(maintenant)
    envois.set(guildId, recents)
    return true
}

// Salon configuré, s'il existe encore et que le bot peut y écrire
function salonUtilisable(guild, channelId) {
    const channel = channelId ? guild.channels.cache.get(channelId) : null
    if (!channel?.isTextBased()) return null
    return channel.permissionsFor(guild.members.me)?.has([Flags.ViewChannel, Flags.SendMessages]) ? channel : null
}

// type : "bienvenue" (arrivée) ou "aurevoir" (départ). Ne lève jamais d'erreur.
async function envoyer(member, type, { test = false } = {}) {
    try {
        const config = db.getWelcome(member.guild.id)[type]
        if (!config) return "desactive"
        const channel = salonUtilisable(member.guild, config.channelId)
        if (!channel) return "salon"
        if (!test && !autorise(member.guild.id)) return "raid"

        const user = member.user
        // Arrivée : mention du nouveau membre (seul lui est notifié). Départ : son pseudo, sans mention.
        const membre = type === "bienvenue" ? `<@${user.id}>` : `**${Discord.escapeMarkdown(user.username)}**`
        const contenu = rendre(config.message, { membre, serveur: member.guild.name, nombre: member.guild.memberCount })
        await channel.send({ content: contenu, allowedMentions: { parse: [], users: type === "bienvenue" ? [user.id] : [] } })
        return "envoye"
    } catch (err) {
        console.error(`Message de ${type} impossible :`, err.message)
        return "erreur"
    }
}

module.exports = { rendre, autorise, envoyer, salonUtilisable, MAX_PAR_MINUTE }
