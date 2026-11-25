const Discord = require('discord.js')
const db = require('./db')
const { sendModLog } = require('./logs')
const { t } = require('./i18n')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral
const MAX_BOUTONS = 25 // 5 lignes de 5 boutons (limite de Discord)

// Un rôle avec une de ces permissions ne se distribue jamais par bouton (n'importe qui pourrait le prendre)
const PERMS_DANGEREUSES = new Discord.PermissionsBitField([
    Flags.Administrator, Flags.ManageGuild, Flags.ManageRoles, Flags.ManageChannels, Flags.ManageMessages,
    Flags.ManageWebhooks, Flags.ManageGuildExpressions, Flags.ManageEvents, Flags.ManageThreads, Flags.ManageNicknames,
    Flags.BanMembers, Flags.KickMembers, Flags.ModerateMembers, Flags.MentionEveryone, Flags.ViewAuditLog, Flags.ViewGuildInsights,
    Flags.MuteMembers, Flags.DeafenMembers, Flags.MoveMembers, Flags.PinMessages, Flags.BypassSlowmode
])

// Permissions dangereuses données au rôle par une autorisation propre à un salon (pas seulement au niveau du serveur)
function salonDangereux(guild, role) {
    return guild.channels.cache.find(c => c.permissionOverwrites?.cache.get(role.id)?.allow.any(PERMS_DANGEREUSES)) ?? null
}

// Le rôle peut-il être distribué par un bouton ? Renvoie un message d'erreur, ou null.
// cible : langue du message d'erreur (interaction, serveur ou "fr" ; français par défaut).
// Revérifié à CHAQUE clic : le rôle a pu gagner une permission ou monter depuis la création du panneau.
function refusRole(guild, role, configurateur = null, cible = null) {
    const l = cible ?? "fr"
    if (!role) return t(l, "eng.refus.inexistant")
    if (role.id === guild.id) return t(l, "eng.refus.everyone")
    if (role.managed) return t(l, "eng.refus.gere")
    if (role.permissions.any(PERMS_DANGEREUSES)) return t(l, "eng.refus.dangereux", { role })
    const salon = salonDangereux(guild, role)
    if (salon) return t(l, "eng.refus.dangereux_salon", { role, salon })
    if (role.comparePositionTo(guild.members.me.roles.highest) >= 0) return t(l, "eng.refus.au_dessus", { role })
    if (configurateur && configurateur.id !== guild.ownerId && role.comparePositionTo(configurateur.roles.highest) >= 0) {
        return t(l, "eng.refus.configurateur")
    }
    return null
}

// Contenu du message d'un panneau (titre échappé, un bouton par rôle). cible : le serveur (langue du message public)
function contenuPanneau(panel, boutons, cible = null) {
    const l = cible ?? "fr"
    const embed = new Discord.EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(panel.titre.slice(0, 256))
        .setDescription(boutons.length
            ? t(l, "eng.panneau.description") + (panel.mode === "unique" ? t(l, "eng.panneau.unique") : "")
            : t(l, "eng.panneau.vide"))
    const lignes = []
    for (let i = 0; i < boutons.length; i += 5) {
        lignes.push(new Discord.ActionRowBuilder().addComponents(boutons.slice(i, i + 5).map(b =>
            new Discord.ButtonBuilder().setCustomId(`role:${b.role_id}`).setLabel(b.label.slice(0, 80)).setStyle(Discord.ButtonStyle.Secondary))))
    }
    return { embeds: [embed], components: lignes }
}

// Met à jour le message du panneau. Message ou salon supprimé : le panneau est oublié. Renvoie false dans ce cas.
async function rafraichirPanneau(guild, panel) {
    const channel = guild.channels.cache.get(panel.channel_id)
    const message = channel ? await channel.messages.fetch(panel.message_id).catch(err => {
        if (err.code === Discord.RESTJSONErrorCodes.UnknownMessage) return null
        throw err
    }) : null
    if (!message) {
        db.removeRolePanel(guild.id, panel.message_id)
        return false
    }
    await message.edit(contenuPanneau(panel, db.listRoleButtons(guild.id, panel.message_id), guild))
    return true
}

const enCours = new Set() // clics en cours par membre et panneau (deux clics rapides = un seul changement)
const alertes = new Map() // bouton -> date de la dernière alerte envoyée dans les logs

async function onClicRole(bot, interaction) {
    if (!interaction.inCachedGuild()) return
    const guild = interaction.guild
    const roleId = interaction.customId.slice("role:".length)
    // Tout est relu en base : le rôle doit être sur CE panneau (message du clic)
    const panel = db.getRolePanel(guild.id, interaction.message.id)
    const bouton = panel ? db.getRoleButton(guild.id, panel.message_id, roleId) : null
    if (!bouton) return interaction.reply({ content: t(interaction, "roles.inactif"), flags: EPHEMERAL })

    const role = guild.roles.cache.get(roleId)
    const refus = refusRole(guild, role) ?? (guild.members.me.permissions.has(Flags.ManageRoles) ? null : "il me manque la permission « Gérer les rôles »")
    if (refus) {
        await interaction.reply({ content: t(interaction, "roles.indisponible"), flags: EPHEMERAL })
        // Une seule alerte par heure et par bouton : des clics répétés ne doivent pas inonder les logs
        const cleAlerte = `${panel.message_id}-${roleId}`
        if (Date.now() - (alertes.get(cleAlerte) ?? 0) < 3600000) return
        alertes.set(cleAlerte, Date.now())
        return sendModLog({ guild, user: bot.user }, { action: "roles", details: `Bouton de rôle refusé (panneau ${interaction.message.url}) : ${refus}` })
    }

    const cle = `${interaction.user.id}-${panel.message_id}`
    if (enCours.has(cle)) return interaction.reply({ content: t(interaction, "roles.patience"), flags: EPHEMERAL })
    enCours.add(cle)
    try {
        await interaction.deferReply({ flags: EPHEMERAL })
        const member = interaction.member
        const raison = `Rôle par bouton (panneau ${panel.message_id})`
        if (member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId, raison)
            return interaction.editReply(t(interaction, "roles.retire", { role }))
        }
        // Mode unique : on retire d'abord les autres rôles de ce panneau
        if (panel.mode === "unique") {
            // Seulement ceux que le bot peut encore retirer (un rôle passé au-dessus du sien ferait tout échouer)
            const autres = db.listRoleButtons(guild.id, panel.message_id).map(b => b.role_id)
                .filter(id => id !== roleId && member.roles.cache.has(id) && guild.roles.cache.get(id)?.comparePositionTo(guild.members.me.roles.highest) < 0)
            if (autres.length) await member.roles.remove(autres, raison)
        }
        await member.roles.add(roleId, raison)
        await interaction.editReply(t(interaction, "roles.ajoute", { role }))
    } finally {
        enCours.delete(cle)
    }
}

module.exports = { refusRole, contenuPanneau, rafraichirPanneau, onClicRole, PERMS_DANGEREUSES, MAX_BOUTONS }
