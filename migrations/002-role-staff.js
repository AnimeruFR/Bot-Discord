// Rôle staff du serveur (idée #1) : donne accès aux commandes de modération qui le déclarent (roleStaffSuffit)
const description = "Rôle staff du serveur (guild_config.staff_role_id)"

const colonnes = db => db.prepare("PRAGMA table_info(guild_config)").all().map(c => c.name)

function up(db) {
    if (!colonnes(db).includes("staff_role_id")) db.exec("ALTER TABLE guild_config ADD COLUMN staff_role_id TEXT")
}

function down(db) {
    if (colonnes(db).includes("staff_role_id")) db.exec("ALTER TABLE guild_config DROP COLUMN staff_role_id")
}

module.exports = { description, up, down }
