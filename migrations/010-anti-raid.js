// Anti-raid (idée #2) : réglages par serveur et historique des raids détectés
const description = "Anti-raid : raid_config (seuils) et raid_events (raids détectés et leur levée)"

function up(db) {
    db.exec(`
        -- Sans ligne : anti-raid désactivé. arrivals arrivées en window_s secondes déclenchent le mode raid.
        -- alert_only : alerte au staff sans verrouiller le serveur
        CREATE TABLE IF NOT EXISTS raid_config (
            guild_id TEXT PRIMARY KEY,
            arrivals INTEGER NOT NULL,
            window_s INTEGER NOT NULL,
            alert_only INTEGER NOT NULL DEFAULT 0
        );
        -- previous_level : niveau de vérification du serveur avant le verrouillage (restauré à la levée)
        CREATE TABLE IF NOT EXISTS raid_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            ended_at INTEGER,
            arrivals INTEGER NOT NULL,
            previous_level INTEGER,
            invites_paused INTEGER NOT NULL DEFAULT 0,
            lifted_by TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_raid_events ON raid_events (guild_id, id);
    `)
}

function down(db) {
    db.exec("DROP TABLE IF EXISTS raid_config; DROP TABLE IF EXISTS raid_events")
}

module.exports = { description, up, down }
