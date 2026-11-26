// Anti-phishing (idée #5) : domaines autorisés par serveur (la liste des domaines d'arnaque est un fichier versionné)
const description = "Anti-phishing : liste blanche de domaines par serveur (phishing_whitelist)"

function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS phishing_whitelist (
            guild_id TEXT NOT NULL,
            domain TEXT NOT NULL,
            PRIMARY KEY (guild_id, domain)
        );
    `)
}

function down(db) {
    db.exec("DROP TABLE IF EXISTS phishing_whitelist")
}

module.exports = { description, up, down }
