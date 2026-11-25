// Raisons de sanction prédéfinies par serveur (idée #10), proposées en autocomplétion (25 au plus par serveur)
const description = "Raisons de sanction prédéfinies (mod_reasons)"

function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS mod_reasons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            content TEXT NOT NULL,
            UNIQUE (guild_id, content)
        );
    `)
}

function down(db) {
    db.exec("DROP TABLE IF EXISTS mod_reasons")
}

module.exports = { description, up, down }
