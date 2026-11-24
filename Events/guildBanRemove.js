const Discord = require('discord.js')
const db = require('../Fonctions/db')

// Membre débanni (par /unban, par le bot à la fin d'un tempban ou à la main dans Discord) :
// son ban temporaire éventuel n'a plus de raison d'être
module.exports = async (bot, ban) => {
    try {
        if (!db.getTempban(ban.guild.id, ban.user.id)) return
        // L'événement peut arriver en retard, après un nouveau /tempban du même membre :
        // on ne supprime l'échéance que s'il n'est vraiment plus banni
        // En cas d'erreur réseau, on garde l'échéance : la tâche de débans fera le tri à l'expiration
        const encoreBanni = await ban.guild.bans.fetch({ user: ban.user.id, force: true })
            .catch(err => err.code === Discord.RESTJSONErrorCodes.UnknownBan ? null : true)
        if (!encoreBanni) db.removeTempban(ban.guild.id, ban.user.id)
    } catch (err) {
        console.error("Erreur sur guildBanRemove :", err.message)
    }
}
