const Discord = require('discord.js')
const db = require('./db')
const { sendModLog } = require('./logs')
const { t } = require('./i18n')
const { ticketOwnerId, roleValide, categorieUtilisable } = require('./tickets')

const { Flags } = Discord.PermissionsBitField
const P = Discord.PermissionFlagsBits

// Validations partagées par les commandes (/setlogs, /setticket) et par /config :
// /config ne doit jamais permettre ce que les commandes interdisent.

// Même permission que /setticket pour tout ce qui touche aux tickets (catégorie, rôle staff, inactivité)
const PERMISSION_TICKETS = P.ManageGuild | P.ManageChannels | P.ManageRoles
const peutConfigurerTickets = interaction => Boolean(interaction.memberPermissions?.has(PERMISSION_TICKETS))

// Rôle staff du serveur (idée #1) : il ouvre des commandes de modération (warn, historique…),
// donc seul quelqu'un qui a lui-même « Gérer le serveur » et « Exclure temporairement » peut le choisir
const PERMISSION_CHOISIR_ROLE_STAFF = P.ManageGuild | P.ModerateMembers
const peutConfigurerStaff = interaction => Boolean(interaction.memberPermissions?.has(PERMISSION_CHOISIR_ROLE_STAFF))

// Salon de logs valable ? Renvoie un message d'erreur, ou null.
// cible : interaction (langue du membre) ; sans elle, français.
function refusSalonLogs(guild, channel, cible = null) {
    const L = cible ?? "fr"
    if (channel.type !== Discord.ChannelType.GuildText) return t(L, "tk.salon_textuel")
    if (ticketOwnerId(channel)) return t(L, "tk.salon_ticket")
    if (!channel.permissionsFor(guild.members.me)?.has([Flags.ViewChannel, Flags.SendMessages, Flags.EmbedLinks])) {
        return t(L, "tk.salon_ecrire", { salon: channel })
    }
    return null
}

// Change le salon de logs (null = désactive). Le changement est tracé dans l'ANCIEN salon (avant)
// et dans le NOUVEAU (après) : impossible de couper les logs discrètement le temps d'une sanction.
// Renvoie { erreur } ou { inchange } ou { ok, public_ }.
async function changerSalonLogs(interaction, channel) {
    const guild = interaction.guild
    if (channel) {
        const erreur = refusSalonLogs(guild, channel, interaction)
        if (erreur) return { erreur }
    }
    const ancien = db.getLogChannel(guild.id)
    if ((channel?.id ?? null) === ancien) return { inchange: true }

    const details = `Salon de logs : ${ancien ? `<#${ancien}>` : "aucun"} → ${channel ?? "aucun (logs désactivés)"}`
    await sendModLog(interaction, { action: "config", details })
    db.setLogChannel(guild.id, channel?.id ?? null)
    if (channel) await sendModLog(interaction, { action: "config", details })
    return { ok: true, public_: Boolean(channel?.permissionsFor(guild.roles.everyone)?.has(Flags.ViewChannel)) }
}

// Catégorie des tickets valable ? Renvoie un message d'erreur, ou null.
function refusCategorie(categorie, cible = null) {
    return categorieUtilisable(categorie) ? null : t(cible ?? "fr", "tk.categorie_refus", { categorie })
}

// Rôle staff des tickets valable pour ce membre ? (le membre de l'interaction : celui du clic, à jour)
function refusRoleStaff(interaction, role) {
    if (!roleValide(interaction.guild, role.id)) return t(interaction, "tk.role_invalide")
    // On ne donne pas l'accès aux tickets à un rôle égal ou supérieur au sien (ex : un rôle qu'on possède soi-même)
    if (interaction.user.id !== interaction.guild.ownerId && role.comparePositionTo(interaction.member.roles.highest) >= 0) {
        return t(interaction, "tk.role_superieur")
    }
    return null
}

module.exports = { PERMISSION_TICKETS, PERMISSION_CHOISIR_ROLE_STAFF, peutConfigurerTickets, peutConfigurerStaff, refusSalonLogs, changerSalonLogs, refusCategorie, refusRoleStaff }
