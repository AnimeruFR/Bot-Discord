const Discord = require('discord.js')
const eco = require('../../../Fonctions/economie')
const profils = require('../../../Fonctions/profils')
const { langueDe, t } = require('../../../Fonctions/i18n')
const { refuser } = require('../../../Fonctions/erreurs')

const EPHEMERAL = Discord.MessageFlags.Ephemeral

module.exports = {
    name: "profil",
    description: "Voir un profil, ou personnaliser le vôtre (bio, thème, badge)",
    permission: "Aucune",
    dm: false,
    cooldown: 3,
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ? (voir un profil par défaut)",
            required: false,
            choices: [
                { name: "Voir un profil", value: "voir" },
                { name: "Changer ma bio", value: "bio" },
                { name: "Changer mon thème", value: "theme" },
                { name: "Choisir mon badge mis en avant", value: "badge" }
            ]
        }, {
            type: "user",
            name: "membre",
            description: "Le membre à voir (vous par défaut)",
            required: false
        }, {
            type: "string",
            name: "texte",
            description: "Votre bio, 200 caractères au plus (vide : l'effacer)",
            required: false,
            maxLength: profils.BIO_MAX
        }, {
            type: "string",
            name: "theme",
            description: "La couleur de votre profil",
            required: false,
            choices: [
                { name: "Bleu", value: "bleu" },
                { name: "Vert", value: "vert" },
                { name: "Rose", value: "rose" }
            ]
        }, {
            type: "string",
            name: "badge",
            description: "Un succès obtenu à mettre en avant (vide : le retirer)",
            required: false,
            autocomplete: true
        }
    ],

    // Propose les succès déjà obtenus par le membre
    async autocomplete(bot, interaction) {
        const langue = langueDe(interaction)
        const saisie = String(interaction.options.getFocused()).toLowerCase()
        const choix = profils.succesObtenus(interaction.guildId, interaction.user.id)
            .map(id => ({ name: profils.nomSucces(langue, id).slice(0, 100), value: id }))
            .filter(c => c.name.toLowerCase().includes(saisie) || c.value.toLowerCase().includes(saisie))
        await interaction.respond(choix.slice(0, 25))
    },

    async run(bot, interaction, args) {
        const action = args.getString("action") ?? "voir"
        const guildId = interaction.guildId
        const moi = interaction.user.id

        if (action === "bio") {
            const bio = profils.definirBio(guildId, moi, args.getString("texte"))
            if (bio === null) return refuser(interaction, t(interaction, "social.profil.bio_trop_longue", { max: profils.BIO_MAX }))
            return interaction.reply({ content: t(interaction, bio ? "social.profil.bio_ok" : "social.profil.bio_effacee"), flags: EPHEMERAL })
        }
        if (action === "theme") {
            if (!profils.definirTheme(guildId, moi, args.getString("theme"))) return refuser(interaction, t(interaction, "social.profil.theme_manquant"))
            return interaction.reply({ content: t(interaction, "social.profil.theme_ok"), flags: EPHEMERAL })
        }
        if (action === "badge") {
            const badge = args.getString("badge")
            if (!profils.definirBadge(guildId, moi, badge)) return refuser(interaction, t(interaction, "social.profil.badge_inconnu"))
            return interaction.reply({ content: t(interaction, badge ? "social.profil.badge_ok" : "social.profil.badge_retire"), flags: EPHEMERAL })
        }

        const cible = args.getUser("membre") ?? interaction.user
        if (cible.bot) return refuser(interaction, t(interaction, "social.profil.bot"))
        const langue = langueDe(interaction)
        const p = profils.donneesProfil(guildId, cible.id)
        const membre = args.getMember("membre") ?? interaction.member
        const embed = new Discord.EmbedBuilder()
            .setColor(p.couleur)
            .setTitle(t(interaction, "social.profil.titre", { nom: Discord.escapeMarkdown(membre?.displayName ?? cible.username) }))
            .setThumbnail((membre?.displayAvatarURL?.() ?? cible.displayAvatarURL?.()) || null)
            // La bio est affichée telle quelle, sans mention possible
            .setDescription(p.bio ? profils.sansMention(p.bio) : t(interaction, "social.profil.bio_vide"))
            .addFields(
                { name: t(interaction, "social.profil.niveau"), value: `${p.niveau} (${p.xp} XP)`, inline: true },
                { name: t(interaction, "social.profil.solde"), value: eco.formater(guildId, p.solde), inline: true },
                { name: t(interaction, "social.profil.reputation"), value: String(p.reputation), inline: true },
                {
                    name: t(interaction, "social.profil.succes"), inline: true,
                    value: p.badge
                        ? t(interaction, "social.profil.succes_badge", { nombre: p.nbSucces, badge: Discord.escapeMarkdown(profils.nomSucces(langue, p.badge)) })
                        : String(p.nbSucces)
                }
            )
        return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } })
    }
}
