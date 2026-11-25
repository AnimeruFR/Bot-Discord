const Discord = require('discord.js')
const { auditReason, formatReason } = require('../Fonctions/moderation')
const { verifierDroits, verrouiller, rolesQuiEcriventEncore, TYPES_VERROUILLABLES } = require('../Fonctions/verrou')
const { sendModLog } = require('../Fonctions/logs')
const { t } = require('../Fonctions/i18n')

const EPHEMERAL = Discord.MessageFlags.Ephemeral

module.exports = {
    name: "lock",
    description: "Verrouille un salon : @everyone ne peut plus y écrire",
    permission: Discord.PermissionFlagsBits.ManageChannels,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "channel",
            name: "salon",
            description: "Le salon à verrouiller (par défaut : celui-ci)",
            required: false,
            channelTypes: TYPES_VERROUILLABLES
        }, {
            type: "string",
            name: "raison",
            description: "La raison du verrouillage",
            required: false,
            maxLength: 400
        }
    ],

    async run(bot, message, args) {
        const channel = args.getChannel("salon") ?? message.channel
        const raisonBrute = args.getString("raison")

        const erreur = verifierDroits(message, channel)
        if (erreur) return message.reply({ content: erreur, flags: EPHEMERAL })

        const resultat = await verrouiller(channel, auditReason(message, raisonBrute))
        if (resultat === "occupe") return message.reply({ content: t(message, "eng.lock.occupe", { salon: channel }), flags: EPHEMERAL })
        if (!resultat) return message.reply({ content: t(message, "eng.lock.deja", { salon: channel }), flags: EPHEMERAL })

        const roles = rolesQuiEcriventEncore(channel)
        const note = roles.length ? t(message, "eng.lock.note", { roles: roles.join(", ") }) : ""
        await message.reply({ content: t(message, "eng.lock.ok", { salon: channel, note }), flags: EPHEMERAL })
        // Annonce visible de tous dans le salon verrouillé
        await channel.send(t(message.guild, "eng.lock.annonce", { raison: formatReason(raisonBrute) })).catch(() => {})
        await sendModLog(message, { action: "lock", raison: raisonBrute, details: `Salon : ${channel}` })
    }
}
