const db = require('./db')
const economie = require('./economie')
const { emettre, jourParis } = require('./evenements')
const { enHeureDeParis, dateDeParis } = require('./dates')

// /daily (idée #27) : 100 + 15 × (série − 1), série comptée jusqu'à 10 (235 au maximum). Chiffres : docs/ECONOMIE.md.
// Un seul daily par jour calendaire de Paris ; la série continue seulement si le dernier daily date d'hier (Paris).
// Événement émis : daily ({ guildId, userId, streak }).
const BASE = 100
const BONUS_PAR_JOUR = 15
const SERIE_MAX = 10

const montantPour = serie => BASE + BONUS_PAR_JOUR * (Math.min(serie, SERIE_MAX) - 1)

// Prochain minuit à Paris
function prochainJour(maintenant) {
    const { annee, mois, jour } = enHeureDeParis(maintenant)
    const demain = new Date(Date.UTC(annee, mois - 1, jour + 1))
    return dateDeParis(demain.getUTCFullYear(), demain.getUTCMonth() + 1, demain.getUTCDate(), 0, 0)
}

// Jour calendaire (Paris) qui précède celui de l'instant. Midi UTC tombe toujours le même jour à Paris : pas de piège d'heure d'été.
function hier(maintenant) {
    const { annee, mois, jour } = enHeureDeParis(maintenant)
    return jourParis(Date.UTC(annee, mois - 1, jour - 1, 12))
}

// maintenant : l'horloge, injectable pour les tests.
// Lecture, écriture de la série (conditionnelle sur l'ancienne date) et crédit se font sans await entre eux :
// un double clic ne peut pas donner deux daily. Si l'économie refuse le gain ou lève une exception, la série est remise comme avant.
function reclamer(member, maintenant = Date.now()) {
    const guildId = member.guild.id, userId = member.id
    const refus = economie.peutJouer(member)
    if (refus) return { ok: false, refus }
    const { streak, lastDailyAt } = economie.compte(guildId, userId)
    if (lastDailyAt && jourParis(lastDailyAt) === jourParis(maintenant)) {
        return { ok: false, refus: "deja", prochain: prochainJour(maintenant) }
    }
    const serie = lastDailyAt && jourParis(lastDailyAt) === hier(maintenant) ? streak + 1 : 1
    const pris = db.sqlRun("UPDATE eco_comptes SET streak = ?, last_daily_at = ? WHERE guild_id = ? AND user_id = ? AND last_daily_at IS ?",
        [serie, maintenant, guildId, userId, lastDailyAt])
    if (!pris) return { ok: false, refus: "deja", prochain: prochainJour(maintenant) }

    const annuler = () => db.sqlRun("UPDATE eco_comptes SET streak = ?, last_daily_at = ? WHERE guild_id = ? AND user_id = ?", [streak, lastDailyAt, guildId, userId])
    let resultat
    try {
        resultat = economie.crediter(member, montantPour(serie), { source: "daily", details: { serie } })
    } catch (err) {
        annuler()
        throw err
    }
    if (!resultat.ok) {
        annuler()
        return resultat
    }
    emettre("daily", { guildId, userId, streak: serie })
    return { ok: true, credite: resultat.credite, solde: resultat.solde, serie, perdue: streak > 1 && serie === 1, prochain: prochainJour(maintenant) }
}

module.exports = { BASE, BONUS_PAR_JOUR, SERIE_MAX, montantPour, prochainJour, reclamer }
