const Discord = require('discord.js')
const ms = require('ms')

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
// Renvoie un message d'erreur, ou null si tout est bon.
function checkHierarchy(interaction, target, action) {
    const guild = interaction.guild

    if (target.id === interaction.user.id) return `Vous ne pouvez pas vous ${action} vous-même !`
    if (target.id === guild.ownerId) return `Vous ne pouvez pas ${action} le propriétaire du serveur !`
    if (target.id === interaction.client.user.id) return `Je ne peux pas me ${action} moi-même !`

    // Le propriétaire du serveur peut agir sur tout le monde
    if (interaction.user.id !== guild.ownerId && target.roles.highest.comparePositionTo(interaction.member.roles.highest) >= 0) {
        return `Vous ne pouvez pas ${action} ce membre : son rôle est supérieur ou égal au vôtre !`
    }
    return null
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
function parseDuree(texte, { min = 60 * 1000, max }) {
    const valeur = texte?.trim() ? ms(texte.trim()) : NaN
    if (!Number.isFinite(valeur) || valeur <= 0) return { erreur: "Durée invalide ! Exemples : `10m`, `1h`, `2d`." }
    if (valeur < min) return { erreur: `Durée trop courte (minimum ${formatDuree(min)}) !` }
    if (valeur > max) return { erreur: `Durée trop longue (maximum ${formatDuree(max)}) !` }
    return { duree: valeur }
}

// 90 000 000 ms -> "1 jour et 1 heure" (deux unités au plus, en français)
const UNITES = [[86400000, "jour"], [3600000, "heure"], [60000, "minute"], [1000, "seconde"]]
function formatDuree(duree) {
    const parties = []
    let reste = duree
    for (const [taille, nom] of UNITES) {
        const n = Math.floor(reste / taille)
        if (n > 0 && parties.length < 2) parties.push(`${n} ${nom}${n > 1 ? "s" : ""}`)
        reste -= n * taille
    }
    return parties.join(" et ") || "moins d'une seconde"
}

module.exports = { formatReason, auditReason, checkHierarchy, fetchMember, parseDuree, formatDuree }
