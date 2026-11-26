const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')
const { loadEnv } = require('./env')
const { migrer, etat, sauvegarderAvantMigration, attendreSchema } = require('./migrations')

// Le .env doit être lu avant d'ouvrir la base, pour que DATABASE_PATH soit pris en compte
loadEnv()

// Base SQLite locale (data/bot.db). DATABASE_PATH=":memory:" pour les tests.
// Toutes les requêtes sont préparées avec des paramètres : pas d'injection SQL possible.
const fichier = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'bot.db')
if (fichier !== ':memory:') fs.mkdirSync(path.dirname(fichier), { recursive: true })

// timeout : le bot et le tableau de bord écrivent dans la même base ; on attend jusqu'à 5 s qu'elle se libère
const db = new DatabaseSync(fichier, { timeout: 5000 })
db.exec(`
    PRAGMA journal_mode = WAL;
    -- Les données effacées sont écrasées dans le fichier (pas seulement marquées comme libres)
    PRAGMA secure_delete = ON;
`)

// Schéma : migrations versionnées (dossier migrations/, version dans PRAGMA user_version).
// Si une migration échoue, l'erreur remonte et le bot ne démarre pas.
// DATABASE_NO_MIGRATE=1 (service dashboard) : ce processus ne sauvegarde ni ne migre, il attend que le bot l'ait fait.
if (process.env.DATABASE_NO_MIGRATE === '1' && fichier !== ':memory:') {
    attendreSchema(db)
} else {
    if (etat(db).enAttente.length) {
        // Base fichier déjà remplie : on la sauvegarde avant de toucher au schéma
        const copie = sauvegarderAvantMigration(db, fichier)
        if (copie) console.log(`Sauvegarde avant migration : ${copie}`)
    }
    const migration = migrer(db)
    if (migration.appliquees.length && fichier !== ':memory:') console.log(`Base migrée de v${migration.avant} à v${migration.apres}`)
}
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
        UNION SELECT guild_id FROM sanction_thresholds UNION SELECT guild_id FROM channel_locks
        UNION SELECT guild_id FROM ticket_types UNION SELECT guild_id FROM tickets UNION SELECT guild_id FROM role_panels
        UNION SELECT guild_id FROM giveaways UNION SELECT guild_id FROM announcements
        UNION SELECT guild_id FROM guild_modules UNION SELECT guild_id FROM guild_salons_jeux
        UNION SELECT guild_id FROM log_channels UNION SELECT guild_id FROM staff_notes UNION SELECT guild_id FROM mod_reasons
        UNION SELECT guild_id FROM case_edits UNION SELECT guild_id FROM ticket_macros UNION SELECT guild_id FROM account_filter
        UNION SELECT guild_id FROM automod_config
        UNION SELECT guild_id FROM raid_config
        UNION SELECT guild_id FROM raid_events
        UNION SELECT guild_id FROM verification_config
        UNION SELECT guild_id FROM nick_filter
        UNION SELECT guild_id FROM appeals
        UNION SELECT guild_id FROM quarantine_config
        UNION SELECT guild_id FROM quarantines
        UNION SELECT guild_id FROM config_audit
        UNION SELECT guild_id FROM ticket_fields
        UNION SELECT guild_id FROM ticket_events
        UNION SELECT guild_id FROM phishing_whitelist UNION SELECT guild_id FROM verification_attempts`),
    deleteParServeur: ["warns", "guild_config", "ticket_cooldowns", "cases", "tempbans", "sanction_thresholds", "channel_locks",
        "ticket_types", "tickets", "role_panels", "role_panel_buttons", "announcements", "guild_modules", "guild_salons_jeux",
        "log_channels", "staff_notes", "mod_reasons", "case_edits", "ticket_macros", "account_filter", "automod_config",
        "raid_config", "raid_events", "verification_config", "nick_filter", "appeals", "quarantine_config", "quarantines", "config_audit", "ticket_fields", "ticket_events", "phishing_whitelist", "verification_attempts"]
        .map(table => db.prepare(`DELETE FROM ${table} WHERE guild_id = ?`)),

    // Types de tickets
    listTicketTypes: db.prepare("SELECT * FROM ticket_types WHERE guild_id = ? ORDER BY id"),
    getTicketType: db.prepare("SELECT * FROM ticket_types WHERE guild_id = ? AND id = ?"),
    addTicketType: db.prepare("INSERT INTO ticket_types (guild_id, nom, description, category_id, staff_role_id) VALUES (?, ?, ?, ?, ?)"),
    updateTicketType: db.prepare(`UPDATE ticket_types SET nom = COALESCE(?, nom), description = COALESCE(?, description),
        category_id = COALESCE(?, category_id), staff_role_id = COALESCE(?, staff_role_id) WHERE guild_id = ? AND id = ?`),
    removeTicketType: db.prepare("DELETE FROM ticket_types WHERE guild_id = ? AND id = ?"),

    // Tickets
    addTicket: db.prepare(`INSERT OR IGNORE INTO tickets (channel_id, guild_id, owner_id, type_id, staff_role_id, created_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)`),
    getTicket: db.prepare("SELECT * FROM tickets WHERE channel_id = ?"),
    openTicketsOf: db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND status = 'ouvert'"),
    // claimed_at garde la date de la 1re prise en charge (pour les stats), même après une libération
    claimTicket: db.prepare("UPDATE tickets SET claimed_by = ?, claimed_at = COALESCE(claimed_at, ?) WHERE channel_id = ? AND claimed_by IS NULL"),
    takeOverTicket: db.prepare("UPDATE tickets SET claimed_by = ?, claimed_at = COALESCE(claimed_at, ?) WHERE channel_id = ?"),
    unclaimTicket: db.prepare("UPDATE tickets SET claimed_by = NULL WHERE channel_id = ? AND claimed_by = ?"),
    setTicketStatus: db.prepare("UPDATE tickets SET status = ?, closed_at = COALESCE(closed_at, ?) WHERE channel_id = ?"),
    // À la suppression, closed_at prend la date de suppression (le délai de 7 jours pour noter part de là)
    setTicketDeleted: db.prepare("UPDATE tickets SET status = 'supprime', closed_at = ? WHERE channel_id = ? AND status != 'supprime'"),
    unfinishedTickets: db.prepare("SELECT * FROM tickets WHERE status != 'supprime'"),
    setTicketWarned: db.prepare("UPDATE tickets SET warned_at = ?, warn_message_id = ? WHERE channel_id = ?"),
    rateTicket: db.prepare("UPDATE tickets SET rating = ?, rated_at = ? WHERE channel_id = ? AND owner_id = ? AND rating IS NULL AND status = 'supprime'"),
    purgeTickets: db.prepare("DELETE FROM tickets WHERE status = 'supprime' AND closed_at < ?"),
    ticketsSince: db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND created_at >= ?"),
    getInactivity: db.prepare("SELECT ticket_inactivity_days FROM guild_config WHERE guild_id = ?"),
    setInactivity: db.prepare(`INSERT INTO guild_config (guild_id, ticket_inactivity_days) VALUES (?, ?)
        ON CONFLICT (guild_id) DO UPDATE SET ticket_inactivity_days = excluded.ticket_inactivity_days`),
    // Lot G
    addRolePanel: db.prepare("INSERT INTO role_panels (message_id, guild_id, channel_id, titre, mode) VALUES (?, ?, ?, ?, ?)"),
    getRolePanel: db.prepare("SELECT * FROM role_panels WHERE guild_id = ? AND message_id = ?"),
    listRolePanels: db.prepare("SELECT * FROM role_panels WHERE guild_id = ?"),
    removeRolePanel: db.prepare("DELETE FROM role_panels WHERE guild_id = ? AND message_id = ?"),
    removeRolePanelButtons: db.prepare("DELETE FROM role_panel_buttons WHERE guild_id = ? AND message_id = ?"),
    addRoleButton: db.prepare("INSERT OR REPLACE INTO role_panel_buttons (message_id, guild_id, role_id, label) VALUES (?, ?, ?, ?)"),
    removeRoleButton: db.prepare("DELETE FROM role_panel_buttons WHERE guild_id = ? AND message_id = ? AND role_id = ?"),
    listRoleButtons: db.prepare("SELECT * FROM role_panel_buttons WHERE guild_id = ? AND message_id = ? ORDER BY rowid"),
    getRoleButton: db.prepare("SELECT * FROM role_panel_buttons WHERE guild_id = ? AND message_id = ? AND role_id = ?"),
    panelsOfRole: db.prepare("SELECT DISTINCT message_id FROM role_panel_buttons WHERE guild_id = ? AND role_id = ?"),
    removeButtonsOfRole: db.prepare("DELETE FROM role_panel_buttons WHERE guild_id = ? AND role_id = ?"),
    panelsOfChannel: db.prepare("SELECT message_id FROM role_panels WHERE guild_id = ? AND channel_id = ?"),

    addGiveaway: db.prepare(`INSERT INTO giveaways (guild_id, channel_id, prix, gagnants, ends_at, host_id) VALUES (?, ?, ?, ?, ?, ?)`),
    setGiveawayMessage: db.prepare("UPDATE giveaways SET message_id = ? WHERE id = ?"),
    getGiveaway: db.prepare("SELECT * FROM giveaways WHERE guild_id = ? AND id = ?"),
    getGiveawayById: db.prepare("SELECT * FROM giveaways WHERE id = ?"),
    listGiveaways: db.prepare("SELECT * FROM giveaways WHERE guild_id = ? ORDER BY id DESC LIMIT 15"),
    countActiveGiveaways: db.prepare("SELECT COUNT(*) AS total FROM giveaways WHERE guild_id = ? AND status = 'en_cours'"),
    dueGiveaways: db.prepare("SELECT * FROM giveaways WHERE status = 'en_cours' AND ends_at <= ? ORDER BY ends_at"),
    // Fin + gagnants en une seule écriture, seulement si encore en cours : un seul tirage même si deux passages se chevauchent
    endGiveaway: db.prepare("UPDATE giveaways SET status = 'termine', ended_at = ?, winners = ?, announced = 0 WHERE id = ? AND status = 'en_cours'"),
    // Nouveau tirage (relancer) : nouveaux gagnants, à republier
    setGiveawayWinners: db.prepare("UPDATE giveaways SET winners = ?, previous_winners = ?, announced = 0 WHERE id = ? AND status = 'termine'"),
    setGiveawayAnnounced: db.prepare("UPDATE giveaways SET announced = 1 WHERE id = ?"),
    // Réservation de la publication : un seul publieur à la fois (commande et tâche de fond)
    reserveGiveawayAnnounce: db.prepare("UPDATE giveaways SET announced = 2 WHERE id = ? AND announced = 0"),
    resetGiveawayAnnouncing: db.prepare("UPDATE giveaways SET announced = 0 WHERE announced = 2"),
    removeEntriesOfMember: db.prepare(`DELETE FROM giveaway_entries WHERE user_id = ?
        AND giveaway_id IN (SELECT id FROM giveaways WHERE guild_id = ? AND status = 'en_cours')`),
    unannouncedGiveaways: db.prepare("SELECT * FROM giveaways WHERE status = 'termine' AND announced = 0"),
    deleteGiveaway: db.prepare("DELETE FROM giveaways WHERE id = ?"),
    deleteGiveawayEntries: db.prepare("DELETE FROM giveaway_entries WHERE giveaway_id = ?"),
    addEntry: db.prepare("INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)"),
    removeEntry: db.prepare("DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?"),
    listEntries: db.prepare("SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?"),
    countEntries: db.prepare("SELECT COUNT(*) AS total FROM giveaway_entries WHERE giveaway_id = ?"),
    deleteEntriesOfGuild: db.prepare("DELETE FROM giveaway_entries WHERE giveaway_id IN (SELECT id FROM giveaways WHERE guild_id = ?)"),
    deleteGiveawaysOfGuild: db.prepare("DELETE FROM giveaways WHERE guild_id = ?"),
    purgeEntries: db.prepare("DELETE FROM giveaway_entries WHERE giveaway_id IN (SELECT id FROM giveaways WHERE status = 'termine' AND ended_at < ?)"),
    purgeGiveaways: db.prepare("DELETE FROM giveaways WHERE status = 'termine' AND ended_at < ?"),

    addAnnouncement: db.prepare("INSERT INTO announcements (guild_id, channel_id, author_id, contenu, send_at) VALUES (?, ?, ?, ?, ?)"),
    listAnnouncements: db.prepare("SELECT * FROM announcements WHERE guild_id = ? ORDER BY send_at"),
    countAnnouncements: db.prepare("SELECT COUNT(*) AS total FROM announcements WHERE guild_id = ?"),
    removeAnnouncement: db.prepare("DELETE FROM announcements WHERE guild_id = ? AND id = ?"),
    dueAnnouncements: db.prepare("SELECT * FROM announcements WHERE send_at <= ? ORDER BY send_at"),
    deleteAnnouncementById: db.prepare("DELETE FROM announcements WHERE id = ?"),

    getWelcome: db.prepare("SELECT welcome_channel_id, welcome_message, goodbye_channel_id, goodbye_message FROM guild_config WHERE guild_id = ?"),
    setWelcome: db.prepare(`INSERT INTO guild_config (guild_id, welcome_channel_id, welcome_message) VALUES (?, ?, ?)
        ON CONFLICT (guild_id) DO UPDATE SET welcome_channel_id = excluded.welcome_channel_id, welcome_message = excluded.welcome_message`),
    setGoodbye: db.prepare(`INSERT INTO guild_config (guild_id, goodbye_channel_id, goodbye_message) VALUES (?, ?, ?)
        ON CONFLICT (guild_id) DO UPDATE SET goodbye_channel_id = excluded.goodbye_channel_id, goodbye_message = excluded.goodbye_message`),

    // Modules activables (idée #87)
    listModules: db.prepare("SELECT module, actif FROM guild_modules WHERE guild_id = ?"),
    setModule: db.prepare(`INSERT INTO guild_modules (guild_id, module, actif) VALUES (?, ?, ?)
        ON CONFLICT (guild_id, module) DO UPDATE SET actif = excluded.actif`),
    listSalonsJeux: db.prepare("SELECT channel_id FROM guild_salons_jeux WHERE guild_id = ? ORDER BY channel_id"),
    clearSalonsJeux: db.prepare("DELETE FROM guild_salons_jeux WHERE guild_id = ?"),
    addSalonJeux: db.prepare("INSERT OR IGNORE INTO guild_salons_jeux (guild_id, channel_id) VALUES (?, ?)"),
    getStaffRole: db.prepare("SELECT staff_role_id FROM guild_config WHERE guild_id = ?"),
    setStaffRole: db.prepare(`INSERT INTO guild_config (guild_id, staff_role_id) VALUES (?, ?)
        ON CONFLICT (guild_id) DO UPDATE SET staff_role_id = excluded.staff_role_id`),
    getApparence: db.prepare("SELECT langue, couleur, ticket_panel_title, ticket_panel_description FROM guild_config WHERE guild_id = ?"),
    setLangue: db.prepare(`INSERT INTO guild_config (guild_id, langue) VALUES (?, ?)
        ON CONFLICT (guild_id) DO UPDATE SET langue = excluded.langue`),
    setCouleur: db.prepare(`INSERT INTO guild_config (guild_id, couleur) VALUES (?, ?)
        ON CONFLICT (guild_id) DO UPDATE SET couleur = excluded.couleur`),
    setPanneauTicket: db.prepare(`INSERT INTO guild_config (guild_id, ticket_panel_title, ticket_panel_description) VALUES (?, ?, ?)
        ON CONFLICT (guild_id) DO UPDATE SET ticket_panel_title = excluded.ticket_panel_title, ticket_panel_description = excluded.ticket_panel_description`),

    guildsWithInactivity: db.prepare("SELECT guild_id, ticket_inactivity_days FROM guild_config WHERE ticket_inactivity_days > 0"),

    addCase: db.prepare(`INSERT INTO cases (guild_id, user_id, moderator_id, type, reason, duration_ms, auto, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    listCases: db.prepare("SELECT * FROM cases WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?"),
    countCases: db.prepare("SELECT COUNT(*) AS total FROM cases WHERE guild_id = ? AND user_id = ?"),
    countActiveCases: db.prepare("SELECT COUNT(*) AS total FROM cases WHERE guild_id = ? AND user_id = ? AND cancelled_at IS NULL"),
    addWarnCase: db.prepare(`INSERT INTO cases (guild_id, user_id, moderator_id, type, reason, warn_id, created_at)
        VALUES (?, ?, ?, 'warn', ?, ?, ?)`),
    anonymiserWarnCase: db.prepare("UPDATE cases SET reason = '(avertissement retiré)' WHERE guild_id = ? AND warn_id = ?"),
    purgeCases: db.prepare("DELETE FROM cases WHERE created_at < ?"),
    purgeCaseEdits: db.prepare("DELETE FROM case_edits WHERE created_at < ? OR case_id NOT IN (SELECT id FROM cases)"),
    purgeStaffNotes: db.prepare("DELETE FROM staff_notes WHERE created_at < ?"),
    // Phase 2 (tribunal S3) : les appels suivent leur sanction, la trace d'un ticket suit le ticket
    purgeAppeals: db.prepare("DELETE FROM appeals WHERE created_at < ? OR case_id NOT IN (SELECT id FROM cases WHERE cases.guild_id = appeals.guild_id)"),
    purgeTicketEvents: db.prepare("DELETE FROM ticket_events WHERE channel_id NOT IN (SELECT channel_id FROM tickets)"),
    purgeConfigAudit: db.prepare("DELETE FROM config_audit WHERE created_at < ?"),
    purgeRaidEvents: db.prepare("DELETE FROM raid_events WHERE ended_at IS NOT NULL AND ended_at < ?"),
    purgeQuarantines: db.prepare("DELETE FROM quarantines WHERE created_at < ?"),
    purgeVerificationAttempts: db.prepare("DELETE FROM verification_attempts WHERE updated_at < ?"),
    purgeWarns: db.prepare("DELETE FROM warns WHERE created_at < ?"),
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

    // Modules désactivés du serveur : { "communaute.jeux": false, … } (absent = actif)
    getModules: guildId => Object.fromEntries(requetes.listModules.all(guildId).map(l => [l.module, l.actif === 1])),
    setModule: (guildId, module, actif) => requetes.setModule.run(guildId, module, actif ? 1 : 0),
    // Salons où les jeux sont autorisés (liste vide = partout). Remplacés d'un bloc.
    getSalonsJeux: guildId => requetes.listSalonsJeux.all(guildId).map(l => l.channel_id),
    setSalonsJeux(guildId, salons) {
        module.exports.transaction(() => {
            requetes.clearSalonsJeux.run(guildId)
            for (const id of salons) requetes.addSalonJeux.run(guildId, id)
        })
    },

    // Rôle staff du serveur (null = aucun) : voir Fonctions/staff.js
    getStaffRole: guildId => requetes.getStaffRole.get(guildId)?.staff_role_id ?? null,
    setStaffRole: (guildId, roleId) => requetes.setStaffRole.run(guildId, roleId ?? null),

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
            let total = requetes.deleteEntriesOfGuild.run(guildId).changes + requetes.deleteGiveawaysOfGuild.run(guildId).changes
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
    // Sanctions non annulées d'un membre
    countActiveCases: (guildId, userId) => requetes.countActiveCases.get(guildId, userId).total,
    // Historique gardé 2 ans au plus (voir docs/confidentialite.md)
    // Notes du staff (#8) et trace des modifications (#12) suivent la même durée que l'historique
    purgeOldCases(avant) {
        const total = requetes.purgeCases.run(avant).changes
        requetes.purgeStaffNotes.run(avant)
        requetes.purgeCaseEdits.run(avant)
        requetes.purgeAppeals.run(avant)
        return total
    },
    purgeOldWarns: avant => requetes.purgeWarns.run(avant).changes,

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
    // Types de tickets (guild_id toujours dans le WHERE : jamais le type d'un autre serveur)
    listTicketTypes: guildId => requetes.listTicketTypes.all(guildId),
    getTicketType: (guildId, id) => requetes.getTicketType.get(guildId, id) ?? null,
    addTicketType: (guildId, { nom, description = null, categoryId = null, staffRoleId = null }) =>
        Number(requetes.addTicketType.run(guildId, nom, description, categoryId, staffRoleId).lastInsertRowid),
    // Une valeur null garde la valeur actuelle
    updateTicketType: (guildId, id, { nom = null, description = null, categoryId = null, staffRoleId = null }) =>
        requetes.updateTicketType.run(nom, description, categoryId, staffRoleId, guildId, id).changes > 0,
    removeTicketType: (guildId, id) => requetes.removeTicketType.run(guildId, id).changes > 0,

    // Tickets
    addTicket: (guildId, channelId, ownerId, typeId = null, { status = "ouvert", createdAt = Date.now(), staffRoleId = null } = {}) =>
        requetes.addTicket.run(channelId, guildId, ownerId, typeId, staffRoleId, createdAt, status),
    getTicket: channelId => requetes.getTicket.get(channelId) ?? null,
    openTicketsOf: guildId => requetes.openTicketsOf.all(guildId),
    // Renvoie false si quelqu'un l'a déjà pris (deux clics simultanés : un seul gagne)
    claimTicket: (channelId, userId) => requetes.claimTicket.run(userId, Date.now(), channelId).changes > 0,
    takeOverTicket: (channelId, userId) => requetes.takeOverTicket.run(userId, Date.now(), channelId),
    unclaimTicket: (channelId, userId) => requetes.unclaimTicket.run(channelId, userId).changes > 0,
    setTicketStatus: (channelId, status, date = Date.now()) => status === "supprime"
        ? requetes.setTicketDeleted.run(date, channelId)
        : requetes.setTicketStatus.run(status, status === "ouvert" ? null : date, channelId),
    unfinishedTickets: () => requetes.unfinishedTickets.all(),
    // date et messageId à null : avertissement annulé
    setTicketWarned: (channelId, date, messageId = null) => requetes.setTicketWarned.run(date, messageId, channelId),
    // Seul l'auteur d'un ticket supprimé peut le noter, une seule fois
    rateTicket: (channelId, ownerId, note) => requetes.rateTicket.run(note, Date.now(), channelId, ownerId).changes > 0,
    // Lignes des tickets supprimés : gardées 90 jours (stats sur 30 jours, notes pendant 7 jours)
    purgeOldTickets(avant) {
        const total = requetes.purgeTickets.run(avant).changes
        requetes.purgeTicketEvents.run()
        return total
    },
    // Durées de la phase 2 (voir le registre RGPD) : journal de config 2 ans, raids levés 1 an,
    // quarantaines 1 an (membre parti sans levée), essais de vérification 1 jour
    purgePhase2({ deuxAns, unAn, unJour }) {
        requetes.purgeConfigAudit.run(deuxAns)
        requetes.purgeRaidEvents.run(unAn)
        requetes.purgeQuarantines.run(unAn)
        requetes.purgeVerificationAttempts.run(unJour)
    },
    ticketsSince: (guildId, date) => requetes.ticketsSince.all(guildId, date),
    getTicketInactivity: guildId => requetes.getInactivity.get(guildId)?.ticket_inactivity_days ?? 0,
    setTicketInactivity: (guildId, jours) => requetes.setInactivity.run(guildId, jours),
    guildsWithTicketInactivity: () => requetes.guildsWithInactivity.all(),

    // Apparence et langue (valeurs null = par défaut)
    getApparence(guildId) {
        const l = requetes.getApparence.get(guildId)
        return {
            langue: l?.langue ?? "auto",
            couleur: l?.couleur ?? null,
            panneauTitre: l?.ticket_panel_title ?? null,
            panneauTexte: l?.ticket_panel_description ?? null
        }
    },
    setLangue: (guildId, langue) => requetes.setLangue.run(guildId, langue === "auto" ? null : langue),
    setCouleur: (guildId, couleur) => requetes.setCouleur.run(guildId, couleur),
    setPanneauTicket: (guildId, titre, texte) => requetes.setPanneauTicket.run(guildId, titre || null, texte || null),

    // Rôles par boutons (guild_id toujours dans le WHERE)
    addRolePanel: (guildId, { messageId, channelId, titre, mode }) => requetes.addRolePanel.run(messageId, guildId, channelId, titre, mode),
    getRolePanel: (guildId, messageId) => requetes.getRolePanel.get(guildId, messageId) ?? null,
    listRolePanels: guildId => requetes.listRolePanels.all(guildId),
    removeRolePanel(guildId, messageId) {
        requetes.removeRolePanelButtons.run(guildId, messageId)
        return requetes.removeRolePanel.run(guildId, messageId).changes > 0
    },
    addRoleButton: (guildId, messageId, roleId, label) => requetes.addRoleButton.run(messageId, guildId, roleId, label),
    removeRoleButton: (guildId, messageId, roleId) => requetes.removeRoleButton.run(guildId, messageId, roleId).changes > 0,
    listRoleButtons: (guildId, messageId) => requetes.listRoleButtons.all(guildId, messageId),
    getRoleButton: (guildId, messageId, roleId) => requetes.getRoleButton.get(guildId, messageId, roleId) ?? null,
    // Rôle supprimé : ses boutons disparaissent. Renvoie les panneaux à rafraîchir.
    removeButtonsOfRole(guildId, roleId) {
        const panneaux = requetes.panelsOfRole.all(guildId, roleId).map(l => l.message_id)
        requetes.removeButtonsOfRole.run(guildId, roleId)
        return panneaux
    },
    // Salon supprimé : ses panneaux sont oubliés
    removePanelsOfChannel(guildId, channelId) {
        for (const { message_id: messageId } of requetes.panelsOfChannel.all(guildId, channelId)) this.removeRolePanel(guildId, messageId)
    },

    // Giveaways
    addGiveaway: (guildId, { channelId, prix, gagnants, endsAt, hostId }) =>
        Number(requetes.addGiveaway.run(guildId, channelId, prix, gagnants, endsAt, hostId).lastInsertRowid),
    setGiveawayMessage: (id, messageId) => requetes.setGiveawayMessage.run(messageId, id),
    getGiveaway: (guildId, id) => requetes.getGiveaway.get(guildId, id) ?? null,
    getGiveawayById: id => requetes.getGiveawayById.get(id) ?? null,
    listGiveaways: guildId => requetes.listGiveaways.all(guildId),
    countActiveGiveaways: guildId => requetes.countActiveGiveaways.get(guildId).total,
    dueGiveaways: (maintenant = Date.now()) => requetes.dueGiveaways.all(maintenant),
    // Renvoie false si le giveaway était déjà terminé (tirage déjà fait ailleurs)
    endGiveaway: (id, winners, date = Date.now()) => requetes.endGiveaway.run(date, JSON.stringify(winners), id).changes > 0,
    setGiveawayWinners: (id, winners, previous) => requetes.setGiveawayWinners.run(JSON.stringify(winners), JSON.stringify(previous), id).changes > 0,
    setGiveawayAnnounced: id => requetes.setGiveawayAnnounced.run(id),
    reserveGiveawayAnnounce: id => requetes.reserveGiveawayAnnounce.run(id).changes > 0,
    // Au démarrage : une publication interrompue par un arrêt du bot est reprise
    resetGiveawayAnnouncing: () => requetes.resetGiveawayAnnouncing.run().changes,
    // Membre parti : ses participations aux giveaways en cours sont effacées
    removeEntriesOfMember: (guildId, userId) => requetes.removeEntriesOfMember.run(userId, guildId).changes,
    unannouncedGiveaways: () => requetes.unannouncedGiveaways.all(),
    deleteGiveaway(id) {
        db.exec("BEGIN")
        try {
            requetes.deleteGiveawayEntries.run(id)
            requetes.deleteGiveaway.run(id)
            db.exec("COMMIT")
        } catch (err) {
            db.exec("ROLLBACK")
            throw err
        }
    },
    addEntry: (giveawayId, userId) => requetes.addEntry.run(giveawayId, userId).changes > 0,
    removeEntry: (giveawayId, userId) => requetes.removeEntry.run(giveawayId, userId).changes > 0,
    listEntries: giveawayId => requetes.listEntries.all(giveawayId).map(e => e.user_id),
    countEntries: giveawayId => requetes.countEntries.get(giveawayId).total,
    // Giveaways terminés depuis plus de 30 jours : participations et giveaway effacés
    purgeOldGiveaways(avant) {
        requetes.purgeEntries.run(avant)
        return requetes.purgeGiveaways.run(avant).changes
    },

    // Annonces programmées
    addAnnouncement: (guildId, { channelId, authorId, contenu, sendAt }) =>
        Number(requetes.addAnnouncement.run(guildId, channelId, authorId, contenu, sendAt).lastInsertRowid),
    listAnnouncements: guildId => requetes.listAnnouncements.all(guildId),
    countAnnouncements: guildId => requetes.countAnnouncements.get(guildId).total,
    removeAnnouncement: (guildId, id) => requetes.removeAnnouncement.run(guildId, id).changes > 0,
    dueAnnouncements: (maintenant = Date.now()) => requetes.dueAnnouncements.all(maintenant),
    deleteAnnouncementById: id => requetes.deleteAnnouncementById.run(id).changes > 0,

    // Bienvenue / au revoir
    getWelcome(guildId) {
        const l = requetes.getWelcome.get(guildId)
        return {
            bienvenue: l?.welcome_channel_id ? { channelId: l.welcome_channel_id, message: l.welcome_message } : null,
            aurevoir: l?.goodbye_channel_id ? { channelId: l.goodbye_channel_id, message: l.goodbye_message } : null
        }
    },
    // channelId null : désactivé
    setWelcome: (guildId, type, channelId, message) =>
        (type === "aurevoir" ? requetes.setGoodbye : requetes.setWelcome).run(guildId, channelId, channelId ? message : null),

    // Exécute fn() en une seule transaction : tout est écrit, ou rien (ROLLBACK puis erreur relancée)
    transaction(fn) {
        db.exec("BEGIN IMMEDIATE")
        try {
            const resultat = fn()
            db.exec("COMMIT")
            return resultat
        } catch (err) {
            db.exec("ROLLBACK")
            throw err
        }
    },

    backupTo: destination => requetes.backup.run(destination),
    fichier,

    close: () => db.close(),

    // Requêtes génériques (RGPD par membre) : le SQL vient uniquement de Fonctions/registreRgpd.js, les valeurs sont en paramètres
    sqlAll: (sql, params = []) => db.prepare(sql).all(...params),
    sqlRun: (sql, params = []) => db.prepare(sql).run(...params).changes
}
