const Discord = require('discord.js')
const anniv = require('../../../Fonctions/anniversaires')
const { texteRefusRole } = require('../../../Fonctions/rolesCommunaute')
const { t } = require('../../../Fonctions/i18n')
const { refuser } = require('../../../Fonctions/erreurs')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral
const dateTexte = (interaction, jour, mois) => `${jour} ${t(interaction, `social.anniv.mois.${mois}`)}`

module.exports = {
    name: "anniversaire",
    description: "Votre anniversaire (jour et mois seulement) et sa configuration",
    permission: "Aucune",
    dm: false,
    cooldown: 5,
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Définir mon anniversaire", value: "definir" },
                { name: "Retirer mon anniversaire", value: "retirer" },
                { name: "Voir mon anniversaire", value: "voir" },
                { name: "Configurer les annonces (admin)", value: "config" },
                { name: "Désactiver les annonces (admin)", value: "desactiver" }
            ]
        }, {
            type: "integer",
            name: "jour",
            description: "Le jour du mois (1 à 31)",
            required: false,
            minValue: 1,
            maxValue: 31
        }, {
            type: "integer",
            name: "mois",
            description: "Le mois (1 à 12)",
            required: false,
            minValue: 1,
            maxValue: 12
        }, {
            type: "channel",
            name: "salon",
            description: "Salon des annonces (config)",
            required: false,
            channelTypes: [Discord.ChannelType.GuildText, Discord.ChannelType.GuildAnnouncement]
        }, {
            type: "role",
            name: "role",
            description: "Rôle donné le jour de l'anniversaire (config)",
            required: false
        }
    ],

    async run(bot, interaction, args) {
        const guild = interaction.guild
        const action = args.getString("action")

        if (action === "definir") {
            const jour = args.getInteger("jour"), mois = args.getInteger("mois")
            const r = anniv.definir(guild.id, interaction.user.id, jour, mois)
            if (!r.ok && r.refus === "delai") return refuser(interaction, t(interaction, "social.anniv.trop_tot", { date: `<t:${Math.floor(r.prochain / 1000)}:D>` }))
            if (!r.ok) return refuser(interaction, t(interaction, "social.anniv.date_invalide"))
            return interaction.reply({ content: t(interaction, "social.anniv.defini", { date: dateTexte(interaction, jour, mois) }), flags: EPHEMERAL })
        }
        if (action === "retirer") {
            const retire = anniv.retirer(guild.id, interaction.user.id)
            return interaction.reply({ content: t(interaction, retire ? "social.anniv.retire" : "social.anniv.aucun"), flags: EPHEMERAL })
        }
        if (action === "voir") {
            const a = anniv.lire(guild.id, interaction.user.id)
            const texte = a ? t(interaction, "social.anniv.voir", { date: dateTexte(interaction, a.day, a.month) }) : t(interaction, "social.anniv.aucun")
            return interaction.reply({ content: texte, flags: EPHEMERAL })
        }

        // Configuration : droit revérifié ici, même si Discord filtre déjà l'accès à la commande
        if (!interaction.memberPermissions?.has(Flags.ManageGuild)) return refuser(interaction, t(interaction, "social.anniv.droit"))

        if (action === "desactiver") {
            anniv.ecrireConfig(guild.id, { salon: null, role: null })
            return interaction.reply({ content: t(interaction, "social.anniv.desactive"), flags: EPHEMERAL })
        }

        const salon = args.getChannel("salon"), role = args.getRole("role")
        if (!salon && !role) {
            const c = anniv.lireConfig(guild.id)
            return interaction.reply({
                content: t(interaction, "social.anniv.config_actuelle", {
                    salon: c.channel_id ? `<#${c.channel_id}>` : t(interaction, "social.anniv.aucun_reglage"),
                    role: c.role_id ? `<@&${c.role_id}>` : t(interaction, "social.anniv.aucun_reglage")
                }),
                flags: EPHEMERAL,
                allowedMentions: { parse: [] }
            })
        }
        if (salon && !salon.permissionsFor(guild.members.me)?.has([Flags.ViewChannel, Flags.SendMessages])) {
            return refuser(interaction, t(interaction, "social.anniv.salon_bot", { salon }))
        }
        if (role) {
            const refus = anniv.refusRoleAnniv(guild, role, interaction.member)
            if (refus) return refuser(interaction, refus.startsWith("social.") ? t(interaction, refus) : texteRefusRole(interaction, refus, role))
        }
        anniv.ecrireConfig(guild.id, { salon: salon?.id, role: role?.id })
        return interaction.reply({ content: t(interaction, "social.anniv.config_ok"), flags: EPHEMERAL })
    }
}
