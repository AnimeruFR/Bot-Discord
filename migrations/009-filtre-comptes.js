// Filtre des comptes récents (idée #3) et réglages AutoMod du bot (idée #7)
const description = "Filtre des comptes récents (account_filter) et lien AutoMod -> sanctions (automod_config)"

function up(db) {
    db.exec(`
        -- action : "role" (rôle « en attente ») ou "kick" ; sans ligne, le filtre est désactivé
        CREATE TABLE IF NOT EXISTS account_filter (
            guild_id TEXT PRIMARY KEY,
            min_age_days INTEGER NOT NULL,
            action TEXT NOT NULL,
            role_id TEXT
        );
        -- count_warns : un blocage AutoMod compte comme un warn pour les seuils de /sanctions
        CREATE TABLE IF NOT EXISTS automod_config (
            guild_id TEXT PRIMARY KEY,
            count_warns INTEGER NOT NULL DEFAULT 0
        );
    `)
}

function down(db) {
    db.exec("DROP TABLE IF EXISTS account_filter; DROP TABLE IF EXISTS automod_config")
}

module.exports = { description, up, down }
