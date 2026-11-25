const Discord = require('discord.js')
const db = require('./db')
const { formatReason, auditReason, checkHierarchy, fetchMember, formatDuree } = require('./moderation')
const { sendModLog } = require('./logs')
const { t, langueDe } = require('./i18n')

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
// Libellés français : utilisés dans les logs (l'affichage aux membres passe par les clés mod.libelle.*)
const LIBELLES = { mute: "mute", kick: "kick", ban: "ban définitif", tempban: "ban temporaire" }

// Vérifie qu'on peut bannir l'utilisateur. Renvoie { erreur } ou { member } (null s'il n'est pas sur le serveur).
// { conversion: true } : il est en ban temporaire et on demande un ban définitif (le ban reste, l'échéance disparaît).
async function verifierBan(interaction, user, duree) {
    const member = await fetchMember(interaction.guild, user.id)
    if (member) {
        const erreur = checkHierarchy(interaction, member, "ban")
        if (erreur) return { erreur }
        if (!member.bannable) return { erreur: t(interaction, "mod.ban.pas_bannable") }
    } else if (user.id === interaction.user.id) {
        return { erreur: t(interaction, "mod.hierarchie.soi", { verbe: t(interaction, "mod.verbe.ban") }) }
    }
    const ban = await interaction.guild.bans.fetch({ user: user.id, force: true }).catch(err => {
        if (err.code === Discord.RESTJSONErrorCodes.UnknownBan) return null
        throw err
    })
    if (ban) {
        if (!duree && db.getTempban(interaction.guild.id, user.id)) return { member: null, conversion: true }
        return { erreur: t(interaction, "mod.ban.deja") }
    }
    return { member }
}

// Bannit sans confirmation (définitif si duree est null). Renvoie le numéro de la sanction.
async function bannir(guild, user, { moderateur, raisonBrute, duree = null, auto = false, member = null }) {
    const reason = formatReason(raisonBrute)
    // Le MP doit partir avant le ban, sinon le bot ne partage plus de serveur avec lui
    if (member) {
        const pendant = duree ? t(guild, "mod.ban.mp_pendant", { duree: formatDuree(duree, langueDe(guild)) }) : ""
        await user.send(t(guild, "mod.ban.mp", { serveur: guild.name, pendant, reason })).catch(() => {})
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
    const pendant = duree ? t(interaction, "mod.ban.pendant", { duree: formatDuree(duree, langueDe(interaction)) }) : ""

    // Réponse différée : les vérifications font des appels à Discord, qui peuvent dépasser les 3 s permises
    await interaction.deferReply({ flags: EPHEMERAL })
    const premier = await verifierBan(interaction, user, duree)
    if (premier.erreur) return interaction.editReply({ content: premier.erreur })

    const boutons = new Discord.ActionRowBuilder().addComponents(
        new Discord.ButtonBuilder().setCustomId(`ban-oui-${interaction.id}`).setLabel(t(interaction, "mod.ban.bouton_ban")).setStyle(Discord.ButtonStyle.Danger),
        new Discord.ButtonBuilder().setCustomId(`ban-non-${interaction.id}`).setLabel(t(interaction, "mod.ban.bouton_annuler")).setStyle(Discord.ButtonStyle.Secondary)
    )
    const question = premier.conversion
        ? t(interaction, "mod.ban.question_conversion", { user, reason })
        : t(interaction, "mod.ban.question", { user, id: user.id, pendant, reason })
    const reponse = await interaction.editReply({ content: question, components: [boutons] })

    const clic = await reponse.awaitMessageComponent({
        componentType: Discord.ComponentType.Button,
        filter: i => i.user.id === interaction.user.id && i.customId.endsWith(interaction.id),
        time: DELAI_CONFIRMATION
    }).catch(() => null)

    if (!clic) return interaction.editReply({ content: t(interaction, "mod.ban.temps_ecoule"), components: [] })
    if (clic.customId.startsWith("ban-non")) return clic.update({ content: t(interaction, "mod.ban.annule"), components: [] })

    await clic.update({ content: t(interaction, "mod.ban.en_cours"), components: [] })

    // La situation a pu changer pendant la confirmation : permission (celle du clic est à jour), hiérarchie, état du ban
    if (!clic.memberPermissions?.has(Discord.PermissionFlagsBits.BanMembers)) {
        return interaction.editReply({ content: t(interaction, "mod.ban.plus_permission") })
    }
    // clic : ses rôles sont ceux du modérateur au moment du clic (pas ceux d'avant la confirmation)
    const second = await verifierBan(clic, user, duree).catch(err => ({ erreur: t(interaction, "mod.ban.verif_impossible", { erreur: err.message }) }))
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
        return interaction.editReply({ content: t(interaction, "mod.ban.echec") })
    }
    await interaction.editReply({ content: t(interaction, "mod.ban.effectue", { numero }) })
    const pendantPublic = duree ? t(interaction.guild, "mod.ban.pendant", { duree: formatDuree(duree, langueDe(interaction.guild)) }) : ""
    await interaction.followUp(t(interaction.guild, "mod.ban.annonce", { moderateur: interaction.user, user, pendant: pendantPublic, reason }))
    await sendModLog(interaction, {
        action: duree ? "tempban" : "ban", cible: user, raison: raisonBrute,
        details: duree ? `Durée : ${formatDuree(duree)} (fin <t:${Math.floor((Date.now() + duree) / 1000)}:f>)` : undefined
    })
}

// Avant un warn : renvoie le libellé de la sanction automatique que ce warn (le n°total) déclencherait
// si l'auteur n'a pas la permission de l'appliquer, sinon null. Même règle que dans appliquerSeuil.
function sanctionInterdite(interaction, total) {
    const seuil = db.getThreshold(interaction.guild.id, total)
    if (!seuil || interaction.memberPermissions?.has(PERMISSIONS[seuil.action])) return null
    const duree = seuil.duration_ms
    return `${t(interaction, `mod.libelle.${seuil.action}`)}${duree ? t(interaction, "mod.auto.de_duree", { duree: formatDuree(duree, langueDe(interaction)) }) : ""}`
}

// Après un warn : applique la sanction dont le seuil est exactement le nouveau nombre de warns.
// "Exactement" : chaque warn a un total différent (SQLite est synchrone), donc un seuil ne se déclenche
// qu'une fois, même si deux modérateurs warnent en même temps. Renvoie un texte à afficher, ou null.
async function appliquerSeuil(interaction, user, total) {
    const seuil = db.getThreshold(interaction.guild.id, total)
    if (!seuil) return null
    const { action } = seuil
    const duree = seuil.duration_ms
    // libelleLog : français, pour les logs ; libelle : dans la langue de l'interaction
    const libelleLog = `${LIBELLES[action]}${duree ? ` de ${formatDuree(duree)}` : ""}`
    const libelle = `${t(interaction, `mod.libelle.${action}`)}${duree ? t(interaction, "mod.auto.de_duree", { duree: formatDuree(duree, langueDe(interaction)) }) : ""}`
    const raisonBrute = `Sanction automatique : ${total} avertissements`
    const raisonMp = t(interaction.guild, "mod.auto.raison", { total })
    const echec = motif => t(interaction, "mod.auto.echec", { libelle, motif })

    // Sans cette vérification, un modérateur qui peut seulement warn pourrait faire bannir quelqu'un
    if (!interaction.memberPermissions?.has(PERMISSIONS[action])) {
        return echec(t(interaction, "mod.auto.pas_permission"))
    }
    const member = await fetchMember(interaction.guild, user.id)
    if (!member) return echec(t(interaction, "mod.auto.absent"))
    const erreur = checkHierarchy(interaction, member, "sanctionner")
    if (erreur) return echec(erreur)

    const audit = auditReason(interaction, raisonBrute)
    try {
        if (action === "mute") {
            if (!member.moderatable) return echec(t(interaction, "mod.auto.pas_moderatable"))
            // On ne raccourcit jamais un mute déjà en cours
            if ((member.communicationDisabledUntilTimestamp ?? 0) >= Date.now() + duree) return echec(t(interaction, "mod.auto.deja_mute"))
            await member.timeout(duree, audit)
            db.addCase(interaction.guild.id, { userId: user.id, moderatorId: interaction.user.id, type: "mute", reason: raisonBrute, durationMs: duree, auto: true })
            await user.send(t(interaction.guild, "mod.auto.mp_mute", { serveur: interaction.guild.name, duree: formatDuree(duree, langueDe(interaction.guild)), raison: raisonMp })).catch(() => {})
        } else if (action === "kick") {
            if (!member.kickable) return echec(t(interaction, "mod.auto.pas_kickable"))
            await user.send(t(interaction.guild, "mod.auto.mp_kick", { serveur: interaction.guild.name, raison: raisonMp })).catch(() => {})
            await member.kick(audit)
            db.addCase(interaction.guild.id, { userId: user.id, moderatorId: interaction.user.id, type: "kick", reason: raisonBrute, auto: true })
        } else {
            if (!member.bannable) return echec(t(interaction, "mod.auto.pas_bannable"))
            await bannir(interaction.guild, user, { moderateur: interaction.user, raisonBrute, duree: action === "tempban" ? duree : null, auto: true, member })
        }
    } catch (err) {
        console.error("Échec de la sanction automatique :", err)
        return echec(t(interaction, "mod.auto.refuse"))
    }

    await sendModLog(interaction, { action, cible: user, raison: raisonBrute, details: `Sanction automatique : ${libelleLog}` })
    return t(interaction, "mod.auto.appliquee", { libelle })
}

// Contexte « sans interaction » : le bot agit lui-même (AutoMod). Mêmes champs que ceux lus par appliquerSeuil,
// mais l'auteur est le bot : c'est SA permission et SON rôle le plus haut qui comptent.
function contexteBot(bot, guild, me = guild.members.me) {
    return { guild, guildId: guild.id, user: bot.user, client: bot, member: me, memberPermissions: me.permissions, locale: null }
}

// Après un warn posé par le bot (sans interaction)
const appliquerSeuilBot = (bot, guild, user, total, me) => appliquerSeuil(contexteBot(bot, guild, me), user, total)

module.exports = {
    verifierBan, bannir, banAvecConfirmation, appliquerSeuil, appliquerSeuilBot, contexteBot, sanctionInterdite,
    marqueurTempban, DUREE_MAX_MUTE, DUREE_MAX_TEMPBAN, PERMISSIONS, LIBELLES
}
