const Discord = require('discord.js')
const { onGuildCreate } = require('../Fonctions/privacy')
const { t } = require('../Fonctions/i18n')

const { Flags } = Discord.PermissionsBitField
// Au-delà, le serveur n'est pas « nouveau » (reconnexion, redémarrage) : on ne redit rien
const DELAI_ARRIVEE = 60 * 1000

// Court message dans le salon système pour suggérer /setup. Ne lève jamais d'erreur.
// Langue : celle du serveur n'est pas encore connue, donc français puis anglais.
async function suggererSetup(guild) {
    try {
        if (!guild.joinedTimestamp || Date.now() - guild.joinedTimestamp > DELAI_ARRIVEE) return false
        const salon = guild.systemChannel
        if (!salon?.permissionsFor(guild.members.me)?.has([Flags.ViewChannel, Flags.SendMessages])) return false
        await salon.send({ content: `${t("fr", "setup.arrivee")}\n${t("en", "setup.arrivee")}`, allowedMentions: { parse: [] } })
        return true
    } catch (err) {
        console.error("Impossible de suggérer /setup :", err.message)
        return false
    }
}

module.exports = async (bot, guild) => {
    try {
        onGuildCreate(guild)
    } catch (err) {
        console.error("Erreur sur guildCreate :", err.message)
    }
    await suggererSetup(guild)
}

module.exports.suggererSetup = suggererSetup
