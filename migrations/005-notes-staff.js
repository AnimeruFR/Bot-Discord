// Notes privées du staff sur un membre (idée #8) : jamais montrées au membre, purgées avec l'historique (2 ans)
const description = "Notes du staff sur un membre (staff_notes)"

function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS staff_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            author_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_staff_notes_membre ON staff_notes (guild_id, user_id, id);
    `)
}

function down(db) {
    db.exec("DROP TABLE IF EXISTS staff_notes")
}

module.exports = { description, up, down }
