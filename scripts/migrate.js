// Migrations de la base : npm run migrate (ou npm run migrate -- --env=prod)
//   (rien)                  applique les migrations en attente
//   --etat                  affiche la version de la base et les migrations en attente
//   --annuler N --confirmer revient à la version N (les données des tables supprimées sont perdues)
// Le bot applique déjà les migrations tout seul au démarrage : ce script sert à les voir ou à les annuler.
const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')
const { loadEnv } = require('../Fonctions/env')
loadEnv()
const { migrer, annuler, etat, sauvegarderAvantMigration } = require('../Fonctions/migrations')

const args = process.argv.slice(2)
const fichier = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'bot.db')

function valeurDe(option) {
    const i = args.indexOf(option)
    if (i === -1) return null
    return args[i + 1] ?? ""
}

function main() {
    const annulation = valeurDe("--annuler")
    if (annulation !== null && !/^\d+$/.test(annulation)) throw new Error("Utilise --annuler N avec un numéro de version, par exemple --annuler 0")
    if (annulation !== null && !args.includes("--confirmer")) {
        throw new Error(`Annuler des migrations peut supprimer des données : ajoute --confirmer (npm run migrate -- --annuler ${annulation} --confirmer)`)
    }
    if (fichier === ":memory:") throw new Error("Une base en mémoire ne se migre pas à part : DATABASE_PATH doit être un fichier")
    if (args.includes("--etat") && !fs.existsSync(fichier)) {
        console.log(`Aucune base à ${fichier} : elle sera créée à la dernière version au prochain démarrage.`)
        return
    }

    fs.mkdirSync(path.dirname(fichier), { recursive: true })
    const db = new DatabaseSync(fichier, { timeout: 5000 })
    try {
        db.exec("PRAGMA journal_mode = WAL; PRAGMA secure_delete = ON;")

        if (args.includes("--etat")) {
            const { actuelle, derniere, enAttente } = etat(db)
            console.log(`Base : ${fichier}`)
            console.log(`Version actuelle : v${actuelle} (dernière version connue : v${derniere})`)
            if (!enAttente.length) console.log("Aucune migration en attente.")
            for (const m of enAttente) console.log(`  en attente : ${String(m.version).padStart(3, "0")}-${m.nom}${m.description ? ` (${m.description})` : ""}`)
            return
        }

        if (annulation !== null) {
            const cible = Number(annulation)
            if (cible >= etat(db).actuelle) {
                console.log(`La base est déjà en v${etat(db).actuelle} : rien à annuler.`)
                return
            }
            const copie = sauvegarderAvantMigration(db, fichier, { prefixe: "avant-annulation" })
            if (copie) console.log(`Sauvegarde créée : ${copie}`)
            const { avant, apres } = annuler(db, cible)
            console.log(`Base ramenée de v${avant} à v${apres}`)
            return
        }

        if (etat(db).enAttente.length) {
            const copie = sauvegarderAvantMigration(db, fichier)
            if (copie) console.log(`Sauvegarde créée : ${copie}`)
        }
        const { avant, apres, appliquees } = migrer(db)
        console.log(appliquees.length ? `Base migrée de v${avant} à v${apres}` : `Base déjà à jour (v${apres})`)
    } finally {
        db.close()
    }
}

try {
    main()
} catch (err) {
    console.error("Échec :", err.message)
    process.exit(1)
}
