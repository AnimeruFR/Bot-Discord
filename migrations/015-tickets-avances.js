// Tickets : délai cible (#18), formulaires personnalisés (#19), transfert et escalade (#21)
const description = "Tickets : ticket_types.sla_minutes, tickets.sla_alerted_at, ticket_fields, ticket_events"

const colonnes = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)

function up(db) {
    if (!colonnes(db, "ticket_types").includes("sla_minutes")) db.exec("ALTER TABLE ticket_types ADD COLUMN sla_minutes INTEGER")
    if (!colonnes(db, "tickets").includes("sla_alerted_at")) db.exec("ALTER TABLE tickets ADD COLUMN sla_alerted_at INTEGER")
    db.exec(`
        -- Champs du formulaire d'un type (5 au plus) ; style : court ou long
        CREATE TABLE IF NOT EXISTS ticket_fields (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            type_id INTEGER NOT NULL,
            label TEXT NOT NULL,
            style TEXT NOT NULL,
            required INTEGER NOT NULL DEFAULT 1,
            position INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ticket_fields ON ticket_fields (guild_id, type_id, position);
        -- Trace d'un ticket : kind transfert, sla_alerte… ; details en clair (aucun contenu de message)
        CREATE TABLE IF NOT EXISTS ticket_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            details TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ticket_events ON ticket_events (guild_id, channel_id);
    `)
}

function down(db) {
    db.exec("DROP TABLE IF EXISTS ticket_fields; DROP TABLE IF EXISTS ticket_events")
    if (colonnes(db, "tickets").includes("sla_alerted_at")) db.exec("ALTER TABLE tickets DROP COLUMN sla_alerted_at")
    if (colonnes(db, "ticket_types").includes("sla_minutes")) db.exec("ALTER TABLE ticket_types DROP COLUMN sla_minutes")
}

module.exports = { description, up, down }
