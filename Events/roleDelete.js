const db = require('../Fonctions/db')
const { rafraichirPanneau } = require('../Fonctions/rolesBoutons')

// Rôle supprimé : ses boutons disparaissent des panneaux de rôles
module.exports = async (bot, role) => {
    try {
        for (const messageId of db.removeButtonsOfRole(role.guild.id, role.id)) {
            const panel = db.getRolePanel(role.guild.id, messageId)
            if (panel) await rafraichirPanneau(role.guild, panel).catch(() => {})
        }
    } catch (err) {
        console.error("Erreur sur roleDelete :", err.message)
    }
}
