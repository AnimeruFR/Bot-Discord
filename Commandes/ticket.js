const Discord = require('discord.js')
const { couleur } = require('../Fonctions/apparence')
const { t, langueDe } = require('../Fonctions/i18n')
const db = require('../Fonctions/db')
const { gererMembre, menuTypes } = require('../Fonctions/tickets')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral

module.exports = {
    name: "ticket",
    description: "Tickets : poster le panneau, ajouter ou retirer un membre d'un ticket",
    // Pas de permission par défaut : le staff des tickets n'a pas forcément « Gérer les messages ».
    // Chaque action vérifie elle-même les droits (voir run).
    permission: "Aucune",
    dm: false,
    category: "Modération",
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Poster le panneau ici", value: "panneau" },
                { name: "Ajouter un membre à ce ticket", value: "ajouter" },
                { name: "Retirer un membre de ce ticket", value: "retirer" }
            ]
        }, {
            type: "user",
            name: "membre",
            description: "Le membre à ajouter ou retirer",
            required: false
        }
    ],

    async run(bot, message, args) {
        const action = args.getString("action")

        if (action !== "panneau") {
            const user = args.getUser("membre")
            if (!user) return message.reply({ content: "Précisez le membre (option `membre`).", flags: EPHEMERAL })
            return gererMembre(message, action, user)
        }

        // Le panneau est visible de tous : réservé à ceux qui peuvent gérer les messages
        if (!message.memberPermissions.has(Flags.ManageMessages)) {
            return message.reply({ content: "Il faut la permission « Gérer les messages » pour poster le panneau.", flags: EPHEMERAL })
        }
        const channel = message.channel
        if (channel?.type !== Discord.ChannelType.GuildText) {
            return message.reply({ content: "Le panneau doit être posté dans un salon textuel.", flags: EPHEMERAL })
        }
        if (!channel.permissionsFor(message.guild.members.me)?.has([Flags.ViewChannel, Flags.SendMessages, Flags.EmbedLinks])) {
            return message.reply({ content: "Je ne peux pas écrire dans ce salon (il me faut Voir, Envoyer des messages et Intégrer des liens).", flags: EPHEMERAL })
        }

        const types = db.listTicketTypes(message.guild.id)
        // Panneau public : langue du serveur ; titre et texte personnalisables avec /config
        const guild = message.guild
        const { panneauTitre, panneauTexte } = db.getApparence(guild.id)
        const embed = new Discord.EmbedBuilder()
            .setColor(couleur(guild))
            .setTitle(panneauTitre ?? t(guild, "tickets.panneau_titre"))
            .setThumbnail(bot.user.displayAvatarURL())
            .setDescription(panneauTexte ?? t(guild, types.length ? "tickets.panneau_menu" : "tickets.panneau_bouton"))
            .setFooter({ text: bot.user.username, iconURL: bot.user.displayAvatarURL() })

        const composant = types.length
            ? menuTypes(types, langueDe(guild))
            : new Discord.ActionRowBuilder().addComponents(new Discord.ButtonBuilder()
                .setCustomId("ticket")
                .setLabel(t(guild, "tickets.bouton_creer"))
                .setStyle(Discord.ButtonStyle.Primary)
                .setEmoji("🎫"))

        // Message simple (pas une réponse à la commande) : le panneau ne montre pas qui l'a posté
        await channel.send({ embeds: [embed], components: [composant] })
        await message.reply({ content: "Panneau de tickets posté.", flags: EPHEMERAL })
    }
}
