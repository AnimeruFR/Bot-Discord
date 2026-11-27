const { gagnerXp } = require('../Fonctions/xp')
const { peutEtreDrop } = require('../Fonctions/drops')

// Message dans un serveur (intent Guild Messages, sans lire le contenu) : XP (#39) et drops (#72).
// Les bots, les webhooks et les messages privés ne comptent pas. Les deux étapes partent en même temps : aucune
// n'attend l'autre, et une étape qui échoue ne bloque pas l'autre.
module.exports = async (bot, message) => {
    if (!message.guild || message.author?.bot || message.webhookId) return
    await Promise.all([["xp", gagnerXp], ["drop", peutEtreDrop]].map(async ([nom, etape]) => {
        try {
            await etape(message)
        } catch (err) {
            console.error(`Message, étape ${nom} :`, err.message)
        }
    }))
}
