const Discord = require('discord.js')
const db = require('./db')
const economie = require('./economie')
const parties = require('./parties')
const { jourParis } = require('./evenements')
const { refuser } = require('./erreurs')
const { t } = require('./i18n')

// Duels et jeux à plusieurs (idées #51, #52, #55). Règles : docs/ECONOMIE.md (duels sans mise).
//   - un duel commence par une invitation que l'adversaire accepte par un bouton (60 s) ;
//   - 15 ✦ au gagnant, 5 au perdant (5 chacun en cas d'égalité), course de réaction : 10 au gagnant ;
//   - au plus 10 parties récompensées par jour et par membre, tous jeux de ce fichier confondus ;
//   - les récompenses passent par terminerPartie({ recompenses }), donc par crediter actif (plafond du jour).
// La logique des jeux est ici sous forme de fonctions pures sur l'état (testables sans Discord) ;
// les commandes de Commandes/Communaute/Jeux ne font que l'affichage.

const GAIN_GAGNANT = 15
const GAIN_PERDANT = 5
const GAIN_EGALITE = 5
const GAIN_REACTION = 10
const MAX_RECOMPENSES_JOUR = 10
const DELAI_INVITATION_MS = 60 * 1000
const DELAI_MANCHE_MS = 60 * 1000
const DELAI_COUP_MS = 60 * 1000
const MANCHES_MAX = 5 // le meilleur des 3 s'arrête à 5 manches si des égalités l'empêchent de se terminer
const ATTENTE_MIN_MS = 2000
const ATTENTE_MAX_MS = 8000
const DELAI_CLIC_MS = 15 * 1000 // temps laissé pour cliquer une fois le bouton vert

// Compteur du jour dans stats_joueur : une seule ligne par membre, valeur = AAAAMMJJ * 100 + nombre de duels récompensés.
// Un nouveau jour repart de zéro sans rien supprimer (pas de ligne par jour qui s'accumule).
const STAT_JOUR = "duels_recompenses_jour"

// --- Invitation ------------------------------------------------------------------------------------------------

// null si le défi est possible, sinon { refus, qui } : "soi_meme", "bot", ou le motif de peutJouer pour l'auteur ou l'adversaire
function verifierDefi(auteur, adversaire) {
    if (auteur.id === adversaire.id) return { refus: "soi_meme" }
    if (adversaire.user?.bot || auteur.user?.bot) return { refus: "bot" }
    const refusAuteur = economie.peutJouer(auteur)
    if (refusAuteur) return { refus: refusAuteur, qui: "auteur" }
    const refusAdversaire = economie.peutJouer(adversaire)
    if (refusAdversaire) return { refus: refusAdversaire, qui: "adversaire" }
    return null
}

// Texte du refus pour celui qui agit. moiEstAuteur : vrai pour la commande, faux pour le clic sur « Accepter ».
function texteRefus(cible, defi, { moiEstAuteur, autreId }) {
    if (defi.refus === "soi_meme" || defi.refus === "bot") return t(cible, `duels.refus.${defi.refus}`)
    if (defi.qui === (moiEstAuteur ? "auteur" : "adversaire")) {
        return t(cible, `eco.refus.${defi.refus}`, { monnaie: economie.monnaie(cible.guildId).nom })
    }
    return t(cible, "duels.refus.adversaire", { user: `<@${autreId}>` })
}

// Message de refus si un des membres a déjà une partie en cours, sinon null
function refusOccupation(interaction, ...membres) {
    for (const membre of membres) {
        if (!parties.partieEnCours(interaction.guildId, membre.id)) continue
        const cle = membre.id === interaction.user.id ? "partie.deja_en_partie" : "partie.adversaire_deja_en_partie"
        return t(interaction, cle, { user: `<@${membre.id}>` })
    }
    return null
}

function ligneInvitation(cible, prefixe, auteurId, adversaireId) {
    const id = reponse => `${prefixe}inv:${auteurId}:${adversaireId}:${reponse}`
    return new Discord.ActionRowBuilder().addComponents(
        new Discord.ButtonBuilder().setCustomId(id("oui")).setLabel(t(cible, "duels.invitation.accepter")).setStyle(Discord.ButtonStyle.Success),
        new Discord.ButtonBuilder().setCustomId(id("non")).setLabel(t(cible, "duels.invitation.refuser")).setStyle(Discord.ButtonStyle.Secondary)
    )
}

// Commande : vérifie le défi, publie l'invitation et la retire au bout de 60 s si personne n'a répondu
async function inviter(interaction, adversaire, { prefixe, jeu }) {
    const defi = verifierDefi(interaction.member, adversaire)
    if (defi) return refuser(interaction, texteRefus(interaction, defi, { moiEstAuteur: true, autreId: adversaire.id }))
    const occupe = refusOccupation(interaction, interaction.member, adversaire)
    if (occupe) return refuser(interaction, occupe)

    await interaction.reply({
        content: t(interaction, "duels.invitation", { auteur: `<@${interaction.user.id}>`, adversaire: `<@${adversaire.id}>`, jeu: t(interaction, `duels.jeu.${jeu}`) }),
        components: [ligneInvitation(interaction, prefixe, interaction.user.id, adversaire.id)]
    })
    // Si l'invitation a été acceptée entre-temps, le message est devenu la partie : on n'y touche pas
    const minuteur = setTimeout(async () => {
        try {
            const message = await interaction.fetchReply()
            const encore = message.components?.[0]?.components?.some(c => c.customId?.startsWith(`${prefixe}inv:`))
            if (encore) await interaction.editReply({ content: t(interaction, "duels.invitation.expiree", { adversaire: `<@${adversaire.id}>` }), components: [] })
        } catch { /* message supprimé : rien à retirer */ }
    }, DELAI_INVITATION_MS + 1000)
    minuteur.unref()
}

// Clic sur « Accepter » ou « Refuser ». Renvoie false si le bouton n'est pas une invitation.
// demarrer(interaction, auteur, adversaire) crée la partie et affiche le jeu (voir ouvrirPartie).
async function repondreInvitation(interaction, { demarrer }) {
    const morceaux = interaction.customId.split(":")
    if (morceaux[1] !== "inv" || morceaux.length !== 5) return false
    const [, , auteurId, adversaireId, reponse] = morceaux
    const vars = { auteur: `<@${auteurId}>`, adversaire: `<@${adversaireId}>` }
    const fermer = cle => interaction.update({ content: t(interaction, cle, vars), components: [] })

    if (interaction.user.id === auteurId && reponse === "non") { await fermer("duels.invitation.annulee"); return true }
    if (interaction.user.id !== adversaireId) { await refuser(interaction, t(interaction, "duels.invitation.pas_pour_vous")); return true }
    if (Date.now() - interaction.message.createdTimestamp > DELAI_INVITATION_MS) { await fermer("duels.invitation.expiree"); return true }
    if (reponse === "non") { await fermer("duels.invitation.refusee"); return true }

    const auteur = await interaction.guild.members.fetch(auteurId).catch(() => null)
    if (!auteur) { await fermer("duels.invitation.introuvable"); return true }
    const defi = verifierDefi(auteur, interaction.member)
    if (defi) { await refuser(interaction, texteRefus(interaction, defi, { moiEstAuteur: false, autreId: auteurId })); return true }
    const occupe = refusOccupation(interaction, interaction.member, auteur)
    if (occupe) { await refuser(interaction, occupe); return true }
    await demarrer(interaction, auteur, interaction.member)
    return true
}

// Crée la partie (une seule par joueur, vérifié dans la même transaction : deux clics sur « Accepter » ne passent pas
// tous les deux), transforme le message d'invitation en jeu. rendre(partie) renvoie { content, components }.
async function ouvrirPartie(interaction, auteur, adversaire, { game, etat, dureeMs, rendre }) {
    const creation = parties.creerPartie({ guildId: interaction.guildId, game, channelId: interaction.channelId, players: [auteur.id, adversaire.id], state: etat, dureeMs })
    if (!creation.ok) {
        const cle = creation.userId === interaction.user.id ? "partie.deja_en_partie" : "partie.adversaire_deja_en_partie"
        await refuser(interaction, t(interaction, cle, { user: `<@${creation.userId}>` }))
        return null
    }
    parties.lierMessage(creation.partie.id, interaction.message.id, interaction.channelId)
    await interaction.update(rendre(creation.partie))
    return creation.partie
}

// Identifiant des boutons de partie : "<prefixe><partie>:<action>:<arguments...>" (pas de « : » dans les morceaux)
function idBouton(prefixe, partieId, action, ...args) {
    const id = [`${prefixe}${partieId}`, action, ...args].join(":")
    if (id.length > 100) throw new Error(`idBouton trop long (${id.length} caractères)`)
    return id
}

function lireIdBouton(prefixe, customId) {
    if (!String(customId).startsWith(prefixe)) return null
    const morceaux = String(customId).slice(prefixe.length).split(":")
    if (!/^\d+$/.test(morceaux[0]) || !morceaux[1]) return null
    return { partieId: Number(morceaux[0]), action: morceaux[1], args: morceaux.slice(2) }
}

// Modifie le message public d'un jeu depuis un autre clic (par exemple celui d'un bouton éphémère)
async function majMessage(interaction, partie, contenu) {
    if (!partie.messageId) return
    try {
        const salon = interaction.channel ?? await interaction.client.channels.fetch(partie.channelId)
        await salon.messages.edit(partie.messageId, contenu)
    } catch (err) {
        console.warn(`Partie ${partie.id} : message non modifié (${err.message})`)
    }
}

// Texte d'un refus renvoyé par les fonctions de coup
const CLES_REFUS = {
    terminee: "partie.terminee", introuvable: "partie.terminee", pas_joueur: "partie.pas_joueur", pas_ton_tour: "partie.pas_ton_tour",
    deja_choisi: "duels.pfc.deja_choisi", coup_invalide: "partie.terminee", case_occupee: "duels.morpion.case_occupee",
    case_invalide: "partie.terminee", elimine: "duels.reaction.deja_elimine"
}
const texteRefusCoup = (cible, refus) => t(cible, CLES_REFUS[refus] ?? "partie.terminee")

// --- Écriture d'un coup ----------------------------------------------------------------------------------------

// transformation(etat, partie) est pure : elle renvoie { refus } ou { etat, ...info }. Elle est d'abord essayée sur une
// lecture (un clic refusé n'écrit rien et ne prolonge pas la partie), puis rejouée dans majPartie, qui sérialise les
// clics simultanés : le deuxième voit l'état laissé par le premier.
function appliquerCoup(partieId, transformation, prolongerMs = null) {
    const lecture = parties.lirePartie(partieId)
    if (!lecture) return { ok: false, refus: "introuvable" }
    const essai = transformation(lecture.state, lecture)
    if (essai.refus) return { ok: false, refus: essai.refus }
    let issue = null
    const resultat = parties.majPartie(partieId, (etat, partie) => {
        issue = transformation(etat, partie)
        return issue.refus ? undefined : issue.etat
    }, { prolongerMs })
    if (!resultat.ok) return { ok: false, refus: resultat.refus }
    if (issue.refus) return { ok: false, refus: issue.refus }
    const info = { ...issue }
    delete info.etat
    return { ok: true, partie: resultat.partie, ...info }
}

// --- Récompenses -----------------------------------------------------------------------------------------------

function numeroJour(maintenant) {
    return Number(jourParis(maintenant).replaceAll("-", ""))
}

function lireCompteurJour(guildId, userId, maintenant = Date.now()) {
    const ligne = db.sqlAll("SELECT value FROM stats_joueur WHERE guild_id = ? AND user_id = ? AND stat = ?", [guildId, userId, STAT_JOUR])[0]
    const jour = numeroJour(maintenant)
    return ligne && Math.floor(ligne.value / 100) === jour ? ligne.value % 100 : 0
}

function ecrireCompteurJour(guildId, userId, nombre, maintenant) {
    db.sqlRun(`INSERT INTO stats_joueur (guild_id, user_id, stat, value) VALUES (?, ?, ?, ?)
        ON CONFLICT (guild_id, user_id, stat) DO UPDATE SET value = excluded.value`, [guildId, userId, STAT_JOUR, numeroJour(maintenant) * 100 + nombre])
}

// Réserve une place de récompense du jour à chaque membre de montants ({ userId: montant }), dans une transaction.
// Renvoie { accordees: { userId: montant }, limitees: [userId] } : les limitées ont déjà 10 parties récompensées aujourd'hui.
function reserverRecompenses(guildId, montants, maintenant = Date.now()) {
    return db.transaction(() => {
        const accordees = {}, limitees = []
        for (const [userId, montant] of Object.entries(montants)) {
            const deja = lireCompteurJour(guildId, userId, maintenant)
            if (deja >= MAX_RECOMPENSES_JOUR) {
                limitees.push(userId)
                continue
            }
            ecrireCompteurJour(guildId, userId, deja + 1, maintenant)
            accordees[userId] = montant
        }
        return { accordees, limitees }
    })
}

function annulerReservation(guildId, userIds, maintenant = Date.now()) {
    db.transaction(() => {
        for (const userId of userIds) ecrireCompteurJour(guildId, userId, Math.max(0, lireCompteurJour(guildId, userId, maintenant) - 1), maintenant)
    })
}

// Le plafond de gains actifs du jour est-il atteint ? (pour le dire au joueur, clé eco.plafonne)
function plafondAtteint(guildId, userId) {
    const { plafondJour } = economie.reglages(guildId)
    const ligne = db.sqlAll("SELECT active_earned FROM eco_compteurs WHERE guild_id = ? AND user_id = ? AND day = ?", [guildId, userId, jourParis()])[0]
    return (ligne?.active_earned ?? 0) >= plafondJour
}

// Termine la partie et verse les récompenses. montants : { userId: montant } avant limite du jour.
// Un membre sanctionné, gelé ou parti n'est ni récompensé ni compté. Renvoie { ok, accordees, limitees, plafonnes }.
async function terminerDuel(partieId, guild, { gagnants = [], montants = {} } = {}) {
    const partie = parties.lirePartie(partieId)
    if (!partie) return { ok: false, refus: "introuvable" }
    const eligibles = {}
    for (const [userId, montant] of Object.entries(montants)) {
        const membre = await guild.members.fetch(userId).catch(() => null)
        if (membre && !economie.peutJouer(membre)) eligibles[userId] = montant
    }
    const { accordees, limitees } = reserverRecompenses(partie.guildId, eligibles)
    const fin = await parties.terminerPartie(partieId, { status: "finie", gagnants, recompenses: accordees })
    if (!fin.ok) {
        annulerReservation(partie.guildId, Object.keys(accordees))
        return { ok: false, refus: fin.refus }
    }
    const plafonnes = Object.keys(accordees).filter(userId => plafondAtteint(partie.guildId, userId))
    return { ok: true, partie: fin.partie, accordees, limitees, plafonnes }
}

// Lignes à ajouter au message de fin : récompenses, limite du jour, plafond de gains
function lignesRecompenses(cible, guildId, fin) {
    const lignes = []
    for (const [userId, montant] of Object.entries(fin.accordees ?? {})) {
        lignes.push(t(cible, "duels.gain", { user: `<@${userId}>`, gain: economie.formater(guildId, montant) }))
    }
    for (const userId of fin.limitees ?? []) lignes.push(t(cible, "duels.limite_jour", { user: `<@${userId}>`, max: MAX_RECOMPENSES_JOUR }))
    for (const userId of fin.plafonnes ?? []) lignes.push(`<@${userId}> : ${t(cible, "eco.plafonne", { monnaie: economie.monnaie(guildId).nom })}`)
    return lignes
}

// --- Pierre-feuille-ciseaux (#51) ------------------------------------------------------------------------------

const COUPS_PFC = ["pierre", "feuille", "ciseaux"]
const BAT = { pierre: "ciseaux", feuille: "pierre", ciseaux: "feuille" }

// 1 si a bat b, -1 si b bat a, 0 en cas d'égalité
const comparerPfc = (a, b) => a === b ? 0 : (BAT[a] === b ? 1 : -1)

const etatInitialPfc = (a, b) => ({ scores: { [a]: 0, [b]: 0 }, choix: {}, jouees: 0, historique: [], termine: false, gagnant: null })

// Un joueur choisit son coup. Quand les deux ont choisi, la manche est jouée : 2 victoires, ou 5 manches au plus.
function transformerChoixPfc(etat, partie, userId, coup) {
    if (etat.termine || partie.status !== "en_cours") return { refus: "terminee" }
    if (!COUPS_PFC.includes(coup)) return { refus: "coup_invalide" }
    if (!partie.players.includes(userId)) return { refus: "pas_joueur" }
    if (etat.choix[userId]) return { refus: "deja_choisi" }
    const choix = { ...etat.choix, [userId]: coup }
    const [a, b] = partie.players
    if (!choix[a] || !choix[b]) return { etat: { ...etat, choix } }

    const comparaison = comparerPfc(choix[a], choix[b])
    const scores = { ...etat.scores }
    if (comparaison > 0) scores[a]++
    else if (comparaison < 0) scores[b]++
    const jouees = etat.jouees + 1
    const manche = { numero: jouees, choix, gagnant: comparaison > 0 ? a : (comparaison < 0 ? b : null) }
    const termine = scores[a] >= 2 || scores[b] >= 2 || jouees >= MANCHES_MAX
    const gagnant = termine && scores[a] !== scores[b] ? (scores[a] > scores[b] ? a : b) : null
    return { etat: { ...etat, choix: {}, scores, jouees, historique: [...etat.historique, manche], termine, gagnant }, manche, termine, gagnant }
}

const choisirPfc = (partieId, userId, coup) =>
    appliquerCoup(partieId, (etat, partie) => transformerChoixPfc(etat, partie, String(userId), coup), DELAI_MANCHE_MS)

// Récompenses d'un duel à deux : gagnant 15, perdant 5, égalité 5 chacun
function montantsDuel(partie, gagnant) {
    const montants = {}
    for (const userId of partie.players) montants[userId] = gagnant === null ? GAIN_EGALITE : (userId === gagnant ? GAIN_GAGNANT : GAIN_PERDANT)
    return montants
}

// --- Morpion (#52) ---------------------------------------------------------------------------------------------

const LIGNES_MORPION = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]

// grille : 9 caractères, "X", "O" ou "-" ; tour : identifiant du joueur dont c'est le tour (lu par verifierClic)
const etatInitialMorpion = (a, b) => ({ grille: "---------", tour: a, symboles: { [a]: "X", [b]: "O" }, coups: 0, termine: false, gagnant: null, ligne: null })

function ligneGagnante(grille) {
    return LIGNES_MORPION.find(([i, j, k]) => grille[i] !== "-" && grille[i] === grille[j] && grille[j] === grille[k]) ?? null
}

// Un coup : vérifie la partie, le joueur, le tour et la case ; détecte victoire et égalité
function transformerCoupMorpion(etat, partie, userId, index) {
    if (etat.termine || partie.status !== "en_cours") return { refus: "terminee" }
    if (!partie.players.includes(userId)) return { refus: "pas_joueur" }
    if (etat.tour !== userId) return { refus: "pas_ton_tour" }
    if (!Number.isInteger(index) || index < 0 || index > 8) return { refus: "case_invalide" }
    if (etat.grille[index] !== "-") return { refus: "case_occupee" }
    const grille = etat.grille.slice(0, index) + etat.symboles[userId] + etat.grille.slice(index + 1)
    const coups = etat.coups + 1
    const ligne = ligneGagnante(grille)
    if (ligne) return { etat: { ...etat, grille, coups, tour: null, termine: true, gagnant: userId, ligne }, termine: true, gagnant: userId }
    if (coups === 9) return { etat: { ...etat, grille, coups, tour: null, termine: true }, termine: true, gagnant: null }
    const suivant = partie.players.find(joueur => joueur !== userId)
    return { etat: { ...etat, grille, coups, tour: suivant }, termine: false, gagnant: null }
}

// 60 s par coup : l'expiration est repoussée à chaque coup valable
const jouerMorpion = (partieId, userId, index) =>
    appliquerCoup(partieId, (etat, partie) => transformerCoupMorpion(etat, partie, String(userId), index), DELAI_COUP_MS)

// --- Course de réaction (#55) ----------------------------------------------------------------------------------

const etatInitialReaction = () => ({ phase: "attente", elimines: [], gagnant: null, vertAt: null })

const attenteAleatoire = (aleatoire = Math.random) => ATTENTE_MIN_MS + Math.floor(aleatoire() * (ATTENTE_MAX_MS - ATTENTE_MIN_MS + 1))

function transformerVert(etat, partie, maintenant) {
    if (partie.status !== "en_cours" || etat.phase !== "attente") return { refus: "terminee" }
    return { etat: { ...etat, phase: "vert", vertAt: maintenant } }
}

// Le bouton devient vert, sauf si tout le monde a déjà été éliminé. Le délai pour cliquer redémarre.
const passerAuVert = (partieId, maintenant = Date.now()) =>
    appliquerCoup(partieId, (etat, partie) => transformerVert(etat, partie, maintenant), DELAI_CLIC_MS)

// Un clic avant le vert élimine le joueur ; le premier clic après le vert gagne. Un seul gagnant : les clics
// sont appliqués l'un après l'autre par majPartie, le deuxième trouve la phase « fini ».
function transformerClicReaction(etat, partie, userId, maintenant) {
    if (partie.status !== "en_cours" || etat.phase === "fini") return { refus: "terminee" }
    if (!partie.players.includes(userId)) return { refus: "pas_joueur" }
    if (etat.elimines.includes(userId)) return { refus: "elimine" }
    if (etat.phase === "attente") {
        const elimines = [...etat.elimines, userId]
        const tousElimines = elimines.length >= partie.players.length
        return { etat: { ...etat, elimines, phase: tousElimines ? "fini" : etat.phase }, elimine: true, tousElimines }
    }
    return { etat: { ...etat, phase: "fini", gagnant: userId }, gagne: true, delaiMs: maintenant - (etat.vertAt ?? maintenant) }
}

const cliquerReaction = (partieId, userId, maintenant = Date.now()) =>
    appliquerCoup(partieId, (etat, partie) => transformerClicReaction(etat, partie, String(userId), maintenant))

module.exports = {
    GAIN_GAGNANT, GAIN_PERDANT, GAIN_EGALITE, GAIN_REACTION, MAX_RECOMPENSES_JOUR, DELAI_INVITATION_MS, DELAI_MANCHE_MS, DELAI_COUP_MS,
    DELAI_CLIC_MS, MANCHES_MAX, COUPS_PFC, LIGNES_MORPION,
    verifierDefi, texteRefus, refusOccupation, inviter, repondreInvitation, ouvrirPartie, idBouton, lireIdBouton, majMessage, texteRefusCoup,
    appliquerCoup, reserverRecompenses, lireCompteurJour, plafondAtteint, terminerDuel, lignesRecompenses, montantsDuel,
    comparerPfc, etatInitialPfc, choisirPfc,
    etatInitialMorpion, ligneGagnante, jouerMorpion,
    etatInitialReaction, attenteAleatoire, passerAuVert, cliquerReaction
}
