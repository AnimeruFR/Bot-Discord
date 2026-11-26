// Filtre de pseudos (tribunal de la phase 2, S1) : qui a activé le filtre. Le bot ne renomme jamais un membre
// placé au même niveau ou au-dessus de cette personne.
const description = "Auteur de l'activation du filtre de pseudos (nick_filter.configured_by)"

const colonnes = db => db.prepare("PRAGMA table_info(nick_filter)").all().map(c => c.name)

function up(db) {
    if (!colonnes(db).includes("configured_by")) db.exec("ALTER TABLE nick_filter ADD COLUMN configured_by TEXT")
}

function down(db) {
    if (colonnes(db).includes("configured_by")) db.exec("ALTER TABLE nick_filter DROP COLUMN configured_by")
}

module.exports = { description, up, down }
