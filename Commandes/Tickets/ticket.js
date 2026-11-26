const Discord = require('discord.js')
const { couleur } = require('../../Fonctions/apparence')
const { t, langueDe } = require('../../Fonctions/i18n')
const db = require('../../Fonctions/db')
const tickets = require('../../Fonctions/tickets')
const { gererMembre, menuTypes, isStaff } = tickets

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral

module.exports = {
    name: "ticket",
    description: "Tickets : poster le panneau, ajouter ou retirer un membre, transférer un ticket",
    // Visible par défaut pour « Gérer les messages » (commande staff). Le staff des tickets qui n'a pas ce droit
    // y a quand même accès (acces ci-dessous) ; un admin peut lui afficher la commande dans Paramètres > Intégrations.
    // Chaque action revérifie ensuite ses propres droits (voir run).
    permission: Discord.PermissionFlagsBits.ManageMessages,
    acces: interaction => isStaff(interaction, interaction.channel),
    // Boutons, menu et formulaire des tickets : cliqués par les membres (ouvrir, fermer le sien, noter),
    // donc publics ; chaque gestionnaire vérifie lui-même qui clique (auteur, staff du ticket…)
    composants: [
        { id: "ticket", types: ["bouton"], public: true, gestionnaire: tickets.onBoutonTicket },
        { id: "close", types: ["bouton"], public: true, gestionnaire: tickets.closeTicket },
        { id: "claim", types: ["bouton"], public: true, gestionnaire: tickets.claimTicket },
        { prefixe: "note:", types: ["bouton"], public: true, gestionnaire: tickets.noterTicket },
        { id: "ticket-type", types: ["menu"], public: true, gestionnaire: tickets.onMenuType },
        { prefixe: "ticket-form:", types: ["modal"], public: true, gestionnaire: tickets.onFormulaire }
    ],
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
                { name: "Retirer un membre de ce ticket", value: "retirer" },
                { name: "Transférer ce ticket vers un autre type", value: "transferer" }
            ]
        }, {
            type: "user",
            name: "membre",
            description: "Le membre à ajouter ou retirer",
            required: false
        }, {
            type: "string",
            name: "type",
            description: "Type de destination (pour transférer)",
            required: false,
            autocomplete: true,
            maxLength: 50
        }
    ],

    async run(bot, message, args) {
        const action = args.getString("action")

        if (action === "transferer") return tickets.transfererTicket(message, args.getString("type"))

        if (action !== "panneau") {
            const user = args.getUser("membre")
            if (!user) return message.reply({ content: t(message, "tk.tk_membre"), flags: EPHEMERAL })
            return gererMembre(message, action, user)
        }

        // Le panneau est visible de tous : réservé à ceux qui peuvent gérer les messages
        if (!message.memberPermissions.has(Flags.ManageMessages)) {
            return message.reply({ content: t(message, "tk.tk_perm"), flags: EPHEMERAL })
        }
        const channel = message.channel
        if (channel?.type !== Discord.ChannelType.GuildText) {
            return message.reply({ content: t(message, "tk.tk_salon_texte"), flags: EPHEMERAL })
        }
        if (!channel.permissionsFor(message.guild.members.me)?.has([Flags.ViewChannel, Flags.SendMessages, Flags.EmbedLinks])) {
            return message.reply({ content: t(message, "tk.tk_ecrire"), flags: EPHEMERAL })
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
        await message.reply({ content: t(message, "tk.tk_panneau_ok"), flags: EPHEMERAL })
    },

    // Types proposés pour /ticket transferer (le nom du type est la valeur choisie)
    async autocomplete(bot, interaction) {
        const saisie = String(interaction.options.getFocused() ?? "").toLowerCase()
        const types = interaction.guildId ? db.listTicketTypes(interaction.guildId) : []
        await interaction.respond(types
            .filter(ty => ty.nom.toLowerCase().includes(saisie))
            .slice(0, 25)
            .map(ty => ({ name: ty.nom.slice(0, 100), value: ty.nom.slice(0, 100) })))
    }
}
