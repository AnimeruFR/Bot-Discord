const Discord = require('discord.js')
const db = require('./db')
const { t, langueDe } = require('./i18n')
const { formatReason, formatDuree, checkHierarchy, fetchMember } = require('./moderation')

// Modifier ou annuler une sanction (table cases) : chaque modification est tracée dans case_edits.
// Toutes les requêtes portent sur guild_id : le numéro d'une sanction d'un autre serveur est introuvable.

// Types qu'on peut annuler (les retraits unwarn, unmute et unban sont déjà des annulations)
const ANNULABLES = ["warn", "mute", "kick", "ban", "tempban"]

// Tous les types de sanction connus (noms traduits : mod.type.<type>), source unique pour /historique, /case et le menu « Dossier »
const TYPES = ["warn", "unwarn", "mute", "unmute", "kick", "ban", "tempban", "unban", "automod"]
const nomType = (interaction, type) => TYPES.includes(type) ? t(interaction, `mod.type.${type}`) : type

// Une ligne d'historique : raison coupée à 200 caractères (10 lignes tiennent dans un embed),
// barrée et suivie de « Annulée le » quand la sanction est annulée
function ligneSanction(interaction, c) {
    const duree = c.duration_ms ? ` (${formatDuree(c.duration_ms, langueDe(interaction))})` : ""
    const auto = c.auto ? t(interaction, "mod.historique.auto") : ""
    const reason = formatReason(c.reason).slice(0, 200)
    const ligne = t(interaction, "mod.historique.ligne", {
        id: c.id, nom: nomType(interaction, c.type), duree, date: Math.floor(c.created_at / 1000), moderateur: c.moderator_id, auto,
        reason: c.cancelled_at ? `~~${reason.replace(/\s+/g, " ")}~~` : reason
    })
    return c.cancelled_at ? ligne + t(interaction, "dos.historique.annulee", { date: Math.floor(c.cancelled_at / 1000) }) : ligne
}

// Cible pour sendModLog quand l'utilisateur n'est pas sous la main
const cibleDe = id => ({ id, toString: () => `<@${id}>` })

// Garde commune à /case (modifier la raison, annuler) et /note (retirer) : l'auteur peut toujours, sinon il faut gérer le serveur,
// et la hiérarchie actuelle est revérifiée si le membre visé est encore sur le serveur (l'auteur a pu perdre du rang depuis).
// cleAutre : clé du refus « ce n'est pas la vôtre ». Renvoie { refus, membre } (refus null si c'est permis).
async function verifierDroitSurCible(interaction, { auteurId, userId, cleAutre }) {
    if (auteurId !== interaction.user.id && !interaction.memberPermissions?.has(Discord.PermissionFlagsBits.ManageGuild)) {
        return { refus: t(interaction, cleAutre), membre: null }
    }
    const membre = await fetchMember(interaction.guild, userId)
    return { refus: membre ? checkHierarchy(interaction, membre, "sanctionner") : null, membre }
}

function lireCase(guildId, id) {
    return db.sqlAll("SELECT * FROM cases WHERE guild_id = ? AND id = ?", [guildId, id])[0] ?? null
}

// Numéro de la sanction (ligne d'historique) créée par un warn, null si elle n'existe pas
function caseDuWarn(guildId, warnId) {
    return db.sqlAll("SELECT id FROM cases WHERE guild_id = ? AND warn_id = ?", [guildId, warnId])[0]?.id ?? null
}

// Retire une sanction écrite d'avance dont l'action a échoué (ban ou kick refusé par Discord après l'écriture)
function retirerCase(guildId, id) {
    return db.sqlRun("DELETE FROM cases WHERE guild_id = ? AND id = ?", [guildId, id]) > 0
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

module.exports = { ANNULABLES, TYPES, nomType, ligneSanction, cibleDe, verifierDroitSurCible, lireCase, caseDuWarn, retirerCase, listerModifs, muteActif, warnEncore, modifierRaison, annulerCase }
