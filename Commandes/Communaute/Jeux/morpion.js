const Discord = require('discord.js')
const parties = require('../../../Fonctions/parties')
const duels = require('../../../Fonctions/duels')
const { refuser } = require('../../../Fonctions/erreurs')
const { t } = require('../../../Fonctions/i18n')

// Morpion (idée #52) : grille 3×3 en boutons, tour par tour (state.tour), 60 s par coup.
const PREFIXE = "morpion:"
const EMOJIS = { X: "❌", O: "⭕", "-": "⬜" }
const mention = id => `<@${id}>`

// Message public : trois rangées de trois boutons. Les cases jouées sont désactivées, la ligne gagnante est en vert.
function rendre(cible, partie, fin = []) {
    const [a, b] = partie.players
    const etat = partie.state
    const lignes = [t(cible, "duels.morpion.titre", { a: mention(a), b: mention(b), sa: EMOJIS[etat.symboles[a]], sb: EMOJIS[etat.symboles[b]] })]
    if (!etat.termine) {
        lignes.push(t(cible, "duels.morpion.tour", { user: mention(etat.tour), symbole: EMOJIS[etat.symboles[etat.tour]] }))
    } else {
        lignes.push(etat.gagnant ? t(cible, "duels.morpion.victoire", { user: mention(etat.gagnant) }) : t(cible, "duels.morpion.egalite"), ...fin)
    }
    const rangees = []
    for (let r = 0; r < 3; r++) {
        const rangee = new Discord.ActionRowBuilder()
        for (let c = 0; c < 3; c++) {
            const i = r * 3 + c, symbole = etat.grille[i]
            const bouton = new Discord.ButtonBuilder().setCustomId(duels.idBouton(PREFIXE, partie.id, "c", i)).setEmoji(EMOJIS[symbole])
            let style = Discord.ButtonStyle.Secondary
            if (etat.ligne?.includes(i)) style = Discord.ButtonStyle.Success
            else if (symbole === "X") style = Discord.ButtonStyle.Danger
            else if (symbole === "O") style = Discord.ButtonStyle.Primary
            rangee.addComponents(bouton.setStyle(style).setDisabled(symbole !== "-" || etat.termine))
        }
        rangees.push(rangee)
    }
    return { content: lignes.join("\n"), components: rangees }
}

async function demarrer(interaction, auteur, adversaire) {
    await duels.ouvrirPartie(interaction, auteur, adversaire, {
        game: "morpion", etat: duels.etatInitialMorpion(auteur.id, adversaire.id), dureeMs: duels.DELAI_COUP_MS,
        rendre: partie => rendre(interaction, partie)
    })
}

async function surBouton(bot, interaction) {
    if (await duels.repondreInvitation(interaction, { demarrer })) return
    const id = duels.lireIdBouton(PREFIXE, interaction.customId)
    if (!id || id.action !== "c") return
    const partie = parties.lirePartie(id.partieId)
    if (partie?.game !== "morpion") return refuser(interaction, t(interaction, "partie.terminee"))
    const refus = parties.verifierClic(interaction, partie)
    if (refus) return refuser(interaction, t(interaction, refus))

    // Deux clics presque simultanés sur la même case : le deuxième voit la case prise (ou n'est plus son tour)
    const resultat = duels.jouerMorpion(partie.id, interaction.user.id, Number(id.args[0]))
    if (!resultat.ok) return refuser(interaction, duels.texteRefusCoup(interaction, resultat.refus))
    if (!resultat.termine) return interaction.update(rendre(interaction, resultat.partie))

    // Fin de partie : récompenses (peut prendre un instant), puis message final
    await interaction.deferUpdate()
    const gagnant = resultat.gagnant
    const fin = await duels.terminerDuel(partie.id, interaction.guild, { gagnants: gagnant ? [gagnant] : [], montants: duels.montantsDuel(partie, gagnant) })
    await interaction.editReply(rendre(interaction, resultat.partie, fin.ok ? duels.lignesRecompenses(interaction, partie.guildId, fin) : []))
}

module.exports = {
    name: "morpion",
    description: "Défier un membre au morpion (grille en boutons)",
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
        return duels.inviter(interaction, adversaire, { prefixe: PREFIXE, jeu: "morpion" })
    }
}
