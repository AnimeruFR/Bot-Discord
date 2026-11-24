const Discord = require('discord.js')
const { auditReason } = require('../Fonctions/moderation')
const { verifierDroits, deverrouiller, TYPES_VERROUILLABLES } = require('../Fonctions/verrou')
const { sendModLog } = require('../Fonctions/logs')

const EPHEMERAL = Discord.MessageFlags.Ephemeral

module.exports = {
    name: "unlock",
    description: "Déverrouille un salon verrouillé avec /lock",
    permission: Discord.PermissionFlagsBits.ManageChannels,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "channel",
            name: "salon",
            description: "Le salon à déverrouiller (par défaut : celui-ci)",
            required: false,
            channelTypes: TYPES_VERROUILLABLES
        }
    ],

    async run(bot, message, args) {
        const channel = args.getChannel("salon") ?? message.channel

        const erreur = verifierDroits(message, channel)
        if (erreur) return message.reply({ content: erreur, flags: EPHEMERAL })

        const resultat = await deverrouiller(channel, auditReason(message, "Déverrouillage"))
        if (resultat === "occupe") return message.reply({ content: `Une autre commande modifie déjà ${channel}, réessayez dans un instant.`, flags: EPHEMERAL })
        if (!resultat) return message.reply({ content: `${channel} n'a pas été verrouillé avec /lock.`, flags: EPHEMERAL })

        await message.reply({ content: `🔓 ${channel} est déverrouillé (permissions de @everyone remises comme avant le /lock).`, flags: EPHEMERAL })
        await channel.send("🔓 Salon déverrouillé.").catch(() => {})
        await sendModLog(message, { action: "unlock", details: `Salon : ${channel}` })
    }
}
