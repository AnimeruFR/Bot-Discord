// Charge le fichier .env s'il existe (Node >= 20.12).
// Une variable déjà définie dans l'environnement garde la priorité sur le fichier.
let charge = false
function loadEnv() {
    if (charge) return
    charge = true
    try {
        process.loadEnvFile()
    } catch (err) {
        if (err.code !== 'ENOENT') throw err
    }
}

// Renvoie le token du bot, ou arrête le programme s'il manque
function loadToken() {
    loadEnv()
    const token = process.env.DISCORD_TOKEN
    if (!token) {
        console.error("DISCORD_TOKEN manquant : copie .env.example en .env et mets-y le token du bot.")
        process.exit(1)
    }
    return token
}

module.exports = { loadEnv, loadToken }
