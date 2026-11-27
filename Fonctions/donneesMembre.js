// Export et effacement des données d'un membre sur un serveur, d'après le registre (Fonctions/registreRgpd.js).
// Les noms de table et de colonne viennent uniquement du registre ; les identifiants passent en paramètres.
const db = require('./db')
const { REGISTRE, ANONYME, INACTIVITE } = require('./registreRgpd')
const { jourParis } = require('./evenements')

const MASQUE = "(secret jusqu'à la fin de la partie)"

// Tables qui contiennent des colonnes de membre (les autres sont déclarées avec "aucune")
const tablesConcernees = () => Object.entries(REGISTRE).filter(([, def]) => def.colonnes)

// Semaine ISO (lundi au dimanche) d'un jour AAAA-MM-JJ : "2026-W48" (même calcul que semaineParis dans Fonctions/quetes.js)
function semaineIso(jour) {
    const [annee, mois, j] = jour.split("-").map(Number)
    const date = new Date(Date.UTC(annee, mois - 1, j))
    date.setUTCDate(date.getUTCDate() + 3 - (date.getUTCDay() + 6) % 7) // le jeudi de la semaine décide de l'année
    const premiere = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
    const numero = 1 + Math.round(((date - premiere) / 86400000 - 3 + (premiere.getUTCDay() + 6) % 7) / 7)
    return `${date.getUTCFullYear()}-W${String(numero).padStart(2, "0")}`
}

// Périodes de jeu (heure de Paris) autour d'un instant : jour, veille, semaine, semaine précédente
function periodes(instant = Date.now()) {
    const jour = jourParis(instant)
    const [annee, mois, j] = jour.split("-").map(Number)
    const decale = n => jourParis(Date.UTC(annee, mois - 1, j + n, 12)) // midi UTC : toujours le bon jour à Paris
    return { jour, hier: decale(-1), semaine: semaineIso(jour), semainePrecedente: semaineIso(decale(-7)) }
}

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

// Colonne secrète tant que la condition du registre est vraie (ex. état d'une partie en cours)
function masquer(ligne, secret) {
    if (!secret || !(secret.colonne in ligne) || ligne[secret.si.colonne] !== secret.si.valeur) return ligne
    return { ...ligne, [secret.colonne]: MASQUE }
}

// Lignes d'une table rattachées au membre par leur ligne parente (ex. case_edits -> cases.user_id)
function lignesRattachees(table, def, guildId, userId) {
    const { colonne, parent, cle, parentServeur, parentMembre } = def.rattachee
    return db.sqlAll(`SELECT * FROM ${table} WHERE ${conditionServeur(def)} AND ${colonne} IN (SELECT ${cle} FROM ${parent} WHERE ${parentServeur} = ? AND ${parentMembre} = ?)`,
        [guildId, guildId, userId])
}

// Toutes les données d'un membre sur un serveur, table par table (seules les tables où il apparaît sont listées)
function exporter(guildId, userId) {
    const g = String(guildId), u = String(userId)
    const tables = {}
    for (const [table, def] of tablesConcernees()) {
        const colonnes = Object.entries(def.colonnes)
        const conditions = colonnes.map(([colonne, c]) => conditionMembre(colonne, c)).join(" OR ")
        const trouvees = db.sqlAll(`SELECT * FROM ${table} WHERE ${conditionServeur(def)} AND (${conditions})`,
            [String(guildId), ...colonnes.map(() => u)])
        // Lignes qui visent le membre par leur ligne parente (ex. modifications de ses sanctions) : toujours en entier
        const viaParent = def.rattachee ? lignesRattachees(table, def, g, u) : []
        const completes = new Set(viaParent.map(l => JSON.stringify(l)))
        const lignes = trouvees.filter(l => !completes.has(JSON.stringify(l))).map(ligne => {
            const roles = colonnes.filter(([colonne, c]) => designe(ligne, colonne, c, u))
            // Concerné lui-même (sanctionné, auteur du ticket, gagnant…) : ligne complète
            if (roles.some(([, c]) => !c.auteur)) return masquer(ligne, def.secret)
            return ligneReduite(ligne, roles.map(([colonne]) => colonne))
        }).concat(viaParent)
        if (!lignes.length) continue
        const traitements = colonnes.map(([colonne, c]) => [colonne, c.duree ? `${c.traitement} (${c.duree})` : c.traitement])
        if (viaParent.length && def.rattachee) {
            const r = def.rattachee
            traitements.push([`${r.colonne} (via ${r.parent}.${r.parentMembre})`, r.duree ? `${r.traitement} (${r.duree})` : r.traitement])
        }
        tables[table] = {
            traitement_a_l_effacement: Object.fromEntries(traitements),
            ...(INACTIVITE.tables.includes(table) ? { effacement_si_inactif: INACTIVITE.duree } : {}),
            lignes
        }
    }
    return { serveur: String(guildId), membre: u, exporte_le: new Date().toISOString(), tables }
}

// Compte gelé par le staff : le portefeuille (tables differeSiGele) n'est pas effacé tant que le gel dure
function portefeuilleGele(guildId, userId) {
    return db.sqlAll("SELECT frozen FROM eco_comptes WHERE guild_id = ? AND user_id = ?", [String(guildId), String(userId)])[0]?.frozen === 1
}

// Applique le registre en une seule transaction : tout est effacé / anonymisé / réinitialisé, ou rien.
// Renvoie un résumé par table : { table: { effacees, anonymisees, reinitialisees, conservees, differees } } (tables sans effet omises).
// instant : pour les tests (périodes de l'empreinte anti-abus).
function effacer(guildId, userId, { instant = Date.now() } = {}) {
    const g = String(guildId), u = String(userId)
    const p = periodes(instant)
    return db.transaction(() => {
        const gele = portefeuilleGele(g, u)
        const resume = {}
        const noter = (table, cle, n) => {
            if (n > 0) resume[table] = { ...resume[table], [cle]: (resume[table]?.[cle] ?? 0) + n }
        }
        for (const [table, def] of tablesConcernees()) {
            const portee = conditionServeur(def)
            const colonnes = Object.entries(def.colonnes)
            // 0. portefeuille d'un compte gelé : rien n'est touché, effacement possible après le dégel
            if (gele && def.differeSiGele) {
                const conditions = colonnes.map(([colonne, c]) => conditionMembre(colonne, c)).join(" OR ")
                const [{ total }] = db.sqlAll(`SELECT COUNT(*) AS total FROM ${table} WHERE ${portee} AND (${conditions})`, [g, ...colonnes.map(() => u)])
                noter(table, "differees", total)
                continue
            }
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
            // 3. empreinte anti-abus : lignes hors de `garder` effacées, valeurs fixes sur les lignes gardées
            for (const [colonne, c] of colonnes.filter(([, c]) => c.traitement === "reinitialiser")) {
                const garde = c.garder ? c.garder(p) : { sql: "1", params: [] }
                noter(table, "effacees", db.sqlRun(`DELETE FROM ${table} WHERE ${portee} AND ${conditionMembre(colonne, c)} AND NOT (${garde.sql})`,
                    [g, u, ...garde.params]))
                if (c.valeurs) {
                    const affectations = Object.entries(c.valeurs).map(([col, valeur]) => `${col} = ${valeur}`).join(", ")
                    noter(table, "reinitialisees", db.sqlRun(`UPDATE ${table} SET ${affectations} WHERE ${portee} AND ${conditionMembre(colonne, c)} AND (${garde.sql})`,
                        [g, u, ...garde.params]))
                } else {
                    const [{ total }] = db.sqlAll(`SELECT COUNT(*) AS total FROM ${table} WHERE ${portee} AND ${conditionMembre(colonne, c)} AND (${garde.sql})`,
                        [g, u, ...garde.params])
                    noter(table, "conservees", total)
                }
            }
            // 4. lignes conservées (comptées pour le résumé, rien n'est modifié)
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
    const lignes = Object.entries(resume).map(([table, r]) => `${table} : ${[
        r.effacees && `${r.effacees} effacée(s)`, r.anonymisees && `${r.anonymisees} anonymisée(s)`,
        r.reinitialisees && `${r.reinitialisees} réinitialisée(s)`, r.conservees && `${r.conservees} conservée(s)`,
        r.differees && `${r.differees} différée(s)`
    ].filter(Boolean).join(", ")}`)
    return lignes.length ? lignes.join(" ; ") : "aucune donnée"
}

// Des lignes ont-elles été différées (compte gelé) ?
const aDesDifferees = resume => Object.values(resume).some(r => r.differees > 0)

module.exports = { exporter, effacer, portefeuilleGele, resumeTexte, aDesDifferees, periodes, semaineIso, MASQUE }
