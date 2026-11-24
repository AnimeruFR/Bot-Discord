const { envoyer } = require('../Fonctions/bienvenue')

// Arrivée d'un membre : message de bienvenue s'il est configuré (/bienvenue)
module.exports = async (bot, member) => {
    await envoyer(member, "bienvenue")
}
