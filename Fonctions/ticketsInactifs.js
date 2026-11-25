const db = require('./db')
const { sendModLog } = require('./logs')
const { ticketOwnerId, fermerPourAuteur, retirerAccesAuteur, accesAuteurRetire } = require('./tickets')

const HEURE = 60 * 60 * 1000
const JOUR = 24 * HEURE
const DELAI_APRES_AVERTISSEMENT = JOUR

// Date du dernier message d'un humain dans le salon (les messages du bot ne comptent pas :
// sinon l'avertissement lui-même relancerait le compteur). Sans message humain récent : date de création.
async function derniereActivite(channel) {
    const messages = await channel.messages.fetch({ limit: 50, cache: false })
    const humain = messages.find(m => !m.author.bot)
    if (humain) return humain.createdTimestamp
    // 50 messages de bots d'affilée : on prend le plus ancien lu, pour ne pas avertir trop tôt
    return messages.size === 50 ? Math.min(...messages.map(m => m.createdTimestamp)) : channel.createdTimestamp
}

// Remet la base d'accord avec Discord pour les tickets pas encore supprimés :
// - salon disparu (supprimé pendant que le bot était éteint) -> "supprime" (sinon la ligne ne serait jamais purgée) ;
// - salon "ferme-…" dont l'auteur a encore accès (fermeture interrompue) -> on termine la fermeture.
async function reconcilier(bot) {
    for (const ticket of db.unfinishedTickets()) {
        const guild = bot.guilds.cache.get(ticket.guild_id)
        if (!guild?.available) continue // autre shard, panne : on ne conclut rien
        const channel = guild.channels.cache.get(ticket.channel_id)
        if (!channel) {
            db.setTicketStatus(ticket.channel_id, "supprime")
            continue
        }
        if (!channel.name.startsWith("ferme-")) continue
        try {
            if (!accesAuteurRetire(channel, ticket.owner_id)) await retirerAccesAuteur(channel, ticket.owner_id, "Fin de la fermeture du ticket")
            if (ticket.status !== "ferme") db.setTicketStatus(channel.id, "ferme")
        } catch (err) {
            console.error(`Fermeture du ticket ${channel.id} à terminer :`, err.message)
        }
    }
}

// Un passage : avertit les tickets inactifs depuis X jours, ferme ceux restés sans réponse 24 h après.
// Renvoie { avertis, fermes } (pour les tests).
async function traiterInactifs(bot, maintenant = Date.now()) {
    const bilan = { avertis: 0, fermes: 0 }
    await reconcilier(bot)

    for (const { guild_id: guildId, ticket_inactivity_days: jours } of db.guildsWithTicketInactivity()) {
        const guild = bot.guilds.cache.get(guildId)
        if (!guild?.available) continue

        for (const ticket of db.openTicketsOf(guildId)) {
            try {
                const channel = guild.channels.cache.get(ticket.channel_id)
                const ownerId = ticketOwnerId(channel)
                if (!channel || !ownerId || channel.name.startsWith("ferme-")) continue

                const activite = await derniereActivite(channel)

                if (ticket.warned_at) {
                    if (activite > ticket.warned_at) {
                        db.setTicketWarned(channel.id, null) // quelqu'un a répondu : avertissement annulé
                    } else if (maintenant - ticket.warned_at >= DELAI_APRES_AVERTISSEMENT) {
                        await fermerPourAuteur(channel, ownerId, `Ticket inactif depuis plus de ${jours} jour(s)`)
                        await channel.send("🔒 Ticket fermé automatiquement pour inactivité. Le staff peut maintenant le supprimer.").catch(() => {})
                        await sendModLog({ guild, user: bot.user }, { action: "ticket", details: `Ticket ${channel} fermé pour inactivité (${jours} jour(s) sans message).` })
                        bilan.fermes++
                    }
                    continue
                }

                if (maintenant - activite >= jours * JOUR) {
                    const avertissement = await channel.send(`⏰ <@${ownerId}>, ce ticket est sans message depuis ${jours} jour(s). Sans réponse dans les 24 h, il sera fermé automatiquement.`)
                    db.setTicketWarned(channel.id, maintenant, avertissement.id)
                    bilan.avertis++
                }
            } catch (err) {
                // Permission manquante, limite de renommage… : on réessaiera au prochain passage
                console.error(`Tickets inactifs (${ticket.channel_id}) :`, err.message)
            }
        }
    }
    return bilan
}

function startTicketInactivitySchedule(bot) {
    let enCours = false
    const tourner = async () => {
        if (enCours) return
        enCours = true
        try {
            await traiterInactifs(bot)
        } catch (err) {
            console.error("Erreur pendant la vérification des tickets :", err.message)
        } finally {
            enCours = false
        }
    }
    tourner()
    return setInterval(tourner, HEURE).unref()
}

module.exports = { traiterInactifs, reconcilier, startTicketInactivitySchedule, derniereActivite, DELAI_APRES_AVERTISSEMENT }
