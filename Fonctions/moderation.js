const Discord = require('discord.js')

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

module.exports = { formatReason, auditReason, checkHierarchy }
