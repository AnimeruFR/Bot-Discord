const db = require('./db')
const { emettre, jourParis } = require('./evenements')
const economie = require('./economie')

// Métiers de /travail (idée #28). Chiffres : docs/ECONOMIE.md.
// Gain d'un travail : 30 à 60 + 3 par niveau (niveau 10 au plus). 1 travail par heure, 8 comptés par jour.
// Les textes de chaque métier sont dans locales/<langue>/daily.json : travail.texte.<métier>.1 à .NB_TEXTES

const METIERS = ["forgeron", "cartographe", "herboriste", "horloger", "archiviste"]
const NB_TEXTES = 5
const NIVEAU_MAX = 10
const GAIN_MIN = 30
const GAIN_MAX = 60
const GAIN_PAR_NIVEAU = 3
const COOLDOWN = 60 * 60 * 1000
const TRAVAUX_PAR_JOUR = 8
const PRIX_CHANGEMENT = 1000
const XP_PAR_TRAVAIL = 10

// XP pour passer du niveau L au niveau L+1 : 20 × L (20, 40, 60…). Cumulée pour le niveau 10 : 900 XP,
// soit 90 travaux (une dizaine de jours à 8 travaux par jour).
const xpPourNiveauSuivant = niveau => 20 * niveau

// Niveau et XP restante dans ce niveau pour une XP totale
function niveauDepuisXp(xp) {
    let niveau = 1, reste = xp
    while (niveau < NIVEAU_MAX && reste >= xpPourNiveauSuivant(niveau)) {
        reste -= xpPourNiveauSuivant(niveau)
        niveau++
    }
    return { niveau, reste, requis: niveau < NIVEAU_MAX ? xpPourNiveauSuivant(niveau) : null }
}

const gainDe = (niveau, hasard = Math.random) =>
    GAIN_MIN + Math.floor(hasard() * (GAIN_MAX - GAIN_MIN + 1)) + GAIN_PAR_NIVEAU * Math.min(niveau, NIVEAU_MAX)

function lireMetier(guildId, userId) {
    const l = db.sqlAll("SELECT * FROM eco_metiers WHERE guild_id = ? AND user_id = ?", [guildId, userId])[0]
    if (!l) return null
    return { job: l.job, level: l.level, xp: l.job_xp, lastWorkAt: l.last_work_at, ...niveauDepuisXp(l.job_xp) }
}

const travauxDuJour = (guildId, userId, maintenant = Date.now()) =>
    db.sqlAll("SELECT works FROM eco_compteurs WHERE guild_id = ? AND user_id = ? AND day = ?", [guildId, userId, jourParis(maintenant)])[0]?.works ?? 0

// Choix du métier. Le premier est gratuit ; en changer coûte 1 000 et repart au niveau 1 (le délai de travail est conservé).
// Tout est synchrone : pas de double paiement possible entre la vérification et l'écriture.
function choisirMetier(member, job) {
    if (!METIERS.includes(job)) return { ok: false, refus: "metier_inconnu" }
    const refus = economie.peutJouer(member)
    if (refus) return { ok: false, refus }
    const guildId = member.guild.id, userId = member.id
    const actuel = lireMetier(guildId, userId)
    if (actuel?.job === job) return { ok: false, refus: "meme_metier" }
    if (!actuel) {
        db.sqlRun("INSERT OR IGNORE INTO eco_metiers (guild_id, user_id, job, level, job_xp) VALUES (?, ?, ?, 1, 0)", [guildId, userId, job])
        return { ok: true, job, paye: 0 }
    }
    const debit = economie.debiter(guildId, userId, PRIX_CHANGEMENT, { source: "metier", details: { de: actuel.job, vers: job } })
    if (!debit.ok) return debit
    db.sqlRun("UPDATE eco_metiers SET job = ?, level = 1, job_xp = 0 WHERE guild_id = ? AND user_id = ?", [job, guildId, userId])
    return { ok: true, job, paye: PRIX_CHANGEMENT, solde: debit.solde }
}

// Un travail. Le délai est pris en base par une écriture conditionnelle (deux travaux simultanés : un seul passe),
// puis annulé si l'économie refuse le gain.
function travailler(member, { hasard = Math.random, maintenant = Date.now() } = {}) {
    const guildId = member.guild.id, userId = member.id
    const refus = economie.peutJouer(member)
    if (refus) return { ok: false, refus }
    const metier = lireMetier(guildId, userId)
    if (!metier) return { ok: false, refus: "sans_metier" }
    if (travauxDuJour(guildId, userId, maintenant) >= TRAVAUX_PAR_JOUR) return { ok: false, refus: "limite_jour" }

    const pris = db.sqlRun(`UPDATE eco_metiers SET last_work_at = ? WHERE guild_id = ? AND user_id = ?
        AND (last_work_at IS NULL OR last_work_at <= ?)`, [maintenant, guildId, userId, maintenant - COOLDOWN])
    if (!pris) return { ok: false, refus: "cooldown", prochain: (lireMetier(guildId, userId).lastWorkAt ?? maintenant) + COOLDOWN }

    // Le 8e travail du jour est le dernier : l'incrément échoue au-delà (garde-fou si deux processus écrivent)
    const compte = db.sqlRun(`INSERT INTO eco_compteurs (guild_id, user_id, day, works) VALUES (?, ?, ?, 1)
        ON CONFLICT (guild_id, user_id, day) DO UPDATE SET works = works + 1 WHERE works < ?`, [guildId, userId, jourParis(maintenant), TRAVAUX_PAR_JOUR])
    const annuler = () => {
        db.sqlRun("UPDATE eco_metiers SET last_work_at = ? WHERE guild_id = ? AND user_id = ?", [metier.lastWorkAt, guildId, userId])
        if (compte) db.sqlRun("UPDATE eco_compteurs SET works = works - 1 WHERE guild_id = ? AND user_id = ? AND day = ?", [guildId, userId, jourParis(maintenant)])
    }
    if (!compte) {
        annuler()
        return { ok: false, refus: "limite_jour" }
    }

    const gain = gainDe(metier.level, hasard)
    const resultat = economie.crediter(member, gain, { source: "travail", actif: true, details: { job: metier.job, niveau: metier.level } })
    if (!resultat.ok) {
        annuler()
        return resultat
    }

    const xp = metier.xp + XP_PAR_TRAVAIL
    const apres = niveauDepuisXp(xp)
    db.sqlRun("UPDATE eco_metiers SET job_xp = ?, level = ? WHERE guild_id = ? AND user_id = ?", [xp, apres.niveau, guildId, userId])
    emettre("travail", { guildId, userId, job: metier.job, level: apres.niveau })
    return {
        ok: true, job: metier.job, gain, credite: resultat.credite, solde: resultat.solde, plafonne: resultat.plafonne,
        niveau: apres.niveau, niveauAvant: metier.level, monte: apres.niveau > metier.level, xp: apres.reste, requis: apres.requis,
        texte: 1 + Math.floor(hasard() * NB_TEXTES), restants: TRAVAUX_PAR_JOUR - travauxDuJour(guildId, userId, maintenant)
    }
}

module.exports = {
    METIERS, NB_TEXTES, NIVEAU_MAX, COOLDOWN, TRAVAUX_PAR_JOUR, PRIX_CHANGEMENT, XP_PAR_TRAVAIL,
    xpPourNiveauSuivant, niveauDepuisXp, gainDe, lireMetier, travauxDuJour, choisirMetier, travailler
}
