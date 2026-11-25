// Salons de logs séparés par famille (idée #24). Sans ligne pour une famille, repli sur le salon général (/setlogs),
// sauf pour les familles qui ne doivent jamais arriver dans le salon de modération (jeux, économie).
const description = "Salon de logs par famille (sanctions, automod, tickets, membres, signalements, animation, jeux)"

function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS log_channels (
            guild_id TEXT NOT NULL,
            famille TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            PRIMARY KEY (guild_id, famille)
        );
    `)
}

function down(db) {
    db.exec("DROP TABLE IF EXISTS log_channels")
}

module.exports = { description, up, down }
