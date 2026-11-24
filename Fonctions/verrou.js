const Discord = require('discord.js')
const db = require('./db')

const { Flags } = Discord.PermissionsBitField

// Permissions de @everyone retirées par /lock (et seulement celles-ci : /unlock ne touche à rien d'autre)
const DROITS_VERROU = ["SendMessages", "SendMessagesInThreads", "CreatePublicThreads", "CreatePrivateThreads", "AddReactions"]

const TYPES_VERROUILLABLES = [
    Discord.ChannelType.GuildText,
    Discord.ChannelType.GuildAnnouncement,
    Discord.ChannelType.GuildVoice
]

// Vérifications communes à /lock et /unlock. Renvoie un message d'erreur, ou null.
function verifierDroits(interaction, channel) {
    if (!TYPES_VERROUILLABLES.includes(channel.type)) return "Seuls les salons textuels, d'annonces et vocaux peuvent être verrouillés."
    // Modifier les permissions d'un salon demande « Gérer les salons » ET « Gérer les permissions » :
    // sans la 2e, un modérateur obtiendrait par le bot un droit qu'il n'a pas
    if (!channel.permissionsFor(interaction.member)?.has([Flags.ViewChannel, Flags.ManageChannels, Flags.ManageRoles])) {
        return `Il vous faut les permissions « Gérer les salons » et « Gérer les permissions » dans ${channel}.`
    }
    // Discord refuse qu'un bot (non administrateur) modifie une permission qu'il n'a pas lui-même
    const besoin = [Flags.ViewChannel, Flags.ManageChannels, Flags.ManageRoles, ...DROITS_VERROU.map(d => Flags[d])]
    if (!channel.permissionsFor(interaction.guild.members.me)?.has(besoin)) {
        return `Il me faut dans ${channel} : Voir le salon, Gérer les salons, Gérer les permissions, Envoyer des messages (y compris dans les fils), Créer des fils et Ajouter des réactions.`
    }
    return null
}

// État actuel des droits de @everyone : true (autorisé), false (refusé) ou null (neutre)
function etatEveryone(channel) {
    const overwrite = channel.permissionOverwrites.cache.get(channel.guild.id)
    const etat = {}
    for (const droit of DROITS_VERROU) {
        if (overwrite?.allow.has(Flags[droit])) etat[droit] = true
        else if (overwrite?.deny.has(Flags[droit])) etat[droit] = false
        else etat[droit] = null
    }
    return etat
}

// Rôles et membres qui gardent le droit d'écrire malgré le verrou (leur autorisation l'emporte sur @everyone)
function rolesQuiEcriventEncore(channel) {
    return channel.permissionOverwrites.cache
        .filter(o => o.id !== channel.guild.id && o.allow.has(Flags.SendMessages))
        .map(o => o.type === Discord.OverwriteType.Member ? `<@${o.id}>` : `<@&${o.id}>`)
}

// Salons en cours de /lock ou /unlock : un /unlock lancé pendant un /lock (ou l'inverse) attend son tour
const enCours = new Set()
async function exclusif(channel, action) {
    if (enCours.has(channel.id)) return "occupe"
    enCours.add(channel.id)
    try {
        return await action()
    } finally {
        enCours.delete(channel.id)
    }
}

// Renvoie true, false (déjà verrouillé) ou "occupe" (une autre commande agit sur ce salon)
function verrouiller(channel, raison) {
    return exclusif(channel, async () => {
        const avant = etatEveryone(channel)
        // Enregistré avant de modifier : deux /lock simultanés -> un seul passe
        if (!db.addLock(channel.guild.id, channel.id, avant)) return false
        try {
            await channel.permissionOverwrites.edit(channel.guild.roles.everyone,
                Object.fromEntries(DROITS_VERROU.map(d => [d, false])), { reason: raison })
        } catch (err) {
            db.removeLock(channel.guild.id, channel.id)
            throw err
        }
        return true
    })
}

// Remet les 5 droits dans leur état d'avant /lock (les autres changements faits entre-temps sont gardés)
function deverrouiller(channel, raison) {
    return exclusif(channel, async () => {
        const avant = db.getLock(channel.guild.id, channel.id)
        if (!avant) return false
        const restauration = Object.fromEntries(DROITS_VERROU.map(d => [d, avant[d] ?? null]))
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, restauration, { reason: raison })
        db.removeLock(channel.guild.id, channel.id)
        return true
    })
}

module.exports = { verifierDroits, verrouiller, deverrouiller, etatEveryone, rolesQuiEcriventEncore, DROITS_VERROU, TYPES_VERROUILLABLES }
