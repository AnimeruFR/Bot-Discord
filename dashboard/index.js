const { loadEnv } = require('../Fonctions/env')

// L'environnement est chargé AVANT les autres modules (la base lit DATABASE_PATH au chargement)
const { fichier } = loadEnv()

const discord = require('./discord')
const actions = require('./actions')
const pages = require('./pages')
const db = require('../Fonctions/db')
const { creerServeur } = require('./serveur')

function erreurConfig(texte) {
    console.error(texte)
    process.exit(1)
}

function verifierEnvironnement() {
    const manquantes = ["DISCORD_TOKEN", "DISCORD_CLIENT_SECRET", "DASHBOARD_URL"].filter(nom => !process.env[nom])
    if (manquantes.length) erreurConfig(`Variable(s) manquante(s) dans ${fichier} : ${manquantes.join(", ")}.`)

    const url = process.env.DASHBOARD_URL
    // Exactement une origine (pas de chemin ni de / final) : le redirect_uri est `${DASHBOARD_URL}/callback`
    if (!URL.canParse(url) || !["http:", "https:"].includes(new URL(url).protocol) || new URL(url).origin !== url) {
        erreurConfig(`DASHBOARD_URL invalide : "${url}". Forme attendue : https://domaine.fr ou http://localhost:3000 (sans / final ni chemin).`)
    }
    const { protocol, hostname } = new URL(url)
    if (protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
        console.warn("Attention : DASHBOARD_URL est en http hors de localhost. Les cookies sécurisés ne fonctionneront pas : utilise https.")
    }

    const port = process.env.DASHBOARD_PORT || "3000"
    if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) erreurConfig(`DASHBOARD_PORT invalide : "${port}".`)
    return { url, port: Number(port) }
}

async function demarrer() {
    const { url, port } = verifierEnvironnement()
    try {
        await discord.init()
    } catch (err) {
        erreurConfig(`Impossible de lire l'application Discord (statut ${err.status ?? "inconnu"}) : vérifie DISCORD_TOKEN.`)
    }

    const serveur = creerServeur({ discord, actions, pages })
    serveur.on("error", err => erreurConfig(`Le tableau de bord n'a pas pu démarrer : ${err.message}`))
    serveur.listen(port, () => console.log(`Tableau de bord prêt : ${url} (port ${port})`))

    let arretEnCours = false
    function arreter(signal) {
        if (arretEnCours) return
        arretEnCours = true
        console.log(`${signal} reçu : arrêt du tableau de bord…`)
        const fin = () => {
            try {
                db.close()
            } catch {
                // déjà fermée
            }
            process.exit(0)
        }
        serveur.close(fin)
        serveur.closeIdleConnections()
        // Les connexions encore actives ont 5 secondes pour se terminer
        setTimeout(() => {
            serveur.closeAllConnections()
            fin()
        }, 5000).unref()
    }
    process.on("SIGINT", () => arreter("SIGINT"))
    process.on("SIGTERM", () => arreter("SIGTERM"))
}

// Dernier filet : on journalise le message (jamais d'objet complet, qui pourrait contenir un jeton)
process.on("unhandledRejection", raison => {
    console.error("Promesse rejetée non gérée :", raison && raison.message ? raison.message : String(raison))
})
process.on("uncaughtException", err => {
    console.error("Exception non gérée :", err && err.stack ? err.stack : String(err))
    process.exit(1)
})

demarrer().catch(err => {
    console.error("Erreur au démarrage du tableau de bord :", err && err.message ? err.message : err)
    process.exit(1)
})
