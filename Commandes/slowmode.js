const Discord = require('discord.js')
const ms = require('ms')
const { formatDuree, auditReason } = require('../Fonctions/moderation')
const { sendModLog } = require('../Fonctions/logs')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral
const MAX_SECONDES = 6 * 60 * 60 // limite de Discord : 6 heures

// Les salons d'annonces n'ont pas de mode lent
const TYPES = [Discord.ChannelType.GuildText, Discord.ChannelType.GuildVoice, Discord.ChannelType.GuildForum]

module.exports = {
    name: "slowmode",
    description: "Règle le mode lent d'un salon (0 pour le désactiver)",
    permission: Discord.PermissionFlagsBits.ManageChannels,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "string",
            name: "duree",
            description: "Délai entre deux messages (ex : 5s, 1m, 2h ; 0 = désactivé ; 6h max)",
            required: true,
            maxLength: 20
        }, {
            type: "channel",
            name: "salon",
            description: "Le salon (par défaut : celui-ci)",
            required: false,
            channelTypes: TYPES
        }
    ],

    async run(bot, message, args) {
        const channel = args.getChannel("salon") ?? message.channel
        if (!TYPES.includes(channel.type)) return message.reply({ content: "Le mode lent ne s'applique pas à ce type de salon.", flags: EPHEMERAL })

        const texte = args.getString("duree").trim().toLowerCase()
        // Un nombre seul est lu en secondes ("5" = 5 s, et non 5 ms comme le ferait ms())
        const valeur = ["off", "non"].includes(texte) ? 0 : /^\d+$/.test(texte) ? Number(texte) * 1000 : ms(texte)
        if (!Number.isFinite(valeur) || valeur < 0) return message.reply({ content: "Durée invalide ! Exemples : `5s`, `1m`, `0`.", flags: EPHEMERAL })
        const secondes = Math.round(valeur / 1000)
        if (secondes === 0 && valeur > 0) return message.reply({ content: "Durée trop courte : 1 seconde minimum (ou `0` pour désactiver).", flags: EPHEMERAL })
        if (secondes > MAX_SECONDES) return message.reply({ content: "6 heures maximum !", flags: EPHEMERAL })

        // Permission vérifiée dans le salon ciblé (et pas seulement dans celui de la commande)
        if (!channel.permissionsFor(message.member)?.has([Flags.ViewChannel, Flags.ManageChannels])) {
            return message.reply({ content: `Vous n'avez pas la permission de gérer ${channel} !`, flags: EPHEMERAL })
        }
        if (!channel.permissionsFor(message.guild.members.me)?.has([Flags.ViewChannel, Flags.ManageChannels])) {
            return message.reply({ content: `Je n'ai pas la permission de gérer ${channel} !`, flags: EPHEMERAL })
        }

        await channel.setRateLimitPerUser(secondes, auditReason(message, `Mode lent : ${secondes} s`))
        const texteFinal = secondes ? `Mode lent de ${formatDuree(secondes * 1000)} activé dans ${channel}.` : `Mode lent désactivé dans ${channel}.`
        await message.reply({ content: texteFinal, flags: EPHEMERAL })
        await sendModLog(message, { action: "slowmode", details: texteFinal })
    }
}
