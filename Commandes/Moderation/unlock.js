const Discord = require('discord.js')
const { auditReason } = require('../../Fonctions/moderation')
const { verifierDroits, deverrouiller, TYPES_VERROUILLABLES } = require('../../Fonctions/verrou')
const { sendModLog } = require('../../Fonctions/logs')
const { t } = require('../../Fonctions/i18n')

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
        if (resultat === "occupe") return message.reply({ content: t(message, "eng.lock.occupe", { salon: channel }), flags: EPHEMERAL })
        if (!resultat) return message.reply({ content: t(message, "eng.unlock.pas_verrouille", { salon: channel }), flags: EPHEMERAL })

        await message.reply({ content: t(message, "eng.unlock.ok", { salon: channel }), flags: EPHEMERAL })
        await channel.send(t(message.guild, "eng.unlock.annonce")).catch(() => {})
        await sendModLog(message, { action: "unlock", details: `Salon : ${channel}` })
    }
}
