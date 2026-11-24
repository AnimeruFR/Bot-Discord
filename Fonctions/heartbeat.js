const fs = require('fs')
const Discord = require('discord.js')

// Le bot est réellement connecté : tous ses shards sont prêts.
// (bot.ws.status ne suffit pas : il passe à Ready une fois et ne redescend jamais.)
function estConnecte(bot) {
    const shards = bot.ws.shards
    return shards.size > 0 && shards.every(s => s.status === Discord.Status.Ready)
}

// Écrit la date du jour dans HEARTBEAT_FILE toutes les 30 s, seulement quand le bot est connecté à Discord.
// Le healthcheck Docker (scripts/healthcheck.js) vérifie que ce fichier est récent.
function startHeartbeat(bot, fichier = process.env.HEARTBEAT_FILE) {
    if (!fichier) return null
    const battre = () => {
        if (!estConnecte(bot)) return
        try {
            fs.writeFileSync(fichier, String(Date.now()))
        } catch (err) {
            console.error("Impossible d'écrire le heartbeat :", err.message)
        }
    }
    battre()
    return setInterval(battre, 30 * 1000).unref()
}

module.exports = { startHeartbeat, estConnecte }
