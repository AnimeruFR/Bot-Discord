const db = require('./db')

// Modifier ou annuler une sanction (table cases) : chaque modification est tracée dans case_edits.
// Toutes les requêtes portent sur guild_id : le numéro d'une sanction d'un autre serveur est introuvable.

// Types qu'on peut annuler (les retraits unwarn, unmute et unban sont déjà des annulations)
const ANNULABLES = ["warn", "mute", "kick", "ban", "tempban"]

function lireCase(guildId, id) {
    return db.sqlAll("SELECT * FROM cases WHERE guild_id = ? AND id = ?", [guildId, id])[0] ?? null
}

// Modifications d'une sanction, les plus récentes d'abord
function listerModifs(guildId, caseId, limite = 5) {
    return db.sqlAll("SELECT * FROM case_edits WHERE guild_id = ? AND case_id = ? ORDER BY id DESC LIMIT ?", [guildId, caseId, limite])
}

// Un mute est « actif » tant que sa durée n'est pas écoulée
const muteActif = c => c.type === "mute" && Boolean(c.duration_ms) && c.created_at + c.duration_ms > Date.now()

// Le warn lié à une sanction existe-t-il encore ? (un /unwarn l'a peut-être retiré)
const warnEncore = c => c.type !== "warn" || !c.warn_id || Boolean(db.getWarn(c.guild_id, c.warn_id))

// Change la raison. Renvoie "ok", "introuvable", "annulee" (une sanction annulée est figée) ou "warn_retire".
function modifierRaison(guildId, id, editeurId, nouvelle) {
    return db.transaction(() => {
        const c = lireCase(guildId, id)
        if (!c) return "introuvable"
        if (c.cancelled_at) return "annulee"
        if (!warnEncore(c)) return "warn_retire"
        db.sqlRun("UPDATE cases SET reason = ? WHERE guild_id = ? AND id = ?", [nouvelle, guildId, id])
        // Le warn garde la même raison que sa ligne d'historique
        if (c.type === "warn" && c.warn_id) db.sqlRun("UPDATE warns SET reason = ? WHERE guild_id = ? AND id = ?", [nouvelle, guildId, c.warn_id])
        db.sqlRun("INSERT INTO case_edits (guild_id, case_id, editor_id, field, old_value, new_value, created_at) VALUES (?, ?, ?, 'raison', ?, ?, ?)",
            [guildId, id, editeurId, c.reason, nouvelle, Date.now()])
        return "ok"
    })
}

// Marque la sanction annulée. Un warn annulé est supprimé de la table warns dans la même transaction (le total baisse).
// Renvoie "ok", "introuvable", "deja" ou "non_annulable".
function annulerCase(guildId, id, editeurId) {
    return db.transaction(() => {
        const c = lireCase(guildId, id)
        if (!c) return "introuvable"
        if (c.cancelled_at) return "deja"
        if (!ANNULABLES.includes(c.type)) return "non_annulable"
        db.sqlRun("UPDATE cases SET cancelled_at = ? WHERE guild_id = ? AND id = ?", [Date.now(), guildId, id])
        if (c.type === "warn" && c.warn_id) db.removeWarn(guildId, c.warn_id)
        db.sqlRun("INSERT INTO case_edits (guild_id, case_id, editor_id, field, old_value, new_value, created_at) VALUES (?, ?, ?, 'annulation', NULL, NULL, ?)",
            [guildId, id, editeurId, Date.now()])
        return "ok"
    })
}

module.exports = { ANNULABLES, lireCase, listerModifs, muteActif, warnEncore, modifierRaison, annulerCase }
