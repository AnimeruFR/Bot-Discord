const Discord = require('discord.js')
const db = require('../Fonctions/db')
const { sendModLog } = require('../Fonctions/logs')
const { ticketOwnerId } = require('../Fonctions/tickets')

const { Flags } = Discord.PermissionsBitField
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
        const ancien = db.getLogChannel(message.guild.id)

        if (channel) {
            if (channel.type !== Discord.ChannelType.GuildText) return message.reply({ content: "Choisis un salon textuel.", flags: EPHEMERAL })
            if (ticketOwnerId(channel)) return message.reply({ content: "Un salon de ticket ne peut pas servir de salon de logs.", flags: EPHEMERAL })
            if (!channel.permissionsFor(message.guild.members.me)?.has([Flags.ViewChannel, Flags.SendMessages, Flags.EmbedLinks])) {
                return message.reply({ content: `Je ne peux pas écrire dans ${channel} (il me faut Voir, Envoyer des messages et Intégrer des liens).`, flags: EPHEMERAL })
            }
        }
        if ((channel?.id ?? null) === ancien) return message.reply({ content: "Rien à changer.", flags: EPHEMERAL })

        // Le changement est tracé dans l'ancien salon (avant) et dans le nouveau (après) :
        // impossible de couper les logs discrètement le temps d'une sanction
        const details = `Salon de logs : ${ancien ? `<#${ancien}>` : "aucun"} → ${channel ?? "aucun (logs désactivés)"}`
        await sendModLog(message, { action: "config", details })
        db.setLogChannel(message.guild.id, channel?.id ?? null)
        if (channel) await sendModLog(message, { action: "config", details })

        if (!channel) return message.reply({ content: "Logs de modération désactivés.", flags: EPHEMERAL })

        // Les logs contiennent les sanctions : on prévient si le salon est visible par tout le monde
        const public_ = channel.permissionsFor(message.guild.roles.everyone)?.has(Flags.ViewChannel)
        await message.reply({
            content: `Les logs de modération seront envoyés dans ${channel}.${public_ ? "\n⚠️ Ce salon est visible par @everyone : pense à le rendre privé." : ""}`,
            flags: EPHEMERAL
        })
    }
}
