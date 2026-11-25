const db = require('./db')

// Filtre des comptes récents (idée #3) : réglage par serveur (table account_filter, migration 009).
// Sans réglage, le filtre est désactivé.
const ACTIONS_FILTRE = ["role", "kick"]
const AGE_MIN_JOURS = 1
const AGE_MAX_JOURS = 365

// Réglage du serveur : { minAgeJours, action, roleId } ou null
function getFiltreComptes(guildId) {
    const ligne = db.sqlAll("SELECT min_age_days, action, role_id FROM account_filter WHERE guild_id = ?", [guildId])[0]
    return ligne ? { minAgeJours: ligne.min_age_days, action: ligne.action, roleId: ligne.role_id } : null
}

// reglage null : désactive le filtre. Lève une erreur si le réglage est invalide (la commande valide avant).
function setFiltreComptes(guildId, reglage) {
    if (!reglage) return db.sqlRun("DELETE FROM account_filter WHERE guild_id = ?", [guildId])
    const { minAgeJours, action, roleId = null } = reglage
    if (!Number.isInteger(minAgeJours) || minAgeJours < AGE_MIN_JOURS || minAgeJours > AGE_MAX_JOURS) throw new RangeError("Âge minimal invalide")
    if (!ACTIONS_FILTRE.includes(action)) throw new RangeError("Action du filtre inconnue")
    if (action === "role" && !roleId) throw new RangeError("Le filtre « rôle en attente » demande un rôle")
    return db.sqlRun(`INSERT INTO account_filter (guild_id, min_age_days, action, role_id) VALUES (?, ?, ?, ?)
        ON CONFLICT (guild_id) DO UPDATE SET min_age_days = excluded.min_age_days, action = excluded.action, role_id = excluded.role_id`,
    [guildId, minAgeJours, action, action === "role" ? roleId : null])
}

module.exports = { getFiltreComptes, setFiltreComptes, ACTIONS_FILTRE, AGE_MIN_JOURS, AGE_MAX_JOURS }
