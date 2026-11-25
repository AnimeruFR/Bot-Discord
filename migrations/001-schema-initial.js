// Schéma initial : tout ce que Fonctions/db.js créait au chargement avant les migrations versionnées.
// up est idempotent : il marche sur une base vide, sur une base créée par une version précédente du bot
// (user_version = 0 mais tables déjà là) et sur une base où il manque des colonnes de guild_config.
const description = "Schéma initial (tables, index, historique des sanctions, colonnes de guild_config)"

// Tables créées par cette migration (down les supprime, index compris)
const TABLES = [
    "warns", "guild_config", "ticket_cooldowns", "guild_left", "cases", "tempbans", "sanction_thresholds",
    "channel_locks", "ticket_types", "tickets", "role_panels", "role_panel_buttons", "giveaways",
    "giveaway_entries", "announcements"
]

function up(db) {
    // La table des sanctions est-elle nouvelle ? (dans ce cas on y reprend les warns existants, voir plus bas)
    const casesExistait = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cases'").get())

    db.exec(`
        CREATE TABLE IF NOT EXISTS warns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            moderator_id TEXT NOT NULL,
            reason TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_warns_membre ON warns (guild_id, user_id);

        CREATE TABLE IF NOT EXISTS guild_config (
            guild_id TEXT PRIMARY KEY,
            log_channel_id TEXT
        );

        CREATE TABLE IF NOT EXISTS ticket_cooldowns (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            opened_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id)
        );

        -- Serveurs que le bot a quittés : leurs données sont effacées 30 jours après (RGPD)
        CREATE TABLE IF NOT EXISTS guild_left (
            guild_id TEXT PRIMARY KEY,
            left_at INTEGER NOT NULL
        );

        -- Historique des sanctions (lot E) : une ligne par action de modération sur un membre
        CREATE TABLE IF NOT EXISTS cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            moderator_id TEXT NOT NULL,
            type TEXT NOT NULL,
            reason TEXT NOT NULL,
            duration_ms INTEGER,
            auto INTEGER NOT NULL DEFAULT 0,
            warn_id INTEGER,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cases_membre ON cases (guild_id, user_id, id);
        CREATE INDEX IF NOT EXISTS idx_cases_date ON cases (created_at);

        -- Bannissements temporaires en cours
        CREATE TABLE IF NOT EXISTS tempbans (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            -- Échéance d'origine : elle figure aussi dans la raison du ban et ne change jamais
            expires_at INTEGER NOT NULL,
            -- Prochain essai si un déban a échoué (sinon NULL : on débannit à expires_at)
            retry_at INTEGER,
            PRIMARY KEY (guild_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_tempbans_fin ON tempbans (expires_at);

        -- Sanctions automatiques : au N-ième warn, on applique l'action
        CREATE TABLE IF NOT EXISTS sanction_thresholds (
            guild_id TEXT NOT NULL,
            warns INTEGER NOT NULL,
            action TEXT NOT NULL,
            duration_ms INTEGER,
            PRIMARY KEY (guild_id, warns)
        );

        -- Salons verrouillés par /lock : permissions de @everyone avant le verrouillage
        CREATE TABLE IF NOT EXISTS channel_locks (
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            previous TEXT NOT NULL,
            PRIMARY KEY (guild_id, channel_id)
        );

        -- Types de tickets (lot F) : catégorie et rôle staff propres à chaque type
        CREATE TABLE IF NOT EXISTS ticket_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            nom TEXT NOT NULL,
            description TEXT,
            category_id TEXT,
            staff_role_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ticket_types ON ticket_types (guild_id);

        -- Suivi des tickets (lot F). Le contenu du formulaire n'est pas stocké : il reste dans le salon.
        CREATE TABLE IF NOT EXISTS tickets (
            channel_id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            type_id INTEGER,
            -- Rôle staff posé sur le salon à sa création (un type modifié ensuite ne change pas l'accès réel)
            staff_role_id TEXT,
            created_at INTEGER NOT NULL,
            -- Message d'avertissement d'inactivité (fermeture 24 h après s'il n'y a pas de réponse)
            warn_message_id TEXT,
            claimed_by TEXT,
            claimed_at INTEGER,
            status TEXT NOT NULL DEFAULT 'ouvert',
            closed_at INTEGER,
            warned_at INTEGER,
            rating INTEGER,
            rated_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_tickets_serveur ON tickets (guild_id, status);

        -- Lot G : rôles par boutons
        CREATE TABLE IF NOT EXISTS role_panels (
            message_id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            titre TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'multiple'
        );
        CREATE TABLE IF NOT EXISTS role_panel_buttons (
            message_id TEXT NOT NULL,
            guild_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            label TEXT NOT NULL,
            PRIMARY KEY (message_id, role_id)
        );

        -- Lot G : giveaways (le tirage survit à un redémarrage)
        CREATE TABLE IF NOT EXISTS giveaways (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            message_id TEXT,
            prix TEXT NOT NULL,
            gagnants INTEGER NOT NULL,
            ends_at INTEGER NOT NULL,
            host_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'en_cours',
            winners TEXT NOT NULL DEFAULT '[]',
            ended_at INTEGER,
            -- 0 : résultat à publier, 2 : publication en cours, 1 : publié (republié au passage suivant après un crash)
            announced INTEGER NOT NULL DEFAULT 0,
            -- Tous les gagnants des tirages précédents (exclus d'un nouveau tirage)
            previous_winners TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS idx_giveaways_fin ON giveaways (status, ends_at);
        CREATE TABLE IF NOT EXISTS giveaway_entries (
            giveaway_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            PRIMARY KEY (giveaway_id, user_id)
        );

        -- Lot G : annonces programmées (supprimées une fois envoyées)
        CREATE TABLE IF NOT EXISTS announcements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            author_id TEXT NOT NULL,
            contenu TEXT NOT NULL,
            send_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_announcements_date ON announcements (send_at);
    `)

    // Lot E : les warns d'avant l'historique des sanctions apparaissent dans cases (seulement si cases vient d'être créée)
    if (!casesExistait) {
        db.exec(`INSERT INTO cases (guild_id, user_id, moderator_id, type, reason, warn_id, created_at)
            SELECT guild_id, user_id, moderator_id, 'warn', reason, id, created_at FROM warns ORDER BY id`)
    }

    // Colonnes de guild_config ajoutées au fil des lots (les bases créées avant ne les ont pas)
    const colonnes = db.prepare("PRAGMA table_info(guild_config)").all().map(c => c.name)
    const ajouter = (colonne, definition) => {
        if (!colonnes.includes(colonne)) db.exec(`ALTER TABLE guild_config ADD COLUMN ${colonne} ${definition}`)
    }
    // Lot C
    ajouter("ticket_category_id", "TEXT")
    ajouter("ticket_staff_role_id", "TEXT")
    // Lot F : fermeture automatique des tickets inactifs (0 = désactivée)
    ajouter("ticket_inactivity_days", "INTEGER NOT NULL DEFAULT 0")
    // Lot G : messages de bienvenue et d'au revoir
    for (const colonne of ["welcome_channel_id", "welcome_message", "goodbye_channel_id", "goodbye_message"]) ajouter(colonne, "TEXT")
    // Lot H : apparence et langue du serveur (NULL = valeur par défaut)
    for (const colonne of ["langue", "ticket_panel_title", "ticket_panel_description"]) ajouter(colonne, "TEXT")
    ajouter("couleur", "INTEGER")
}

// Supprime les tables créées par up (leurs index disparaissent avec elles)
function down(db) {
    for (const table of TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`)
}

module.exports = { description, up, down }
