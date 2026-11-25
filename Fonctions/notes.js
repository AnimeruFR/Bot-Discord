const db = require('./db')

// Notes privées du staff sur un membre (staff_notes) : jamais montrées au membre
const LIMITE_NOTES = 50
const TAILLE_MAX = 1000

// Ajoute une note. Renvoie son numéro, ou null si le membre a déjà LIMITE_NOTES notes (rien n'est écrit)
function ajouterNote(guildId, userId, authorId, texte) {
    return db.transaction(() => {
        if (compterNotes(guildId, userId) >= LIMITE_NOTES) return null
        db.sqlRun("INSERT INTO staff_notes (guild_id, user_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)", [guildId, userId, authorId, texte, Date.now()])
        return db.sqlAll("SELECT last_insert_rowid() AS id")[0].id
    })
}

// Notes d'un membre, les plus récentes d'abord
function listerNotes(guildId, userId, limite = 10) {
    return db.sqlAll("SELECT id, author_id, content, created_at FROM staff_notes WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?", [guildId, userId, limite])
}

function compterNotes(guildId, userId) {
    return db.sqlAll("SELECT COUNT(*) AS total FROM staff_notes WHERE guild_id = ? AND user_id = ?", [guildId, userId])[0].total
}

// Une note du serveur (null si elle n'existe pas ou vient d'un autre serveur)
function lireNote(guildId, id) {
    return db.sqlAll("SELECT id, user_id, author_id, content, created_at FROM staff_notes WHERE guild_id = ? AND id = ?", [guildId, id])[0] ?? null
}

// Supprime une note du serveur. Renvoie false si elle n'existe pas. Le droit de retrait se vérifie dans la commande.
function retirerNote(guildId, id) {
    return db.sqlRun("DELETE FROM staff_notes WHERE guild_id = ? AND id = ?", [guildId, id]) > 0
}

module.exports = { LIMITE_NOTES, TAILLE_MAX, ajouterNote, listerNotes, compterNotes, lireNote, retirerNote }
