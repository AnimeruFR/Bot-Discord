const fs = require('fs')
const path = require('path')
const util = require('util')

// Choix de l'environnement : --env=dev en argument, ou ENV_FILE=.env.dev dans l'environnement.
//   (rien)        -> .env (s'il existe ; sinon on garde les variables déjà définies, ex. Docker)
//   --env=dev     -> .env.dev, OBLIGATOIRE : jamais de repli sur .env, qui peut contenir le token de prod
//   ENV_FILE=...  -> ce fichier précis, obligatoire aussi
function envFile(argv = process.argv, env = process.env) {
    // "--env dev" (avec un espace) serait ignoré sans le dire et chargerait .env : on le refuse
    if (argv.includes("--env")) throw new Error(`Écris --env=dev (avec un "="), pas "--env dev".`)
    const option = argv.find(a => a.startsWith("--env="))
    if (option) {
        const nom = option.slice("--env=".length)
        // Un simple nom (dev, prod, test…) : pas de chemin, pas de "../"
        if (!/^[a-z0-9-]{1,20}$/.test(nom)) throw new Error(`Nom d'environnement invalide : "${nom}" (lettres minuscules, chiffres et tirets seulement)`)
        return { fichier: `.env.${nom}`, obligatoire: true, nom }
    }
    if (env.ENV_FILE) return { fichier: env.ENV_FILE, obligatoire: true, nom: path.basename(env.ENV_FILE) }
    return { fichier: ".env", obligatoire: false, nom: "défaut" }
}

// Applique les variables d'un fichier.
// Fichier choisi explicitement (dev, prod…) : ses valeurs PRIMENT sur celles déjà définies, pour qu'un
// DISCORD_TOKEN de prod resté dans le terminal ou dans les variables Windows ne serve jamais en dev.
// Fichier .env par défaut : les variables déjà définies priment (ex. celles données par Docker).
function appliquer(contenu, prioritaire, env = process.env) {
    for (const [cle, valeur] of Object.entries(util.parseEnv(contenu))) {
        if (prioritaire || env[cle] === undefined) env[cle] = valeur
    }
}

let charge = null
function loadEnv() {
    if (charge) return charge
    try {
        charge = envFile()
    } catch (err) {
        console.error(err.message)
        process.exit(1)
    }
    const chemin = path.resolve(charge.fichier)
    if (fs.existsSync(chemin)) {
        appliquer(fs.readFileSync(chemin, "utf8"), charge.obligatoire)
    } else if (charge.obligatoire) {
        console.error(`Fichier d'environnement introuvable : ${charge.fichier}. Copie ${charge.fichier}.example (ou .env.example) et remplis-le.`)
        process.exit(1)
    }
    return charge
}

// Renvoie le token du bot, ou arrête le programme s'il manque
function loadToken() {
    const { fichier } = loadEnv()
    const token = process.env.DISCORD_TOKEN
    if (!token) {
        console.error(`DISCORD_TOKEN manquant dans ${fichier} (ou dans les variables d'environnement).`)
        process.exit(1)
    }
    return token
}

module.exports = { loadEnv, loadToken, envFile, appliquer }
