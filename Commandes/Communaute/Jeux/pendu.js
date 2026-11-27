const Discord = require('discord.js')
const mots = require('../../../Fonctions/mots')
const economie = require('../../../Fonctions/economie')
const duels = require('../../../Fonctions/duels')
const parties = require('../../../Fonctions/parties')
const { refuser } = require('../../../Fonctions/erreurs')
const { t } = require('../../../Fonctions/i18n')

const MAX_PARTICIPANTS = 50
const GROUPES = { a: "ABCDEFGHIJKLM", n: "NOPQRSTUVWXYZ" }

// Les identifiants du moteur ("p:<id>:...") sont laissés aux autres jeux : le pendu a son préfixe, « pendu:<partie>:<groupe> »

function refusEconomie(interaction) {
    const refus = economie.peutJouer(interaction.member)
    return refus ? t(interaction, `eco.refus.${refus}`, { monnaie: economie.monnaie(interaction.guildId).nom }) : null
}

// Deux menus (A à M, N à Z) : 26 boutons ne tiennent pas dans les 25 places d'un message. Lettre déjà jouée : ✅ ou ❌.
function menus(partie) {
    const { state } = partie
    return Object.entries(GROUPES).map(([groupe, lettres]) => new Discord.ActionRowBuilder().addComponents(
        new Discord.StringSelectMenuBuilder()
            .setCustomId(`pendu:${partie.id}:${groupe}`)
            .setPlaceholder(t(state.langue, groupe === "a" ? "mots.pendu.menu_a" : "mots.pendu.menu_n"))
            .addOptions([...lettres].map(lettre => {
                const option = { label: lettre, value: lettre }
                if (state.trouvees.includes(lettre)) option.emoji = "✅"
                else if (state.ratees.includes(lettre)) option.emoji = "❌"
                return option
            }))
    ))
}

// Message public de la partie, dans la langue du serveur (plusieurs joueurs le modifient, pas de langue « du joueur »)
function rendu(partie, { fin = null } = {}) {
    const { state } = partie
    const langue = state.langue
    const mode = t(langue, state.mode === "ouvert" ? "mots.pendu.mode_ouvert" : "mots.pendu.mode_solo", { user: state.hote })
    const lignes = [
        `${t(langue, "mots.pendu.titre")} (${mode})`,
        "```\n" + mots.dessin(state.ratees.length) + "\n```",
        `\`${mots.masque(state.mot, state.trouvees)}\``,
        t(langue, "mots.pendu.erreurs", { erreurs: state.ratees.length, max: mots.ERREURS_MAX }),
        t(langue, "mots.pendu.ratees", { lettres: state.ratees.length ? state.ratees.join(", ") : t(langue, "mots.pendu.aucune") })
    ]
    if (fin) lignes.push(fin)
    return { content: lignes.join("\n"), components: fin ? [] : menus(partie) }
}

// Récompense d'un pendu trouvé : 20 pour l'hôte, plus 5 pour chaque autre membre ayant trouvé une lettre juste.
// Au plus 5 pendus récompensés par jour et par membre (compteur « pendu » de Fonctions/duels.js).
function montantsPendu(etat) {
    const montants = { [etat.hote]: mots.GAIN_PENDU }
    for (const userId of etat.justes ?? []) if (userId !== etat.hote) montants[userId] = mots.GAIN_PENDU_PARTICIPANT
    return montants
}

// Clic d'un joueur : la lettre est jouée, ou refusée en éphémère (sans coûter d'erreur)
async function gerer(bot, interaction) {
    const [, idTexte] = interaction.customId.split(":")
    const partie = parties.lirePartie(Number(idTexte))
    if (!partie || partie.game !== "pendu") return refuser(interaction, t(interaction, "partie.terminee"))
    const userId = interaction.user.id
    const ouvert = partie.state.mode === "ouvert"

    // Mode ouvert : les joueurs arrivent à la volée, or verifierClic exige d'être dans partie.players. On le lui fait donc
    // vérifier avec le clic ajouté à la liste (état de la partie et expiration) ; le joueur n'est vraiment ajouté
    // (parties.ajouterJoueur) qu'une fois la lettre jugée valable.
    const aVerifier = ouvert ? { ...partie, players: [...new Set([...partie.players, userId])] } : partie
    const refusClic = parties.verifierClic(interaction, aVerifier)
    if (refusClic === "partie.pas_joueur") return refuser(interaction, t(interaction, "mots.pendu.refus_solo", { user: partie.state.hote }))
    if (refusClic) return refuser(interaction, t(interaction, refusClic))

    const avertissement = refusEconomie(interaction)
    if (avertissement) return refuser(interaction, avertissement)

    const lettre = mots.normaliser(interaction.values?.[0])
    if (lettre.length !== 1) return refuser(interaction, t(interaction, "mots.pendu.refus_action"))
    // Lettre déjà jouée : refusée avant d'écrire, donc le délai de 2 minutes n'est pas prolongé
    if (partie.state.trouvees.includes(lettre) || partie.state.ratees.includes(lettre)) {
        return refuser(interaction, t(interaction, "mots.pendu.deja_jouee", { lettre }))
    }

    // Un participant devient joueur de la partie : il ne peut plus en lancer ni en rejoindre une autre (une partie à la fois),
    // et inversement s'il en a déjà une en cours
    if (ouvert && !partie.players.includes(userId)) {
        const ajout = parties.ajouterJoueur(partie.id, userId, { max: MAX_PARTICIPANTS })
        if (!ajout.ok) {
            const cle = { complete: "mots.pendu.complet", deja_en_partie: "partie.deja_en_partie" }[ajout.refus] ?? "partie.terminee"
            return refuser(interaction, t(interaction, cle, { max: MAX_PARTICIPANTS }))
        }
    }

    let coup = null
    const maj = parties.majPartie(partie.id, etat => {
        coup = mots.jouerLettre(etat, lettre)
        if (!coup.ok) return
        etat.justes ??= []
        if (!etat.participants.includes(userId)) etat.participants.push(userId)
        if (coup.bonne && !etat.justes.includes(userId)) etat.justes.push(userId)
    }, { prolongerMs: mots.DUREE_PENDU })
    if (!maj.ok) return refuser(interaction, t(interaction, "partie.terminee"))
    if (!coup.ok) return refuser(interaction, t(interaction, "mots.pendu.deja_jouee", { lettre }))

    const etat = maj.partie.state
    if (!coup.gagne && !coup.perdu) return interaction.update(rendu(maj.partie))

    // Fin de partie : la partie ne se termine qu'une fois ; les récompenses passent par le moteur de parties (crédit actif,
    // plafond du jour) et par la limite de 5 pendus récompensés par jour
    const langue = etat.langue
    const montants = coup.gagne ? montantsPendu(etat) : {}
    await interaction.deferUpdate()
    const fin = coup.gagne
        ? await duels.conclureDuel(partie.id, interaction.guild, { gagnants: Object.keys(montants), montants, compteur: "pendu" })
        : await parties.terminerPartie(partie.id, { status: "finie", gagnants: [] })
    if (!fin.ok) return interaction.followUp({ content: t(interaction, "partie.terminee"), flags: Discord.MessageFlags.Ephemeral }).catch(() => {})
    if (!coup.gagne) return interaction.editReply(rendu(maj.partie, { fin: t(langue, "mots.pendu.perdu", { mot: etat.mot }) }))

    const lignes = [t(langue, "mots.pendu.trouve", { mot: etat.mot }), ...duels.lignesRecompenses(langue, partie.guildId, fin, { cleLimite: "mots.pendu.limite_jour", max: duels.MAX_PENDUS_JOUR })]
    return interaction.editReply(rendu(maj.partie, { fin: lignes.join("\n") }))
}

module.exports = {
    name: "pendu",
    description: "Pendu : trouvez le mot caché avant que le dessin soit complet",
    permission: "Aucune",
    dm: false,
    cooldown: 5,
    composants: [{ prefixe: "pendu:", types: ["menu"], public: true, gestionnaire: gerer }],
    options: [
        {
            type: "string",
            name: "mode",
            description: "Qui peut jouer (solo par défaut)",
            required: false,
            choices: [
                { name: "Solo : seulement moi", value: "solo" },
                { name: "Ouvert : tout le salon", value: "ouvert" }
            ]
        }
    ],

    async run(bot, interaction, args) {
        const avertissement = refusEconomie(interaction)
        if (avertissement) return refuser(interaction, avertissement)
        const langue = mots.langueServeur(interaction.guildId)
        const userId = interaction.user.id
        const etat = {
            mot: mots.motPendu(langue), langue, mode: args.getString("mode") === "ouvert" ? "ouvert" : "solo",
            hote: userId, participants: [userId], justes: [], trouvees: [], ratees: []
        }
        const creation = parties.creerPartie({
            guildId: interaction.guildId, game: "pendu", channelId: interaction.channelId, players: [userId], state: etat, dureeMs: mots.DUREE_PENDU
        })
        if (!creation.ok) return refuser(interaction, t(interaction, "partie.deja_en_partie"))
        try {
            await interaction.reply(rendu(creation.partie))
            const message = await interaction.fetchReply()
            parties.lierMessage(creation.partie.id, message.id, interaction.channelId)
        } catch (err) {
            // Pas de message : la partie ne doit pas bloquer le joueur
            await parties.terminerPartie(creation.partie.id, { status: "annulee" })
            throw err
        }
    }
}
