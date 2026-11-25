// Modifier ou annuler une sanction (idée #12) : date d'annulation sur la sanction, et trace de chaque modification
const description = "Annulation des sanctions (cases.cancelled_at) et trace des modifications (case_edits)"

const colonnes = db => db.prepare("PRAGMA table_info(cases)").all().map(c => c.name)

function up(db) {
    if (!colonnes(db).includes("cancelled_at")) db.exec("ALTER TABLE cases ADD COLUMN cancelled_at INTEGER")
    db.exec(`
        -- champ : "raison" ou "annulation" ; ancienne et nouvelle valeur en clair (raison) ou vides (annulation)
        CREATE TABLE IF NOT EXISTS case_edits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            case_id INTEGER NOT NULL,
            editor_id TEXT NOT NULL,
            field TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_case_edits_case ON case_edits (guild_id, case_id);
    `)
}

function down(db) {
    db.exec("DROP TABLE IF EXISTS case_edits")
    if (colonnes(db).includes("cancelled_at")) db.exec("ALTER TABLE cases DROP COLUMN cancelled_at")
}

module.exports = { description, up, down }
