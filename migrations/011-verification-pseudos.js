// Vérification à l'arrivée (idée #4) et filtre de pseudos (idée #25)
const description = "Vérification à l'arrivée (verification_config) et filtre de pseudos (nick_filter)"

function up(db) {
    db.exec(`
        -- role_id : rôle donné une fois vérifié ; channel_id et message_id : panneau « Je ne suis pas un robot »
        CREATE TABLE IF NOT EXISTS verification_config (
            guild_id TEXT PRIMARY KEY,
            role_id TEXT NOT NULL,
            channel_id TEXT,
            message_id TEXT
        );
        -- banned_words : liste JSON de mots interdits dans les pseudos (en plus des règles fixes : hoist, zalgo)
        CREATE TABLE IF NOT EXISTS nick_filter (
            guild_id TEXT PRIMARY KEY,
            banned_words TEXT NOT NULL DEFAULT '[]'
        );
    `)
}

function down(db) {
    db.exec("DROP TABLE IF EXISTS verification_config; DROP TABLE IF EXISTS nick_filter")
}

module.exports = { description, up, down }
