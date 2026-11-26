const Discord = require('discord.js')
const ms = require('ms')
const { t, langueDe } = require('./i18n')

// Raison affichée sans casser la mise en forme Discord (ni lien déguisé, ni titre, ni liste)
function formatReason(reason) {
    return Discord.escapeMarkdown(reason?.trim() || "Aucune raison fournie", {
        maskedLink: true,
        heading: true,
        bulletedList: true,
        numberedList: true
    })
}

// Raison brute pour le journal d'audit de Discord (limité à 512 caractères)
function auditReason(interaction, reason) {
    return `${interaction.user.tag} : ${reason?.trim() || "Aucune raison fournie"}`.slice(0, 500)
}

// Vérifie que l'auteur de la commande a le droit d'agir sur la cible.
// action : identifiant de l'action ("ban", "kick", "mute", "unmute", "warn", "unwarn", "sanctionner") dont le verbe est traduit.
// Renvoie un message d'erreur, ou null si tout est bon.
const ANCIENS_VERBES = { bannir: "ban" }
function checkHierarchy(interaction, target, action) {
    const guild = interaction.guild
    const id = ANCIENS_VERBES[action] ?? action
    const verbe = t(interaction, `mod.verbe.${id}`)

    if (target.id === interaction.user.id) return t(interaction, "mod.hierarchie.soi", { verbe })
    if (target.id === guild.ownerId) return t(interaction, "mod.hierarchie.proprio", { verbe })
    if (target.id === interaction.client.user.id) return t(interaction, "mod.hierarchie.bot", { verbe })

    // Le propriétaire du serveur peut agir sur tout le monde
    if (interaction.user.id !== guild.ownerId && target.roles.highest.comparePositionTo(interaction.member.roles.highest) >= 0) {
        return t(interaction, "mod.hierarchie.role", { verbe })
    }
    return null
}

// Hiérarchie commune (tribunal de la phase 2, P2) : à utiliser partout où un membre ou le bot agit sur un autre
// membre ou donne un rôle, pour que le bot n'ait jamais plus de pouvoir que celui qui agit ou configure.

// acteur (membre, ou guild.members.me pour le bot) est-il strictement au-dessus de cible (membre) ?
// Le propriétaire est au-dessus de tous ; personne n'est au-dessus du propriétaire.
function estAuDessus(acteur, cible) {
    const guild = acteur.guild
    if (cible.id === guild.ownerId) return false
    if (acteur.id === guild.ownerId) return true
    return acteur.roles.highest.comparePositionTo(cible.roles.highest) > 0
}

// acteur peut-il donner ce rôle ? « Gérer les rôles » et un rôle strictement plus haut (le propriétaire : toujours).
// Jamais @everyone ni un rôle géré par une intégration.
function peutDonnerRole(acteur, role) {
    if (!role || role.managed || role.id === role.guild.id) return false
    if (acteur.id === role.guild.ownerId) return true
    return Boolean(acteur.permissions?.has(Discord.PermissionFlagsBits.ManageRoles)) && role.comparePositionTo(acteur.roles.highest) < 0
}

// Relit le membre auprès de Discord (force : le cache peut avoir des rôles périmés). null s'il n'est pas sur le serveur.
// Toute autre erreur (réseau, limite de débit) est relancée : la prendre pour « membre absent »
// ferait sauter la vérification de hiérarchie.
const ABSENT = [Discord.RESTJSONErrorCodes.UnknownMember, Discord.RESTJSONErrorCodes.UnknownUser]
function fetchMember(guild, userId) {
    return guild.members.fetch({ user: userId, force: true }).catch(err => {
        if (ABSENT.includes(err.code)) return null
        throw err
    })
}

// "10m", "2h", "7d"… -> millisecondes. Renvoie { duree } ou { erreur }.
// cible : interaction ou serveur pour la langue des erreurs (français sans cible).
function parseDuree(texte, { min = 60 * 1000, max, cible = null }) {
    const langue = cible ? langueDe(cible) : "fr"
    const valeur = texte?.trim() ? ms(texte.trim()) : NaN
    if (!Number.isFinite(valeur) || valeur <= 0) return { erreur: t(langue, "mod.duree.invalide") }
    if (valeur < min) return { erreur: t(langue, "mod.duree.courte", { duree: formatDuree(min, langue) }) }
    if (valeur > max) return { erreur: t(langue, "mod.duree.longue", { duree: formatDuree(max, langue) }) }
    return { duree: valeur }
}

// 90 000 000 ms -> "1 jour et 1 heure" / "1 day and 1 hour" (deux unités au plus)
const UNITES = [
    [86400000, { fr: "jour", en: "day" }], [3600000, { fr: "heure", en: "hour" }],
    [60000, { fr: "minute", en: "minute" }], [1000, { fr: "seconde", en: "second" }]
]
const LIAISON = { fr: " et ", en: " and " }
const MOINS_D_UNE = { fr: "moins d'une seconde", en: "less than a second" }
function formatDuree(duree, langue = "fr") {
    if (!LIAISON[langue]) langue = "fr"
    const parties = []
    let reste = duree
    for (const [taille, noms] of UNITES) {
        const n = Math.floor(reste / taille)
        if (n > 0 && parties.length < 2) parties.push(`${n} ${noms[langue]}${n > 1 ? "s" : ""}`)
        reste -= n * taille
    }
    return parties.join(LIAISON[langue]) || MOINS_D_UNE[langue]
}

module.exports = { formatReason, auditReason, checkHierarchy, estAuDessus, peutDonnerRole, fetchMember, parseDuree, formatDuree }
