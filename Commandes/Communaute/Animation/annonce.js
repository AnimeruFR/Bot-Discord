const Discord = require('discord.js')
const db = require('../../../Fonctions/db')
const { sendModLog } = require('../../../Fonctions/logs')
const { parseQuand } = require('../../../Fonctions/dates')
const { t } = require('../../../Fonctions/i18n')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral
const MAX_EN_ATTENTE = 20
const DELAI_MAX = 60 * 24 * 60 * 60 * 1000

module.exports = {
    name: "annonce",
    description: "Annonces programmées",
    permission: Discord.PermissionFlagsBits.ManageMessages,
    dm: false,
    category: "Engagement",
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Voir les annonces prévues", value: "liste" },
                { name: "Programmer une annonce", value: "programmer" },
                { name: "Annuler une annonce", value: "annuler" }
            ]
        }, {
            type: "string",
            name: "message",
            description: "Le texte de l'annonce (aucune mention ne notifiera personne)",
            required: false,
            maxLength: 2000
        }, {
            type: "string",
            name: "quand",
            description: "Dans combien de temps (2h, 3d) ou date JJ/MM/AAAA HH:MM (heure de Paris)",
            required: false,
            maxLength: 20
        }, {
            type: "channel",
            name: "salon",
            description: "Salon de l'annonce (par défaut : celui-ci)",
            required: false,
            channelTypes: [Discord.ChannelType.GuildText, Discord.ChannelType.GuildAnnouncement]
        }, {
            type: "integer",
            name: "numero",
            description: "Numéro de l'annonce à annuler",
            required: false,
            minValue: 1
        }
    ],

    async run(bot, message, args) {
        const guild = message.guild
        const action = args.getString("action")

        // Un modérateur ne voit et n'annule que les annonces des salons qu'il peut voir (pas celles d'un salon privé du staff)
        const visible = a => guild.channels.cache.get(a.channel_id)?.permissionsFor(message.member)?.has(Flags.ViewChannel)

        if (action === "liste") {
            const lignes = db.listAnnouncements(guild.id).filter(visible).map(a => t(message, "eng.annonce.ligne", {
                id: a.id, date: `<t:${Math.floor(a.send_at / 1000)}:f>`, salon: a.channel_id, auteur: a.author_id,
                texte: `${Discord.escapeMarkdown(a.contenu.slice(0, 80))}${a.contenu.length > 80 ? "…" : ""}`
            }))
            return message.reply({ content: lignes.length ? lignes.join("\n").slice(0, 2000) : t(message, "eng.annonce.aucune"), flags: EPHEMERAL })
        }

        if (action === "annuler") {
            const numero = args.getInteger("numero")
            const cible = db.listAnnouncements(guild.id).find(a => a.id === numero)
            if (!cible || !visible(cible) || !db.removeAnnouncement(guild.id, numero)) return message.reply({ content: t(message, "eng.annonce.inconnue"), flags: EPHEMERAL })
            await message.reply({ content: t(message, "eng.annonce.annulee", { id: numero }), flags: EPHEMERAL })
            return sendModLog(message, { action: "annonce", details: `Annonce n°${numero} annulée` })
        }

        // programmer
        const contenu = args.getString("message")?.trim()
        if (!contenu) return message.reply({ content: t(message, "eng.annonce.texte_manquant"), flags: EPHEMERAL })
        const { date, erreur } = parseQuand(args.getString("quand"), { max: DELAI_MAX, cible: message })
        if (erreur) return message.reply({ content: erreur, flags: EPHEMERAL })

        const channel = args.getChannel("salon") ?? message.channel
        if (!channel.permissionsFor(message.member)?.has([Flags.ViewChannel, Flags.SendMessages])) {
            return message.reply({ content: t(message, "eng.annonce.salon_membre", { salon: channel }), flags: EPHEMERAL })
        }
        if (!channel.permissionsFor(guild.members.me)?.has([Flags.ViewChannel, Flags.SendMessages])) {
            return message.reply({ content: t(message, "eng.annonce.salon_bot", { salon: channel }), flags: EPHEMERAL })
        }
        if (db.countAnnouncements(guild.id) >= MAX_EN_ATTENTE) return message.reply({ content: t(message, "eng.annonce.max", { max: MAX_EN_ATTENTE }), flags: EPHEMERAL })

        const id = db.addAnnouncement(guild.id, { channelId: channel.id, authorId: message.user.id, contenu, sendAt: date })
        await message.reply({
            content: t(message, "eng.annonce.prevue", { id, date: `<t:${Math.floor(date / 1000)}:f>`, relatif: `<t:${Math.floor(date / 1000)}:R>`, salon: channel }),
            flags: EPHEMERAL
        })
        await sendModLog(message, { action: "annonce", details: `Annonce n°${id} programmée pour <t:${Math.floor(date / 1000)}:f> dans ${channel}` })
    }
}
