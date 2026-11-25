const Discord = require('discord.js')
const db = require('../../../Fonctions/db')
const { sendModLog } = require('../../../Fonctions/logs')
const { t } = require('../../../Fonctions/i18n')
const { envoyer, salonUtilisable } = require('../../../Fonctions/bienvenue')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
// Nom du type de message dans la langue de la personne qui configure
const nomType = (cible, type) => t(cible, `eng.bienvenue.nom_${type}`)
// Messages par défaut dans la langue du serveur
const DEFAUTS = { bienvenue: "bienvenue.defaut", aurevoir: "aurevoir.defaut" }

module.exports = {
    name: "bienvenue",
    description: "Messages de bienvenue et d'au revoir",
    permission: Discord.PermissionFlagsBits.ManageGuild,
    dm: false,
    category: "Configuration",
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Voir la configuration", value: "voir" },
                { name: "Configurer", value: "configurer" },
                { name: "Désactiver", value: "desactiver" },
                { name: "Tester (sur vous-même)", value: "tester" }
            ]
        }, {
            type: "string",
            name: "type",
            description: "Arrivée ou départ",
            required: false,
            choices: [
                { name: "Bienvenue (arrivée)", value: "bienvenue" },
                { name: "Au revoir (départ)", value: "aurevoir" }
            ]
        }, {
            type: "channel",
            name: "salon",
            description: "Salon des messages",
            required: false,
            channelTypes: [Discord.ChannelType.GuildText, Discord.ChannelType.GuildAnnouncement]
        }, {
            type: "string",
            name: "message",
            description: "Texte, avec {membre} {serveur} {nombre} (un message par défaut sinon)",
            required: false,
            maxLength: 1000
        }
    ],

    async run(bot, message, args) {
        const guild = message.guild
        const action = args.getString("action")
        const type = args.getString("type") ?? "bienvenue"

        if (action === "voir") {
            const config = db.getWelcome(guild.id)
            const ligne = k => config[k]
                ? t(message, "eng.bienvenue.ligne", {
                    nom: nomType(message, k), salon: config[k].channelId,
                    alerte: salonUtilisable(guild, config[k].channelId) ? "" : t(message, "eng.bienvenue.alerte"),
                    texte: Discord.escapeMarkdown(config[k].message).slice(0, 300)
                })
                : t(message, "eng.bienvenue.ligne_desactive", { nom: nomType(message, k) })
            return message.reply({ content: `${ligne("bienvenue")}\n\n${ligne("aurevoir")}`, flags: EPHEMERAL })
        }

        if (action === "desactiver") {
            db.setWelcome(guild.id, type, null, null)
            await message.reply({ content: t(message, "eng.bienvenue.desactives", { nom: nomType(message, type) }), flags: EPHEMERAL })
            return sendModLog(message, { action: "config", details: `Messages de ${t("fr", `eng.bienvenue.nom_${type}`)} désactivés` })
        }

        if (action === "tester") {
            const resultat = await envoyer(message.member, type, { test: true })
            const cles = { envoye: "test_envoye", desactive: "test_desactive", salon: "test_salon", erreur: "test_erreur" }
            const contenu = t(message, `eng.bienvenue.${cles[resultat] ?? "test_autre"}`, { nom: nomType(message, type) })
            return message.reply({ content: contenu, flags: EPHEMERAL })
        }

        // configurer
        const channel = args.getChannel("salon")
        if (!channel) return message.reply({ content: t(message, "eng.bienvenue.salon_manquant"), flags: EPHEMERAL })
        if (!salonUtilisable(guild, channel.id)) return message.reply({ content: t(message, "eng.bienvenue.salon_bot", { salon: channel }), flags: EPHEMERAL })
        const texte = args.getString("message")?.trim() || t(guild, DEFAUTS[type])
        db.setWelcome(guild.id, type, channel.id, texte)
        await message.reply({
            content: t(message, "eng.bienvenue.configure", { nom: nomType(message, type), salon: channel, texte: texte.slice(0, 300) }),
            flags: EPHEMERAL,
            allowedMentions: { parse: [] }
        })
        await sendModLog(message, { action: "config", details: `Messages de ${t("fr", `eng.bienvenue.nom_${type}`)} configurés dans ${channel}` })
    }
}
