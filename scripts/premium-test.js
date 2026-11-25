// Donne ou retire le premium de TEST à un serveur, sans payer (entitlement de test de Discord, sans date de fin).
//   npm run premium:test -- --env=dev --guild ID_SERVEUR              -> crée l'entitlement de test
//   npm run premium:test -- --env=dev --guild ID_SERVEUR --supprimer  -> retire les entitlements de test de ce serveur
// Il faut PREMIUM_SKU_ID dans le fichier d'environnement. Recharge Discord (Ctrl+R) pour voir le changement.
const Discord = require('discord.js')
const { loadToken } = require('../Fonctions/env')

async function main() {
    const args = process.argv.slice(2)
    // Fichier d'environnement obligatoire : jamais le .env par défaut, qui peut contenir le token de prod
    if (!args.some(a => a.startsWith("--env=")) && !process.env.ENV_FILE) throw new Error("Précise l'application : --env=dev (ou --env=prod)")
    const token = loadToken()
    const guildId = args[args.indexOf("--guild") + 1]
    const sku = process.env.PREMIUM_SKU_ID
    if (!args.includes("--guild") || !/^\d{17,20}$/.test(guildId ?? "")) throw new Error("Donne l'ID du serveur : --guild ID")
    if (!/^\d{17,20}$/.test(sku ?? "")) throw new Error("PREMIUM_SKU_ID manquant ou invalide dans le fichier d'environnement")

    const rest = new Discord.REST({ version: '10' }).setToken(token)
    const application = await rest.get(Discord.Routes.currentApplication())
    const route = Discord.Routes.entitlements(application.id)

    if (args.includes("--supprimer")) {
        const liste = await rest.get(route, { query: new URLSearchParams({ guild_id: guildId, sku_ids: sku }) })
        // Seulement les entitlements de TEST (type 4) : jamais un vrai abonnement payé
        const tests = liste.filter(e => e.type === Discord.EntitlementType.TestModePurchase)
        for (const e of tests) await rest.delete(Discord.Routes.entitlement(application.id, e.id))
        console.log(`${tests.length} entitlement(s) de test supprimé(s) pour le serveur ${guildId}.`)
    } else {
        await rest.post(route, { body: { sku_id: sku, owner_id: guildId, owner_type: 1 } })
        console.log(`Premium de test donné au serveur ${guildId}. Recharge Discord (Ctrl+R) pour le voir.`)
    }
}

main().catch(err => {
    console.error("Échec :", err.message)
    process.exit(1)
})
