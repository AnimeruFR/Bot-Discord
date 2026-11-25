const { oublier } = require('../Fonctions/premium')

// Renouvellement ou fin d'abonnement (ends_at renseigné) : le statut premium du serveur sera relu
module.exports = async (bot, ancien, entitlement) => {
    oublier(entitlement?.guildId ?? ancien?.guildId)
}
