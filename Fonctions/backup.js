const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')
const db = require('./db')

const MOTIF = /^bot-\d{8}-\d{6}\.db$/ // seuls ces fichiers sont concernés par la rotation
const MOTIF_TMP = /^bot-\d{8}-\d{6}\.db\.tmp$/

function horodatage(date = new Date()) {
    const p = n => String(n).padStart(2, "0")
    return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

// Crée une sauvegarde vérifiée dans `dossier` et ne garde que les `garder` plus récentes.
// Renvoie le chemin de la sauvegarde créée.
function makeBackup(dossier = process.env.BACKUP_DIR || "backups", garder = Number(process.env.BACKUP_KEEP) || 7) {
    if (db.fichier === ":memory:") throw new Error("Pas de sauvegarde possible pour une base en mémoire")
    fs.mkdirSync(dossier, { recursive: true })

    const final = path.join(dossier, `bot-${horodatage()}.db`)
    const temporaire = `${final}.tmp`
    if (fs.existsSync(final)) throw new Error(`La sauvegarde ${final} existe déjà`)

    // Fichiers temporaires laissés par un crash précédent : supprimés (ils ne doivent pas s'accumuler)
    for (const f of fs.readdirSync(dossier)) if (MOTIF_TMP.test(f)) fs.rmSync(path.join(dossier, f), { force: true })

    // Écriture dans un fichier temporaire, vérification, puis renommage : jamais de sauvegarde à moitié écrite
    try {
        db.backupTo(temporaire)
        const copie = new DatabaseSync(temporaire, { readOnly: true })
        try {
            const { integrity_check: resultat } = copie.prepare("PRAGMA integrity_check").get()
            if (resultat !== "ok") throw new Error(`Sauvegarde corrompue : ${resultat}`)
        } finally {
            copie.close()
        }
        fs.renameSync(temporaire, final)
    } catch (err) {
        fs.rmSync(temporaire, { force: true })
        throw err
    }

    // Rotation : on supprime les plus anciennes au-delà de `garder`
    const anciennes = listBackups(dossier).slice(Math.max(1, garder))
    for (const f of anciennes) fs.rmSync(path.join(dossier, f))

    return final
}

// Sauvegardes existantes, de la plus récente à la plus ancienne
function listBackups(dossier) {
    if (!fs.existsSync(dossier)) return []
    return fs.readdirSync(dossier).filter(f => MOTIF.test(f)).sort().reverse()
}

// Âge de la dernière sauvegarde en ms (Infinity s'il n'y en a pas)
function ageDerniereSauvegarde(dossier = process.env.BACKUP_DIR || "backups") {
    const [derniere] = listBackups(dossier)
    return derniere ? Date.now() - fs.statSync(path.join(dossier, derniere)).mtimeMs : Infinity
}

// Sauvegarde automatique toutes les BACKUP_INTERVAL_HOURS heures (0 ou absent = désactivée)
function startBackupSchedule() {
    const heures = Number(process.env.BACKUP_INTERVAL_HOURS)
    if (!Number.isFinite(heures) || heures <= 0) return null
    const lancer = () => {
        try {
            console.log(`Sauvegarde de la base : ${makeBackup()}`)
        } catch (err) {
            console.error("Échec de la sauvegarde automatique :", err.message)
        }
    }
    // Au démarrage, seulement si la dernière sauvegarde est trop ancienne : un bot qui redémarre en boucle
    // ne doit pas remplacer les bonnes sauvegardes par des copies prises à quelques secondes d'intervalle
    // La prochaine sauvegarde se cale sur l'âge de la dernière (et non sur l'heure de démarrage) :
    // même si le bot redémarre plus souvent que l'intervalle, une sauvegarde finit toujours par se faire.
    const intervalle = heures * 60 * 60 * 1000
    const attente = Math.max(0, intervalle - ageDerniereSauvegarde())
    const premier = setTimeout(() => {
        lancer()
        setInterval(lancer, intervalle).unref()
    }, attente)
    premier.unref()
    return premier
}

module.exports = { makeBackup, startBackupSchedule, listBackups, ageDerniereSauvegarde, MOTIF }
