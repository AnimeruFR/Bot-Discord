const Discord = require('discord.js')
const db = require('./db')

// Garde du module Modération (idée #1).
// Discord n'affiche une commande qu'aux membres qui ont sa permission par défaut, mais un admin peut l'ouvrir
// à d'autres dans Paramètres > Intégrations : on ne s'y fie jamais, tout est revérifié ici à chaque appel.
//
// Une commande ou un composant (bouton, menu, modal) du module Modération est autorisé si :
//   1. le membre a la permission Discord déclarée (`permission`, toujours un bigint) ;
//   2. ou la commande déclare `roleStaffSuffit: true` et le membre a le rôle staff du serveur (/config) ;
//      réservé aux actions sans pouvoir propre au bot (warn, historique…) : un rôle staff ne fait jamais bannir ;
//   3. ou la commande déclare une fonction `acces(interaction)` qui l'autorise (ex. : staff d'un ticket).
// Une commande de modération sans permission bigint est refusée à tout le monde (on échoue fermé).

const ID = /^\d{17,20}$/

// Rôle staff du serveur (null si aucun)
function roleStaff(guildId) {
    const id = guildId ? db.getStaffRole(guildId) : null
    return ID.test(id ?? "") ? id : null
}

// Le membre a-t-il ce rôle ? interaction.member est un GuildMember (cache) ou un objet brut de l'API (roles = liste d'ID)
function aLeRole(member, roleId) {
    if (!member || !roleId) return false
    if (Array.isArray(member.roles)) return member.roles.includes(roleId)
    return Boolean(member.roles?.cache?.has(roleId))
}

// Le membre a-t-il le rôle staff configuré sur ce serveur ?
function aRoleStaff(interaction) {
    return interaction.inGuild?.() === true && aLeRole(interaction.member, roleStaff(interaction.guildId))
}

// La déclaration (commande ou composant) est-elle bien formée pour le module Modération ?
// Appelée au chargement : une commande staff mal déclarée empêche le bot de démarrer (et fait échouer les tests).
function verifierDeclaration(declaration) {
    if (declaration.module !== "moderation") return
    if (typeof declaration.permission !== "bigint" || declaration.permission === 0n) {
        throw new Error(`${declaration.name ?? "?"} (Modération) doit déclarer une permission Discord (bigint)`)
    }
    if (declaration.dm) throw new Error(`${declaration.name ?? "?"} (Modération) ne peut pas être utilisable en MP`)
}

// Accès à une commande ou à un composant. Renvoie true si le membre peut l'utiliser.
async function verifierAcces(interaction, declaration) {
    if (declaration.module !== "moderation") {
        // Hors Modération : seule la permission déclarée compte (S15, inchangé)
        if (typeof declaration.permission !== "bigint" || !interaction.inGuild?.()) return true
        return Boolean(interaction.memberPermissions?.has(declaration.permission))
    }

    if (!interaction.inGuild?.()) return false
    if (typeof declaration.permission !== "bigint" || declaration.permission === 0n) return false
    if (interaction.memberPermissions?.has(declaration.permission)) return true
    if (declaration.roleStaffSuffit && aRoleStaff(interaction)) return true
    if (typeof declaration.acces === "function") return Boolean(await declaration.acces(interaction))
    return false
}

// Le membre fait-il partie du staff ? (permission de modération ou rôle staff) Sert à /help et à l'autocomplétion.
const PERMISSIONS_STAFF = [Discord.PermissionFlagsBits.ModerateMembers, Discord.PermissionFlagsBits.KickMembers,
    Discord.PermissionFlagsBits.BanMembers, Discord.PermissionFlagsBits.ManageMessages, Discord.PermissionFlagsBits.ManageGuild]
function estStaff(interaction) {
    if (!interaction.inGuild?.()) return false
    if (PERMISSIONS_STAFF.some(p => interaction.memberPermissions?.has(p))) return true
    return aRoleStaff(interaction)
}

module.exports = { verifierAcces, verifierDeclaration, estStaff, aRoleStaff, aLeRole, roleStaff }
