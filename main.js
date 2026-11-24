const Discord = require('discord.js')
const loadCommands = require('./Loader/loadCommands')
const loadEvents = require('./Loader/loadEvents')

// Charge le fichier .env s'il existe (Node >= 20.12)
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

bot.login(token)
