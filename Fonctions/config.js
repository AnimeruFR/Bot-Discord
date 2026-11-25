const Discord = require('discord.js')
const db = require('./db')
const { sendModLog, setSalonFamille, salonsFamilles, FAMILLES, SANS_REPLI } = require('./logs')
const { getFiltreComptes, setFiltreComptes, ACTIONS_FILTRE, AGE_MIN_JOURS, AGE_MAX_JOURS } = require('./antiraid')
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

// Modules et salons de jeux : changer ce que tout le serveur peut faire est réservé aux administrateurs
const peutConfigurerModules = interaction => Boolean(interaction.user.id === interaction.guild?.ownerId || interaction.memberPermissions?.has(Flags.Administrator))

// Âges proposés pour le filtre des comptes récents (en jours)
const AGES_FILTRE = [1, 3, 7, 14, 30]

// Permissions qu'un rôle « en attente » ne doit jamais avoir : sinon le filtre donnerait du pouvoir à des comptes neufs
const PERMISSIONS_MODERATION = P.Administrator | P.ManageGuild | P.ManageRoles | P.ManageChannels | P.ManageWebhooks | P.ManageMessages | P.ManageThreads
    | P.KickMembers | P.BanMembers | P.ModerateMembers | P.ManageNicknames | P.MentionEveryone | P.ViewAuditLog

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

// Salon de logs d'une famille (sanctions, automod…) : mêmes vérifications que le salon général.
// channel null : la famille repasse au salon général (ou n'a plus de logs, pour jeux et économie).
// Renvoie { erreur } ou { inchange } ou { ok, public_ }.
async function changerSalonFamille(interaction, famille, channel) {
    const guild = interaction.guild
    if (!FAMILLES.includes(famille)) return { erreur: t(interaction, "commun.erreur") }
    if (channel) {
        const erreur = refusSalonLogs(guild, channel, interaction)
        if (erreur) return { erreur }
    }
    const ancien = salonsFamilles(guild.id)[famille] ?? null
    if ((channel?.id ?? null) === ancien) return { inchange: true }

    const apres = channel ?? (SANS_REPLI.includes(famille) ? "aucun (pas de logs)" : "salon général")
    const details = `Salon de logs « ${famille} » : ${ancien ? `<#${ancien}>` : "salon général"} → ${apres}`
    // Log dans l'ancien salon avant le changement, puis dans le nouveau s'il en a un (comme changerSalonLogs)
    await sendModLog(interaction, { action: "config", details })
    setSalonFamille(guild.id, famille, channel?.id ?? null)
    if (channel) await sendModLog(interaction, { action: "config", details })
    return { ok: true, public_: Boolean(channel?.permissionsFor(guild.roles.everyone)?.has(Flags.ViewChannel)) }
}

// Rôle « en attente » du filtre des comptes récents valable ? Renvoie un message d'erreur, ou null.
function refusRoleFiltre(interaction, role) {
    const guild = interaction.guild
    if (!roleValide(guild, role.id)) return t(interaction, "config.filtre_role_invalide")
    if (role.permissions.any(PERMISSIONS_MODERATION)) return t(interaction, "config.filtre_role_pouvoir")
    // Jamais plus de pouvoir par le bot que celui qui règle le filtre : « Gérer les rôles » et un rôle strictement sous le sien
    const proprietaire = interaction.user.id === guild.ownerId
    if (!proprietaire && !interaction.memberPermissions?.has(Flags.ManageRoles)) return t(interaction, "config.filtre_roles_membre")
    const refusPosition = refusRoleStaff(interaction, role)
    if (refusPosition) return refusPosition
    // Le bot doit pouvoir donner ce rôle : il lui faut « Gérer les rôles » et un rôle plus haut
    const moi = guild.members.me
    if (!moi?.permissions.has(Flags.ManageRoles) || role.comparePositionTo(moi.roles.highest) >= 0) return t(interaction, "config.filtre_role_bot")
    return null
}

// Active, règle ou coupe (reglage null) le filtre des comptes récents. Renvoie { erreur } ou { inchange } ou { ok }.
async function changerFiltreComptes(interaction, reglage) {
    const guild = interaction.guild
    const ancien = getFiltreComptes(guild.id)
    if (reglage) {
        const { minAgeJours, action, roleId = null } = reglage
        if (!Number.isInteger(minAgeJours) || minAgeJours < AGE_MIN_JOURS || minAgeJours > AGE_MAX_JOURS) {
            return { erreur: t(interaction, "config.filtre_age_invalide", { min: AGE_MIN_JOURS, max: AGE_MAX_JOURS }) }
        }
        if (!ACTIONS_FILTRE.includes(action)) return { erreur: t(interaction, "commun.erreur") }
        if (action === "role") {
            const role = roleId ? guild.roles.cache.get(roleId) : null
            if (!role) return { erreur: t(interaction, "config.filtre_role_manquant") }
            const refus = refusRoleFiltre(interaction, role)
            if (refus) return { erreur: refus }
        } else if (!interaction.memberPermissions?.has(Flags.KickMembers)) {
            // Jamais plus de pouvoir par le bot que celui qui règle le filtre
            return { erreur: t(interaction, "config.filtre_kick_membre") }
        } else if (!guild.members.me?.permissions.has(Flags.KickMembers)) {
            return { erreur: t(interaction, "config.filtre_kick_bot") }
        }
        if (ancien && ancien.minAgeJours === minAgeJours && ancien.action === action && ancien.roleId === (action === "role" ? roleId : null)) return { inchange: true }
    } else if (!ancien) return { inchange: true }

    setFiltreComptes(guild.id, reglage)
    const details = reglage
        ? `Filtre des comptes récents : activé (moins de ${reglage.minAgeJours} jour(s) → ${reglage.action === "role" ? `rôle <@&${reglage.roleId}>` : "expulsion"})`
        : "Filtre des comptes récents : désactivé"
    await sendModLog(interaction, { action: "config", details })
    return { ok: true }
}

// Rôle staff du serveur (null = retirer). Mêmes règles que /config. Renvoie { erreur } ou { ok }.
async function changerRoleStaff(interaction, role) {
    if (!peutConfigurerStaff(interaction)) return { erreur: t(interaction, "config.staff_permission") }
    if (role) {
        const refus = refusRoleStaff(interaction, role)
        if (refus) return { erreur: refus }
    }
    db.setStaffRole(interaction.guild.id, role?.id ?? null)
    await sendModLog(interaction, { action: "config", details: `Rôle staff du serveur : ${role ?? "aucun"}` })
    return { ok: true }
}

// Modules actifs (actifs : clés cochées parmi connus). Renvoie { erreur } ou { inchange } ou { ok }.
async function changerModules(interaction, connus, actifs) {
    if (!peutConfigurerModules(interaction)) return { erreur: t(interaction, "config.modules_permission") }
    const guild = interaction.guild
    const voulus = new Set([...actifs].filter(v => connus.includes(v)))
    const avant = db.getModules(guild.id)
    const changes = connus.filter(m => (avant[m] !== false) !== voulus.has(m))
    if (!changes.length) return { inchange: true }
    db.transaction(() => { for (const m of changes) db.setModule(guild.id, m, voulus.has(m)) })
    await sendModLog(interaction, { action: "config", details: `Modules : ${changes.map(m => `${m} ${voulus.has(m) ? "activé" : "désactivé"}`).join(", ")}` })
    return { ok: true }
}

// Salons où les jeux sont autorisés (liste vide = partout). Renvoie { erreur } ou { ok }.
async function changerSalonsJeux(interaction, ids) {
    if (!peutConfigurerModules(interaction)) return { erreur: t(interaction, "config.modules_permission") }
    const guild = interaction.guild
    const salons = ids.filter(id => guild.channels.cache.get(id)?.type === Discord.ChannelType.GuildText)
    db.setSalonsJeux(guild.id, salons)
    await sendModLog(interaction, { action: "config", details: `Salons de jeux : ${salons.length ? salons.map(id => `<#${id}>`).join(", ") : "tous"}` })
    return { ok: true }
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

module.exports = {
    PERMISSION_TICKETS, PERMISSION_CHOISIR_ROLE_STAFF, PERMISSIONS_MODERATION, AGES_FILTRE,
    peutConfigurerTickets, peutConfigurerStaff, peutConfigurerModules,
    refusSalonLogs, changerSalonLogs, changerSalonFamille, refusCategorie, refusRoleStaff, refusRoleFiltre,
    changerFiltreComptes, changerRoleStaff, changerModules, changerSalonsJeux
}
