const Discord = require('discord.js')
const { changerSalonLogs } = require('../Fonctions/config')
const { t } = require('../Fonctions/i18n')

const EPHEMERAL = Discord.MessageFlags.Ephemeral

module.exports = {
    name: "setlogs",
    description: "Choisit le salon des logs de modération (sans salon : désactive les logs)",
    permission: Discord.PermissionFlagsBits.ManageGuild,
    dm: false,
    category: "Configuration",
    options: [
        {
            type: "channel",
            name: "salon",
            description: "Le salon où envoyer les logs",
            required: false,
            channelTypes: [Discord.ChannelType.GuildText]
        }
    ],

    async run(bot, message, args) {
        const channel = args.getChannel("salon")
        const resultat = await changerSalonLogs(message, channel)
        if (resultat.erreur) return message.reply({ content: resultat.erreur, flags: EPHEMERAL })
        if (resultat.inchange) return message.reply({ content: t(message, "tk.lg_rien"), flags: EPHEMERAL })
        if (!channel) return message.reply({ content: t(message, "tk.lg_off"), flags: EPHEMERAL })

        // Les logs contiennent les sanctions : on prévient si le salon est visible par tout le monde
        await message.reply({
            content: t(message, "tk.lg_ok", { salon: channel }) + (resultat.public_ ? t(message, "tk.lg_public") : ""),
            flags: EPHEMERAL
        })
    }
}
