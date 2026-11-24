const db = require('../Fonctions/db')

// Salon supprimé : on oublie son verrouillage éventuel, et un ticket supprimé à la main est marqué comme tel
module.exports = async (bot, channel) => {
    try {
        if (!channel.guildId) return
        db.removeLock(channel.guildId, channel.id)
        const ticket = db.getTicket(channel.id)
        if (ticket && ticket.status !== "supprime") db.setTicketStatus(channel.id, "supprime")
    } catch (err) {
        console.error("Erreur sur channelDelete :", err.message)
    }
}
