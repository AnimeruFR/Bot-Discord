const db = require('./db')
const { t, langueDe } = require('./i18n')
const { formatReason, checkHierarchy, fetchMember, auditReason, formatDuree } = require('./moderation')
const { appliquerSeuil, sanctionInterdite } = require('./sanctions')
const { sendModLog } = require('./logs')
const { caseDuWarn } = require('./cases')
const { mpSanction } = require('./appels')

// Actions de modération partagées entre les slash commandes, les menus contextuels et les signalements.

// Avertit un membre (warn). Partagé par /warn, le menu contextuel « Warn rapide » (#23) et les boutons des signalements (#22).
// Renvoie { erreur } (texte traduit pour l'auteur, rien n'est enregistré)
// ou { id, total, prevenu, auto, reason } : auto = texte de la sanction automatique appliquée (ou de son échec), sinon null.
async function avertir(interaction, user, raisonSaisie) {
    const member = await fetchMember(interaction.guild, user.id)
    if (!member) return { erreur: t(interaction, "mod.absent") }

    const erreur = checkHierarchy(interaction, member, "warn")
    if (erreur) return { erreur }

    // Un warn qui atteindrait un seuil dont l'auteur ne peut pas appliquer la sanction est refusé :
    // sinon le seuil serait consommé sans effet (pas de déclenchement au warn suivant)
    const interdite = sanctionInterdite(interaction, db.countWarns(interaction.guild.id, user.id) + 1)
    if (interdite) return { erreur: t(interaction, "mod.warn.seuil_interdit", { sanction: interdite }) }

    // On enregistre la raison brute : elle est échappée au moment de l'affichage.
    // Ajout et comptage sans "await" entre les deux : chaque warn obtient un total différent,
    // même si deux modérateurs warnent en même temps (un seuil ne se déclenche donc qu'une fois)
    const raisonBrute = raisonSaisie?.trim() || "Aucune raison fournie"
    const reason = formatReason(raisonSaisie)
    const id = db.addWarn(interaction.guild.id, user.id, interaction.user.id, raisonBrute)
    const total = db.countWarns(interaction.guild.id, user.id)

    // Le MP part après l'écriture du warn : son bouton « Faire appel » a besoin du numéro de la sanction
    const numeroCase = caseDuWarn(interaction.guild.id, id)
    const prevenu = await mpSanction(user, interaction.guild, t(interaction.guild, "mod.warn.mp", { serveur: interaction.guild.name, reason }), numeroCase)
        .then(() => true)
        .catch(() => false)

    await sendModLog(interaction, { action: "warn", cible: user, raison: raisonBrute, details: `Warn n°${id}, ${total} au total` })

    // Sanction automatique configurée avec /sanctions (seuil atteint)
    const auto = await appliquerSeuil(interaction, user, total)
    return { id, total, prevenu, auto, reason }
}

// Rend un membre muet (timeout). Partagé par /mute, le menu contextuel « Mute 10 min » (#23) et les signalements (#22).
// duree en ms, déjà validée par l'appelant. Renvoie { erreur } ou { numero, temps, reason }.
async function muter(interaction, user, duree, raisonSaisie) {
    const member = await fetchMember(interaction.guild, user.id)
    if (!member) return { erreur: t(interaction, "mod.absent") }
    const erreur = checkHierarchy(interaction, member, "mute")
    if (erreur) return { erreur }
    if (!member.moderatable) return { erreur: t(interaction, "mod.mute.pas_moderatable") }
    if (member.isCommunicationDisabled()) return { erreur: t(interaction, "mod.mute.deja") }

    const reason = formatReason(raisonSaisie)
    await member.timeout(duree, auditReason(interaction, raisonSaisie))
    const numero = db.addCase(interaction.guild.id, { userId: user.id, moderatorId: interaction.user.id, type: "mute", reason: raisonSaisie, durationMs: duree })
    await sendModLog(interaction, { action: "mute", cible: user, raison: raisonSaisie, details: `Durée : ${formatDuree(duree)}` })
    await mpSanction(user, interaction.guild, t(interaction.guild, "mod.mute.mp", { serveur: interaction.guild.name, temps: formatDuree(duree, langueDe(interaction.guild)), reason }), numero).catch(() => {})
    return { numero, temps: formatDuree(duree, langueDe(interaction)), reason }
}

module.exports = { avertir, muter }
