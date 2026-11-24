const Discord = require('discord.js')
const { changerSalonLogs } = require('../Fonctions/config')

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
        if (resultat.inchange) return message.reply({ content: "Rien à changer.", flags: EPHEMERAL })
        if (!channel) return message.reply({ content: "Logs de modération désactivés.", flags: EPHEMERAL })

        // Les logs contiennent les sanctions : on prévient si le salon est visible par tout le monde
        await message.reply({
            content: `Les logs de modération seront envoyés dans ${channel}.${resultat.public_ ? "\n⚠️ Ce salon est visible par @everyone : pense à le rendre privé." : ""}`,
            flags: EPHEMERAL
        })
    }
}
