const Discord = require('discord.js')
const xp = require('../../../Fonctions/xp')
const { couleur } = require('../../../Fonctions/apparence')
const { refuser } = require('../../../Fonctions/erreurs')
const { t } = require('../../../Fonctions/i18n')

module.exports = {
    name: "rang",
    description: "Voir son niveau, son XP et son rang (ou ceux d'un membre)",
    permission: "Aucune",
    dm: false,
    cooldown: 5,
    category: "Information",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Membre à consulter (vous par défaut)",
            required: false
        }
    ],

    async run(bot, interaction, args) {
        const user = args.getUser("membre") ?? interaction.user
        if (user.bot) return refuser(interaction, t(interaction, "niv.rang.bot"))

        const p = xp.profilXp(interaction.guild.id, user.id)
        const embed = new Discord.EmbedBuilder()
            .setColor(couleur(interaction.guild))
            .setTitle(t(interaction, "niv.rang.titre", { nom: Discord.escapeMarkdown(user.displayName ?? user.username) }).slice(0, 256))
            .setDescription(t(interaction, "niv.rang.niveau", {
                niveau: p.niveau, barre: xp.barre(p.dansNiveau, p.pourNiveau), dans: p.dansNiveau, pour: p.pourNiveau
            }))
            .addFields(
                { name: t(interaction, "niv.rang.classement"), value: p.rang ? t(interaction, "niv.rang.place", { rang: p.rang }) : t(interaction, "niv.rang.sans_place"), inline: true },
                { name: t(interaction, "niv.rang.total"), value: String(p.xp), inline: true },
                { name: t(interaction, "niv.rang.jour"), value: t(interaction, "niv.rang.jour_valeur", { xp: p.xpJour, plafond: xp.PLAFOND_JOUR }), inline: true }
            )
        return interaction.reply({ embeds: [embed] })
    }
}
