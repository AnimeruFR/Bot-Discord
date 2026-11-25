const ms = require('ms')
const { t } = require('./i18n')

const FUSEAU = "Europe/Paris"
const MINUTE = 60 * 1000

// Composants de la date d'un instant, vus depuis le fuseau de Paris
function enHeureDeParis(instant) {
    const parties = new Intl.DateTimeFormat("fr-FR", {
        timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date(instant))
    const v = type => Number(parties.find(p => p.type === type).value)
    return { annee: v("year"), mois: v("month"), jour: v("day"), heure: v("hour"), minute: v("minute") }
}

// "JJ/MM/AAAA HH:MM" (heure de Paris) -> instant UTC en ms. Gère le changement d'heure sans décalage fixe :
// on essaie les deux décalages possibles de Paris (UTC+1, UTC+2) et on garde ceux qui retombent sur la même heure.
// Heure inexistante (passage à l'heure d'été, ex : 02:30 fin mars) : refusée. Heure en double (fin octobre) : la 1re.
function dateDeParis(annee, mois, jour, heure, minute) {
    const voulu = { annee, mois, jour, heure, minute }
    const candidats = [60, 120]
        .map(decalage => Date.UTC(annee, mois - 1, jour, heure, minute) - decalage * MINUTE)
        .filter(instant => {
            const vu = enHeureDeParis(instant)
            return Object.keys(voulu).every(k => vu[k] === voulu[k])
        })
    return candidats.length ? Math.min(...candidats) : null
}

// "2h", "3d" ou "25/12/2026 18:00" -> { date } (ms UTC) ou { erreur }
// cible : interaction pour la langue des erreurs (français sans cible)
function parseQuand(texte, { maintenant = Date.now(), min = MINUTE, max, cible = null } = {}) {
    const L = cible ?? "fr"
    const brut = texte?.trim() ?? ""
    let date
    const absolue = brut.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})[:h](\d{2})$/)
    if (absolue) {
        const [jour, mois, annee, heure, minute] = absolue.slice(1).map(Number)
        // Valeurs impossibles (31/02, 25:00…) refusées, au lieu d'être décalées comme le ferait new Date()
        const jours = new Date(Date.UTC(annee, mois, 0)).getUTCDate()
        if (mois < 1 || mois > 12 || jour < 1 || jour > jours || heure > 23 || minute > 59) return { erreur: t(L, "dates.invalide") }
        date = dateDeParis(annee, mois, jour, heure, minute)
        if (date === null) return { erreur: t(L, "dates.inexistante") }
    } else {
        const duree = brut ? ms(brut) : NaN
        if (!Number.isFinite(duree) || duree <= 0) return { erreur: t(L, "dates.format") }
        date = maintenant + duree
    }
    if (date - maintenant < min) return { erreur: t(L, "dates.trop_tot") }
    if (max && date - maintenant > max) return { erreur: t(L, "dates.trop_loin", { jours: Math.round(max / 86400000) }) }
    return { date }
}

module.exports = { parseQuand, dateDeParis, enHeureDeParis, FUSEAU }
