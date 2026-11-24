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
db.exec(`
    PRAGMA journal_mode = WAL;

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
`)

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
    getCooldown: db.prepare("SELECT opened_at FROM ticket_cooldowns WHERE guild_id = ? AND user_id = ?"),
    setCooldown: db.prepare(`INSERT INTO ticket_cooldowns (guild_id, user_id, opened_at) VALUES (?, ?, ?)
        ON CONFLICT (guild_id, user_id) DO UPDATE SET opened_at = excluded.opened_at`),
    purgeCooldowns: db.prepare("DELETE FROM ticket_cooldowns WHERE opened_at < ?")
}

module.exports = {
    addWarn(guildId, userId, moderatorId, reason) {
        const resultat = requetes.addWarn.run(guildId, userId, moderatorId, reason, Date.now())
        return Number(resultat.lastInsertRowid)
    },
    listWarns: (guildId, userId, limite = 10) => requetes.listWarns.all(guildId, userId, limite),
    countWarns: (guildId, userId) => requetes.countWarns.get(guildId, userId).total,
    getWarn: (guildId, id) => requetes.getWarn.get(guildId, id),
    removeWarn: (guildId, id) => requetes.removeWarn.run(guildId, id).changes > 0,

    getLogChannel: guildId => requetes.getLogChannel.get(guildId)?.log_channel_id ?? null,
    setLogChannel: (guildId, channelId) => requetes.setLogChannel.run(guildId, channelId),

    getTicketCooldown: (guildId, userId) => requetes.getCooldown.get(guildId, userId)?.opened_at ?? 0,
    setTicketCooldown: (guildId, userId) => requetes.setCooldown.run(guildId, userId, Date.now()),
    purgeTicketCooldowns: avant => requetes.purgeCooldowns.run(avant),

    close: () => db.close()
}
