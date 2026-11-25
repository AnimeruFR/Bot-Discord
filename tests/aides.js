// Faux objets Discord partagés par les tests
const Discord = require('discord.js')
const loadCommands = require('../Loader/loadCommands')

// Rôle factice : seule la position compte
const role = position => ({ comparePositionTo: other => position - other.position, position })

// Erreur de l'API Discord avec son code
const erreurDiscord = code => Object.assign(new Error(`code ${code}`), { code })

// Charge toutes les commandes dans un faux bot
function chargerCommandes() {
    const bot = { commands: new Discord.Collection() }
    loadCommands(bot, { silencieux: true })
    return bot
}

module.exports = { role, erreurDiscord, chargerCommandes }
