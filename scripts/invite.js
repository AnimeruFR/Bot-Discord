// Affiche le lien d'invitation du bot, avec les permissions minimales et leur raison.
//   npm run invite              -> lit l'ID de l'application avec le token du .env
//   npm run invite -- --env=dev -> application de développement
//   npm run invite -- --id ID   -> sans token (ID visible dans le Developer Portal > General Information)
const Discord = require('discord.js')
const { PERMISSIONS, permissionsMinimales, lienInvitation } = require('../Fonctions/invitation')

async function main() {
    const args = process.argv.slice(2)
    const index = args.indexOf("--id")
    let id = index !== -1 ? args[index + 1] : null

    if (!id) {
        const { loadToken } = require('../Fonctions/env')
        const rest = new Discord.REST({ version: '10' }).setToken(loadToken())
        id = (await rest.get(Discord.Routes.currentApplication())).id
    }

    console.log("Permissions demandées (minimales, jamais Administrateur) :")
    for (const [flag, usage] of PERMISSIONS) console.log(`  - ${new Discord.PermissionsBitField(flag).toArray()[0]} : ${usage}`)
    console.log(`\nValeur : ${permissionsMinimales().bitfield}`)
    console.log(`\nLien d'invitation :\n${lienInvitation(id)}`)
    console.log("\nPense aussi à cocher « Server Members Intent » dans le Developer Portal (Bot > Privileged Gateway Intents).")
}

main().catch(err => {
    console.error("Lien d'invitation impossible :", err.message)
    process.exit(1)
})
