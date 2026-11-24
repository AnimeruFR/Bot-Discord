// Enregistre les slash commandes auprès de Discord.
// À lancer une fois après avoir ajouté ou modifié une commande (pas à chaque démarrage du bot).
//   npm run deploy                 -> commandes globales (peuvent mettre un moment à apparaître)
//   npm run deploy -- --guild ID   -> commandes sur un seul serveur, immédiat (pour tester)
//   npm run deploy -- --guild ID --clear -> retire les commandes de ce serveur
//   npm run deploy -- --clear      -> retire les commandes globales
// Attention : des commandes à la fois globales et sur un serveur apparaissent en double sur ce serveur.
// Après tes tests avec --guild, pense à les retirer avec --guild ID --clear.
const Discord = require('discord.js')
const { loadToken } = require('../Fonctions/env')
const loadCommands = require('../Loader/loadCommands')
const { deploySlashCommands } = require('../Loader/loadSlashCommands')

async function main() {
    const token = loadToken()
    const args = process.argv.slice(2)

    const index = args.indexOf("--guild")
    const guildId = index !== -1 ? args[index + 1] : null
    if (index !== -1 && !/^\d{17,20}$/.test(guildId ?? "")) {
        console.error("Après --guild, il faut l'ID du serveur (clic droit sur le serveur > Copier l'identifiant).")
        process.exit(1)
    }

    const bot = { commands: new Discord.Collection() }
    if (!args.includes("--clear")) loadCommands(bot, { silencieux: true })

    const resultat = await deploySlashCommands(token, [...bot.commands.values()], guildId)
    console.log(`${resultat.length} slash commande(s) enregistrée(s) ${guildId ? `sur le serveur ${guildId}` : "globalement"}.`)
}

main().catch(err => {
    console.error("Échec de l'enregistrement des commandes :", err.message)
    process.exit(1)
})
