const Discord = require('discord.js')
const economie = require('../../../Fonctions/economie')
const { couleur } = require('../../../Fonctions/apparence')
const { t } = require('../../../Fonctions/i18n')
const { refuser } = require('../../../Fonctions/erreurs')

// La série de daily se perd après 48 h sans daily
const DELAI_SERIE = 48 * 3600 * 1000

module.exports = {
    name: "solde",
    description: "Voir un solde, la série de daily et le rang au classement",
    permission: "Aucune",
    dm: false,
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre à consulter (vous par défaut)",
            required: false
        }
    ],

    async run(bot, interaction, args) {
        const guildId = interaction.guild.id
        const user = args.getUser("membre") ?? interaction.user
        const { nom } = economie.monnaie(guildId)
        if (user.bot) return refuser(interaction, t(interaction, "eco.refus.bot", { monnaie: nom }))

        const compte = economie.compte(guildId, user.id)
        const rang = economie.rang(guildId, user.id)
        const serieEnCours = compte.lastDailyAt && Date.now() - compte.lastDailyAt <= DELAI_SERIE ? compte.streak : 0

        const embed = new Discord.EmbedBuilder()
            .setColor(couleur(interaction.guild))
            .setTitle(t(interaction, "portefeuille.solde.titre"))
            .setDescription(`<@${user.id}>`)
            .addFields(
                { name: t(interaction, "portefeuille.solde.solde"), value: economie.formater(guildId, compte.balance), inline: true },
                { name: t(interaction, "portefeuille.solde.serie"), value: t(interaction, "portefeuille.solde.jours", { jours: serieEnCours }), inline: true },
                { name: t(interaction, "portefeuille.solde.rang"), value: rang ? `#${rang}` : t(interaction, "portefeuille.solde.non_classe"), inline: true }
            )
        return interaction.reply({ embeds: [embed] })
    }
}
