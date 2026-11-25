const fs = require('fs')
const path = require('path')

// Migrations de schéma versionnées. La version de la base est stockée dans PRAGMA user_version.
// Chaque fichier migrations/NNN-nom.js exporte { description, up(db), down(db) }.
const DOSSIER = path.join(__dirname, '..', 'migrations')
const MOTIF = /^(\d{3,})-([a-z0-9-]+)\.js$/i

function versionActuelle(db) {
    return db.prepare("PRAGMA user_version").get().user_version
}

// Liste les migrations du dossier, triées par version. Erreur s'il manque un numéro ou s'il y a un doublon.
function listerMigrations(dossier = DOSSIER) {
    if (!fs.existsSync(dossier)) throw new Error(`Dossier de migrations introuvable : ${dossier}`)
    const migrations = []
    for (const fichier of fs.readdirSync(dossier).filter(f => f.endsWith('.js')).sort()) {
        const correspondance = MOTIF.exec(fichier)
        if (!correspondance) throw new Error(`Nom de migration invalide : ${fichier} (attendu : NNN-nom.js)`)
        const version = Number(correspondance[1])
        const precedente = migrations[migrations.length - 1]
        if (precedente && precedente.version === version) {
            throw new Error(`Numéro de migration en double (${version}) : ${precedente.fichier} et ${fichier}`)
        }
        if (version !== migrations.length + 1) {
            throw new Error(`Trou dans la numérotation des migrations : ${fichier} arrive après la version ${migrations.length}`)
        }
        const module_ = require(path.join(dossier, fichier))
        if (typeof module_.up !== 'function' || typeof module_.down !== 'function') {
            throw new Error(`La migration ${fichier} doit exporter up(db) et down(db)`)
        }
        migrations.push({ version, nom: correspondance[2], fichier, description: module_.description || '', up: module_.up, down: module_.down })
    }
    return migrations
}

// Exécute fn dans une transaction BEGIN IMMEDIATE. Dans la transaction, on relit user_version :
// un autre processus (le bot ou le tableau de bord) a pu migrer entre-temps. fn reçoit cette version
// et renvoie la nouvelle (ou null s'il n'y a rien à faire).
function dansTransaction(db, fn) {
    db.exec("BEGIN IMMEDIATE")
    try {
        const nouvelle = fn(versionActuelle(db))
        if (nouvelle !== null) db.exec(`PRAGMA user_version = ${nouvelle}`)
        db.exec("COMMIT")
    } catch (err) {
        try {
            db.exec("ROLLBACK")
        } catch {
            // Déjà annulée par SQLite : rien à faire
        }
        throw err
    }
}

function verifierCible(cible, derniere) {
    if (!Number.isInteger(cible) || cible < 0 || cible > derniere) {
        throw new Error(`Version cible invalide : ${cible} (entre 0 et ${derniere})`)
    }
}

// Applique les migrations en attente jusqu'à `cible` (la dernière par défaut), chacune dans sa transaction.
// En cas d'erreur : ROLLBACK de cette migration puis exception (les précédentes restent appliquées).
function migrer(db, { dossier = DOSSIER, cible } = {}) {
    const migrations = listerMigrations(dossier)
    const derniere = migrations.length
    const voulue = cible ?? derniere
    verifierCible(voulue, derniere)

    const avant = versionActuelle(db)
    if (avant > derniere) {
        throw new Error(`La base est en version ${avant}, plus récente que ce code (version ${derniere}) : mets le bot à jour`)
    }
    const appliquees = []
    for (const migration of migrations.filter(m => m.version > avant && m.version <= voulue)) {
        let faite = false
        try {
            dansTransaction(db, actuelle => {
                if (actuelle >= migration.version) return null // déjà appliquée par un autre processus
                migration.up(db)
                faite = true
                return migration.version
            })
        } catch (err) {
            throw new Error(`Migration ${migration.fichier} échouée (annulée) : ${err.message}`, { cause: err })
        }
        if (faite) appliquees.push(migration.version)
    }
    return { avant, apres: versionActuelle(db), appliquees }
}

// Revient à la version `cible` en appliquant les down en ordre inverse, chacun dans sa transaction.
function annuler(db, cible, { dossier = DOSSIER } = {}) {
    const migrations = listerMigrations(dossier)
    const avant = versionActuelle(db)
    verifierCible(cible, avant)
    if (avant > migrations.length) {
        throw new Error(`La base est en version ${avant}, plus récente que ce code (version ${migrations.length}) : impossible d'annuler`)
    }
    const annulees = []
    for (const migration of migrations.filter(m => m.version > cible && m.version <= avant).reverse()) {
        let faite = false
        try {
            dansTransaction(db, actuelle => {
                if (actuelle < migration.version) return null // déjà annulée par un autre processus
                migration.down(db)
                faite = true
                return migration.version - 1
            })
        } catch (err) {
            throw new Error(`Annulation de ${migration.fichier} échouée (annulée) : ${err.message}`, { cause: err })
        }
        if (faite) annulees.push(migration.version)
    }
    return { avant, apres: versionActuelle(db), annulees }
}

// Version actuelle, dernière version connue et migrations en attente
function etat(db, { dossier = DOSSIER } = {}) {
    const migrations = listerMigrations(dossier)
    const actuelle = versionActuelle(db)
    const enAttente = migrations.filter(m => m.version > actuelle).map(m => ({ version: m.version, nom: m.nom, description: m.description }))
    return { actuelle, derniere: migrations.length, enAttente }
}

function horodatage(date = new Date()) {
    const p = n => String(n).padStart(2, "0")
    return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

// Sauvegarde (VACUUM INTO) avant de toucher au schéma d'une base qui contient déjà des tables.
// Le nom (avant-migration-v<version>-<date>.db) ne correspond pas au motif de rotation de backup.js :
// ces fichiers ne sont jamais supprimés automatiquement. Renvoie le chemin, ou null s'il n'y avait rien à sauvegarder.
function sauvegarderAvantMigration(db, fichier, { dossier = process.env.BACKUP_DIR || "backups", prefixe = "avant-migration" } = {}) {
    if (fichier === ":memory:") return null
    const contientDesTables = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get()
    if (!contientDesTables) return null

    const final = path.join(dossier, `${prefixe}-v${versionActuelle(db)}-${horodatage()}.db`)
    // Un autre processus (bot et tableau de bord démarrent parfois ensemble) vient de faire la même sauvegarde
    if (fs.existsSync(final)) return final
    const temporaire = `${final}.${process.pid}.tmp` // le PID évite que deux processus écrivent le même fichier
    try {
        fs.mkdirSync(dossier, { recursive: true })
        fs.rmSync(temporaire, { force: true })
        db.prepare("VACUUM INTO ?").run(temporaire)
        fs.renameSync(temporaire, final)
    } catch (err) {
        fs.rmSync(temporaire, { force: true })
        throw new Error(`Sauvegarde avant migration impossible dans ${dossier} (BACKUP_DIR) : ${err.message}`, { cause: err })
    }
    return final
}

const MOTIF_SAUVEGARDE = /^avant-migration-v\d+-\d{8}-\d{6}\.db$/
const CONSERVATION_SAUVEGARDES = 30 * 24 * 60 * 60 * 1000

// RGPD : ces copies contiennent toute la base, donc des données déjà effacées. On les supprime après 30 jours.
// Renvoie le nombre de fichiers supprimés.
function purgerSauvegardesMigration({ dossier = process.env.BACKUP_DIR || "backups", maintenant = Date.now(), duree = CONSERVATION_SAUVEGARDES } = {}) {
    if (!fs.existsSync(dossier)) return 0
    let supprimees = 0
    for (const nom of fs.readdirSync(dossier).filter(n => MOTIF_SAUVEGARDE.test(n))) {
        const chemin = path.join(dossier, nom)
        try {
            if (maintenant - fs.statSync(chemin).mtimeMs <= duree) continue
            fs.rmSync(chemin, { force: true })
            supprimees++
        } catch (err) {
            console.error(`Suppression de la sauvegarde ${nom} impossible :`, err.message)
        }
    }
    return supprimees
}

// Pour un processus qui ne migre pas (DATABASE_NO_MIGRATE=1, ex. le tableau de bord) : attend que le bot ait migré.
// Réessaie toutes les `intervalle` ms pendant `delaiMax` ms au plus, puis lève une erreur claire.
function attendreSchema(db, { intervalle = 2000, delaiMax = 60000, dormir = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms), dossier = DOSSIER } = {}) {
    let attendu = 0
    for (;;) {
        const { actuelle, derniere, enAttente } = etat(db, { dossier })
        if (!enAttente.length) return
        if (attendu >= delaiMax) {
            throw new Error(`La base est en version ${actuelle} et le code attend la version ${derniere}, mais la migration est désactivée (DATABASE_NO_MIGRATE=1) : lance d'abord le bot (il migre la base), puis relance ce service`)
        }
        dormir(intervalle)
        attendu += intervalle
    }
}

module.exports = { listerMigrations, migrer, annuler, etat, sauvegarderAvantMigration, purgerSauvegardesMigration, attendreSchema, versionActuelle, DOSSIER }
