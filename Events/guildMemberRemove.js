const { envoyer } = require('../Fonctions/bienvenue')
const db = require('../Fonctions/db')

// Départ d'un membre : message d'au revoir s'il est configuré (/bienvenue)
module.exports = async (bot, member) => {
    // Un membre parti ne peut plus gagner, et ses participations n'ont plus de raison d'être gardées
    try {
        db.removeEntriesOfMember(member.guild.id, member.id)
    } catch (err) {
        console.error("Participations du membre parti :", err.message)
    }
    await envoyer(member, "aurevoir")
}
