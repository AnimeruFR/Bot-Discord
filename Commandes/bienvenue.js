const Discord = require('discord.js')
const db = require('../Fonctions/db')
const { sendModLog } = require('../Fonctions/logs')
const { t } = require('../Fonctions/i18n')
const { envoyer, salonUtilisable } = require('../Fonctions/bienvenue')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const NOMS = { bienvenue: "bienvenue", aurevoir: "au revoir" }
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
            const ligne = t => config[t]
                ? `**${NOMS[t]}** : <#${config[t].channelId}>${salonUtilisable(guild, config[t].channelId) ? "" : " ⚠️ (je ne peux pas y écrire)"}\n> ${Discord.escapeMarkdown(config[t].message).slice(0, 300)}`
                : `**${NOMS[t]}** : désactivé`
            return message.reply({ content: `${ligne("bienvenue")}\n\n${ligne("aurevoir")}`, flags: EPHEMERAL })
        }

        if (action === "desactiver") {
            db.setWelcome(guild.id, type, null, null)
            await message.reply({ content: `Messages de ${NOMS[type]} désactivés.`, flags: EPHEMERAL })
            return sendModLog(message, { action: "config", details: `Messages de ${NOMS[type]} désactivés` })
        }

        if (action === "tester") {
            const resultat = await envoyer(message.member, type, { test: true })
            const textes = {
                envoye: "Message de test envoyé.",
                desactive: `Les messages de ${NOMS[type]} sont désactivés.`,
                salon: "Je ne peux pas écrire dans le salon configuré.",
                erreur: "L'envoi a échoué (voir la console du bot)."
            }
            return message.reply({ content: textes[resultat] ?? "Envoi impossible.", flags: EPHEMERAL })
        }

        // configurer
        const channel = args.getChannel("salon")
        if (!channel) return message.reply({ content: "Précise le salon (option `salon`).", flags: EPHEMERAL })
        if (!salonUtilisable(guild, channel.id)) return message.reply({ content: `Je ne peux pas écrire dans ${channel}.`, flags: EPHEMERAL })
        const texte = args.getString("message")?.trim() || t(guild, DEFAUTS[type])
        db.setWelcome(guild.id, type, channel.id, texte)
        await message.reply({
            content: `Messages de ${NOMS[type]} envoyés dans ${channel}.\nAperçu : ${texte.slice(0, 300)}\n-# Seul le nouveau membre est mentionné ; @everyone et les rôles écrits dans le texte ne notifient personne. 10 messages par minute au maximum (anti-raid).`,
            flags: EPHEMERAL,
            allowedMentions: { parse: [] }
        })
        await sendModLog(message, { action: "config", details: `Messages de ${NOMS[type]} configurés dans ${channel}` })
    }
}
