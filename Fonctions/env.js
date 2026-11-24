// Charge le fichier .env s'il existe (Node >= 20.12) et renvoie le token du bot
function loadToken() {
    try {
        process.loadEnvFile()
    } catch (err) {
        if (err.code !== 'ENOENT') throw err
    }

    const token = process.env.DISCORD_TOKEN
    if (!token) {
        console.error("DISCORD_TOKEN manquant : copie .env.example en .env et mets-y le token du bot.")
        process.exit(1)
    }
    return token
}

module.exports = { loadToken }
