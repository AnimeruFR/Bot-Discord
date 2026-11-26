const Discord = require('discord.js')
const { changerSalonLogs, changerSalonFamille } = require('../../Fonctions/config')
const { FAMILLES, SANS_REPLI } = require('../../Fonctions/logs')
const { t } = require('../../Fonctions/i18n')

const EPHEMERAL = Discord.MessageFlags.Ephemeral

// Texte affiché dans la liste de choix (traduit dans locales/commandes.en.json)
const NOMS_FAMILLES = {
    sanctions: "Sanctions (ban, kick, warn…)",
    automod: "AutoMod",
    tickets: "Tickets",
    membres: "Membres (arrivées, filtre)",
    signalements: "Signalements (jamais dans le salon général)",
    antiraid: "Anti-raid",
    appels: "Appels de sanction (jamais dans le salon général)",
    animation: "Animation (giveaways, sondages)",
    config: "Configuration",
    jeux: "Jeux (jamais dans le salon général)",
    economie: "Économie (jamais dans le salon général)"
}

module.exports = {
    name: "setlogs",
    description: "Choisit le salon des logs (général ou par famille ; sans salon : retire le réglage)",
    permission: Discord.PermissionFlagsBits.ManageGuild,
    dm: false,
    category: "Configuration",
    options: [
        {
            type: "channel",
            name: "salon",
            description: "Le salon où envoyer les logs",
            required: false,
            channelTypes: [Discord.ChannelType.GuildText]
        },
        {
            type: "string",
            name: "famille",
            description: "Un type de logs précis (sans famille : le salon général)",
            required: false,
            choices: FAMILLES.map(f => ({ name: NOMS_FAMILLES[f], value: f }))
        }
    ],

    async run(bot, message, args) {
        const channel = args.getChannel("salon")
        const famille = args.getString("famille")

        if (famille) {
            const resultat = await changerSalonFamille(message, famille, channel)
            if (resultat.erreur) return message.reply({ content: resultat.erreur, flags: EPHEMERAL })
            if (resultat.inchange) return message.reply({ content: t(message, "tk.lg_rien"), flags: EPHEMERAL })
            const nom = t(message, `config.famille_${famille}`)
            if (!channel) {
                const cle = SANS_REPLI.includes(famille) ? "config.logs_famille_aucun" : "config.logs_famille_general"
                return message.reply({ content: t(message, cle, { famille: nom }), flags: EPHEMERAL })
            }
            return message.reply({
                content: t(message, "config.logs_famille_ok", { famille: nom, salon: channel }) + (resultat.public_ ? t(message, "tk.lg_public") : ""),
                flags: EPHEMERAL
            })
        }

        const resultat = await changerSalonLogs(message, channel)
        if (resultat.erreur) return message.reply({ content: resultat.erreur, flags: EPHEMERAL })
        if (resultat.inchange) return message.reply({ content: t(message, "tk.lg_rien"), flags: EPHEMERAL })
        if (!channel) return message.reply({ content: t(message, "tk.lg_off"), flags: EPHEMERAL })

        // Les logs contiennent les sanctions : on prévient si le salon est visible par tout le monde
        await message.reply({
            content: t(message, "tk.lg_ok", { salon: channel }) + (resultat.public_ ? t(message, "tk.lg_public") : ""),
            flags: EPHEMERAL
        })
    }
}
