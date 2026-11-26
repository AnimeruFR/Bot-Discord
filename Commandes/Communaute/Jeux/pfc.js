const Discord = require('discord.js')
const parties = require('../../../Fonctions/parties')
const duels = require('../../../Fonctions/duels')
const { refuser } = require('../../../Fonctions/erreurs')
const { t } = require('../../../Fonctions/i18n')

// Duel pierre-feuille-ciseaux (idée #51) : meilleur des 3, choix envoyés en éphémère et révélés quand les deux ont joué.
const PREFIXE = "pfc:"
const EMOJIS = { pierre: "🪨", feuille: "📄", ciseaux: "✂️" }
const mention = id => `<@${id}>`
const nomCoup = (cible, coup) => `${EMOJIS[coup]} ${t(cible, `duels.pfc.coup.${coup}`)}`

// Message public de la partie. fin : lignes de conclusion (partie terminée).
function rendre(cible, partie, fin = []) {
    const [a, b] = partie.players
    const etat = partie.state
    const lignes = [
        t(cible, "duels.pfc.titre", { a: mention(a), b: mention(b) }),
        t(cible, "duels.pfc.score", { a: mention(a), b: mention(b), sa: etat.scores[a], sb: etat.scores[b] })
    ]
    for (const manche of etat.historique) {
        lignes.push(t(cible, "duels.pfc.manche", {
            n: manche.numero, a: mention(a), b: mention(b), ca: nomCoup(cible, manche.choix[a]), cb: nomCoup(cible, manche.choix[b]),
            resultat: manche.gagnant ? t(cible, "duels.pfc.gagne_manche", { user: mention(manche.gagnant) }) : t(cible, "duels.pfc.egalite_manche")
        }))
    }
    if (etat.termine) {
        lignes.push(etat.gagnant
            ? t(cible, "duels.pfc.victoire", { user: mention(etat.gagnant), sa: etat.scores[etat.gagnant], sb: etat.scores[etat.gagnant === a ? b : a] })
            : t(cible, "duels.pfc.egalite", { n: etat.jouees }), ...fin)
        return { content: lignes.join("\n"), components: [] }
    }
    const statut = id => etat.choix[id] ? "✅" : "⏳"
    lignes.push(t(cible, "duels.pfc.attente", { n: etat.jouees + 1, a: mention(a), b: mention(b), ea: statut(a), eb: statut(b) }))
    const bouton = new Discord.ButtonBuilder().setCustomId(duels.idBouton(PREFIXE, partie.id, "jouer")).setLabel(t(cible, "duels.pfc.jouer")).setStyle(Discord.ButtonStyle.Primary)
    return { content: lignes.join("\n"), components: [new Discord.ActionRowBuilder().addComponents(bouton)] }
}

// Les trois coups, dans une réponse éphémère propre à chaque joueur
function boutonsCoups(cible, partieId) {
    return [new Discord.ActionRowBuilder().addComponents(duels.COUPS_PFC.map(coup =>
        new Discord.ButtonBuilder().setCustomId(duels.idBouton(PREFIXE, partieId, "c", coup)).setLabel(t(cible, `duels.pfc.coup.${coup}`)).setEmoji(EMOJIS[coup]).setStyle(Discord.ButtonStyle.Secondary)))]
}

async function demarrer(interaction, auteur, adversaire) {
    await duels.ouvrirPartie(interaction, auteur, adversaire, {
        game: "pfc", etat: duels.etatInitialPfc(auteur.id, adversaire.id), dureeMs: duels.DELAI_MANCHE_MS,
        rendre: partie => rendre(interaction, partie)
    })
}

// Fin du duel : récompenses, puis message final (le message public est modifié depuis le clic éphémère)
async function conclure(interaction, partie) {
    const fin = await duels.terminerDuel(partie.id, interaction.guild, { gagnants: partie.state.gagnant ? [partie.state.gagnant] : [], montants: duels.montantsDuel(partie, partie.state.gagnant) })
    const lignes = fin.ok ? duels.lignesRecompenses(interaction, partie.guildId, fin) : []
    await duels.majMessage(interaction, partie, rendre(interaction, partie, lignes))
}

async function surBouton(bot, interaction) {
    if (await duels.repondreInvitation(interaction, { demarrer })) return
    const id = duels.lireIdBouton(PREFIXE, interaction.customId)
    if (!id) return
    const partie = parties.lirePartie(id.partieId)
    if (partie?.game !== "pfc") return refuser(interaction, t(interaction, "partie.terminee"))
    const refus = parties.verifierClic(interaction, partie)
    if (refus) return refuser(interaction, t(interaction, refus))
    const userId = interaction.user.id

    if (id.action === "jouer") {
        if (partie.state.choix[userId]) return refuser(interaction, t(interaction, "duels.pfc.deja_choisi"))
        return interaction.reply({ content: t(interaction, "duels.pfc.choisir"), components: boutonsCoups(interaction, partie.id), flags: Discord.MessageFlags.Ephemeral })
    }
    if (id.action !== "c") return

    const coup = id.args[0]
    const resultat = duels.choisirPfc(partie.id, userId, coup)
    if (!resultat.ok) return refuser(interaction, duels.texteRefusCoup(interaction, resultat.refus))
    await interaction.update({ content: t(interaction, "duels.pfc.choisi", { coup: nomCoup(interaction, coup) }), components: [] })
    if (resultat.termine) return conclure(interaction, resultat.partie)
    await duels.majMessage(interaction, resultat.partie, rendre(interaction, resultat.partie))
}

module.exports = {
    name: "pfc",
    description: "Défier un membre à pierre-feuille-ciseaux (meilleur des 3)",
    permission: "Aucune",
    dm: false,
    cooldown: 10,
    options: [
        { type: "user", name: "adversaire", description: "Le membre à défier", required: true }
    ],
    composants: [{ prefixe: PREFIXE, types: ["bouton"], public: true, gestionnaire: surBouton }],
    rendre,

    async run(bot, interaction, options) {
        const adversaire = options.getMember("adversaire") ?? await interaction.guild.members.fetch(options.getUser("adversaire").id).catch(() => null)
        if (!adversaire) return refuser(interaction, t(interaction, "duels.refus.introuvable"))
        return duels.inviter(interaction, adversaire, { prefixe: PREFIXE, jeu: "pfc" })
    }
}
