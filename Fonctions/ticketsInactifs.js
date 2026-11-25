const db = require('./db')
const { t, langueDe } = require('./i18n')
const { sendModLog } = require('./logs')
const { formatDuree } = require('./moderation')
const { ticketOwnerId, fermerPourAuteur, retirerAccesAuteur, accesAuteurRetire, roleValide, staffRoleId, ajouterEvenement } = require('./tickets')

const HEURE = 60 * 60 * 1000
const JOUR = 24 * HEURE
const DELAI_APRES_AVERTISSEMENT = JOUR
const MINUTE = 60 * 1000

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
                        await channel.send(t(guild, "tk.inactif_ferme")).catch(() => {})
                        await sendModLog({ guild, user: bot.user }, { action: "ticket", details: `Ticket ${channel} fermé pour inactivité (${jours} jour(s) sans message).` })
                        bilan.fermes++
                    }
                    continue
                }

                if (maintenant - activite >= jours * JOUR) {
                    const avertissement = await channel.send(t(guild, "tk.inactif_avert", { auteur: `<@${ownerId}>`, jours }))
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

// Délai cible (SLA) : alerte, une seule fois, les tickets ouverts jamais pris en charge dont l'âge dépasse le délai de leur type.
// Renvoie le nombre d'alertes envoyées (pour les tests).
async function traiterSla(bot, maintenant = Date.now()) {
    let alertes = 0
    const retards = db.sqlAll(`SELECT tk.channel_id, tk.guild_id, tk.staff_role_id, ty.nom AS type_nom, ty.sla_minutes
        FROM tickets tk JOIN ticket_types ty ON ty.guild_id = tk.guild_id AND ty.id = tk.type_id
        WHERE tk.status = 'ouvert' AND tk.claimed_by IS NULL AND tk.claimed_at IS NULL AND tk.sla_alerted_at IS NULL
        AND ty.sla_minutes IS NOT NULL AND tk.created_at + ty.sla_minutes * 60000 <= ?`, [maintenant])

    for (const ticket of retards) {
        try {
            const guild = bot.guilds.cache.get(ticket.guild_id)
            if (!guild?.available) continue
            const channel = guild.channels.cache.get(ticket.channel_id)
            if (!channel || !ticketOwnerId(channel) || channel.name.startsWith("ferme-")) continue

            // Écrit avant l'envoi : si le bot plante entre les deux, l'alerte ne sera pas répétée
            if (db.sqlRun("UPDATE tickets SET sla_alerted_at = ? WHERE channel_id = ? AND sla_alerted_at IS NULL", [maintenant, ticket.channel_id]) === 0) continue
            ajouterEvenement(ticket.guild_id, ticket.channel_id, bot.user.id, "sla_alerte", `${ticket.type_nom} : ${ticket.sla_minutes} min`)

            // Rôle staff figé sur le ticket, sinon le rôle de /setticket ou du .env : lui seul peut être mentionné
            const role = roleValide(guild, ticket.staff_role_id)?.id ?? staffRoleId(guild)
            const delai = formatDuree(ticket.sla_minutes * MINUTE, langueDe(guild))
            await channel.send({
                content: t(guild, role ? "tk.sla_alerte" : "tk.sla_alerte_sans_role", { role: `<@&${role}>`, delai }),
                allowedMentions: { parse: [], roles: role ? [role] : [] }
            })
            alertes++
        } catch (err) {
            console.error(`Délai cible du ticket ${ticket.channel_id} :`, err.message)
        }
    }
    return alertes
}

// Deux passages : les tickets inactifs toutes les heures, les délais cibles (à partir de 5 minutes) toutes les 5 minutes
function startTicketInactivitySchedule(bot) {
    const garde = (nom, fonction) => {
        let enCours = false
        return async () => {
            if (enCours) return
            enCours = true
            try {
                await fonction(bot)
            } catch (err) {
                console.error(`Erreur pendant la vérification des tickets (${nom}) :`, err.message)
            } finally {
                enCours = false
            }
        }
    }
    const inactifs = garde("inactivité", traiterInactifs)
    const sla = garde("délai cible", traiterSla)
    inactifs()
    sla()
    setInterval(sla, 5 * MINUTE).unref()
    return setInterval(inactifs, HEURE).unref()
}

module.exports = { traiterInactifs, traiterSla, reconcilier, startTicketInactivitySchedule, derniereActivite, DELAI_APRES_AVERTISSEMENT }
