const { oublier } = require('../Fonctions/premium')

// Achat, remboursement ou entitlement de test : le statut premium du serveur sera relu
module.exports = async (bot, entitlement) => {
    oublier(entitlement.guildId)
}
