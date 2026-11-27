const profils = require('../../../Fonctions/profils')
const { t } = require('../../../Fonctions/i18n')
const { refuser } = require('../../../Fonctions/erreurs')

module.exports = {
    name: "rep",
    description: "Donner un point de réputation à un membre (une fois par jour)",
    permission: "Aucune",
    dm: false,
    cooldown: 3,
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre à remercier",
            required: true
        }
    ],

    async run(bot, interaction, args) {
        const receveur = args.getMember("membre")
        if (!receveur) return refuser(interaction, t(interaction, "social.rep.refus.absent"))
        const resultat = profils.donnerRep(interaction.member, receveur)
        if (!resultat.ok) return refuser(interaction, t(interaction, `social.rep.refus.${resultat.refus}`))
        return interaction.reply({
            content: t(interaction, "social.rep.ok", { membre: `<@${receveur.id}>`, total: resultat.total }),
            allowedMentions: { parse: [] }
        })
    }
}
