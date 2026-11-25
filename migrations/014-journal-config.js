// Journal d'audit consultable (idée #15) : changements de configuration du bot (les sanctions sont dans cases)
const description = "Journal des changements de configuration (config_audit)"

function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS config_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            moderator_id TEXT NOT NULL,
            details TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_config_audit ON config_audit (guild_id, created_at);
    `)
}

function down(db) {
    db.exec("DROP TABLE IF EXISTS config_audit")
}

module.exports = { description, up, down }
