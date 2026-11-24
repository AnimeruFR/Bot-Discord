// Sauvegarde manuelle de la base : npm run backup (ou npm run backup -- --env=prod)
// Restauration : arrête le bot, remplace data/bot.db par la sauvegarde choisie
// (et supprime data/bot.db-wal et data/bot.db-shm s'ils existent), puis relance le bot.
const { loadEnv } = require('../Fonctions/env')
loadEnv()
const { makeBackup } = require('../Fonctions/backup')

try {
    console.log(`Sauvegarde créée : ${makeBackup()}`)
} catch (err) {
    console.error("Échec de la sauvegarde :", err.message)
    process.exit(1)
}
