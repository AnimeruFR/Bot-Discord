// Jeux (idées #46 à #55, #72) : parties en cours (moteur #50), jeux quotidiens, drops
const description = "Jeux : parties, jeux_quotidiens, drops_config"

function up(db) {
    db.exec(`
        -- players : liste JSON des joueurs ; state : état du jeu en JSON ; status : en_cours, finie, annulee, expiree
        CREATE TABLE IF NOT EXISTS parties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            game TEXT NOT NULL,
            channel_id TEXT,
            message_id TEXT,
            players TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'en_cours',
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_parties_statut ON parties (status, expires_at);
        CREATE INDEX IF NOT EXISTS idx_parties_serveur ON parties (guild_id, game, status);
        -- Jeux du jour (mot du jour, énigme) : un état par membre, par jeu et par jour
        CREATE TABLE IF NOT EXISTS jeux_quotidiens (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            game TEXT NOT NULL,
            day TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT '{}',
            finished INTEGER NOT NULL DEFAULT 0,
            finished_at INTEGER,
            PRIMARY KEY (guild_id, user_id, game, day)
        );
        -- channels : liste JSON des salons où un coffre peut apparaître
        CREATE TABLE IF NOT EXISTS drops_config (
            guild_id TEXT PRIMARY KEY,
            channels TEXT NOT NULL DEFAULT '[]'
        );
    `)
}

function down(db) {
    db.exec("DROP TABLE IF EXISTS parties; DROP TABLE IF EXISTS jeux_quotidiens; DROP TABLE IF EXISTS drops_config")
}

module.exports = { description, up, down }
