// Modules activables par serveur et salons réservés aux jeux (idée #87)
const description = "Modules et sous-modules activés par serveur, salons autorisés pour les jeux"

function up(db) {
    db.exec(`
        -- Une ligne seulement pour un module désactivé (ou réactivé) : sans ligne, le module est actif
        CREATE TABLE IF NOT EXISTS guild_modules (
            guild_id TEXT NOT NULL,
            module TEXT NOT NULL,
            actif INTEGER NOT NULL,
            PRIMARY KEY (guild_id, module)
        );
        -- Aucun salon = jeux autorisés partout
        CREATE TABLE IF NOT EXISTS guild_salons_jeux (
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            PRIMARY KEY (guild_id, channel_id)
        );
    `)
}

function down(db) {
    db.exec("DROP TABLE IF EXISTS guild_modules; DROP TABLE IF EXISTS guild_salons_jeux")
}

module.exports = { description, up, down }
