const Discord = require('discord.js')
const { loadToken } = require('./Fonctions/env')
const loadCommands = require('./Loader/loadCommands')
const loadEvents = require('./Loader/loadEvents')

const token = loadToken()

const bot = new Discord.Client({
    // Seul l'intent Guilds est nécessaire : les slash commandes n'ont pas besoin des intents privilégiés
    intents: [Discord.GatewayIntentBits.Guilds],
    // Le bot ne ping jamais @everyone, @here ou un rôle, même si une raison en contient
    allowedMentions: { parse: [], repliedUser: false }
})

bot.commands = new Discord.Collection()
bot.color = "#FF0000"

loadCommands(bot)
loadEvents(bot)

bot.on('error', err => console.error("Erreur du client Discord :", err))
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
