// Économie (idées #26 à #38) : comptes, journal, compteurs du jour, métiers, inventaire, boutique.
// Voir docs/ECONOMIE.md pour les montants. Monnaie par serveur, sans valeur réelle.
const description = "Économie : eco_config, eco_comptes, eco_journal, eco_compteurs, eco_metiers, inventaire, shop_items, shop_roles_temp"

function up(db) {
    db.exec(`
        -- Réglages par serveur (sans ligne : valeurs par défaut d'ECONOMIE.md)
        CREATE TABLE IF NOT EXISTS eco_config (
            guild_id TEXT PRIMARY KEY,
            currency_name TEXT,
            currency_emoji TEXT,
            daily_cap INTEGER,
            multiplier REAL
        );
        -- Solde : toujours >= 0 (vérifié dans la transaction) ; frozen : compte gelé par le staff (#35)
        CREATE TABLE IF NOT EXISTS eco_comptes (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            balance INTEGER NOT NULL DEFAULT 0,
            frozen INTEGER NOT NULL DEFAULT 0,
            streak INTEGER NOT NULL DEFAULT 0,
            last_daily_at INTEGER,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id)
        );
        -- Une ligne par variation de solde : la somme des delta d'un compte est égale à son solde
        CREATE TABLE IF NOT EXISTS eco_journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            delta INTEGER NOT NULL,
            balance_after INTEGER NOT NULL,
            source TEXT NOT NULL,
            other_id TEXT,
            details TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_eco_journal ON eco_journal (guild_id, user_id, id);
        CREATE INDEX IF NOT EXISTS idx_eco_journal_date ON eco_journal (guild_id, created_at);
        -- Compteurs du jour (date AAAA-MM-JJ, heure de Paris) : gains actifs, monnaie envoyée et reçue, travaux comptés
        CREATE TABLE IF NOT EXISTS eco_compteurs (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            day TEXT NOT NULL,
            active_earned INTEGER NOT NULL DEFAULT 0,
            sent INTEGER NOT NULL DEFAULT 0,
            received INTEGER NOT NULL DEFAULT 0,
            works INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, user_id, day)
        );
        CREATE TABLE IF NOT EXISTS eco_metiers (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            job TEXT NOT NULL,
            level INTEGER NOT NULL DEFAULT 1,
            job_xp INTEGER NOT NULL DEFAULT 0,
            last_work_at INTEGER,
            PRIMARY KEY (guild_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS inventaire (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            item TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id, item)
        );
        -- kind : role, role_temp, couleur, objet ; stock NULL = illimité
        CREATE TABLE IF NOT EXISTS shop_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            price INTEGER NOT NULL,
            stock INTEGER,
            role_id TEXT,
            duration_s INTEGER,
            item TEXT,
            active INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_shop_items ON shop_items (guild_id, active);
        -- Rôles temporaires achetés : retirés à l'échéance
        CREATE TABLE IF NOT EXISTS shop_roles_temp (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id, role_id)
        );
    `)
}

function down(db) {
    db.exec(`DROP TABLE IF EXISTS eco_config; DROP TABLE IF EXISTS eco_comptes; DROP TABLE IF EXISTS eco_journal;
        DROP TABLE IF EXISTS eco_compteurs; DROP TABLE IF EXISTS eco_metiers; DROP TABLE IF EXISTS inventaire;
        DROP TABLE IF EXISTS shop_items; DROP TABLE IF EXISTS shop_roles_temp`)
}

module.exports = { description, up, down }
