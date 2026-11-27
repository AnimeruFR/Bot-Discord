const economie = require('../../../Fonctions/economie')
const daily = require('../../../Fonctions/daily')
const { refuser } = require('../../../Fonctions/erreurs')
const { t } = require('../../../Fonctions/i18n')

// /daily : la logique (série, montant, jour de Paris) est dans Fonctions/daily.js, la commande ne fait que l'affichage.


const nomMonnaie = guildId => {
    const m = economie.monnaie(guildId)
    return `${m.nom} ${m.emoji}`
}

module.exports = {
    name: "daily",
    description: "Récupérer votre récompense quotidienne",
    permission: "Aucune",
    dm: false,
    options: [],

    async run(bot, interaction) {
        const guildId = interaction.guildId
        const monnaie = nomMonnaie(guildId)
        const resultat = daily.reclamer(interaction.member)
        if (!resultat.ok) {
            const quand = resultat.prochain ? `<t:${Math.floor(resultat.prochain / 1000)}:R>` : ""
            return refuser(interaction, t(interaction, resultat.refus === "deja" ? "daily.deja" : `eco.refus.${resultat.refus}`, { quand, monnaie }))
        }
        const lignes = [
            t(interaction, "daily.gain", { gain: economie.formater(guildId, resultat.credite), serie: resultat.serie }),
            t(interaction, "daily.solde", { solde: economie.formater(guildId, resultat.solde) }),
            resultat.serie >= daily.SERIE_MAX ? t(interaction, "daily.serie_max") : t(interaction, "daily.demain", { gain: economie.formater(guildId, daily.montantPour(resultat.serie + 1)) }),
            t(interaction, "daily.prochain", { quand: `<t:${Math.floor(resultat.prochain / 1000)}:R>` })
        ]
        if (resultat.perdue) lignes.unshift(t(interaction, "daily.serie_perdue"))
        return interaction.reply({ content: lignes.join("\n") })
    }
}
