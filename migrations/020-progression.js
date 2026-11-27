// Progression (idées #39 à #45, #76 à #78) : XP, paliers, bonus, succès, quêtes, statistiques, profil, réputation, anniversaires
const description = "Progression : xp, xp_config, xp_bonus, xp_paliers, succes, quetes, stats_joueur, profils, reputation, rep_donnees, anniversaires, anniv_config"

function up(db) {
    db.exec(`
        -- day / day_xp : XP gagnée aujourd'hui (plafond de 3 000 par jour)
        CREATE TABLE IF NOT EXISTS xp (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            xp INTEGER NOT NULL DEFAULT 0,
            level INTEGER NOT NULL DEFAULT 0,
            last_gain_at INTEGER,
            day TEXT,
            day_xp INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_xp_classement ON xp (guild_id, xp DESC);
        -- excluded_channels : liste JSON ; weekend_double : 0/1 ; tier_mode : cumul ou remplace
        CREATE TABLE IF NOT EXISTS xp_config (
            guild_id TEXT PRIMARY KEY,
            excluded_channels TEXT NOT NULL DEFAULT '[]',
            weekend_double INTEGER NOT NULL DEFAULT 0,
            levelup_channel_id TEXT,
            tier_mode TEXT NOT NULL DEFAULT 'cumul'
        );
        -- kind : salon ou role ; target : ID du salon ou du rôle (jamais un membre) ; multiplier ≤ 2
        CREATE TABLE IF NOT EXISTS xp_bonus (
            guild_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            target TEXT NOT NULL,
            multiplier REAL NOT NULL,
            PRIMARY KEY (guild_id, kind, target)
        );
        CREATE TABLE IF NOT EXISTS xp_paliers (
            guild_id TEXT NOT NULL,
            level INTEGER NOT NULL,
            role_id TEXT,
            reward INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, level)
        );
        CREATE TABLE IF NOT EXISTS succes (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            achievement TEXT NOT NULL,
            earned_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id, achievement)
        );
        -- period : jour (AAAA-MM-JJ) ou semaine (AAAA-Wnn) ; claimed : récompense versée
        CREATE TABLE IF NOT EXISTS quetes (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            period TEXT NOT NULL,
            quest TEXT NOT NULL,
            progress INTEGER NOT NULL DEFAULT 0,
            goal INTEGER NOT NULL,
            claimed INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, user_id, period, quest)
        );
        -- Compteurs cumulés d'un joueur (parties gagnées, meilleure série…) pour les succès et les classements de jeux
        CREATE TABLE IF NOT EXISTS stats_joueur (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            stat TEXT NOT NULL,
            value INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, user_id, stat)
        );
        CREATE TABLE IF NOT EXISTS profils (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            bio TEXT,
            theme TEXT,
            featured_badge TEXT,
            PRIMARY KEY (guild_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS reputation (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            total INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, user_id)
        );
        -- Une réputation donnée par membre et par jour (day : AAAA-MM-JJ)
        CREATE TABLE IF NOT EXISTS rep_donnees (
            guild_id TEXT NOT NULL,
            giver_id TEXT NOT NULL,
            receiver_id TEXT NOT NULL,
            day TEXT NOT NULL,
            PRIMARY KEY (guild_id, giver_id, day)
        );
        -- Jour et mois seulement, jamais l'année
        CREATE TABLE IF NOT EXISTS anniversaires (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            day INTEGER NOT NULL,
            month INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS anniv_config (
            guild_id TEXT PRIMARY KEY,
            channel_id TEXT,
            role_id TEXT,
            last_run_day TEXT
        );
    `)
}

function down(db) {
    db.exec(`DROP TABLE IF EXISTS xp; DROP TABLE IF EXISTS xp_config; DROP TABLE IF EXISTS xp_bonus; DROP TABLE IF EXISTS xp_paliers;
        DROP TABLE IF EXISTS succes; DROP TABLE IF EXISTS quetes; DROP TABLE IF EXISTS stats_joueur; DROP TABLE IF EXISTS profils;
        DROP TABLE IF EXISTS reputation; DROP TABLE IF EXISTS rep_donnees; DROP TABLE IF EXISTS anniversaires; DROP TABLE IF EXISTS anniv_config`)
}

module.exports = { description, up, down }
