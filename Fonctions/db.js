const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')
const { loadEnv } = require('./env')

// Le .env doit être lu avant d'ouvrir la base, pour que DATABASE_PATH soit pris en compte
loadEnv()

// Base SQLite locale (data/bot.db). DATABASE_PATH=":memory:" pour les tests.
// Toutes les requêtes sont préparées avec des paramètres : pas d'injection SQL possible.
const fichier = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'bot.db')
if (fichier !== ':memory:') fs.mkdirSync(path.dirname(fichier), { recursive: true })

const db = new DatabaseSync(fichier)
// La table des sanctions est-elle nouvelle ? (dans ce cas on y reprend les warns existants, voir plus bas)
const casesExistait = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cases'").get())
db.exec(`
    PRAGMA journal_mode = WAL;
    -- Les données effacées sont écrasées dans le fichier (pas seulement marquées comme libres)
    PRAGMA secure_delete = ON;
`)
// Création des tables et migration dans une seule transaction : un crash au milieu ne laisse rien à moitié fait
db.exec("BEGIN")
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
`)

// Migration lot E : les warns d'avant le lot E apparaissent dans l'historique
if (!casesExistait) {
    db.exec(`INSERT INTO cases (guild_id, user_id, moderator_id, type, reason, warn_id, created_at)
        SELECT guild_id, user_id, moderator_id, 'warn', reason, id, created_at FROM warns ORDER BY id`)
}
db.exec("COMMIT")

// Migration : colonnes ajoutées au lot C (les bases créées avant ne les ont pas)
const colonnes = db.prepare("PRAGMA table_info(guild_config)").all().map(c => c.name)
if (!colonnes.includes("ticket_category_id")) db.exec("ALTER TABLE guild_config ADD COLUMN ticket_category_id TEXT")
if (!colonnes.includes("ticket_staff_role_id")) db.exec("ALTER TABLE guild_config ADD COLUMN ticket_staff_role_id TEXT")

const requetes = {
    addWarn: db.prepare("INSERT INTO warns (guild_id, user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?)"),
    listWarns: db.prepare("SELECT * FROM warns WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?"),
    countWarns: db.prepare("SELECT COUNT(*) AS total FROM warns WHERE guild_id = ? AND user_id = ?"),
    // guild_id est toujours dans le WHERE : on ne peut jamais lire ou supprimer le warn d'un autre serveur
    getWarn: db.prepare("SELECT * FROM warns WHERE guild_id = ? AND id = ?"),
    removeWarn: db.prepare("DELETE FROM warns WHERE guild_id = ? AND id = ?"),
    getLogChannel: db.prepare("SELECT log_channel_id FROM guild_config WHERE guild_id = ?"),
    setLogChannel: db.prepare(`INSERT INTO guild_config (guild_id, log_channel_id) VALUES (?, ?)
        ON CONFLICT (guild_id) DO UPDATE SET log_channel_id = excluded.log_channel_id`),
    getTicketConfig: db.prepare("SELECT ticket_category_id, ticket_staff_role_id FROM guild_config WHERE guild_id = ?"),
    setTicketConfig: db.prepare(`INSERT INTO guild_config (guild_id, ticket_category_id, ticket_staff_role_id) VALUES (?, ?, ?)
        ON CONFLICT (guild_id) DO UPDATE SET
            ticket_category_id = COALESCE(excluded.ticket_category_id, ticket_category_id),
            ticket_staff_role_id = COALESCE(excluded.ticket_staff_role_id, ticket_staff_role_id)`),
    resetTicketConfig: db.prepare("UPDATE guild_config SET ticket_category_id = NULL, ticket_staff_role_id = NULL WHERE guild_id = ?"),
    getCooldown: db.prepare("SELECT opened_at FROM ticket_cooldowns WHERE guild_id = ? AND user_id = ?"),
    setCooldown: db.prepare(`INSERT INTO ticket_cooldowns (guild_id, user_id, opened_at) VALUES (?, ?, ?)
        ON CONFLICT (guild_id, user_id) DO UPDATE SET opened_at = excluded.opened_at`),
    purgeCooldowns: db.prepare("DELETE FROM ticket_cooldowns WHERE opened_at < ?"),

    markLeft: db.prepare("INSERT OR IGNORE INTO guild_left (guild_id, left_at) VALUES (?, ?)"),
    cancelLeft: db.prepare("DELETE FROM guild_left WHERE guild_id = ?"),
    leftBefore: db.prepare("SELECT guild_id FROM guild_left WHERE left_at < ?"),
    guildsWithData: db.prepare(`SELECT guild_id FROM warns UNION SELECT guild_id FROM guild_config
        UNION SELECT guild_id FROM ticket_cooldowns UNION SELECT guild_id FROM cases UNION SELECT guild_id FROM tempbans
        UNION SELECT guild_id FROM sanction_thresholds UNION SELECT guild_id FROM channel_locks`),
    deleteParServeur: ["warns", "guild_config", "ticket_cooldowns", "cases", "tempbans", "sanction_thresholds", "channel_locks"]
        .map(table => db.prepare(`DELETE FROM ${table} WHERE guild_id = ?`)),

    addCase: db.prepare(`INSERT INTO cases (guild_id, user_id, moderator_id, type, reason, duration_ms, auto, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    listCases: db.prepare("SELECT * FROM cases WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?"),
    countCases: db.prepare("SELECT COUNT(*) AS total FROM cases WHERE guild_id = ? AND user_id = ?"),
    addWarnCase: db.prepare(`INSERT INTO cases (guild_id, user_id, moderator_id, type, reason, warn_id, created_at)
        VALUES (?, ?, ?, 'warn', ?, ?, ?)`),
    anonymiserWarnCase: db.prepare("UPDATE cases SET reason = '(avertissement retiré)' WHERE guild_id = ? AND warn_id = ?"),
    purgeCases: db.prepare("DELETE FROM cases WHERE created_at < ?"),
    reporterTempban: db.prepare("UPDATE tempbans SET retry_at = ? WHERE guild_id = ? AND user_id = ?"),

    setTempban: db.prepare(`INSERT INTO tempbans (guild_id, user_id, expires_at) VALUES (?, ?, ?)
        ON CONFLICT (guild_id, user_id) DO UPDATE SET expires_at = excluded.expires_at, retry_at = NULL`),
    removeTempban: db.prepare("DELETE FROM tempbans WHERE guild_id = ? AND user_id = ?"),
    getTempban: db.prepare("SELECT expires_at FROM tempbans WHERE guild_id = ? AND user_id = ?"),
    // Pas de LIMIT : des entrées ignorées (serveur indisponible) ne doivent pas bloquer les suivantes
    expiredTempbans: db.prepare("SELECT * FROM tempbans WHERE COALESCE(retry_at, expires_at) <= ? ORDER BY expires_at"),

    setThreshold: db.prepare(`INSERT INTO sanction_thresholds (guild_id, warns, action, duration_ms) VALUES (?, ?, ?, ?)
        ON CONFLICT (guild_id, warns) DO UPDATE SET action = excluded.action, duration_ms = excluded.duration_ms`),
    removeThreshold: db.prepare("DELETE FROM sanction_thresholds WHERE guild_id = ? AND warns = ?"),
    getThreshold: db.prepare("SELECT * FROM sanction_thresholds WHERE guild_id = ? AND warns = ?"),
    listThresholds: db.prepare("SELECT * FROM sanction_thresholds WHERE guild_id = ? ORDER BY warns"),

    addLock: db.prepare("INSERT OR IGNORE INTO channel_locks (guild_id, channel_id, previous) VALUES (?, ?, ?)"),
    getLock: db.prepare("SELECT previous FROM channel_locks WHERE guild_id = ? AND channel_id = ?"),
    removeLock: db.prepare("DELETE FROM channel_locks WHERE guild_id = ? AND channel_id = ?"),
    backup: db.prepare("VACUUM INTO ?")
}

module.exports = {
    // Le warn et sa ligne d'historique sont écrits ensemble (tout ou rien)
    addWarn(guildId, userId, moderatorId, reason) {
        db.exec("BEGIN")
        try {
            const maintenant = Date.now()
            const id = Number(requetes.addWarn.run(guildId, userId, moderatorId, reason, maintenant).lastInsertRowid)
            requetes.addWarnCase.run(guildId, userId, moderatorId, reason, id, maintenant)
            db.exec("COMMIT")
            return id
        } catch (err) {
            db.exec("ROLLBACK")
            throw err
        }
    },
    listWarns: (guildId, userId, limite = 10) => requetes.listWarns.all(guildId, userId, limite),
    countWarns: (guildId, userId) => requetes.countWarns.get(guildId, userId).total,
    getWarn: (guildId, id) => requetes.getWarn.get(guildId, id),
    // Un warn retiré ne garde pas sa raison dans l'historique (minimisation des données)
    removeWarn(guildId, id) {
        const retire = requetes.removeWarn.run(guildId, id).changes > 0
        if (retire) requetes.anonymiserWarnCase.run(guildId, id)
        return retire
    },

    getLogChannel: guildId => requetes.getLogChannel.get(guildId)?.log_channel_id ?? null,
    setLogChannel: (guildId, channelId) => requetes.setLogChannel.run(guildId, channelId),

    getTicketConfig(guildId) {
        const ligne = requetes.getTicketConfig.get(guildId)
        return { categoryId: ligne?.ticket_category_id ?? null, staffRoleId: ligne?.ticket_staff_role_id ?? null }
    },
    // Une valeur null garde la valeur actuelle (changer la catégorie ne remet pas le rôle à zéro)
    setTicketConfig: (guildId, categoryId, staffRoleId) => requetes.setTicketConfig.run(guildId, categoryId, staffRoleId),
    resetTicketConfig: guildId => requetes.resetTicketConfig.run(guildId),

    getTicketCooldown: (guildId, userId) => requetes.getCooldown.get(guildId, userId)?.opened_at ?? 0,
    setTicketCooldown: (guildId, userId) => requetes.setCooldown.run(guildId, userId, Date.now()),
    purgeTicketCooldowns: avant => requetes.purgeCooldowns.run(avant),

    // Départ d'un serveur : on note la date (sans écraser une date déjà notée), ou on l'annule s'il revient
    markGuildLeft: (guildId, date = Date.now()) => requetes.markLeft.run(guildId, date),
    cancelGuildLeft: guildId => requetes.cancelLeft.run(guildId),
    guildsLeftBefore: date => requetes.leftBefore.all(date).map(l => l.guild_id),
    guildsWithData: () => requetes.guildsWithData.all().map(l => l.guild_id),

    // Efface toutes les données d'un serveur, d'un seul bloc (tout ou rien)
    deleteGuildData(guildId) {
        db.exec("BEGIN")
        try {
            let total = 0
            for (const requete of requetes.deleteParServeur) total += requete.run(guildId).changes
            requetes.cancelLeft.run(guildId)
            db.exec("COMMIT")
            return total
        } catch (err) {
            db.exec("ROLLBACK")
            throw err
        }
    },

    // Historique des sanctions (type : warn, unwarn, mute, unmute, kick, ban, tempban, unban)
    addCase(guildId, { userId, moderatorId, type, reason, durationMs = null, auto = false }) {
        const raison = reason?.trim() || "Aucune raison fournie"
        const resultat = requetes.addCase.run(guildId, userId, moderatorId, type, raison, durationMs, auto ? 1 : 0, Date.now())
        return Number(resultat.lastInsertRowid)
    },
    listCases: (guildId, userId, limite = 15) => requetes.listCases.all(guildId, userId, limite),
    countCases: (guildId, userId) => requetes.countCases.get(guildId, userId).total,
    // Historique gardé 2 ans au plus (voir docs/confidentialite.md)
    purgeOldCases: avant => requetes.purgeCases.run(avant).changes,

    setTempban: (guildId, userId, expiresAt) => requetes.setTempban.run(guildId, userId, expiresAt),
    removeTempban: (guildId, userId) => requetes.removeTempban.run(guildId, userId).changes > 0,
    getTempban: (guildId, userId) => requetes.getTempban.get(guildId, userId)?.expires_at ?? null,
    reporterTempban: (guildId, userId, retryAt) => requetes.reporterTempban.run(retryAt, guildId, userId),
    expiredTempbans: (maintenant = Date.now()) => requetes.expiredTempbans.all(maintenant),

    setThreshold: (guildId, warns, action, durationMs = null) => requetes.setThreshold.run(guildId, warns, action, durationMs),
    removeThreshold: (guildId, warns) => requetes.removeThreshold.run(guildId, warns).changes > 0,
    getThreshold: (guildId, warns) => requetes.getThreshold.get(guildId, warns) ?? null,
    listThresholds: guildId => requetes.listThresholds.all(guildId),

    // Renvoie false si le salon est déjà verrouillé (deux /lock simultanés : un seul gagne)
    addLock: (guildId, channelId, previous) => requetes.addLock.run(guildId, channelId, JSON.stringify(previous)).changes > 0,
    getLock(guildId, channelId) {
        const ligne = requetes.getLock.get(guildId, channelId)
        return ligne ? JSON.parse(ligne.previous) : null
    },
    removeLock: (guildId, channelId) => requetes.removeLock.run(guildId, channelId).changes > 0,

    // Copie cohérente de la base, même pendant que le bot l'utilise
    backupTo: destination => requetes.backup.run(destination),
    fichier,

    close: () => db.close()
}
