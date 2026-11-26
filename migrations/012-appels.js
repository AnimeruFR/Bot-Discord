// Appels de sanction (idée #11) : un appel par sanction, décidé par le staff
const description = "Appels de sanction (appeals)"

function up(db) {
    db.exec(`
        -- status : en_attente, accepte, refuse. Le texte de l'appel est écrit par le membre lui-même.
        CREATE TABLE IF NOT EXISTS appeals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            case_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            content TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'en_attente',
            decided_by TEXT,
            created_at INTEGER NOT NULL,
            decided_at INTEGER,
            UNIQUE (guild_id, case_id)
        );
        CREATE INDEX IF NOT EXISTS idx_appeals_membre ON appeals (guild_id, user_id);
    `)
}

function down(db) {
    db.exec("DROP TABLE IF EXISTS appeals")
}

module.exports = { description, up, down }
