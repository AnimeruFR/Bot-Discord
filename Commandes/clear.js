const Discord = require('discord.js')
const { ticketOwnerId } = require('../Fonctions/tickets')
const { sendModLog } = require('../Fonctions/logs')
const { t } = require('../Fonctions/i18n')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral

module.exports = {
    name: "clear",
    description: "Clear un salon",
    permission: Discord.PermissionFlagsBits.ManageMessages,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "integer",
            name: "nombre",
            description: "Nombre de messages à effacer (1 à 100)",
            required: true,
            minValue: 1,
            maxValue: 100
        },
        {
            type: "channel",
            name: "salon",
            description: "Le salon dans lequel les messages seront effacés",
            required: false,
            channelTypes: [
                Discord.ChannelType.GuildText,
                Discord.ChannelType.GuildAnnouncement,
                Discord.ChannelType.GuildVoice,
                Discord.ChannelType.PublicThread,
                Discord.ChannelType.PrivateThread
            ]
        }
    ],

    async run(bot, message, args) {
        const channel = args.getChannel("salon") ?? message.channel
        if (!channel?.isTextBased() || typeof channel.bulkDelete !== "function") {
            return message.reply({ content: t(message, "mod.clear.impossible"), flags: EPHEMERAL })
        }

        // Un ticket sert de preuve : on ne le vide pas
        if (ticketOwnerId(channel)) return message.reply({ content: t(message, "mod.clear.ticket"), flags: EPHEMERAL })

        // La permission de la commande n'est vérifiée que dans le salon courant : on la vérifie aussi dans le salon ciblé
        if (!channel.permissionsFor(message.member)?.has([Flags.ViewChannel, Flags.ManageMessages])) {
            return message.reply({ content: t(message, "mod.clear.pas_permission", { salon: channel }), flags: EPHEMERAL })
        }
        if (!channel.permissionsFor(message.guild.members.me)?.has([Flags.ViewChannel, Flags.ReadMessageHistory, Flags.ManageMessages])) {
            return message.reply({ content: t(message, "mod.clear.bot_pas_permission", { salon: channel }), flags: EPHEMERAL })
        }

        const number = args.getInteger("nombre")
        if (number < 1 || number > 100) return message.reply({ content: t(message, "mod.clear.nombre"), flags: EPHEMERAL })

        await message.deferReply({ flags: EPHEMERAL })

        // true : on ignore les messages de plus de 14 jours (Discord refuse de les supprimer en masse)
        const messages = await channel.bulkDelete(number, true)

        let texte = t(message, "mod.clear.fait", { nombre: messages.size, salon: channel })
        if (messages.size < number) texte += t(message, "mod.clear.restants")
        await message.editReply(texte)
        await sendModLog(message, { action: "clear", details: `${messages.size} message(s) supprimé(s) dans ${channel}` })
    }
}
