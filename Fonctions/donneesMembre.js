// Export et effacement des données d'un membre sur un serveur, d'après le registre (Fonctions/registreRgpd.js).
// Les noms de table et de colonne viennent uniquement du registre ; les identifiants passent en paramètres.
const db = require('./db')
const { REGISTRE, ANONYME } = require('./registreRgpd')

// Tables qui contiennent des colonnes de membre (les autres sont déclarées avec "aucune")
const tablesConcernees = () => Object.entries(REGISTRE).filter(([, def]) => def.colonnes)

// Condition SQL qui limite une table au serveur (directement, ou via sa table parente)
function conditionServeur(def) {
    if (typeof def.serveur === "string") return `${def.serveur} = ?`
    const { colonne, parent, cle, parentServeur } = def.serveur
    return `${colonne} IN (SELECT ${cle} FROM ${parent} WHERE ${parentServeur} = ?)`
}

// Condition SQL "cette colonne désigne le membre" (une valeur simple, ou un identifiant dans une liste JSON)
function conditionMembre(colonne, c) {
    if (!c.liste) return `${colonne} = ?`
    return `CASE WHEN json_valid(${colonne}) THEN EXISTS (SELECT 1 FROM json_each(${colonne}) WHERE value = ?) ELSE 0 END`
}

// Cette ligne désigne-t-elle le membre par cette colonne ? (valeur simple, ou identifiant dans une liste JSON)
function designe(ligne, colonne, c, userId) {
    const valeur = ligne[colonne]
    if (!c.liste) return valeur === userId
    try {
        return JSON.parse(valeur).includes(userId)
    } catch {
        return false
    }
}

// Ligne où le membre apparaît seulement comme auteur d'une action (modérateur, organisateur…) : on ne donne que
// son id, ses dates et son rôle. Le reste (membre sanctionné, raison, participants…) concerne d'autres personnes.
function ligneReduite(ligne, roles) {
    const reduite = {}
    for (const [colonne, valeur] of Object.entries(ligne)) {
        if (colonne === "id" || colonne.endsWith("_at")) reduite[colonne] = valeur
    }
    return { ...reduite, role_du_membre: roles }
}

// Toutes les données d'un membre sur un serveur, table par table (seules les tables où il apparaît sont listées)
function exporter(guildId, userId) {
    const u = String(userId)
    const tables = {}
    for (const [table, def] of tablesConcernees()) {
        const colonnes = Object.entries(def.colonnes)
        const conditions = colonnes.map(([colonne, c]) => conditionMembre(colonne, c)).join(" OR ")
        const trouvees = db.sqlAll(`SELECT * FROM ${table} WHERE ${conditionServeur(def)} AND (${conditions})`,
            [String(guildId), ...colonnes.map(() => u)])
        const lignes = trouvees.map(ligne => {
            const roles = colonnes.filter(([colonne, c]) => designe(ligne, colonne, c, u))
            // Concerné lui-même (sanctionné, auteur du ticket, gagnant…) : ligne complète
            if (roles.some(([, c]) => !c.auteur)) return ligne
            return ligneReduite(ligne, roles.map(([colonne]) => colonne))
        })
        if (!lignes.length) continue
        tables[table] = {
            traitement_a_l_effacement: Object.fromEntries(colonnes.map(([colonne, c]) =>
                [colonne, c.duree ? `${c.traitement} (${c.duree})` : c.traitement])),
            lignes
        }
    }
    return { serveur: String(guildId), membre: u, exporte_le: new Date().toISOString(), tables }
}

// Point d'extension : renvoie un motif (texte) si l'effacement doit être différé (gel économique, séquestre…), sinon null.
// Les modules suivants le remplacent par leurs propres vérifications.
function refusEffacement() {
    return null
}

// Applique le registre en une seule transaction : tout est effacé / anonymisé, ou rien.
// Renvoie un résumé par table : { table: { effacees, anonymisees, conservees } } (tables sans effet omises).
function effacer(guildId, userId) {
    const g = String(guildId), u = String(userId)
    return db.transaction(() => {
        const motif = module.exports.refusEffacement(g, u)
        if (motif) throw Object.assign(new Error(`Effacement différé : ${motif}`), { code: "RGPD_DIFFERE", motif })

        const resume = {}
        const noter = (table, cle, n) => {
            if (n > 0) resume[table] = { ...resume[table], [cle]: (resume[table]?.[cle] ?? 0) + n }
        }
        for (const [table, def] of tablesConcernees()) {
            const portee = conditionServeur(def)
            const colonnes = Object.entries(def.colonnes)
            // 1. lignes à effacer
            for (const [colonne, c] of colonnes.filter(([, c]) => c.traitement === "effacer")) {
                noter(table, "effacees", db.sqlRun(`DELETE FROM ${table} WHERE ${portee} AND ${conditionMembre(colonne, c)}`, [g, u]))
            }
            // 2. colonnes à anonymiser
            for (const [colonne, c] of colonnes.filter(([, c]) => c.traitement === "anonymiser")) {
                const nouvelle = c.liste
                    ? `(SELECT json_group_array(CASE WHEN value = ? THEN ? ELSE value END) FROM json_each(${colonne}))`
                    : "?"
                const params = c.liste ? [u, ANONYME, g, u] : [ANONYME, g, u]
                noter(table, "anonymisees", db.sqlRun(`UPDATE ${table} SET ${colonne} = ${nouvelle} WHERE ${portee} AND ${conditionMembre(colonne, c)}`, params))
            }
            // 3. lignes conservées (comptées pour le résumé, rien n'est modifié)
            for (const [colonne, c] of colonnes.filter(([, c]) => c.traitement === "conserver")) {
                const [{ total }] = db.sqlAll(`SELECT COUNT(*) AS total FROM ${table} WHERE ${portee} AND ${conditionMembre(colonne, c)}`, [g, u])
                noter(table, "conservees", total)
            }
        }
        return resume
    })
}

// Résumé sur une ligne, pour les logs (jamais de contenu, seulement des nombres)
function resumeTexte(resume) {
    const lignes = Object.entries(resume).map(([table, r]) =>
        `${table} : ${[r.effacees && `${r.effacees} effacée(s)`, r.anonymisees && `${r.anonymisees} anonymisée(s)`, r.conservees && `${r.conservees} conservée(s)`].filter(Boolean).join(", ")}`)
    return lignes.length ? lignes.join(" ; ") : "aucune donnée"
}

module.exports = { exporter, effacer, refusEffacement, resumeTexte }
