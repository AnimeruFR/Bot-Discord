const { envoyer } = require('../Fonctions/bienvenue')
const { appliquerFiltre } = require('../Fonctions/antiraid')

// Arrivée d'un membre : filtre des comptes récents, puis message de bienvenue s'il est configuré (/bienvenue)
module.exports = async (bot, member) => {
    const filtre = await appliquerFiltre(member)
    if (filtre.action === "kick" && filtre.ok) return // expulsé : pas de bienvenue
    await envoyer(member, "bienvenue")
}
