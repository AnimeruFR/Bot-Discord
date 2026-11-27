const Discord = require('discord.js')
const parties = require('../../../Fonctions/parties')
const duels = require('../../../Fonctions/duels')
const economie = require('../../../Fonctions/economie')
const { refuser } = require('../../../Fonctions/erreurs')
const { t } = require('../../../Fonctions/i18n')

// Course de réaction (idée #55) : partie ouverte (2 à 10 joueurs, 30 s pour rejoindre), puis un bouton gris qui devient
// vert après 2 à 8 s. Cliquer trop tôt élimine ; le premier clic après le vert gagne (ordre garanti par majPartie).
// Les inscriptions sont gardées en mémoire (30 s) : un redémarrage du bot les annule, sans rien de perdu.
const PREFIXE = "reaction:"
const DUREE_INSCRIPTION_MS = 30 * 1000
const JOUEURS_MIN = 2
const JOUEURS_MAX = 10
const mention = id => `<@${id}>`

const tables = new Map() // identifiant de la commande -> { id, guildId, channelId, joueurs, interaction }

function rendreTable(cible, table) {
    const bouton = new Discord.ButtonBuilder().setCustomId(`${PREFIXE}j:${table.id}`).setLabel(t(cible, "duels.reaction.rejoindre")).setStyle(Discord.ButtonStyle.Primary)
    return {
        content: t(cible, "duels.reaction.ouverture", { min: JOUEURS_MIN, max: JOUEURS_MAX, n: table.joueurs.length, joueurs: table.joueurs.map(mention).join(" ") }),
        components: [new Discord.ActionRowBuilder().addComponents(bouton)]
    }
}

// Message de la course : bouton gris pendant l'attente, vert ensuite. fin : lignes de conclusion.
function rendreCourse(cible, partie, fin = null) {
    const etat = partie.state
    const bouton = new Discord.ButtonBuilder().setCustomId(duels.idBouton(PREFIXE, partie.id, "clic"))
    const joueurs = partie.players.map(mention).join(" ")
    if (fin) {
        bouton.setLabel(t(cible, "duels.reaction.bouton_fini")).setStyle(etat.gagnant ? Discord.ButtonStyle.Success : Discord.ButtonStyle.Secondary).setDisabled(true)
        return { content: [t(cible, "duels.reaction.titre", { joueurs }), ...fin].join("\n"), components: [new Discord.ActionRowBuilder().addComponents(bouton)] }
    }
    const vert = etat.phase === "vert"
    bouton.setLabel(t(cible, vert ? "duels.reaction.bouton_vert" : "duels.reaction.bouton_gris")).setStyle(vert ? Discord.ButtonStyle.Success : Discord.ButtonStyle.Secondary)
    const consigne = t(cible, vert ? "duels.reaction.consigne_vert" : "duels.reaction.consigne_gris")
    return { content: [t(cible, "duels.reaction.titre", { joueurs }), consigne].join("\n"), components: [new Discord.ActionRowBuilder().addComponents(bouton)] }
}

// Lance la course avec les joueurs inscrits. Ceux qui ont une autre partie entre-temps, ou qui ne peuvent plus jouer
// (sanction, compte gelé), sont retirés. Si le message ne peut pas être modifié, la course est annulée.
// attenteMs : attente avant le vert (tests), tirée au hasard par défaut.
async function demarrerCourse(table, { attenteMs = duels.attenteAleatoire() } = {}) {
    tables.delete(table.id)
    const { interaction } = table
    let joueurs = []
    for (const id of table.joueurs) {
        const membre = await interaction.guild?.members?.fetch(id).catch(() => null)
        if (membre && !economie.peutJouer(membre)) joueurs.push(id)
    }
    let creation = null
    while (joueurs.length >= JOUEURS_MIN) {
        const essai = parties.creerPartie({
            guildId: table.guildId, game: "reaction", channelId: table.channelId, players: joueurs, state: duels.etatInitialReaction(),
            dureeMs: duels.DELAI_CLIC_MS + 10 * 1000
        })
        if (essai.ok) { creation = essai; break }
        joueurs = joueurs.filter(id => id !== essai.userId)
    }
    if (!creation) return interaction.editReply({ content: t(interaction, "duels.reaction.annulee", { min: JOUEURS_MIN }), components: [] }).catch(() => {})

    // Pas de message : pas de course (les joueurs ne verraient aucun bouton)
    const partieId = creation.partie.id
    const annuler = async err => {
        console.warn(`Course ${partieId} annulée : message non modifié (${err.message})`)
        await parties.terminerPartie(partieId, { status: "annulee" }).catch(() => {})
    }
    let message
    try {
        message = await interaction.editReply(rendreCourse(interaction, creation.partie))
    } catch (err) {
        return annuler(err)
    }
    parties.lierMessage(partieId, message.id, table.channelId)
    const minuteur = setTimeout(async () => {
        const vert = duels.passerAuVert(partieId)
        if (!vert.ok) return
        try {
            await interaction.editReply(rendreCourse(interaction, vert.partie))
        } catch (err) {
            return annuler(err)
        }
        // Le délai se mesure à partir du moment où le vert est affiché
        duels.recalerVert(partieId)
    }, attenteMs)
    minuteur.unref()
}

async function rejoindre(interaction, idTable) {
    const table = tables.get(idTable)
    if (!table) return refuser(interaction, t(interaction, "duels.reaction.table_fermee"))
    const userId = interaction.user.id
    if (table.joueurs.includes(userId)) return refuser(interaction, t(interaction, "duels.reaction.deja_inscrit"))
    for (const autre of tables.values()) {
        if (autre !== table && autre.joueurs.includes(userId)) return refuser(interaction, t(interaction, "duels.reaction.table_ouverte"))
    }
    if (table.joueurs.length >= JOUEURS_MAX) return refuser(interaction, t(interaction, "duels.reaction.table_pleine", { max: JOUEURS_MAX }))
    const refus = economie.peutJouer(interaction.member)
    if (refus) return refuser(interaction, t(interaction, `eco.refus.${refus}`, { monnaie: economie.monnaie(interaction.guildId).nom }))
    const occupe = duels.refusOccupation(interaction, interaction.member)
    if (occupe) return refuser(interaction, occupe)
    table.joueurs.push(userId)
    return interaction.update(rendreTable(interaction, table))
}

async function surBouton(bot, interaction) {
    const morceaux = interaction.customId.split(":")
    if (morceaux[1] === "j") return rejoindre(interaction, morceaux[2])
    const id = duels.lireIdBouton(PREFIXE, interaction.customId)
    if (!id || id.action !== "clic") return
    const partie = parties.lirePartie(id.partieId)
    if (partie?.game !== "reaction") return refuser(interaction, t(interaction, "partie.terminee"))
    const refus = parties.verifierClic(interaction, partie)
    if (refus) return refuser(interaction, t(interaction, refus))

    const resultat = duels.cliquerReaction(partie.id, interaction.user.id)
    if (!resultat.ok) return refuser(interaction, duels.texteRefusCoup(interaction, resultat.refus))

    if (resultat.elimine) {
        await refuser(interaction, t(interaction, "duels.reaction.trop_tot"))
        if (!resultat.tousElimines) return
        await duels.conclureDuel(partie.id, interaction.guild, {})
        return duels.majMessage(interaction, resultat.partie, rendreCourse(interaction, resultat.partie, [t(interaction, "duels.reaction.personne")]))
    }
    // Premier clic après le vert : victoire (un seul gagnant, majPartie a ordonné les clics)
    await interaction.deferUpdate()
    const gagnant = interaction.user.id
    const fin = await duels.conclureDuel(partie.id, interaction.guild, { gagnants: [gagnant], montants: { [gagnant]: duels.GAIN_REACTION } })
    const lignes = [t(interaction, "duels.reaction.victoire", { user: mention(gagnant), ms: resultat.delaiMs }), ...(fin.ok ? duels.lignesRecompenses(interaction, partie.guildId, fin) : [])]
    await interaction.editReply(rendreCourse(interaction, resultat.partie, lignes))
}

module.exports = {
    name: "reaction",
    description: "Lancer une course de réaction : le premier à cliquer sur le vert gagne",
    permission: "Aucune",
    dm: false,
    cooldown: 30,
    options: [],
    composants: [{ prefixe: PREFIXE, types: ["bouton"], public: true, gestionnaire: surBouton }],
    tables, rendreTable, rendreCourse, demarrerCourse, JOUEURS_MIN, JOUEURS_MAX,

    async run(bot, interaction) {
        const refus = economie.peutJouer(interaction.member)
        if (refus) return refuser(interaction, t(interaction, `eco.refus.${refus}`, { monnaie: economie.monnaie(interaction.guildId).nom }))
        const occupe = duels.refusOccupation(interaction, interaction.member)
        if (occupe) return refuser(interaction, occupe)
        // Une seule inscription ouverte par salon, et un membre n'est inscrit qu'à une table
        for (const autre of tables.values()) {
            if (autre.channelId === interaction.channelId || autre.joueurs.includes(interaction.user.id)) return refuser(interaction, t(interaction, "duels.reaction.table_ouverte"))
        }
        const table = { id: interaction.id, guildId: interaction.guildId, channelId: interaction.channelId, joueurs: [interaction.user.id], interaction }
        tables.set(table.id, table)
        try {
            await interaction.reply(rendreTable(interaction, table))
        } catch (err) {
            tables.delete(table.id)
            throw err
        }
        const minuteur = setTimeout(() => demarrerCourse(table).catch(err => console.error("Course de réaction en échec :", err.message)), DUREE_INSCRIPTION_MS)
        minuteur.unref()
    }
}
