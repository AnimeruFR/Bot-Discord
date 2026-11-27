// Tribunal de la phase 3 (S5, S7) : rôle d'anniversaire retiré seulement à ceux à qui le bot l'a donné,
// date d'anniversaire modifiable une fois par 30 jours, retraits de rôles temporaires abandonnés après des échecs répétés
const description = "Rôles de la communauté : anniv_roles_donnes, anniversaires.changed_at, shop_roles_temp.failures"

const colonnes = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)

function up(db) {
    db.exec(`
        -- Rôle du jour donné par le bot (lui seul le retire, jamais aux autres porteurs)
        CREATE TABLE IF NOT EXISTS anniv_roles_donnes (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            day TEXT NOT NULL,
            PRIMARY KEY (guild_id, user_id, role_id)
        );
    `)
    if (!colonnes(db, "anniversaires").includes("changed_at")) db.exec("ALTER TABLE anniversaires ADD COLUMN changed_at INTEGER")
    if (!colonnes(db, "shop_roles_temp").includes("failures")) db.exec("ALTER TABLE shop_roles_temp ADD COLUMN failures INTEGER NOT NULL DEFAULT 0")
}

function down(db) {
    db.exec("DROP TABLE IF EXISTS anniv_roles_donnes")
    if (colonnes(db, "anniversaires").includes("changed_at")) db.exec("ALTER TABLE anniversaires DROP COLUMN changed_at")
    if (colonnes(db, "shop_roles_temp").includes("failures")) db.exec("ALTER TABLE shop_roles_temp DROP COLUMN failures")
}

module.exports = { description, up, down }
