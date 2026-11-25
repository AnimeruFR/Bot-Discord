const db = require('./db')

// Garde des modules réservés au staff : Modération et Tickets (idée #1).
// Discord n'affiche une commande qu'aux membres qui ont sa permission par défaut, mais un admin peut l'ouvrir
// à d'autres dans Paramètres > Intégrations : on ne s'y fie jamais, tout est revérifié ici à chaque appel.
//
// Une commande ou un composant (bouton, menu, modal) d'un module staff est autorisé si :
//   1. le membre a la permission Discord déclarée (`permission`, toujours un bigint) ;
//   2. ou la commande déclare `roleStaffSuffit: true` et le membre a le rôle staff du serveur (/config) ;
//      réservé aux actions sans pouvoir propre au bot (warn, historique…) : un rôle staff ne fait jamais bannir ;
//   3. ou la commande déclare une fonction `acces(interaction)` qui l'autorise (ex. : staff d'un ticket).
// Une commande staff sans permission bigint est refusée à tout le monde (on échoue fermé).
const MODULES_STAFF = ["moderation", "tickets"]
const estModuleStaff = declaration => MODULES_STAFF.includes(declaration.module)

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
    if (!estModuleStaff(declaration)) return
    if (typeof declaration.permission !== "bigint" || declaration.permission === 0n) {
        throw new Error(`${declaration.name ?? "?"} (${declaration.module}) doit déclarer une permission Discord (bigint)`)
    }
    if (declaration.dm) throw new Error(`${declaration.name ?? "?"} (${declaration.module}) ne peut pas être utilisable en MP`)
}

// Accès à une commande ou à un composant. Renvoie true si le membre peut l'utiliser.
async function verifierAcces(interaction, declaration) {
    if (!estModuleStaff(declaration)) {
        // Hors modules staff : seule la permission déclarée compte. Elle est revérifiée ici car un admin peut ouvrir
        // la commande à d'autres rôles dans Paramètres > Intégrations (faille S15 de l'audit, corrigée au lot A).
        if (typeof declaration.permission !== "bigint" || !interaction.inGuild?.()) return true
        return Boolean(interaction.memberPermissions?.has(declaration.permission))
    }

    if (!interaction.inGuild?.()) return false
    if (typeof declaration.permission !== "bigint" || declaration.permission === 0n) return false
    if (interaction.memberPermissions?.has(declaration.permission)) return true
    if (declaration.roleStaffSuffit && aRoleStaff(interaction)) return true
    if (typeof declaration.acces === "function") {
        // Règle propre à la commande (ex. staff d'un ticket) : une erreur vaut refus
        try { return Boolean(await declaration.acces(interaction)) } catch { return false }
    }
    return false
}


module.exports = { verifierAcces, verifierDeclaration, aRoleStaff, aLeRole, roleStaff, MODULES_STAFF }
