const Discord = require('discord.js')
const economie = require('../../../Fonctions/economie')
const parties = require('../../../Fonctions/parties')
const cooldowns = require('../../../Fonctions/cooldowns')
const quiz = require('../../../Fonctions/quiz')
const { couleur } = require('../../../Fonctions/apparence')
const { refuser } = require('../../../Fonctions/erreurs')
const { t, langueDe } = require('../../../Fonctions/i18n')

// /quiz (idée #46) : une question, 4 boutons, 30 secondes, une seule réponse. Gain de 10, 20 ou 40 selon la difficulté.
const LETTRES = ["A", "B", "C", "D"]

const nomMonnaie = guildId => economie.monnaie(guildId).nom

// Texte d'un refus, quelle que soit son origine (moteur de parties, économie, banque de questions)
function texteRefus(cible, refus, guildId) {
    if (refus === "deja_en_partie") return t(cible, "partie.deja_en_partie")
    if (refus === "aucune_question") return t(cible, "quiz.aucune_question")
    if (refus === "toutes_vues") return t(cible, "quiz.toutes_vues")
    if (refus === "limite_jour") return t(cible, "quiz.limite_jour", { max: quiz.MAX_QUIZ_JOUR })
    return t(cible, `eco.refus.${refus}`, { monnaie: nomMonnaie(guildId) })
}

function etiquette(position, texte) {
    return `${LETTRES[position]}. ${texte}`.slice(0, 80)
}

// Les choix dans l'ordre affiché : le texte vient de la question, l'ordre de l'état de la partie
const choixAffiches = (question, ordre) => ordre.map(indice => question.choix[indice])

function boutons(partieId, question, ordre) {
    const ligne = new Discord.ActionRowBuilder()
    choixAffiches(question, ordre).forEach((texte, position) => {
        ligne.addComponents(new Discord.ButtonBuilder()
            .setCustomId(`quiz:${partieId}:${position}`).setLabel(etiquette(position, texte)).setStyle(Discord.ButtonStyle.Secondary))
    })
    return ligne
}

function titre(langue, etat) {
    return t(langue, "quiz.titre", {
        theme: t(langue, `quiz.theme.${etat.theme}`), difficulte: t(langue, `quiz.difficulte.${etat.difficulte}`)
    })
}

async function lancer(bot, interaction, args) {
    const guildId = interaction.guildId
    const langue = langueDe(interaction)
    const debut = quiz.demarrerQuiz(interaction.member, {
        theme: args.getString("theme"), difficulte: args.getString("difficulte"), langue, channelId: interaction.channelId
    })
    if (!debut.ok) {
        // Refusé avant de jouer : le délai ne doit pas être consommé
        cooldowns.liberer("quiz", guildId, interaction.user.id)
        return refuser(interaction, texteRefus(interaction, debut.refus, guildId))
    }
    const { partie, question, ordre } = debut
    const embed = new Discord.EmbedBuilder()
        .setColor(couleur(interaction.guild))
        .setTitle(titre(langue, partie.state))
        .setDescription(question.question)
        .setFooter({ text: t(langue, "quiz.pied", { secondes: quiz.DUREE_QUIZ_MS / 1000, gain: partie.state.gain, monnaie: nomMonnaie(guildId) }) })
    try {
        await interaction.reply({ embeds: [embed], components: [boutons(partie.id, question, ordre)] })
    } catch (err) {
        // Pas de message : pas de partie fantôme qui bloquerait le joueur pendant 30 secondes
        await parties.terminerPartie(partie.id, { status: "annulee" })
        throw err
    }
    // Le message sert à retirer les boutons si le temps est écoulé (expirerParties)
    const message = await interaction.fetchReply().catch(() => null)
    if (message) parties.lierMessage(partie.id, message.id, interaction.channelId)
}

async function onClic(bot, interaction) {
    const [, id, position] = interaction.customId.split(":")
    const partie = parties.lirePartie(Number(id))
    if (!partie || partie.game !== "quiz") return refuser(interaction, t(interaction, "partie.terminee"))
    const refusClic = parties.verifierClic(interaction, partie)
    if (refusClic) return refuser(interaction, t(interaction, refusClic))

    const reponse = quiz.repondreQuiz(partie.id, Number(position))
    if (!reponse.ok) return refuser(interaction, t(interaction, reponse.refus === "deja_repondu" ? "quiz.deja_repondu" : "partie.terminee"))
    const fin = await quiz.conclureQuiz(interaction.member, partie.id, reponse)
    if (!fin.ok) return refuser(interaction, t(interaction, "partie.terminee"))

    const { question, etat } = reponse
    const langue = etat.langue
    const choisie = Number(position)
    const lignes = choixAffiches(question, etat.ordre).map((texte, i) => {
        const bonne = etat.ordre[i] === question.reponse
        return `${bonne ? "✅" : (i === choisie ? "❌" : "▫️")} ${etiquette(i, texte)}`
    })
    const bilan = [t(langue, fin.bonne ? "quiz.bonne" : "quiz.mauvaise")]
    if (fin.bonne) {
        if (fin.refusEco) bilan.push(texteRefus(langue, fin.refusEco, interaction.guildId))
        else bilan.push(t(langue, "quiz.gain", { gain: economie.formater(interaction.guildId, fin.credite) }))
        if (fin.plafonne) bilan.push(t(langue, "eco.plafonne", { monnaie: nomMonnaie(interaction.guildId) }))
    }
    const embed = new Discord.EmbedBuilder()
        .setColor(fin.bonne ? 0x57F287 : 0xED4245)
        .setTitle(titre(langue, etat))
        .setDescription(`${question.question}\n\n${lignes.join("\n")}\n\n${bilan.join("\n")}`)
    await interaction.update({ embeds: [embed], components: [] })
}

module.exports = {
    name: "quiz",
    description: "Une question de culture générale : répondez en 30 secondes pour gagner des Éclats",
    permission: "Aucune",
    dm: false,
    category: "Jeux",
    cooldown: 20,
    composants: [{ prefixe: "quiz:", types: ["bouton"], public: true, gestionnaire: onClic }],
    options: [
        {
            type: "string",
            name: "theme",
            description: "Thème de la question (au hasard par défaut)",
            required: false,
            choices: [
                { name: "Sciences", value: "sciences" },
                { name: "Histoire", value: "histoire" },
                { name: "Géographie", value: "geographie" },
                { name: "Langue", value: "langue" },
                { name: "Nature", value: "nature" },
                { name: "Arts", value: "arts" },
                { name: "Sport", value: "sport" },
                { name: "Technologie", value: "technologie" }
            ]
        }, {
            type: "string",
            name: "difficulte",
            description: "Difficulté : 10, 20 ou 40 Éclats (au hasard par défaut)",
            required: false,
            choices: [
                { name: "Facile (10)", value: "facile" },
                { name: "Moyen (20)", value: "moyen" },
                { name: "Difficile (40)", value: "difficile" }
            ]
        }
    ],

    run: lancer
}
