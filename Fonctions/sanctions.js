const Discord = require('discord.js')
const db = require('./db')
const { formatReason, auditReason, checkHierarchy, fetchMember, formatDuree } = require('./moderation')
const { sendModLog } = require('./logs')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const DELAI_CONFIRMATION = 30 * 1000
const JOUR = 24 * 60 * 60 * 1000
const DUREE_MAX_MUTE = 28 * JOUR // limite de Discord
const DUREE_MAX_TEMPBAN = 365 * JOUR

// Les bans temporaires commencent par ce marqueur dans la raison du journal d'audit, avec l'échéance exacte
// enregistrée en base (à la milliseconde). Si, à l'expiration, le ban ne commence plus par ce marqueur,
// c'est qu'un humain a re-banni le membre entre-temps : on ne le débannit pas. Le marqueur est en tête
// (avant le texte libre du modérateur) et contient l'échéance : impossible à imiter dans une raison.
const marqueurTempban = fin => `[tempban:${fin}]`

// Permission nécessaire pour chaque sanction automatique
const PERMISSIONS = {
    mute: Discord.PermissionFlagsBits.ModerateMembers,
    kick: Discord.PermissionFlagsBits.KickMembers,
    ban: Discord.PermissionFlagsBits.BanMembers,
    tempban: Discord.PermissionFlagsBits.BanMembers
}
const LIBELLES = { mute: "mute", kick: "kick", ban: "ban définitif", tempban: "ban temporaire" }

// Vérifie qu'on peut bannir l'utilisateur. Renvoie { erreur } ou { member } (null s'il n'est pas sur le serveur).
// { conversion: true } : il est en ban temporaire et on demande un ban définitif (le ban reste, l'échéance disparaît).
async function verifierBan(interaction, user, duree) {
    const member = await fetchMember(interaction.guild, user.id)
    if (member) {
        const erreur = checkHierarchy(interaction, member, "bannir")
        if (erreur) return { erreur }
        if (!member.bannable) return { erreur: "Je ne peux pas bannir ce membre (rôle trop haut pour moi) !" }
    } else if (user.id === interaction.user.id) {
        return { erreur: "Vous ne pouvez pas vous bannir vous-même !" }
    }
    const ban = await interaction.guild.bans.fetch({ user: user.id, force: true }).catch(err => {
        if (err.code === Discord.RESTJSONErrorCodes.UnknownBan) return null
        throw err
    })
    if (ban) {
        if (!duree && db.getTempban(interaction.guild.id, user.id)) return { member: null, conversion: true }
        return { erreur: "Ce membre est déjà banni !" }
    }
    return { member }
}

// Bannit sans confirmation (définitif si duree est null). Renvoie le numéro de la sanction.
async function bannir(guild, user, { moderateur, raisonBrute, duree = null, auto = false, member = null }) {
    const reason = formatReason(raisonBrute)
    // Le MP doit partir avant le ban, sinon le bot ne partage plus de serveur avec lui
    if (member) {
        const pendant = duree ? ` pendant ${formatDuree(duree)}` : ""
        await user.send(`Tu as été banni du serveur ${guild.name}${pendant} pour la raison : ***${reason}***`).catch(() => {})
    }

    const audit = auditReason({ user: moderateur }, raisonBrute)
    // L'échéance est enregistrée avant le ban : si le bot s'arrête juste après, le déban se fera quand même
    const fin = duree ? Date.now() + duree : null
    if (duree) db.setTempban(guild.id, user.id, fin)
    try {
        await guild.bans.create(user.id, { reason: duree ? `${marqueurTempban(fin)} ${audit}`.slice(0, 500) : audit })
    } catch (err) {
        if (duree) db.removeTempban(guild.id, user.id)
        throw err
    }
    // Un ban définitif remplace un éventuel ban temporaire
    if (!duree) db.removeTempban(guild.id, user.id)

    return db.addCase(guild.id, {
        userId: user.id, moderatorId: moderateur.id, type: duree ? "tempban" : "ban",
        reason: raisonBrute, durationMs: duree, auto
    })
}

// /ban et /tempban : confirmation par bouton, puis revérification complète avant d'agir
async function banAvecConfirmation(interaction, { user, raisonBrute, duree = null }) {
    const reason = formatReason(raisonBrute)
    const pendant = duree ? ` pendant **${formatDuree(duree)}**` : ""

    // Réponse différée : les vérifications font des appels à Discord, qui peuvent dépasser les 3 s permises
    await interaction.deferReply({ flags: EPHEMERAL })
    const premier = await verifierBan(interaction, user, duree)
    if (premier.erreur) return interaction.editReply({ content: premier.erreur })

    const boutons = new Discord.ActionRowBuilder().addComponents(
        new Discord.ButtonBuilder().setCustomId(`ban-oui-${interaction.id}`).setLabel("Bannir").setStyle(Discord.ButtonStyle.Danger),
        new Discord.ButtonBuilder().setCustomId(`ban-non-${interaction.id}`).setLabel("Annuler").setStyle(Discord.ButtonStyle.Secondary)
    )
    const question = premier.conversion
        ? `${user} est en ban temporaire. Le transformer en ban **définitif** pour la raison : ***${reason}*** ?`
        : `Confirmer le bannissement de ${user} (\`${user.id}\`)${pendant} pour la raison : ***${reason}*** ?`
    const reponse = await interaction.editReply({ content: question, components: [boutons] })

    const clic = await reponse.awaitMessageComponent({
        componentType: Discord.ComponentType.Button,
        filter: i => i.user.id === interaction.user.id && i.customId.endsWith(interaction.id),
        time: DELAI_CONFIRMATION
    }).catch(() => null)

    if (!clic) return interaction.editReply({ content: "Temps écoulé, bannissement annulé.", components: [] })
    if (clic.customId.startsWith("ban-non")) return clic.update({ content: "Bannissement annulé.", components: [] })

    await clic.update({ content: "Bannissement en cours…", components: [] })

    // La situation a pu changer pendant la confirmation : permission (celle du clic est à jour), hiérarchie, état du ban
    if (!clic.memberPermissions?.has(Discord.PermissionFlagsBits.BanMembers)) {
        return interaction.editReply({ content: "Vous n'avez plus la permission de bannir." })
    }
    // clic : ses rôles sont ceux du modérateur au moment du clic (pas ceux d'avant la confirmation)
    const second = await verifierBan(clic, user, duree).catch(err => ({ erreur: `Vérification impossible (${err.message}), rien n'a été fait.` }))
    if (second.erreur) return interaction.editReply({ content: second.erreur })

    let numero
    try {
        if (second.conversion) {
            // Le ban reste en place ; sans échéance, la tâche de débans ne le lèvera plus
            db.removeTempban(interaction.guild.id, user.id)
            numero = db.addCase(interaction.guild.id, { userId: user.id, moderatorId: interaction.user.id, type: "ban", reason: raisonBrute })
        } else {
            numero = await bannir(interaction.guild, user, { moderateur: interaction.user, raisonBrute, duree, member: second.member })
        }
    } catch (err) {
        console.error("Échec du bannissement :", err)
        return interaction.editReply({ content: "Échec du bannissement (permissions du bot ?)." })
    }
    await interaction.editReply({ content: `Bannissement effectué (sanction n°${numero}).` })
    await interaction.followUp(`${interaction.user} a banni ${user}${pendant} pour la raison : ***${reason}***`)
    await sendModLog(interaction, {
        action: duree ? "tempban" : "ban", cible: user, raison: raisonBrute,
        details: duree ? `Durée : ${formatDuree(duree)} (fin <t:${Math.floor((Date.now() + duree) / 1000)}:f>)` : undefined
    })
}

// Après un warn : applique la sanction dont le seuil est exactement le nouveau nombre de warns.
// "Exactement" : chaque warn a un total différent (SQLite est synchrone), donc un seuil ne se déclenche
// qu'une fois, même si deux modérateurs warnent en même temps. Renvoie un texte à afficher, ou null.
async function appliquerSeuil(interaction, user, total) {
    const seuil = db.getThreshold(interaction.guild.id, total)
    if (!seuil) return null
    const { action } = seuil
    const duree = seuil.duration_ms
    const libelle = `${LIBELLES[action]}${duree ? ` de ${formatDuree(duree)}` : ""}`
    const raisonBrute = `Sanction automatique : ${total} avertissements`
    const echec = motif => `Sanction automatique (${libelle}) **non appliquée** : ${motif}`

    // Sans cette vérification, un modérateur qui peut seulement warn pourrait faire bannir quelqu'un
    if (!interaction.memberPermissions?.has(PERMISSIONS[action])) {
        return echec("vous n'avez pas vous-même la permission de faire cette sanction.")
    }
    const member = await fetchMember(interaction.guild, user.id)
    if (!member) return echec("le membre n'est plus sur le serveur.")
    const erreur = checkHierarchy(interaction, member, "sanctionner")
    if (erreur) return echec(erreur)

    const audit = auditReason(interaction, raisonBrute)
    try {
        if (action === "mute") {
            if (!member.moderatable) return echec("je ne peux pas mute ce membre (rôle trop haut pour moi).")
            // On ne raccourcit jamais un mute déjà en cours
            if ((member.communicationDisabledUntilTimestamp ?? 0) >= Date.now() + duree) return echec("le membre est déjà mute plus longtemps.")
            await member.timeout(duree, audit)
            db.addCase(interaction.guild.id, { userId: user.id, moderatorId: interaction.user.id, type: "mute", reason: raisonBrute, durationMs: duree, auto: true })
            await user.send(`Tu as été mute sur le serveur ${interaction.guild.name} pendant ${formatDuree(duree)} (${raisonBrute}).`).catch(() => {})
        } else if (action === "kick") {
            if (!member.kickable) return echec("je ne peux pas kick ce membre (rôle trop haut pour moi).")
            await user.send(`Tu as été kick du serveur ${interaction.guild.name} (${raisonBrute}).`).catch(() => {})
            await member.kick(audit)
            db.addCase(interaction.guild.id, { userId: user.id, moderatorId: interaction.user.id, type: "kick", reason: raisonBrute, auto: true })
        } else {
            if (!member.bannable) return echec("je ne peux pas bannir ce membre (rôle trop haut pour moi).")
            await bannir(interaction.guild, user, { moderateur: interaction.user, raisonBrute, duree: action === "tempban" ? duree : null, auto: true, member })
        }
    } catch (err) {
        console.error("Échec de la sanction automatique :", err)
        return echec("Discord a refusé l'action (permissions du bot ?).")
    }

    await sendModLog(interaction, { action, cible: user, raison: raisonBrute, details: `Sanction automatique : ${libelle}` })
    return `Sanction automatique appliquée : **${libelle}**.`
}

module.exports = {
    verifierBan, bannir, banAvecConfirmation, appliquerSeuil,
    marqueurTempban, DUREE_MAX_MUTE, DUREE_MAX_TEMPBAN, PERMISSIONS, LIBELLES
}
