const Discord = require('discord.js')
const { auditReason, formatReason } = require('../Fonctions/moderation')
const { verifierDroits, verrouiller, rolesQuiEcriventEncore, TYPES_VERROUILLABLES } = require('../Fonctions/verrou')
const { sendModLog } = require('../Fonctions/logs')

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
        if (resultat === "occupe") return message.reply({ content: `Une autre commande modifie déjà ${channel}, réessayez dans un instant.`, flags: EPHEMERAL })
        if (!resultat) return message.reply({ content: `${channel} est déjà verrouillé. Utilisez /unlock.`, flags: EPHEMERAL })

        const roles = rolesQuiEcriventEncore(channel)
        const note = roles.length ? `\n⚠️ Ces rôles ont une autorisation propre dans le salon et peuvent encore écrire : ${roles.join(", ")}` : ""
        await message.reply({ content: `🔒 ${channel} est verrouillé.${note}`, flags: EPHEMERAL })
        // Annonce visible de tous dans le salon verrouillé
        await channel.send(`🔒 Salon verrouillé par la modération. Raison : ***${formatReason(raisonBrute)}***`).catch(() => {})
        await sendModLog(message, { action: "lock", raison: raisonBrute, details: `Salon : ${channel}` })
    }
}
