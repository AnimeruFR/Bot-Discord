// Réponses prédéfinies des tickets (idée #20) : le staff poste un texte enregistré avec /reponse
const description = "Réponses prédéfinies des tickets (ticket_macros)"

function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ticket_macros (
            guild_id TEXT NOT NULL,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            author_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, name)
        );
    `)
}

function down(db) {
    db.exec("DROP TABLE IF EXISTS ticket_macros")
}

module.exports = { description, up, down }
