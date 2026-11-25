// Quarantaine (idée #14) : rôles retirés sauvegardés AVANT le retrait, restaurés à la levée
const description = "Quarantaine : quarantine_config (rôle isolé) et quarantines (rôles sauvegardés)"

function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS quarantine_config (
            guild_id TEXT PRIMARY KEY,
            role_id TEXT NOT NULL
        );
        -- roles : liste JSON des rôles retirés
        CREATE TABLE IF NOT EXISTS quarantines (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            roles TEXT NOT NULL,
            moderator_id TEXT NOT NULL,
            reason TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id)
        );
    `)
}

function down(db) {
    db.exec("DROP TABLE IF EXISTS quarantine_config; DROP TABLE IF EXISTS quarantines")
}

module.exports = { description, up, down }
