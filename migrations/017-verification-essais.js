// Vérification (tribunal phase 2, S4/A4) : les erreurs et le blocage survivent à un redémarrage du bot
const description = "Essais de vérification par membre (verification_attempts)"

function up(db) {
    db.exec(`
        -- errors : erreurs depuis le dernier blocage ; blocked_until : fin du blocage (0 = pas bloqué)
        CREATE TABLE IF NOT EXISTS verification_attempts (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            errors INTEGER NOT NULL DEFAULT 0,
            blocked_until INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id)
        );
    `)
}

function down(db) {
    db.exec("DROP TABLE IF EXISTS verification_attempts")
}

module.exports = { description, up, down }
