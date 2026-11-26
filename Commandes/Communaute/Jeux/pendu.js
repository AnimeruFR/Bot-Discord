const Discord = require('discord.js')
const mots = require('../../../Fonctions/mots')
const economie = require('../../../Fonctions/economie')
const parties = require('../../../Fonctions/parties')
const { emettre } = require('../../../Fonctions/evenements')
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

// Clic d'un joueur : la lettre est jouée, ou refusée en éphémère (sans coûter d'erreur)
async function gerer(bot, interaction) {
    const [, idTexte] = interaction.customId.split(":")
    const partie = parties.lirePartie(Number(idTexte))
    if (!partie || partie.game !== "pendu") return refuser(interaction, t(interaction, "partie.terminee"))
    const userId = interaction.user.id

    // Mode ouvert : les joueurs arrivent à la volée, or verifierClic exige d'être dans partie.players (fixé à la création).
    // On le lui fait donc vérifier avec le clic ajouté à la liste (état de la partie et expiration), et les participants
    // sont notés dans state.participants.
    const aVerifier = partie.state.mode === "ouvert" ? { ...partie, players: [...partie.players, userId] } : partie
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

    let coup = null
    const maj = parties.majPartie(partie.id, etat => {
        coup = mots.jouerLettre(etat, lettre)
        if (coup.ok && !etat.participants.includes(userId) && etat.participants.length < MAX_PARTICIPANTS) etat.participants.push(userId)
    }, { prolongerMs: mots.DUREE_PENDU })
    if (!maj.ok) return refuser(interaction, t(interaction, "partie.terminee"))
    if (!coup.ok) return refuser(interaction, t(interaction, "mots.pendu.deja_jouee", { lettre }))

    const etat = maj.partie.state
    if (!coup.gagne && !coup.perdu) return interaction.update(rendu(maj.partie))

    // Fin de partie : la partie ne se termine qu'une fois, le gain n'est versé qu'à celui qui a trouvé le mot
    const fin = await parties.terminerPartie(partie.id, { status: "finie", gagnants: coup.gagne ? [userId] : [] })
    if (!fin.ok) return refuser(interaction, t(interaction, "partie.terminee"))
    for (const autre of etat.participants) {
        if (!partie.players.includes(autre)) emettre("partie:jouee", { guildId: partie.guildId, userId: autre, game: "pendu" })
    }
    const langue = etat.langue
    if (!coup.gagne) return interaction.update(rendu(maj.partie, { fin: t(langue, "mots.pendu.perdu", { mot: etat.mot }) }))

    const credit = economie.crediter(interaction.member, mots.GAIN_PENDU, { source: "pendu", actif: true })
    let texte = t(langue, "mots.pendu.gagne_sans_gain", { mot: etat.mot, user: userId })
    if (credit.ok && credit.credite > 0) {
        texte = t(langue, "mots.pendu.gagne", { mot: etat.mot, user: userId, gain: economie.formater(partie.guildId, credit.credite) })
    } else if (credit.ok && credit.plafonne) {
        texte += "\n" + t(langue, "eco.plafonne", { monnaie: economie.monnaie(partie.guildId).nom })
    } else if (!credit.ok) {
        texte += "\n" + t(langue, `eco.refus.${credit.refus}`, { monnaie: economie.monnaie(partie.guildId).nom })
    }
    return interaction.update(rendu(maj.partie, { fin: texte }))
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
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [{ name: "Lancer une partie", value: "lancer" }]
        }, {
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
            hote: userId, participants: [userId], trouvees: [], ratees: []
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
