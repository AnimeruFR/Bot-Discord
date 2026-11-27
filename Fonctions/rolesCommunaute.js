const Discord = require('discord.js')
const db = require('./db')
const { t } = require('./i18n')
const { PERMISSIONS_MODERATION } = require('./config')
const { PERMS_DANGEREUSES } = require('./rolesBoutons')
const { peutDonnerRole } = require('./moderation')

// Contrôle commun des rôles que le bot donne tout seul dans les modules communautaires : boutique, paliers de niveau,
// rôle d'anniversaire (tribunal de la phase 3, S2). Une seule règle, pour qu'un module ne soit jamais plus laxiste qu'un autre.
//
// INVARIANT : ces modules ne donnent jamais un rôle qui ouvre un pouvoir de modération ou d'administration, ni un rôle
// réservé au staff, à la quarantaine ou à la vérification. Vérifié à la configuration ET à chaque attribution.

// Pouvoirs de modération (config.js) et autres pouvoirs dangereux (liste des rôles à boutons)
const PERMISSIONS_INTERDITES = new Discord.PermissionsBitField(PERMS_DANGEREUSES.bitfield | PERMISSIONS_MODERATION)

// Salon dont une surcharge donne au rôle un pouvoir interdit (le rôle serait alors dangereux dans ce salon), ou null.
// Même contrôle que salonDangereux de rolesBoutons.js (non exporté là-bas), avec la liste ci-dessus.
const salonDangereux = (guild, role) =>
    guild.channels.cache.find(c => c.permissionOverwrites?.cache.get(role.id)?.allow.any(PERMISSIONS_INTERDITES)) ?? null

const existe = (requete, params) => db.sqlAll(requete, params).length > 0

// Le rôle est-il réservé ? "staff", "quarantaine", "verifie", "attente" (filtre des comptes récents) ou null.
// Staff : rôle staff du bot, rôle staff des tickets (par défaut, par type, ou TICKET_STAFF_ROLE_ID du .env).
function roleReserve(guildId, roleId) {
    if (db.getStaffRole(guildId) === roleId) return "staff"
    const config = db.sqlAll("SELECT ticket_staff_role_id FROM guild_config WHERE guild_id = ?", [guildId])[0]
    if (config?.ticket_staff_role_id === roleId) return "staff"
    if (process.env.TICKET_STAFF_ROLE_ID === roleId) return "staff"
    if (existe("SELECT 1 FROM ticket_types WHERE guild_id = ? AND staff_role_id = ?", [guildId, roleId])) return "staff"
    if (existe("SELECT 1 FROM quarantine_config WHERE guild_id = ? AND role_id = ?", [guildId, roleId])) return "quarantaine"
    if (existe("SELECT 1 FROM verification_config WHERE guild_id = ? AND role_id = ?", [guildId, roleId])) return "verifie"
    if (existe("SELECT 1 FROM account_filter WHERE guild_id = ? AND role_id = ?", [guildId, roleId])) return "attente"
    return null
}

// Le bot peut-il donner ce rôle à un membre sans danger ? Renvoie la clé i18n du refus (rolecom.refus.*), ou null.
// configurateur : le membre qui règle le module (il doit pouvoir donner ce rôle lui-même). À l'attribution, il n'est pas
// connu : on ne contrôle alors que le rôle et le bot (peutDonnerRole(me, role)).
function refusRoleCommunaute(guild, role, configurateur = null) {
    if (!role) return "rolecom.refus.inexistant"
    if (role.id === guild.id) return "rolecom.refus.everyone"
    if (role.managed) return "rolecom.refus.gere"
    if (role.permissions.any(PERMISSIONS_INTERDITES)) return "rolecom.refus.dangereux"
    if (salonDangereux(guild, role)) return "rolecom.refus.dangereux_salon"
    const reserve = roleReserve(guild.id, role.id)
    if (reserve) return `rolecom.refus.${reserve}`
    const moi = guild.members.me
    if (!moi || !peutDonnerRole(moi, role)) return "rolecom.refus.bot"
    if (configurateur && !peutDonnerRole(configurateur, role)) return "rolecom.refus.configurateur"
    return null
}

// Texte du refus dans la langue de cible (interaction, serveur ou "fr")
const texteRefusRole = (cible, cle, role) => t(cible ?? "fr", cle, { role: role ? `<@&${role.id}>` : "?" })

module.exports = { PERMISSIONS_INTERDITES, salonDangereux, roleReserve, refusRoleCommunaute, texteRefusRole }
