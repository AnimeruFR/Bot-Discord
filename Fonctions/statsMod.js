const db = require('./db')

// Requêtes et calculs de /journal (#15), /modstats (#16) et du rapport hebdomadaire (#17).
// Lecture seule : rien n'est écrit ici.

const HEURE = 60 * 60 * 1000
const JOUR = 24 * HEURE
const LIMITE_SOURCE = 500 // lignes lues par table pour /journal (les plus récentes)

// Périodes de /journal et de /modstats (valeur du choix -> durée)
const PERIODES_JOURNAL = { "24h": JOUR, "7j": 7 * JOUR, "30j": 30 * JOUR }
const PERIODES_STATS = { "7": 7 * JOUR, "30": 30 * JOUR, "90": 90 * JOUR, "365": 365 * JOUR }
const PERIODES_GRATUITES = ["7", "30"]

// Médiane d'une liste de nombres (null si elle est vide)
function mediane(valeurs) {
    if (!valeurs.length) return null
    const tri = [...valeurs].sort((a, b) => a - b)
    const milieu = Math.floor(tri.length / 2)
    return tri.length % 2 ? tri[milieu] : (tri[milieu - 1] + tri[milieu]) / 2
}

// Entrées du journal : sanctions (cases) et changements de configuration (config_audit) du serveur,
// fusionnées, de la plus récente à la plus ancienne.
// filtres : { moderateurId, type ("config" ou un type de sanction), depuis (ms) }
function entreesJournal(guildId, { moderateurId = null, type = null, depuis = 0 } = {}) {
    const entrees = []
    if (type !== "config") {
        const params = [guildId, depuis]
        let sql = "SELECT id, user_id, moderator_id, type, reason, duration_ms, auto, created_at, cancelled_at FROM cases WHERE guild_id = ? AND created_at >= ?"
        if (moderateurId) { sql += " AND moderator_id = ?"; params.push(moderateurId) }
        if (type) { sql += " AND type = ?"; params.push(type) }
        sql += " ORDER BY created_at DESC, id DESC LIMIT ?"
        params.push(LIMITE_SOURCE)
        for (const c of db.sqlAll(sql, params)) entrees.push({ genre: "sanction", ...c })
    }
    if (!type || type === "config") {
        const params = [guildId, depuis]
        let sql = "SELECT id, moderator_id, details, created_at FROM config_audit WHERE guild_id = ? AND created_at >= ?"
        if (moderateurId) { sql += " AND moderator_id = ?"; params.push(moderateurId) }
        sql += " ORDER BY created_at DESC, id DESC LIMIT ?"
        params.push(LIMITE_SOURCE)
        for (const c of db.sqlAll(sql, params)) entrees.push({ genre: "config", ...c })
    }
    return entrees.sort((a, b) => b.created_at - a.created_at || (a.genre === b.genre ? b.id - a.id : a.genre === "sanction" ? -1 : 1))
}

// Statistiques de modération depuis `depuis` : sanctions non annulées par modérateur et par type, actions automatiques
// à part (moderator_id = bot ou auto = 1), délai médian de prise en charge des tickets (claimed_at - created_at).
function statsModeration(guildId, botId, depuis) {
    const parModerateur = new Map() // id -> { total, types: { type: n } }
    const auto = { total: 0, types: {} }
    const lignes = db.sqlAll(`SELECT moderator_id, type, auto, COUNT(*) AS n FROM cases
        WHERE guild_id = ? AND created_at >= ? AND cancelled_at IS NULL GROUP BY moderator_id, type, auto`, [guildId, depuis])
    for (const l of lignes) {
        if (l.auto || l.moderator_id === botId) {
            auto.total += l.n
            auto.types[l.type] = (auto.types[l.type] ?? 0) + l.n
            continue
        }
        const m = parModerateur.get(l.moderator_id) ?? { total: 0, types: {} }
        m.total += l.n
        m.types[l.type] = (m.types[l.type] ?? 0) + l.n
        parModerateur.set(l.moderator_id, m)
    }
    const delais = db.sqlAll("SELECT claimed_at - created_at AS d FROM tickets WHERE guild_id = ? AND created_at >= ? AND claimed_at IS NOT NULL", [guildId, depuis])
        .map(l => l.d).filter(d => d >= 0)
    return {
        moderateurs: [...parModerateur.entries()].map(([id, m]) => ({ id, ...m })).sort((a, b) => b.total - a.total || a.id.localeCompare(b.id)),
        auto,
        medianePriseEnCharge: mediane(delais),
        ticketsPris: delais.length
    }
}

// Chiffres du rapport hebdomadaire depuis `depuis`
function donneesRapport(guildId, depuis) {
    const un = sql => db.sqlAll(sql, [guildId, depuis])[0]?.n ?? 0
    return {
        sanctions: db.sqlAll("SELECT type, COUNT(*) AS n FROM cases WHERE guild_id = ? AND created_at >= ? AND cancelled_at IS NULL GROUP BY type ORDER BY n DESC", [guildId, depuis]),
        // Pas de table des blocages AutoMod : on compte les dossiers de type « automod » (blocages ayant donné un dossier)
        automod: un("SELECT COUNT(*) AS n FROM cases WHERE guild_id = ? AND created_at >= ? AND type = 'automod' AND cancelled_at IS NULL"),
        ticketsOuverts: un("SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND created_at >= ?"),
        ticketsFermes: un("SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND closed_at >= ?"),
        raids: un("SELECT COUNT(*) AS n FROM raid_events WHERE guild_id = ? AND started_at >= ?"),
        appels: un("SELECT COUNT(*) AS n FROM appeals WHERE guild_id = ? AND created_at >= ?"),
        appelsAcceptes: un("SELECT COUNT(*) AS n FROM appeals WHERE guild_id = ? AND created_at >= ? AND status = 'accepte'")
    }
}

// Rapport hebdomadaire : fonctions pures (heure de Paris)
const formateurParis = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
const JOURS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

function partiesParis(date) {
    const p = Object.fromEntries(formateurParis.formatToParts(date).map(x => [x.type, x.value]))
    return { jour: JOURS[p.weekday], heure: Number(p.hour), annee: Number(p.year), mois: Number(p.month), date: Number(p.day) }
}

// Est-on lundi, entre 9 h 00 et 9 h 59 à Paris ? (le passage de 30 min tombe deux fois dans cette heure : voir dejaEnvoye)
function estLundi9hParis(date = new Date()) {
    const p = partiesParis(date)
    return p.jour === 1 && p.heure === 9
}

// Clé de la semaine (date du lundi, heure de Paris) : "2026-11-23"
function cleSemaine(date = new Date()) {
    const p = partiesParis(date)
    return new Date(Date.UTC(p.annee, p.mois - 1, p.date - (p.jour - 1))).toISOString().slice(0, 10)
}

// Le rapport de cette semaine est-il déjà parti pour ce serveur ? envoyes : Map serveur -> clé de semaine
const dejaEnvoye = (envoyes, guildId, cle) => envoyes.get(guildId) === cle

module.exports = {
    JOUR, PERIODES_JOURNAL, PERIODES_STATS, PERIODES_GRATUITES, LIMITE_SOURCE,
    mediane, entreesJournal, statsModeration, donneesRapport, estLundi9hParis, cleSemaine, dejaEnvoye
}
