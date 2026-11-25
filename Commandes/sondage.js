const Discord = require('discord.js')
const { sendModLog } = require('../Fonctions/logs')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral

// Limites des sondages natifs de Discord
const MAX_QUESTION = 300
const MAX_CHOIX = 10
const MAX_TEXTE_CHOIX = 55
const MAX_HEURES = 768 // 32 jours

// "Oui ; Non ; Peut-être" -> liste nettoyée (sans vides ni doublons). Renvoie { choix } ou { erreur }.
function lireChoix(texte) {
    const choix = [...new Set(texte.split(";").map(c => c.trim()).filter(Boolean))]
    if (choix.length < 2) return { erreur: "Il faut au moins 2 choix différents, séparés par `;`." }
    if (choix.length > MAX_CHOIX) return { erreur: `${MAX_CHOIX} choix au maximum.` }
    if (choix.some(c => c.length > MAX_TEXTE_CHOIX)) return { erreur: `Chaque choix fait ${MAX_TEXTE_CHOIX} caractères au maximum.` }
    return { choix }
}

module.exports = {
    name: "sondage",
    description: "Crée un sondage Discord (natif)",
    permission: Discord.PermissionFlagsBits.ManageMessages,
    dm: false,
    category: "Engagement",
    lireChoix,
    options: [
        {
            type: "string",
            name: "question",
            description: "La question",
            required: true,
            maxLength: MAX_QUESTION
        }, {
            type: "string",
            name: "choix",
            description: "Les choix, séparés par ; (ex : Oui ; Non ; Peut-être)",
            required: true,
            maxLength: 600
        }, {
            type: "integer",
            name: "heures",
            description: "Durée en heures (24 par défaut, 768 maximum)",
            required: false,
            minValue: 1,
            maxValue: MAX_HEURES
        }, {
            type: "boolean",
            name: "multiple",
            description: "Autoriser plusieurs réponses",
            required: false
        }, {
            type: "channel",
            name: "salon",
            description: "Salon du sondage (par défaut : celui-ci)",
            required: false,
            channelTypes: [Discord.ChannelType.GuildText, Discord.ChannelType.GuildAnnouncement]
        }
    ],

    async run(bot, message, args) {
        const { choix, erreur } = lireChoix(args.getString("choix"))
        if (erreur) return message.reply({ content: erreur, flags: EPHEMERAL })
        const question = args.getString("question").trim()
        if (!question) return message.reply({ content: "La question ne peut pas être vide.", flags: EPHEMERAL })

        const channel = args.getChannel("salon") ?? message.channel
        if (!channel.permissionsFor(message.guild.members.me)?.has([Flags.ViewChannel, Flags.SendMessages, Flags.SendPolls])) {
            return message.reply({ content: `Je ne peux pas publier de sondage dans ${channel} (il me faut Envoyer des messages et Créer des sondages).`, flags: EPHEMERAL })
        }
        if (!channel.permissionsFor(message.member)?.has([Flags.ViewChannel, Flags.SendMessages, Flags.SendPolls])) {
            return message.reply({ content: `Vous ne pouvez pas publier de sondage dans ${channel}.`, flags: EPHEMERAL })
        }

        await channel.send({
            poll: {
                question: { text: question },
                answers: choix.map(text => ({ text })),
                duration: args.getInteger("heures") ?? 24,
                allowMultiselect: args.getBoolean("multiple") ?? false
            }
        })
        await message.reply({ content: `Sondage publié dans ${channel}.`, flags: EPHEMERAL })
        await sendModLog(message, { action: "sondage", details: `Sondage publié dans ${channel} : ${question.slice(0, 200)}` })
    }
}
