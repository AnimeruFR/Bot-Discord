// Succès (critique du lot 3B) : la récompense d'un succès est marquée versée, pour être rejouée si son versement a échoué
const description = "Récompense de succès versée ou en attente (succes.rewarded)"

const colonnes = db => db.prepare("PRAGMA table_info(succes)").all().map(c => c.name)

function up(db) {
    // Les succès déjà obtenus sont considérés comme payés (aucun moyen de savoir le contraire)
    if (!colonnes(db).includes("rewarded")) db.exec("ALTER TABLE succes ADD COLUMN rewarded INTEGER NOT NULL DEFAULT 1")
}

function down(db) {
    if (colonnes(db).includes("rewarded")) db.exec("ALTER TABLE succes DROP COLUMN rewarded")
}

module.exports = { description, up, down }
