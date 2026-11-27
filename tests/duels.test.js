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
        replied: false, deferred: false, reponses: [], suivis: [], maj: null, finales: [],
        channel: { messages: { edit: async (id, contenu) => { messagesPublics.push([id, contenu]) } } }
    }
    i.reply = async r => { i.reponses.push(r) }
    i.update = async r => { i.maj = r }
    i.deferUpdate = async () => { i.deferred = true }
    i.editReply = async r => { i.finales.push(r) }
    i.followUp = async r => { i.suivis.push(r) }
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
    // Un adversaire différent à chaque duel : la limite contre le même adversaire (3) ne gêne pas
    const adversaires = Array.from({ length: 12 }, (_, i) => `1000000000000002${String(i).padStart(2, "0")}`)
    const g = creerServeur("555555555555555609", [A, C, ...adversaires])
    brancherRecompenses()
    t.after(() => parties.configurerRecompenses(null))
    const duel = async adversaire => {
        const { partie } = parties.creerPartie({ guildId: g.id, game: "pfc", players: [A, adversaire], state: duels.etatInitialPfc(A, adversaire) })
        return duels.terminerDuel(partie.id, g, { gagnants: [A], montants: duels.montantsDuel(partie, A) })
    }
    for (let n = 1; n <= 10; n++) {
        const fin = await duel(adversaires[n - 1])
        assert.deepStrictEqual([fin.ok, fin.accordees, fin.limitees], [true, { [A]: 15, [adversaires[n - 1]]: 5 }, []], `duel ${n}`)
    }
    assert.strictEqual(duels.lireCompteurJour(g.id, A), 10)
    const onzieme = await duel(adversaires[10])
    assert.deepStrictEqual(onzieme.accordees, { [adversaires[10]]: 5 })
    assert.deepStrictEqual(onzieme.limitees, [A])
    assert.match(duels.lignesRecompenses({ guildId: g.id, locale: "fr" }, g.id, onzieme).join("\n"), /10 duels récompensés/)
    assert.strictEqual(economie.compte(g.id, A).balance, 150)
    assert.strictEqual(economie.compte(g.id, adversaires[0]).balance, 5)
    assert.ok(economie.verifierCoherence(g.id, A))
    // Le lendemain, le compteur repart
    const demain = Date.now() + 36 * 3600 * 1000
    assert.deepStrictEqual(duels.reserverRecompenses(g.id, { [A]: 15 }, demain), { accordees: { [A]: 15 }, limitees: [], limiteesAdversaire: [] })
    // Un membre à qui il reste de la place n'est pas pénalisé par l'autre
    assert.deepStrictEqual(duels.reserverRecompenses(g.id, { [C]: 15 }), { accordees: { [C]: 15 }, limitees: [], limiteesAdversaire: [] })
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

// --- Lot 3C : abandon, expiration, limites, échecs de crédit --------------------------------------------------------

// Démarre un duel par le bouton « Accepter » et renvoie la partie
async function lancerDuel(g, commande, auteur = A, adversaire = B) {
    await commande.composants[0].gestionnaire(null, clic(g, adversaire, `${commande.name}:inv:${auteur}:${adversaire}:oui`))
    return parties.partieEnCours(g.id, auteur)
}

// Faux client pour le planificateur d'expiration : serveurs, salon, message à modifier
function fauxClient(g) {
    const modifs = []
    const message = { edit: async contenu => { modifs.push(contenu) } }
    return { modifs, guilds: { cache: new Map([[g.id, g]]) }, channels: { fetch: async () => ({ messages: { fetch: async () => message } }) } }
}

// Fait dépasser la date limite d'une partie
const perimer = id => db.sqlRun("UPDATE parties SET expires_at = ? WHERE id = ?", [Date.now() - 1000, id])

test("morpion : le bouton Abandonner donne la partie et les récompenses à l'adversaire, même hors de son tour", async (t) => {
    const g = creerServeur("555555555555555620")
    brancherRecompenses()
    t.after(() => parties.configurerRecompenses(null))
    const partie = await lancerDuel(g, morpion)
    assert.ok(morpion.rendre({ guildId: g.id, locale: "fr" }, partie).components.at(-1).components[0].data.custom_id.endsWith(":ab"))

    // Un tiers ne peut pas abandonner à la place d'un joueur
    const tiers = clic(g, C, `morpion:${partie.id}:ab`)
    await morpion.composants[0].gestionnaire(null, tiers)
    assert.match(tiers.reponses[0].content, /ne participes pas/)
    assert.strictEqual(parties.lirePartie(partie.id).status, "en_cours")

    // B abandonne alors que c'est le tour de A : A gagne 15, B reçoit 5
    const ab = clic(g, B, `morpion:${partie.id}:ab`)
    await morpion.composants[0].gestionnaire(null, ab)
    const final = ab.finales[0].content
    assert.match(final, new RegExp(`<@${B}> abandonne : <@${A}> remporte`))
    assert.match(final, new RegExp(`<@${A}> : \\+15`))
    assert.ok(ab.finales[0].components.every(r => r.components.every(b => b.data.disabled)))
    assert.strictEqual(parties.lirePartie(partie.id).status, "finie")
    assert.deepStrictEqual([economie.compte(g.id, A).balance, economie.compte(g.id, B).balance], [15, 5])
    // Deuxième clic : partie terminée
    const encore = clic(g, A, `morpion:${partie.id}:ab`)
    await morpion.composants[0].gestionnaire(null, encore)
    assert.match(encore.reponses[0].content, /terminée/)
})

test("pfc : le bouton Abandonner termine le duel au profit de l'adversaire", async (t) => {
    const g = creerServeur("555555555555555621")
    brancherRecompenses()
    t.after(() => parties.configurerRecompenses(null))
    const partie = await lancerDuel(g, pfc)
    const gagnees = []
    evenements.ecouter("partie:gagnee", d => gagnees.push(d))
    t.after(() => evenements.retirerEcouteurs())
    const ab = clic(g, A, `pfc:${partie.id}:ab`)
    await pfc.composants[0].gestionnaire(null, ab)
    assert.match(ab.finales[0].content, new RegExp(`<@${A}> abandonne : <@${B}> remporte`))
    assert.deepStrictEqual([economie.compte(g.id, B).balance, economie.compte(g.id, A).balance], [15, 5])
    assert.deepStrictEqual(ab.finales[0].components, [])
    assert.deepStrictEqual(gagnees.map(e => [e.userId, e.players]), [[B, [A, B]]], "les joueurs sont dans l'événement")
})

test("morpion : l'expiration est une défaite pour le joueur dont c'était le tour", async (t) => {
    const g = creerServeur("555555555555555622")
    brancherRecompenses()
    t.after(() => parties.configurerRecompenses(null))
    const partie = await lancerDuel(g, morpion)
    await morpion.composants[0].gestionnaire(null, clic(g, A, `morpion:${partie.id}:c:4`)) // A joue : c'est au tour de B
    parties.lierMessage(partie.id, "900", "777")
    perimer(partie.id)
    const bot = fauxClient(g)
    assert.strictEqual(await parties.expirerParties(bot), 1)
    const finale = parties.lirePartie(partie.id)
    assert.strictEqual(finale.status, "finie", "terminée avec un résultat, pas « expiree »")
    assert.strictEqual(finale.state.gagnant, A)
    assert.deepStrictEqual([economie.compte(g.id, A).balance, economie.compte(g.id, B).balance], [15, 5])
    assert.match(bot.modifs[0].content, new RegExp(`<@${B}> n'a pas joué à temps : <@${A}> remporte`))
    assert.match(bot.modifs[0].content, new RegExp(`<@${A}> : \\+15`))
    assert.strictEqual(await parties.expirerParties(bot), 0, "rien à refaire au passage suivant")
})

test("pfc : l'expiration donne la défaite à celui qui n'a pas joué ; personne n'a joué : expirée sans gain", async (t) => {
    const g = creerServeur("555555555555555623")
    brancherRecompenses()
    t.after(() => parties.configurerRecompenses(null))
    const partie = await lancerDuel(g, pfc)
    duels.choisirPfc(partie.id, B, "pierre")
    perimer(partie.id)
    assert.strictEqual(await parties.expirerParties(fauxClient(g)), 1)
    assert.strictEqual(parties.lirePartie(partie.id).state.gagnant, B)
    assert.deepStrictEqual([economie.compte(g.id, B).balance, economie.compte(g.id, A).balance], [15, 5])

    // Aucun des deux n'a choisi : pas de résultat, pas de récompense
    const g2 = creerServeur("555555555555555624")
    const vide = await lancerDuel(g2, pfc)
    perimer(vide.id)
    assert.strictEqual(await parties.expirerParties(fauxClient(g2)), 1)
    assert.strictEqual(parties.lirePartie(vide.id).status, "expiree")
    assert.strictEqual(economie.compte(g2.id, A).balance, 0)

    // Un jeu solo expire toujours sans gain (le moteur ne connaît pas d'expiration propre à ce jeu)
    const solo = parties.creerPartie({ guildId: g2.id, game: "quiz", players: [C], state: {} }).partie
    perimer(solo.id)
    assert.strictEqual(await parties.expirerParties(fauxClient(g2)), 1)
    assert.strictEqual(parties.lirePartie(solo.id).status, "expiree")
})

test("expiration d'un duel : serveur introuvable ou crédit en échec, la partie se termine quand même", async (t) => {
    const g = creerServeur("555555555555555625")
    t.after(() => parties.configurerRecompenses(null))
    const partie = await lancerDuel(g, morpion)
    perimer(partie.id)
    // Le bot ne connaît plus le serveur : expirée sans résultat
    assert.strictEqual(await parties.expirerParties({ guilds: { cache: new Map() } }), 1)
    assert.strictEqual(parties.lirePartie(partie.id).status, "expiree")
    assert.strictEqual(parties.partieEnCours(g.id, A), null, "les joueurs sont libérés")
})

test("duels : au plus 3 duels récompensés par jour contre le même adversaire", async (t) => {
    const g = creerServeur("555555555555555626")
    brancherRecompenses()
    t.after(() => parties.configurerRecompenses(null))
    const duel = async (x, y) => {
        const { partie } = parties.creerPartie({ guildId: g.id, game: "pfc", players: [x, y], state: duels.etatInitialPfc(x, y) })
        return duels.terminerDuel(partie.id, g, { gagnants: [x], montants: duels.montantsDuel(partie, x) })
    }
    for (let n = 1; n <= 3; n++) assert.deepStrictEqual(Object.keys((await duel(A, B)).accordees).sort(), [A, B], `duel ${n}`)
    const quatrieme = await duel(A, B)
    assert.deepStrictEqual(quatrieme.accordees, {})
    assert.deepStrictEqual(quatrieme.limiteesAdversaire.sort(), [A, B])
    const lignes = duels.lignesRecompenses({ guildId: g.id, locale: "fr" }, g.id, quatrieme).join("\n")
    assert.match(lignes, new RegExp(`<@${A}> a déjà eu 3 duels récompensés contre <@${B}>`))
    assert.strictEqual(economie.compte(g.id, A).balance, 45)
    // Les duels refusés ne consomment rien : un autre adversaire reste récompensé, et la limite du jour compte 4 duels pas 5
    assert.deepStrictEqual(Object.keys((await duel(A, C)).accordees).sort(), [A, C])
    assert.strictEqual(duels.lireCompteurJour(g.id, A), 4)
    // Dans l'autre sens aussi, et le lendemain tout repart
    assert.deepStrictEqual((await duel(B, A)).limiteesAdversaire.sort(), [A, B])
    const demain = Date.now() + 36 * 3600 * 1000
    assert.deepStrictEqual(duels.reserverRecompenses(g.id, { [A]: 15 }, demain, { contre: { [A]: B } }).accordees, { [A]: 15 })
})

test("récompenses : le compteur du jour n'est consommé qu'après un crédit réussi, l'échec est journalisé", async (t) => {
    const g = creerServeur("555555555555555627")
    const erreurs = []
    const consoleErreur = console.error
    console.error = (...args) => { erreurs.push(args.join(" ")) }
    t.after(() => { console.error = consoleErreur; parties.configurerRecompenses(null) })
    // B : l'économie refuse ; C : le crédit lève une erreur ; A : tout va bien
    parties.configurerRecompenses(async (guild, userId, montant, { source }) => {
        if (userId === B) return { ok: false, refus: "gele" }
        if (userId === C) throw new Error("base en panne")
        economie.crediter(g.membres[userId], montant, { source, actif: true })
    })
    const fin = async (x, y) => {
        const { partie } = parties.creerPartie({ guildId: g.id, game: "pfc", players: [x, y], state: duels.etatInitialPfc(x, y) })
        return duels.terminerDuel(partie.id, g, { gagnants: [x], montants: duels.montantsDuel(partie, x) })
    }
    const r1 = await fin(A, B)
    assert.deepStrictEqual([Object.keys(r1.accordees), r1.echecs], [[A], [B]])
    assert.strictEqual(duels.lireCompteurJour(g.id, A), 1)
    assert.strictEqual(duels.lireCompteurJour(g.id, B), 0, "crédit refusé : rien de consommé")
    assert.match(duels.lignesRecompenses({ guildId: g.id, locale: "fr" }, g.id, r1).join("\n"), new RegExp(`<@${B}>.*pas pu être versée`))
    const r2 = await fin(A, C)
    assert.deepStrictEqual(r2.echecs, [C])
    assert.strictEqual(duels.lireCompteurJour(g.id, C), 0, "crédit en erreur : rien de consommé")
    assert.strictEqual(duels.lireCompteurJour(g.id, A), 2)
    // La limite par adversaire n'a pas non plus été consommée par les crédits échoués
    assert.strictEqual(duels.lireCompteurJour(g.id, B, Date.now(), "duels_contre:" + A), 0)
    assert.ok(erreurs.some(e => e.includes("jeu pfc") && e.includes(`membre ${B}`) && e.includes("gele")), "refus journalisé avec le membre et le jeu")
    assert.ok(erreurs.some(e => e.includes("jeu pfc") && e.includes(`membre ${C}`) && e.includes("base en panne")), "erreur journalisée avec le membre et le jeu")
})

test("morpion : si la fin du duel échoue, la partie est terminée sans récompense et le message le dit", async (t) => {
    const g = creerServeur("555555555555555628")
    brancherRecompenses()
    const erreurConsole = console.error
    console.error = () => {}
    t.after(() => { console.error = erreurConsole; parties.configurerRecompenses(null) })
    const partie = await lancerDuel(g, morpion)
    const gestionnaire = morpion.composants[0].gestionnaire
    for (const [userId, case_] of [[A, 0], [B, 3], [A, 1], [B, 4]]) await gestionnaire(null, clic(g, userId, `morpion:${partie.id}:c:${case_}`))
    g.members.fetch = () => { throw new Error("API Discord en panne") }
    const dernier = clic(g, A, `morpion:${partie.id}:c:2`)
    await gestionnaire(null, dernier)
    assert.match(dernier.finales[0].content, /gagne la partie/)
    assert.match(dernier.finales[0].content, /récompenses n'ont pas pu être versées/)
    assert.strictEqual(parties.lirePartie(partie.id).status, "finie", "plus de partie bloquée")
    assert.strictEqual(parties.partieEnCours(g.id, A), null)
    assert.strictEqual(economie.compte(g.id, A).balance, 0)
})

// --- Réaction : message, joueurs, délai ---------------------------------------------------------------------------

const attendre = ms => new Promise(resolve => setTimeout(resolve, ms))

function fauxTable(g, joueurs, editReply) {
    const interaction = { guild: g, guildId: g.id, locale: "fr", editReply }
    return { id: `t${Math.random()}`, guildId: g.id, channelId: "777", joueurs, interaction }
}

test("réaction : si le message ne peut pas être modifié, la course est annulée", async () => {
    const g = creerServeur("555555555555555629")
    const table = fauxTable(g, [A, B, C], async () => { throw new Error("message supprimé") })
    const avertir = console.warn
    console.warn = () => {}
    try {
        await reaction.demarrerCourse(table, { attenteMs: 5 })
    } finally {
        console.warn = avertir
    }
    assert.strictEqual(parties.partieEnCours(g.id, A), null, "aucune partie ne reste bloquée")
    const annulee = db.sqlAll("SELECT status FROM parties WHERE guild_id = ?", [g.id])
    assert.deepStrictEqual(annulee.map(p => p.status), ["annulee"])
})

test("réaction : un inscrit devenu sanctionné est retiré au départ ; trop peu de joueurs : course annulée", async () => {
    const g = creerServeur("555555555555555630")
    const envoyes = []
    const table = fauxTable(g, [A, B, C], async contenu => { envoyes.push(contenu); return { id: "900" } })
    g.membres[B].communicationDisabledUntilTimestamp = Date.now() + 3600 * 1000
    await reaction.demarrerCourse(table, { attenteMs: 60000 })
    assert.deepStrictEqual(db.sqlAll("SELECT players FROM parties WHERE guild_id = ?", [g.id]).map(p => JSON.parse(p.players)), [[A, C]])
    await parties.terminerPartie(parties.partieEnCours(g.id, A).id, { status: "annulee" })

    // Deux sanctionnés sur trois : il ne reste qu'un joueur
    const g2 = creerServeur("555555555555555631")
    g2.membres[B].communicationDisabledUntilTimestamp = Date.now() + 3600 * 1000
    economie.geler(g2.id, C, true)
    const finales = []
    await reaction.demarrerCourse(fauxTable(g2, [A, B, C], async contenu => { finales.push(contenu); return { id: "901" } }), { attenteMs: 5 })
    assert.match(finales[0].content, /Course annulée/)
    assert.strictEqual(db.sqlAll("SELECT COUNT(*) AS n FROM parties WHERE guild_id = ?", [g2.id])[0].n, 0)
})

test("réaction : le délai se mesure depuis le vert affiché, et un échec d'affichage du vert annule la course", async () => {
    const g = creerServeur("555555555555555632")
    let finEdition = 0
    const table = fauxTable(g, [A, B], async contenu => {
        if (contenu.components?.[0]?.components?.[0]?.data?.disabled === undefined && /CLIQUEZ/.test(JSON.stringify(contenu.components))) {
            await attendre(40)
            finEdition = Date.now()
        }
        return { id: "902" }
    })
    await reaction.demarrerCourse(table, { attenteMs: 5 })
    await attendre(120)
    const partie = parties.partieEnCours(g.id, A)
    assert.strictEqual(partie.state.phase, "vert")
    assert.ok(finEdition > 0 && partie.state.vertAt >= finEdition, "vertAt est posé après l'édition réussie")

    // Le bouton vert n'a pas pu être affiché : course annulée
    const g2 = creerServeur("555555555555555633")
    let appels = 0
    const avertir = console.warn
    console.warn = () => {}
    try {
        await reaction.demarrerCourse(fauxTable(g2, [A, B], async () => {
            if (++appels === 2) throw new Error("Discord injoignable")
            return { id: "903" }
        }), { attenteMs: 5 })
        await attendre(60)
    } finally {
        console.warn = avertir
    }
    assert.strictEqual(parties.partieEnCours(g2.id, A), null)
    assert.strictEqual(db.sqlAll("SELECT status FROM parties WHERE guild_id = ?", [g2.id])[0].status, "annulee")
})

// --- Drops : envoi raté, coffres d'avant le redémarrage ---------------------------------------------------------------

test("drops : un envoi raté ne bloque pas le salon 20 minutes ; le délai court depuis l'envoi réussi", async () => {
    const g = creerServeur("555555555555555634")
    const salon = creerSalon("333333333333333310")
    drops.definirSalonsDrops(g.id, [salon.id])
    const t0 = Math.floor(Date.now() / 3600000) * 3600000
    const envoyer = salon.send
    salon.send = async () => { throw new Error("permissions manquantes") }
    const avertir = console.warn
    console.warn = () => {}
    try {
        assert.strictEqual(await drops.peutEtreDrop(messageDans(g, salon), { aleatoire: () => 0, maintenant: t0 }), false)
    } finally {
        console.warn = avertir
    }
    // La minute suivante, le salon peut de nouveau recevoir un coffre
    salon.send = envoyer
    assert.strictEqual(await drops.peutEtreDrop(messageDans(g, salon), { aleatoire: () => 0, maintenant: t0 + 60000 }), true)
    // Et ensuite seulement, le délai de 20 minutes s'applique
    assert.strictEqual(await drops.peutEtreDrop(messageDans(g, salon), { aleatoire: () => 0, maintenant: t0 + 5 * 60000 }), false)
    assert.strictEqual(salon.envoyes.length, 1)
})

test("drops : le bouton d'un coffre d'avant le redémarrage répond « coffre fermé » (route persistante drop:)", async () => {
    const drop = require('../Commandes/Communaute/Jeux/drops')
    const route = drop.composants[0]
    assert.deepStrictEqual([route.prefixe, route.types, route.public], ["drop:", ["bouton"], true])
    assert.ok(!drops.ID_COFFRE.startsWith(route.prefixe), "les nouveaux coffres ne passent pas par cette route")
    const g = creerServeur("555555555555555635")
    const i = clic(g, B, "drop:coffre")
    const modifs = []
    i.message = { edit: async contenu => { modifs.push(contenu) } }
    await route.gestionnaire(null, i)
    assert.match(i.reponses[0].content, /coffre est fermé/)
    assert.ok(i.reponses[0].flags, "réponse éphémère")
    assert.deepStrictEqual(modifs[0].components, [])
    assert.strictEqual(economie.compte(g.id, B).balance, 0)
})
