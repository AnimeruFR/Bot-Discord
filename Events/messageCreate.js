const { gagnerXp } = require('../Fonctions/xp')
const { peutEtreDrop } = require('../Fonctions/drops')

// Message dans un serveur (intent Guild Messages, sans lire le contenu) : XP (#39) puis drops (#72).
// Les bots, les webhooks et les messages privés ne comptent pas. Une étape qui échoue ne bloque pas l'autre.
module.exports = async (bot, message) => {
    if (!message.guild || message.author?.bot || message.webhookId) return
    for (const [nom, etape] of [["xp", gagnerXp], ["drop", peutEtreDrop]]) {
        try {
            await etape(message)
        } catch (err) {
            console.error(`Message, étape ${nom} :`, err.message)
        }
    }
}
