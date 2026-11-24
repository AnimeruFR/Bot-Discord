const Discord = require('discord.js')
const { loadToken, loadEnv } = require('./Fonctions/env')

// Le .env doit être chargé avant tout le reste (la base lit DATABASE_PATH)
const token = loadToken()
console.log(`Environnement : ${loadEnv().nom} (${loadEnv().fichier})`)

const db = require('./Fonctions/db')
const loadCommands = require('./Loader/loadCommands')
const loadEvents = require('./Loader/loadEvents')

const bot = new Discord.Client({
    // Aucun intent privilégié : Guilds pour les serveurs et salons, GuildModeration pour savoir
    // quand un membre est débanni (fin anticipée d'un ban temporaire)
    intents: [Discord.GatewayIntentBits.Guilds, Discord.GatewayIntentBits.GuildModeration],
    // Le bot ne ping jamais @everyone, @here ou un rôle, même si une raison en contient
    allowedMentions: { parse: [], repliedUser: false }
})

bot.commands = new Discord.Collection()
bot.color = "#FF0000"

loadCommands(bot)
loadEvents(bot)

bot.on('error', err => console.error("Erreur du client Discord :", err))

// Déconnexion définitive (token réinitialisé, intents refusés…) : on quitte avec une erreur pour que
// Docker (restart: unless-stopped) ou le gestionnaire de processus relance le bot, au lieu d'un bot zombie.
bot.on('shardDisconnect', (event, shardId) => {
    if (arretEnCours) return // arrêt volontaire (Ctrl+C, docker stop) : géré par arreter()
    console.error(`Shard ${shardId} déconnecté définitivement (code ${event.code}), arrêt du bot.`)
    process.exit(1)
})
process.on('unhandledRejection', err => console.error("Promesse rejetée non gérée :", err))

// Arrêt propre (Ctrl+C, docker stop…) : on ferme la connexion à Discord avant de quitter
let arretEnCours = false
async function arreter(signal) {
    if (arretEnCours) return
    arretEnCours = true
    console.log(`${signal} reçu, arrêt du bot…`)
    // Si la déconnexion se bloque, on force l'arrêt au bout de 5 secondes
    setTimeout(() => process.exit(1), 5000).unref()
    try {
        await bot.destroy()
        db.close()
        process.exit(0)
    } catch (err) {
        console.error("Erreur pendant l'arrêt :", err)
        process.exit(1)
    }
}
process.on('SIGINT', arreter)
process.on('SIGTERM', arreter)

bot.login(token).catch(err => {
    console.error("Connexion à Discord impossible (token invalide ?) :", err.message)
    process.exit(1)
})
