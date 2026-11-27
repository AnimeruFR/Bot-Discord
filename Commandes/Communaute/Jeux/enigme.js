const Discord = require('discord.js')
const economie = require('../../../Fonctions/economie')
const quiz = require('../../../Fonctions/quiz')
const { jourParis } = require('../../../Fonctions/evenements')
const { refuser } = require('../../../Fonctions/erreurs')
const { t, langueDe } = require('../../../Fonctions/i18n')

// /enigme (idée #48) : une énigme par jour et par serveur, 3 essais par membre.
// Les 3 premiers à la trouver gagnent 40, 30 et 20, les suivants 10.
const EPHEMERAL = Discord.MessageFlags.Ephemeral
const PREFIXE = "enigme:"

const nomMonnaie = guildId => economie.monnaie(guildId).nom

function texteEtat(interaction, etat) {
    if (etat.trouvee) return t(interaction, "enigme.etat_trouvee", { rang: etat.rang })
    if (!etat.restants) return t(interaction, "enigme.etat_plus_essais")
    return t(interaction, "enigme.etat_essais", { restants: etat.restants, max: quiz.ESSAIS_ENIGME })
}

async function voir(interaction) {
    const guildId = interaction.guildId
    const jour = jourParis()
    const langue = langueDe(interaction)
    const enigme = quiz.enigmeDuJour(guildId, jour)[langue]
    const etat = quiz.etatEnigme(guildId, interaction.user.id, jour)
    const gains = quiz.GAINS_ENIGME.map(g => economie.formater(guildId, g)).join(" / ")
    const lignes = [
        t(langue, "enigme.titre"),
        `> ${enigme.enigme}`,
        texteEtat(interaction, etat),
        t(langue, "enigme.trouveurs", { nombre: quiz.nombreTrouveurs(guildId, jour) }),
        t(langue, "enigme.gains", { gains, defaut: economie.formater(guildId, quiz.GAIN_ENIGME_DEFAUT) })
    ]
    return interaction.reply({ content: lignes.join("\n\n"), flags: EPHEMERAL })
}

async function ouvrirFormulaire(interaction) {
    const jour = jourParis()
    const etat = quiz.etatEnigme(interaction.guildId, interaction.user.id, jour)
    if (etat.trouvee) return refuser(interaction, t(interaction, "enigme.deja_trouvee"))
    if (!etat.restants) return refuser(interaction, t(interaction, "enigme.plus_essais"))
    const champ = new Discord.TextInputBuilder()
        .setCustomId("reponse").setLabel(t(interaction, "enigme.form_champ")).setStyle(Discord.TextInputStyle.Short)
        .setRequired(true).setMaxLength(100)
    await interaction.showModal(new Discord.ModalBuilder()
        .setCustomId(`${PREFIXE}${jour}`).setTitle(t(interaction, "enigme.form_titre"))
        .addComponents(new Discord.ActionRowBuilder().addComponents(champ)))
}

// Formulaire envoyé. Si le jour a changé depuis l'ouverture (minuit passé), la réponse viserait une autre énigme : refusée.
async function onFormulaire(bot, interaction) {
    if (!interaction.inGuild()) return
    if (interaction.customId !== `${PREFIXE}${jourParis()}`) return refuser(interaction, t(interaction, "enigme.changee"))
    const guildId = interaction.guildId
    const resultat = quiz.repondreEnigme(interaction.member, interaction.fields.getTextInputValue("reponse"))

    switch (resultat.etat) {
        case "refus":
            return refuser(interaction, t(interaction, `eco.refus.${resultat.refus}`, { monnaie: nomMonnaie(guildId) }))
        case "vide":
            return refuser(interaction, t(interaction, "enigme.vide"))
        case "deja_trouvee":
            return refuser(interaction, t(interaction, "enigme.deja_trouvee"))
        case "plus_essais":
            return refuser(interaction, t(interaction, "enigme.plus_essais"))
        case "ratee":
            return interaction.reply({
                content: t(interaction, resultat.restants ? "enigme.rate" : "enigme.rate_dernier", { restants: resultat.restants }),
                flags: EPHEMERAL
            })
    }
    // Trouvée : annonce publique sans la réponse, pour ne pas la révéler aux autres
    const lignes = [t(interaction, "enigme.trouvee", { user: interaction.user.id, rang: resultat.rang })]
    if (resultat.refusEco) lignes.push(t(interaction, `eco.refus.${resultat.refusEco}`, { monnaie: nomMonnaie(guildId) }))
    else lignes.push(t(interaction, "enigme.gain", { gain: economie.formater(guildId, resultat.credite) }))
    if (resultat.plafonne) lignes.push(t(interaction, "eco.plafonne", { monnaie: nomMonnaie(guildId) }))
    return interaction.reply({ content: lignes.join("\n") })
}

module.exports = {
    name: "enigme",
    description: "L'énigme du jour : voir l'énigme ou tenter votre réponse (3 essais par jour)",
    permission: "Aucune",
    dm: false,
    category: "Jeux",
    composants: [{ prefixe: PREFIXE, types: ["modal"], public: true, gestionnaire: onFormulaire }],
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Voir l'énigme", value: "voir" },
                { name: "Répondre", value: "repondre" }
            ]
        }
    ],

    async run(bot, interaction, args) {
        return args.getString("action") === "repondre" ? ouvrirFormulaire(interaction) : voir(interaction)
    }
}
