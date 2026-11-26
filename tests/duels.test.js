process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('node:events')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const economie = require('../Fonctions/economie')
const parties = require('../Fonctions/parties')
const evenements = require('../Fonctions/evenements')
const duels = require('../Fonctions/duels')
const drops = require('../Fonctions/drops')
const pfc = require('../Commandes/Communaute/Jeux/pfc')
const morpion = require('../Commandes/Communaute/Jeux/morpion')
const reaction = require('../Commandes/Communaute/Jeux/reaction')

const ANCIEN = Date.now() - 30 * 24 * 3600 * 1000
const A = "100000000000000001", B = "100000000000000002", C = "100000000000000003", D = "100000000000000004"

// Faux serveur et faux membres (assez proches de Discord pour economie.peutJouer et crediter)
const serveurs = new Map()
function creerServeur(id, ids = [A, B, C, D]) {
    const guild = { id, membres: {} }
    serveurs.set(id, guild)
    guild.members = { fetch: async userId => { if (!guild.membres[userId]) throw new Error("inconnu"); return guild.membres[userId] } }
    for (const userId of ids) guild.membres[userId] = { id: userId, guild, user: { id: userId, bot: false }, joinedTimestamp: ANCIEN }
    return guild
}

// Faux clic sur un bouton : toutes les réponses sont notées
function clic(guild, userId, customId, { message = { id: "900", createdTimestamp: Date.now() }, messagesPublics = [] } = {}) {
    const i = {
        guild, guildId: guild.id, channelId: "777", locale: "fr", customId, message, user: { id: userId }, member: guild.membres[userId],
        replied: false, deferred: false, reponses: [], maj: null, finales: [],
        channel: { messages: { edit: async (id, contenu) => { messagesPublics.push([id, contenu]) } } }
    }
    i.reply = async r => { i.reponses.push(r) }
    i.update = async r => { i.maj = r }
    i.deferUpdate = async () => { i.deferred = true }
    i.editReply = async r => { i.finales.push(r) }
    return i
}

// Branche les récompenses comme main.js : crédit « actif » du membre
function brancherRecompenses() {
    parties.configurerRecompenses(async (guild, userId, montant, { source }) => {
        const membre = await serveurs.get(guild.id).members.fetch(userId)
        economie.crediter(membre, montant, { source, actif: true })
    })
}

test("invitation : soi-même, bot et sanctionné refusés", () => {
    const g = creerServeur("555555555555555601")
    const [a, b] = [g.membres[A], g.membres[B]]
    assert.strictEqual(duels.verifierDefi(a, b), null)
    assert.deepStrictEqual(duels.verifierDefi(a, a), { refus: "soi_meme" })
    const robot = { ...b, id: "100000000000000009", user: { id: "100000000000000009", bot: true } }
    assert.deepStrictEqual(duels.verifierDefi(a, robot), { refus: "bot" })

    b.communicationDisabledUntilTimestamp = Date.now() + 3600 * 1000
    assert.deepStrictEqual(duels.verifierDefi(a, b), { refus: "sanctionne", qui: "adversaire" })
    assert.deepStrictEqual(duels.verifierDefi(b, a), { refus: "sanctionne", qui: "auteur" })
    // Textes : le sanctionné lit son propre motif, l'autre apprend que l'adversaire ne peut pas jouer
    const cible = { guildId: g.id, locale: "fr" }
    assert.match(duels.texteRefus(cible, { refus: "sanctionne", qui: "auteur" }, { moiEstAuteur: true, autreId: B }), /sanctionné/)
    assert.match(duels.texteRefus(cible, { refus: "sanctionne", qui: "adversaire" }, { moiEstAuteur: true, autreId: B }), new RegExp(`<@${B}>`))
    assert.match(duels.texteRefus(cible, { refus: "soi_meme" }, { moiEstAuteur: true, autreId: A }), /vous défier/)
    b.communicationDisabledUntilTimestamp = 0

    economie.geler(g.id, A, true)
    assert.deepStrictEqual(duels.verifierDefi(a, b), { refus: "gele", qui: "auteur" })
    economie.geler(g.id, A, false)
})

test("invitation : seul l'adversaire accepte, 60 s, un seul « Accepter » démarre la partie", async () => {
    const g = creerServeur("555555555555555602")
    const demarrer = (interaction, auteur, adversaire) => duels.ouvrirPartie(interaction, auteur, adversaire, {
        game: "pfc", etat: duels.etatInitialPfc(auteur.id, adversaire.id), dureeMs: duels.DELAI_MANCHE_MS, rendre: partie => pfc.rendre(interaction, partie)
    })
    const id = rep => `pfc:inv:${A}:${B}:${rep}`

    assert.strictEqual(await duels.repondreInvitation(clic(g, A, "pfc:12:jouer"), { demarrer }), false, "pas une invitation")
    // L'auteur ne peut pas accepter à la place de l'adversaire, un tiers non plus
    for (const intrus of [A, C]) {
        const i = clic(g, intrus, id("oui"))
        assert.strictEqual(await duels.repondreInvitation(i, { demarrer }), true)
        assert.match(i.reponses[0].content, /ne vous est pas destinée/)
    }
    // L'auteur peut annuler
    const annulation = clic(g, A, id("non"))
    await duels.repondreInvitation(annulation, { demarrer })
    assert.match(annulation.maj.content, /annulé/)
    // Refus, puis invitation périmée
    const refus = clic(g, B, id("non"))
    await duels.repondreInvitation(refus, { demarrer })
    assert.match(refus.maj.content, /refusé/)
    const perimee = clic(g, B, id("oui"), { message: { id: "900", createdTimestamp: Date.now() - 61 * 1000 } })
    await duels.repondreInvitation(perimee, { demarrer })
    assert.match(perimee.maj.content, /expirée/)
    assert.strictEqual(parties.partieEnCours(g.id, B), null, "aucune partie créée par ces réponses")

    // Adversaire sanctionné entre l'invitation et le clic : refus éphémère, pas de partie
    g.membres[B].communicationDisabledUntilTimestamp = Date.now() + 3600 * 1000
    const sanctionne = clic(g, B, id("oui"))
    await duels.repondreInvitation(sanctionne, { demarrer })
    assert.match(sanctionne.reponses[0].content, /sanctionné/)
    assert.strictEqual(parties.partieEnCours(g.id, A), null)
    g.membres[B].communicationDisabledUntilTimestamp = 0

    // Deux « Accepter » en même temps : une seule partie, le deuxième clic est refusé
    const [i1, i2] = [clic(g, B, id("oui")), clic(g, B, id("oui"))]
    await Promise.all([duels.repondreInvitation(i1, { demarrer }), duels.repondreInvitation(i2, { demarrer })])
    assert.strictEqual([i1, i2].filter(i => i.maj).length, 1, "une seule partie démarre")
    const refuse = [i1, i2].find(i => !i.maj)
    assert.ok(refuse.reponses[0].flags, "refus éphémère")
    const partie = parties.partieEnCours(g.id, A)
    assert.deepStrictEqual(partie.players, [A, B])
    assert.strictEqual(partie.messageId, "900", "le message d'invitation devient la partie")
    // Défier quelqu'un qui joue déjà est refusé dès la commande
    assert.match(duels.refusOccupation({ guildId: g.id, user: { id: C }, locale: "fr" }, g.membres[C], g.membres[A]), new RegExp(`<@${A}>`))
})

test("pierre-feuille-ciseaux : résultat, égalité de manche, meilleur des 3", () => {
    assert.strictEqual(duels.comparerPfc("pierre", "ciseaux"), 1)
    assert.strictEqual(duels.comparerPfc("ciseaux", "feuille"), 1)
    assert.strictEqual(duels.comparerPfc("feuille", "pierre"), 1)
    assert.strictEqual(duels.comparerPfc("pierre", "feuille"), -1)
    assert.strictEqual(duels.comparerPfc("pierre", "pierre"), 0)

    const G = "555555555555555603"
    const { partie } = parties.creerPartie({ guildId: G, game: "pfc", players: [A, B], state: duels.etatInitialPfc(A, B) })
    // Un coup invalide, un joueur étranger et un double choix sont refusés
    assert.strictEqual(duels.choisirPfc(partie.id, A, "puits").refus, "coup_invalide")
    assert.strictEqual(duels.choisirPfc(partie.id, C, "pierre").refus, "pas_joueur")
    assert.ok(duels.choisirPfc(partie.id, A, "pierre").ok)
    assert.strictEqual(duels.choisirPfc(partie.id, A, "feuille").refus, "deja_choisi")
    assert.strictEqual(parties.lirePartie(partie.id).state.choix[A], "pierre", "le premier choix est conservé")
    // Manche égale : personne ne marque, les choix repartent à zéro
    const egalite = duels.choisirPfc(partie.id, B, "pierre")
    assert.deepStrictEqual([egalite.manche.gagnant, egalite.termine], [null, false])
    assert.deepStrictEqual(parties.lirePartie(partie.id).state.choix, {})
    // A gagne deux manches : le duel est fini
    duels.choisirPfc(partie.id, A, "pierre")
    const m2 = duels.choisirPfc(partie.id, B, "ciseaux")
    assert.deepStrictEqual([m2.manche.gagnant, m2.termine], [A, false])
    duels.choisirPfc(partie.id, B, "feuille")
    const m3 = duels.choisirPfc(partie.id, A, "ciseaux")
    assert.deepStrictEqual([m3.manche.gagnant, m3.termine, m3.gagnant], [A, true, A])
    assert.deepStrictEqual(parties.lirePartie(partie.id).state.scores, { [A]: 2, [B]: 0 })
    assert.strictEqual(duels.choisirPfc(partie.id, B, "pierre").refus, "terminee")

    // Que des égalités : la partie s'arrête après 5 manches, sans gagnant
    const { partie: nulle } = parties.creerPartie({ guildId: G, game: "pfc", players: [C, D], state: duels.etatInitialPfc(C, D) })
    let dernier
    for (let n = 0; n < duels.MANCHES_MAX; n++) {
        duels.choisirPfc(nulle.id, C, "feuille")
        dernier = duels.choisirPfc(nulle.id, D, "feuille")
    }
    assert.deepStrictEqual([dernier.termine, dernier.gagnant], [true, null])
    assert.deepStrictEqual(duels.montantsDuel(nulle, null), { [C]: 5, [D]: 5 })
    assert.deepStrictEqual(duels.montantsDuel(partie, A), { [A]: 15, [B]: 5 })
})

test("pierre-feuille-ciseaux : duel complet par les boutons, choix éphémères et récompenses", async (t) => {
    const g = creerServeur("555555555555555604")
    brancherRecompenses()
    t.after(() => parties.configurerRecompenses(null))
    const publics = []
    const gestionnaire = pfc.composants[0].gestionnaire

    const accepter = clic(g, B, `pfc:inv:${A}:${B}:oui`, { messagesPublics: publics })
    await gestionnaire(null, accepter)
    assert.match(accepter.maj.content, /Pierre-feuille-ciseaux/)
    const partie = parties.partieEnCours(g.id, A)

    // « Choisir mon coup » ouvre une réponse éphémère avec les trois coups
    const jouer = clic(g, A, `pfc:${partie.id}:jouer`)
    await gestionnaire(null, jouer)
    assert.ok(jouer.reponses[0].flags)
    assert.strictEqual(jouer.reponses[0].components[0].components.length, 3)
    // Un tiers ne peut pas jouer
    const tiers = clic(g, C, `pfc:${partie.id}:jouer`)
    await gestionnaire(null, tiers)
    assert.match(tiers.reponses[0].content, /ne participes pas/)

    const coups = [[A, "pierre"], [B, "ciseaux"], [A, "pierre"], [B, "ciseaux"]]
    for (const [userId, coup] of coups) {
        const c = clic(g, userId, `pfc:${partie.id}:c:${coup}`, { messagesPublics: publics })
        await gestionnaire(null, c)
        assert.match(c.maj.content, /Vous avez choisi/, "le coup n'est confirmé qu'en éphémère")
    }
    // Le choix du premier joueur n'apparaît jamais dans le message public avant la manche
    assert.doesNotMatch(publics[0][1].content, /🪨|✂️|📄/)
    const final = publics.at(-1)[1].content
    assert.match(final, /remporte le duel 2 à 0/)
    assert.match(final, new RegExp(`<@${A}> : \\+15`))
    assert.match(final, new RegExp(`<@${B}> : \\+5`))
    assert.strictEqual(parties.lirePartie(partie.id).status, "finie")
    assert.strictEqual(economie.compte(g.id, A).balance, 15)
    assert.strictEqual(economie.compte(g.id, B).balance, 5)
})

test("morpion : victoire, égalité, tour respecté, double clic", () => {
    const G = "555555555555555605"
    const nouvelle = (x, o) => parties.creerPartie({ guildId: G, game: "morpion", players: [x, o], state: duels.etatInitialMorpion(x, o), dureeMs: 5000 }).partie

    const p = nouvelle(A, B)
    assert.strictEqual(duels.jouerMorpion(p.id, B, 4).refus, "pas_ton_tour", "A commence")
    assert.strictEqual(duels.jouerMorpion(p.id, C, 4).refus, "pas_joueur")
    assert.strictEqual(duels.jouerMorpion(p.id, A, 9).refus, "case_invalide")
    const expireAvant = parties.lirePartie(p.id).expiresAt
    assert.ok(duels.jouerMorpion(p.id, A, 0).ok)
    assert.ok(parties.lirePartie(p.id).expiresAt > expireAvant + 30000, "l'expiration est repoussée à chaque coup")
    // Double clic sur la même case : un seul coup, le deuxième clic n'écrit rien
    const double = duels.jouerMorpion(p.id, A, 0)
    assert.strictEqual(double.refus, "pas_ton_tour")
    assert.strictEqual(parties.lirePartie(p.id).state.coups, 1)
    // L'autre joueur sur une case prise
    assert.strictEqual(duels.jouerMorpion(p.id, B, 0).refus, "case_occupee")
    // Victoire de A sur la première ligne
    duels.jouerMorpion(p.id, B, 3)
    duels.jouerMorpion(p.id, A, 1)
    duels.jouerMorpion(p.id, B, 4)
    const fin = duels.jouerMorpion(p.id, A, 2)
    assert.deepStrictEqual([fin.termine, fin.gagnant], [true, A])
    assert.deepStrictEqual(parties.lirePartie(p.id).state.ligne, [0, 1, 2])
    assert.strictEqual(duels.jouerMorpion(p.id, B, 5).refus, "terminee")

    // Grille pleine sans ligne : égalité
    const q = nouvelle(C, D)
    let dernier
    for (const [joueur, index] of [[C, 0], [D, 1], [C, 2], [D, 4], [C, 3], [D, 5], [C, 7], [D, 6], [C, 8]]) dernier = duels.jouerMorpion(q.id, joueur, index)
    assert.deepStrictEqual([dernier.ok, dernier.termine, dernier.gagnant], [true, true, null])
    assert.strictEqual(parties.lirePartie(q.id).state.coups, 9)

    // L'affichage : 3 rangées de 3 boutons, cases jouées désactivées
    const rendu = morpion.rendre({ guildId: G, locale: "fr" }, parties.lirePartie(p.id))
    assert.strictEqual(rendu.components.length, 3)
    assert.ok(rendu.components.every(r => r.components.length === 3))
    assert.ok(rendu.components[0].components.every(b => b.data.disabled), "partie finie : tout est désactivé")
})

test("morpion : deux clics simultanés sur la même case ne font qu'un coup (boutons)", async () => {
    const g = creerServeur("555555555555555606")
    brancherRecompenses()
    const gestionnaire = morpion.composants[0].gestionnaire
    await gestionnaire(null, clic(g, B, `morpion:inv:${A}:${B}:oui`))
    const partie = parties.partieEnCours(g.id, A)
    const [c1, c2] = [clic(g, A, `morpion:${partie.id}:c:4`), clic(g, A, `morpion:${partie.id}:c:4`)]
    await Promise.all([gestionnaire(null, c1), gestionnaire(null, c2)])
    assert.strictEqual([c1, c2].filter(c => c.maj).length, 1)
    assert.match([c1, c2].find(c => !c.maj).reponses[0].content, /pas ton tour/)
    assert.strictEqual(parties.lirePartie(partie.id).state.coups, 1)
    parties.configurerRecompenses(null)
})

test("course de réaction : trop tôt éliminé, un seul gagnant sous concurrence", async () => {
    const G = "555555555555555607"
    const nouvelle = joueurs => parties.creerPartie({ guildId: G, game: "reaction", players: joueurs, state: duels.etatInitialReaction() }).partie

    const p = nouvelle([A, B, C])
    assert.ok(duels.attenteAleatoire(() => 0) === 2000 && duels.attenteAleatoire(() => 0.999999) === 8000)
    // Clic avant le vert : éliminé, une seule fois
    const tot = duels.cliquerReaction(p.id, A)
    assert.deepStrictEqual([tot.ok, tot.elimine, tot.tousElimines], [true, true, false])
    assert.strictEqual(duels.cliquerReaction(p.id, A).refus, "elimine")
    assert.strictEqual(duels.cliquerReaction(p.id, D).refus, "pas_joueur")
    assert.ok(duels.passerAuVert(p.id, 1000).ok)
    assert.strictEqual(duels.passerAuVert(p.id).refus, "terminee", "le vert ne vient qu'une fois")
    assert.strictEqual(duels.cliquerReaction(p.id, A, 1200).refus, "elimine", "un éliminé ne peut plus gagner")

    // Deux clics en même temps après le vert : un seul gagnant
    const [r1, r2] = await Promise.all([
        Promise.resolve().then(() => duels.cliquerReaction(p.id, B, 1250)),
        Promise.resolve().then(() => duels.cliquerReaction(p.id, C, 1250))
    ])
    assert.deepStrictEqual([r1, r2].map(r => r.ok).sort(), [false, true])
    const gagnant = [r1, r2].find(r => r.ok)
    assert.strictEqual(gagnant.gagne, true)
    assert.strictEqual(gagnant.delaiMs, 250)
    assert.strictEqual([r1, r2].find(r => !r.ok).refus, "terminee")
    assert.strictEqual(parties.lirePartie(p.id).state.gagnant, gagnant.partie.state.gagnant)

    // Tout le monde clique trop tôt : fin sans gagnant, le vert n'arrive plus
    const q = nouvelle([D, "100000000000000005"])
    duels.cliquerReaction(q.id, D)
    const dernier = duels.cliquerReaction(q.id, "100000000000000005")
    assert.deepStrictEqual([dernier.elimine, dernier.tousElimines], [true, true])
    assert.strictEqual(duels.passerAuVert(q.id).refus, "terminee")

    // Affichage : bouton gris puis vert
    const gris = reaction.rendreCourse({ guildId: G, locale: "fr" }, p)
    assert.ok(gris.components[0].components[0].data.style)
    assert.strictEqual(reaction.rendreTable({ guildId: G, locale: "fr" }, { id: "1", joueurs: [A] }).components[0].components.length, 1)
})

test("course de réaction : le gagnant reçoit 10 par le bouton", async (t) => {
    const g = creerServeur("555555555555555608")
    brancherRecompenses()
    t.after(() => parties.configurerRecompenses(null))
    const { partie } = parties.creerPartie({ guildId: g.id, game: "reaction", channelId: "777", players: [A, B], state: duels.etatInitialReaction() })
    parties.lierMessage(partie.id, "900", "777")
    const gestionnaire = reaction.composants[0].gestionnaire
    // Clic trop tôt de A : éphémère, éliminé
    const tot = clic(g, A, `reaction:${partie.id}:clic`)
    await gestionnaire(null, tot)
    assert.match(tot.reponses[0].content, /Trop tôt/)
    duels.passerAuVert(partie.id)
    const gagne = clic(g, B, `reaction:${partie.id}:clic`)
    await gestionnaire(null, gagne)
    assert.match(gagne.finales[0].content, /victoire/)
    assert.strictEqual(economie.compte(g.id, B).balance, 10)
    assert.strictEqual(economie.compte(g.id, A).balance, 0)
    assert.strictEqual(parties.lirePartie(partie.id).status, "finie")
})

test("au plus 10 duels récompensés par jour et par membre", async (t) => {
    const g = creerServeur("555555555555555609")
    brancherRecompenses()
    t.after(() => parties.configurerRecompenses(null))
    const duel = async () => {
        const { partie } = parties.creerPartie({ guildId: g.id, game: "pfc", players: [A, B], state: duels.etatInitialPfc(A, B) })
        return duels.terminerDuel(partie.id, g, { gagnants: [A], montants: duels.montantsDuel(partie, A) })
    }
    for (let n = 1; n <= 10; n++) {
        const fin = await duel()
        assert.deepStrictEqual([fin.ok, fin.accordees, fin.limitees], [true, { [A]: 15, [B]: 5 }, []], `duel ${n}`)
    }
    assert.strictEqual(duels.lireCompteurJour(g.id, A), 10)
    const onzieme = await duel()
    assert.deepStrictEqual(onzieme.accordees, {})
    assert.deepStrictEqual(onzieme.limitees.sort(), [A, B])
    assert.match(duels.lignesRecompenses({ guildId: g.id, locale: "fr" }, g.id, onzieme).join("\n"), /10 duels récompensés/)
    assert.strictEqual(economie.compte(g.id, A).balance, 150)
    assert.strictEqual(economie.compte(g.id, B).balance, 50)
    assert.ok(economie.verifierCoherence(g.id, A))
    // Le lendemain, le compteur repart
    const demain = Date.now() + 36 * 3600 * 1000
    assert.deepStrictEqual(duels.reserverRecompenses(g.id, { [A]: 15 }, demain), { accordees: { [A]: 15 }, limitees: [] })
    // Un membre à qui il reste de la place n'est pas pénalisé par l'autre
    assert.deepStrictEqual(duels.reserverRecompenses(g.id, { [C]: 15 }), { accordees: { [C]: 15 }, limitees: [] })
})

test("un membre sanctionné n'est ni récompensé ni compté ; une partie déjà terminée ne compte pas", async (t) => {
    const g = creerServeur("555555555555555610")
    brancherRecompenses()
    t.after(() => parties.configurerRecompenses(null))
    g.membres[B].communicationDisabledUntilTimestamp = Date.now() + 3600 * 1000
    const { partie } = parties.creerPartie({ guildId: g.id, game: "pfc", players: [A, B], state: duels.etatInitialPfc(A, B) })
    const fin = await duels.terminerDuel(partie.id, g, { gagnants: [A], montants: duels.montantsDuel(partie, A) })
    assert.deepStrictEqual(fin.accordees, { [A]: 15 })
    assert.strictEqual(duels.lireCompteurJour(g.id, B), 0)
    assert.strictEqual(economie.compte(g.id, B).balance, 0)
    // Deuxième fin : refusée, la place du jour de A est rendue
    const encore = await duels.terminerDuel(partie.id, g, { gagnants: [A], montants: { [A]: 15 } })
    assert.strictEqual(encore.ok, false)
    assert.strictEqual(duels.lireCompteurJour(g.id, A), 1)
    assert.strictEqual(economie.compte(g.id, A).balance, 15)
})

// --- Drops -----------------------------------------------------------------------------------------------------

// Faux salon : chaque coffre envoyé garde son collecteur (un EventEmitter) et ses modifications
function creerSalon(id) {
    const salon = { id, envoyes: [] }
    salon.send = async contenu => {
        const collecteur = new EventEmitter()
        collecteur.stop = raison => collecteur.emit("end", [], raison)
        const modifs = []
        const message = { id: `m${salon.envoyes.length}`, contenu, collecteur, modifs, edit: async p => { modifs.push(p) }, createMessageComponentCollector: () => collecteur }
        salon.envoyes.push(message)
        return message
    }
    return salon
}
const messageDans = (guild, salon, bot = false) => ({ guild, channel: salon, author: { id: A, bot } })
const vide = () => new Promise(resolve => setImmediate(resolve))

test("drops : salons non configurés ignorés, fréquence bornée par l'activité", async () => {
    const g = creerServeur("555555555555555611")
    const salon = creerSalon("333333333333333301"), autre = creerSalon("333333333333333302")
    const t0 = Math.floor(Date.now() / 3600000) * 3600000 // début d'heure : les minutes se comptent sans surprise

    // Aucune configuration : rien, même avec un tirage gagnant
    assert.strictEqual(await drops.peutEtreDrop(messageDans(g, salon), { aleatoire: () => 0, maintenant: t0 }), false)
    assert.deepStrictEqual(drops.definirSalonsDrops(g.id, [salon.id]), [salon.id])
    assert.strictEqual(await drops.peutEtreDrop(messageDans(g, autre), { aleatoire: () => 0, maintenant: t0 }), false, "salon non configuré")
    assert.strictEqual(autre.envoyes.length, 0)
    assert.strictEqual(await drops.peutEtreDrop(messageDans(g, salon, true), { aleatoire: () => 0, maintenant: t0 }), false, "un bot ne compte pas")
    assert.throws(() => drops.definirSalonsDrops(g.id, ["pas un salon"]), RangeError)
    assert.deepStrictEqual(drops.salonsDrops(g.id), [salon.id], "une liste invalide ne change rien")

    // Tirage perdant : pas de coffre
    assert.strictEqual(await drops.peutEtreDrop(messageDans(g, salon), { aleatoire: () => 0.99, maintenant: t0 }), false)
    // Tirage gagnant : un coffre ; plusieurs messages dans la même minute ne donnent pas d'autre chance
    assert.strictEqual(await drops.peutEtreDrop(messageDans(g, salon), { aleatoire: () => 0, maintenant: t0 + 60000 }), true)
    assert.strictEqual(await drops.peutEtreDrop(messageDans(g, salon), { aleatoire: () => 0, maintenant: t0 + 61000 }), false)
    assert.strictEqual(salon.envoyes.length, 1)
    // Une heure de discussion avec un tirage toujours gagnant : un coffre toutes les 20 minutes au plus (+ le premier déjà posé)
    for (let minute = 2; minute < 62; minute++) await drops.peutEtreDrop(messageDans(g, salon), { aleatoire: () => 0, maintenant: t0 + minute * 60000 })
    assert.strictEqual(salon.envoyes.length, 4, "à t+1, t+21, t+41 et t+61 minutes")

    // Module Jeux coupé : plus de coffre
    db.setModule(g.id, "communaute.jeux", false)
    assert.strictEqual(await drops.peutEtreDrop(messageDans(g, salon), { aleatoire: () => 0, maintenant: t0 + 3 * 3600000 }), false)
    db.setModule(g.id, "communaute.jeux", true)
    // Salons vidés : drops désactivés
    drops.definirSalonsDrops(g.id, [])
    assert.strictEqual(await drops.peutEtreDrop(messageDans(g, salon), { aleatoire: () => 0, maintenant: t0 + 4 * 3600000 }), false)
})

test("drops : le premier qui clique gagne, un seul gagnant, montant de 25 à 100, coffre expiré", async (t) => {
    const g = creerServeur("555555555555555612")
    const salon = creerSalon("333333333333333303")
    drops.definirSalonsDrops(g.id, [salon.id])
    const recus = []
    evenements.ecouter("drop:ramasse", d => recus.push(d))
    t.after(() => evenements.retirerEcouteurs())
    const t0 = Math.floor(Date.now() / 3600000) * 3600000

    assert.strictEqual(drops.montantAleatoire(() => 0), 25)
    assert.strictEqual(drops.montantAleatoire(() => 0.999999), 100)
    await drops.peutEtreDrop(messageDans(g, salon), { aleatoire: () => 0, maintenant: t0 })
    const coffre = salon.envoyes[0]
    assert.match(coffre.contenu.content, /Un coffre apparaît/)

    // Deux clics simultanés : un gagnant, l'autre apprend qu'il est trop tard
    const [i1, i2] = [clic(g, B, "drop:coffre"), clic(g, C, "drop:coffre")]
    coffre.collecteur.emit("collect", i1)
    coffre.collecteur.emit("collect", i2)
    await vide()
    assert.strictEqual([i1, i2].filter(i => i.maj).length, 1)
    const gagnant = [i1, i2].find(i => i.maj), perdant = [i1, i2].find(i => !i.maj)
    assert.match(gagnant.maj.content, /a ouvert le coffre : \+25/)
    assert.match(perdant.reponses[0].content, /Trop tard/)
    assert.strictEqual(economie.compte(g.id, gagnant.user.id).balance, 25)
    assert.strictEqual(economie.compte(g.id, perdant.user.id).balance, 0)
    assert.deepStrictEqual(recus, [{ guildId: g.id, userId: gagnant.user.id, channelId: salon.id, amount: 25 }])
    assert.strictEqual(coffre.modifs.length, 0, "coffre ouvert : pas de message d'expiration")

    // Un coffre non ouvert se referme (fin du collecteur par le temps)
    await drops.peutEtreDrop(messageDans(g, salon), { aleatoire: () => 0, maintenant: t0 + 25 * 60000 })
    const second = salon.envoyes[1]
    second.collecteur.stop("time")
    await vide()
    assert.match(second.modifs[0].content, /s'est refermé/)
    assert.deepStrictEqual(second.modifs[0].components, [])
})

test("drops : un membre sanctionné ou au plafond du jour ne vide pas le coffre", async () => {
    const g = creerServeur("555555555555555613")
    const salon = creerSalon("333333333333333304")
    drops.definirSalonsDrops(g.id, [salon.id])
    await drops.peutEtreDrop(messageDans(g, salon), { aleatoire: () => 0, maintenant: Math.floor(Date.now() / 3600000) * 3600000 })
    const coffre = salon.envoyes[0]

    g.membres[B].communicationDisabledUntilTimestamp = Date.now() + 3600 * 1000
    const sanctionne = clic(g, B, "drop:coffre")
    coffre.collecteur.emit("collect", sanctionne)
    // C a déjà atteint le plafond de gains du jour
    economie.definirReglages(g.id, { plafondJour: 300 })
    economie.crediter(g.membres[C], 300, { source: "test", actif: true })
    const plafonne = clic(g, C, "drop:coffre")
    coffre.collecteur.emit("collect", plafonne)
    await vide()
    assert.match(sanctionne.reponses[0].content, /sanctionné/)
    assert.match(plafonne.reponses[0].content, /plafond/)
    assert.deepStrictEqual([sanctionne.maj, plafonne.maj], [null, null])

    // D, lui, peut encore l'ouvrir
    const libre = clic(g, D, "drop:coffre")
    coffre.collecteur.emit("collect", libre)
    await vide()
    assert.match(libre.maj.content, /\+25/)
    assert.ok(economie.verifierCoherence(g.id, D))
})

test("commandes : drops, pfc, morpion, reaction sont bien déclarées", () => {
    const drop = require('../Commandes/Communaute/Jeux/drops')
    assert.strictEqual(drop.permission, Discord.PermissionFlagsBits.ManageGuild)
    assert.deepStrictEqual(drop.options[0].choices.map(c => c.value), ["salons", "voir"])
    for (const commande of [pfc, morpion, reaction]) assert.deepStrictEqual([commande.permission, commande.dm], ["Aucune", false])
})
