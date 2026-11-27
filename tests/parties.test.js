process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const parties = require('../Fonctions/parties')
const evenements = require('../Fonctions/evenements')

const G = "555555555555555590"
const A = "100000000000000001", B = "100000000000000002", C = "100000000000000003", D = "100000000000000004"

test("parties (une par joueur, mises à jour concurrentes, fin unique, récompenses, événements)", async (t) => {
    const evts = []
    evenements.ecouter("partie:jouee", d => evts.push(["jouee", d.userId, d.game]))
    evenements.ecouter("partie:gagnee", d => evts.push(["gagnee", d.userId, d.game]))
    const versements = []
    parties.configurerRecompenses(async (guild, userId, montant, opts) => { versements.push([guild.id, userId, montant, opts.source]) })
    t.after(() => { evenements.retirerEcouteurs(); parties.configurerRecompenses(null) })

    // Une seule partie en cours par joueur, tous jeux confondus
    const p1 = parties.creerPartie({ guildId: G, game: "morpion", players: [A, B], state: { compteur: 0, tour: A } })
    assert.ok(p1.ok)
    assert.deepStrictEqual(p1.partie.players, [A, B])
    assert.strictEqual(p1.partie.status, "en_cours")
    const refus = parties.creerPartie({ guildId: G, game: "pfc", players: [B, C] })
    assert.deepStrictEqual([refus.ok, refus.refus, refus.partieId], [false, "deja_en_partie", p1.partie.id])
    assert.strictEqual(parties.partieEnCours(G, C), null, "rien n'a été écrit pour le joueur libre")
    assert.strictEqual(parties.partieEnCours(G, A).id, p1.partie.id)
    assert.strictEqual(parties.partieEnCours("555555555555555591", A), null, "autre serveur : pas de partie")
    assert.ok(parties.creerPartie({ guildId: G, game: "pfc", players: [C, D] }).ok)

    // Deux majPartie concurrentes : appliquées l'une après l'autre, aucune ne se perd
    const [m1, m2] = await Promise.all([
        Promise.resolve().then(() => parties.majPartie(p1.partie.id, state => ({ ...state, compteur: state.compteur + 1 }))),
        Promise.resolve().then(() => parties.majPartie(p1.partie.id, state => ({ ...state, compteur: state.compteur + 1 })))
    ])
    assert.ok(m1.ok && m2.ok)
    assert.strictEqual(parties.lirePartie(p1.partie.id).state.compteur, 2)
    assert.deepStrictEqual(parties.majPartie(99999, s => s), { ok: false, refus: "introuvable" })
    // Un transformer qui plante annule l'écriture
    assert.throws(() => parties.majPartie(p1.partie.id, () => { throw new Error("boum") }), /boum/)
    assert.strictEqual(parties.lirePartie(p1.partie.id).state.compteur, 2)
    // prolongerMs repousse l'expiration
    const avant = parties.lirePartie(p1.partie.id).expiresAt
    parties.majPartie(p1.partie.id, s => s, { prolongerMs: 60 * 60 * 1000 })
    assert.ok(parties.lirePartie(p1.partie.id).expiresAt > avant + 30 * 60 * 1000)

    // terminerPartie deux fois : un seul versement, des événements une seule fois
    const fin = await Promise.all([
        parties.terminerPartie(p1.partie.id, { gagnants: [A], recompenses: { [A]: 15, [B]: 5 } }),
        parties.terminerPartie(p1.partie.id, { gagnants: [A], recompenses: { [A]: 15, [B]: 5 } })
    ])
    assert.deepStrictEqual(fin.map(f => f.ok).sort(), [false, true])
    assert.strictEqual(fin.find(f => !f.ok).refus, "deja_terminee")
    assert.deepStrictEqual(versements, [[G, A, 15, "partie:morpion"], [G, B, 5, "partie:morpion"]])
    assert.deepStrictEqual(evts, [["jouee", A, "morpion"], ["jouee", B, "morpion"], ["gagnee", A, "morpion"]])
    assert.strictEqual(parties.lirePartie(p1.partie.id).status, "finie")
    assert.deepStrictEqual(parties.majPartie(p1.partie.id, s => s), { ok: false, refus: "terminee" })
    assert.strictEqual(parties.partieEnCours(G, A), null, "les joueurs sont libres après la fin")
    assert.deepStrictEqual(await parties.terminerPartie(99999), { ok: false, refus: "introuvable" })

    // Une fonction de récompense qui échoue ne bloque ni les autres versements ni les événements
    parties.configurerRecompenses(async () => { throw new Error("économie en panne") })
    const p2 = parties.creerPartie({ guildId: G, game: "duel", players: [A, B] }).partie
    const erreurs = []
    const log = console.error
    console.error = (...args) => erreurs.push(args.join(" "))
    evts.length = 0
    const f2 = await parties.terminerPartie(p2.id, { gagnants: [B], recompenses: { [B]: 10 } })
    console.error = log
    assert.ok(f2.ok && erreurs.length === 1)
    assert.strictEqual(evts.length, 3)
    parties.configurerRecompenses(async (guild, userId, montant) => { versements.push([guild.id, userId, montant]) })

    // Annulée : ni récompense ni événement
    const p3 = parties.creerPartie({ guildId: G, game: "duel", players: [A, B] }).partie
    versements.length = 0
    evts.length = 0
    assert.ok((await parties.terminerPartie(p3.id, { status: "annulee", recompenses: { [A]: 10 } })).ok)
    assert.deepStrictEqual([versements.length, evts.length], [0, 0])
    await assert.rejects(parties.terminerPartie(p3.id, { status: "nimportequoi" }), /statut inconnu/)

    // Abandon : l'autre joueur gagne, un non-joueur ne peut pas abandonner
    const p4 = parties.creerPartie({ guildId: G, game: "duel", players: [A, B] }).partie
    evts.length = 0
    assert.deepStrictEqual(await parties.abandonner(p4.id, C), { ok: false, refus: "pas_joueur" })
    assert.ok((await parties.abandonner(p4.id, A)).ok)
    assert.ok(evts.some(e => e[0] === "gagnee" && e[1] === B))
    assert.ok(!evts.some(e => e[0] === "gagnee" && e[1] === A))
})

test("parties (expiration au démarrage, boutons, vérification des clics)", async (t) => {
    // Plus aucune partie en cours après le test précédent, sauf celle de C et D
    const ancienne = parties.partieEnCours(G, C)
    assert.ok(ancienne)
    await parties.terminerPartie(ancienne.id, { status: "annulee" })

    // Partie dépassée avant le redémarrage + partie encore valide
    const vieille = parties.creerPartie({ guildId: G, game: "pfc", players: [A, B], dureeMs: -1000 }).partie
    parties.lierMessage(vieille.id, "777", "888")
    const valide = parties.creerPartie({ guildId: G, game: "pfc", players: [C, D] }).partie
    assert.strictEqual(parties.partieEnCours(G, A), null, "une partie dépassée ne bloque plus ses joueurs")
    assert.deepStrictEqual(parties.majPartie(vieille.id, s => s), { ok: false, refus: "terminee" })

    const versements = []
    parties.configurerRecompenses(async (...args) => { versements.push(args) })
    t.after(() => parties.configurerRecompenses(null))
    const editions = []
    const bot = {
        guilds: { cache: new Map() },
        channels: { fetch: async id => ({ messages: { fetch: async mid => ({ edit: async contenu => editions.push([id, mid, contenu]) }) } }) }
    }
    // startPartiesSchedule : le premier passage est immédiat (timer unref, il ne retient pas le processus)
    parties.startPartiesSchedule(bot)
    for (let i = 0; i < 50 && parties.lirePartie(vieille.id).status === "en_cours"; i++) await new Promise(r => setTimeout(r, 10))
    assert.strictEqual(parties.lirePartie(vieille.id).status, "expiree")
    assert.strictEqual(parties.lirePartie(valide.id).status, "en_cours", "la partie valide reste jouable")
    assert.strictEqual(versements.length, 0, "aucune récompense à l'expiration")
    await new Promise(r => setTimeout(r, 20))
    assert.deepStrictEqual(editions, [["888", "777", { content: "⌛ Partie expirée : plus personne n'a joué à temps.", components: [] }]])
    assert.strictEqual(await parties.expirerParties(bot), 0, "rien de plus à expirer")

    // verifierClic
    const clic = id => ({ user: { id } })
    const duel = parties.creerPartie({ guildId: G, game: "morpion", players: ["200000000000000001", "200000000000000002"], state: { tour: "200000000000000001" } }).partie
    assert.strictEqual(parties.verifierClic(clic("200000000000000001"), duel), null)
    assert.strictEqual(parties.verifierClic(clic("200000000000000002"), duel), "partie.pas_ton_tour")
    assert.strictEqual(parties.verifierClic(clic("200000000000000009"), duel), "partie.pas_joueur")
    const parIndex = { ...duel, state: { tour: 1 } }
    assert.strictEqual(parties.verifierClic(clic("200000000000000002"), parIndex), null, "tour donné par index")
    assert.strictEqual(parties.verifierClic(clic("200000000000000001"), parIndex), "partie.pas_ton_tour")
    assert.strictEqual(parties.verifierClic(clic("200000000000000001"), { ...duel, state: {} }), null, "sans state.tour, tous les joueurs peuvent cliquer")
    assert.strictEqual(parties.verifierClic(clic("200000000000000001"), parties.lirePartie(vieille.id)), "partie.terminee", "expirée")
    assert.strictEqual(parties.verifierClic(clic("200000000000000001"), null), "partie.terminee")
    await parties.terminerPartie(duel.id)
    assert.strictEqual(parties.verifierClic(clic("200000000000000001"), parties.lirePartie(duel.id)), "partie.terminee")
    // Joueur qui n'est pas dans la liste + partie expirée non encore balayée : la date suffit
    assert.strictEqual(parties.verifierClic(clic(C), { ...valide, expiresAt: Date.now() - 1 }), "partie.terminee")

    // customId
    const id = parties.customId(123, "jouer", 4, "x")
    assert.strictEqual(id, "p:123:jouer:4:x")
    assert.deepStrictEqual(parties.lireCustomId(id), { partieId: 123, action: "jouer", args: ["4", "x"] })
    assert.deepStrictEqual(parties.lireCustomId("p:7:abandon"), { partieId: 7, action: "abandon", args: [] })
    assert.strictEqual(parties.lireCustomId("autre:1:x"), null)
    assert.strictEqual(parties.lireCustomId("p:abc:x"), null)
    assert.ok(parties.customId(2147483647, "action", "a".repeat(60)).length <= 100)
    assert.throws(() => parties.customId(1, "a", "b".repeat(100)), /trop long/)
    assert.throws(() => parties.customId(1, "a:b"), /interdit/)
})

// --- Lot 3C : joueurs dans les événements, résultat des versements, expiration propre à un jeu, ajout de joueur ------

const G2 = "555555555555555592"

test("parties : les événements portent la liste des joueurs, les versements disent qui a été payé", async (t) => {
    const evts = []
    evenements.ecouter("partie:jouee", d => evts.push(["jouee", d]))
    evenements.ecouter("partie:gagnee", d => evts.push(["gagnee", d]))
    const log = console.error
    const erreurs = []
    console.error = (...args) => erreurs.push(args.join(" "))
    t.after(() => { console.error = log; evenements.retirerEcouteurs(); parties.configurerRecompenses(null) })
    // A est payé (retour sans résultat), B est refusé par l'économie, C fait lever une erreur
    parties.configurerRecompenses(async (guild, userId) => {
        if (userId === B) return { ok: false, refus: "gele" }
        if (userId === C) throw new Error("panne")
    })
    const p = parties.creerPartie({ guildId: G2, game: "morpion", players: [A, B, C] }).partie
    const fin = await parties.terminerPartie(p.id, { gagnants: [A], recompenses: { [A]: 15, [B]: 5, [C]: 5 } })
    assert.deepStrictEqual(Object.fromEntries(Object.entries(fin.versements).map(([u, v]) => [u, v.ok])), { [A]: true, [B]: false, [C]: false })
    assert.strictEqual(erreurs.length, 2)
    assert.ok(erreurs.every(e => e.includes("jeu morpion") && e.includes(`partie ${p.id}`)), "le jeu est dans le journal")
    assert.ok(erreurs.some(e => e.includes(`membre ${B}`)) && erreurs.some(e => e.includes(`membre ${C}`)), "le membre est dans le journal")
    assert.strictEqual(evts.length, 4)
    for (const [, donnees] of evts) assert.deepStrictEqual(donnees.players, [A, B, C])
})

test("parties : majPartie refuse une partie dépassée, sauf autoriserExpiree ; ajouterJoueur (partie ouverte)", () => {
    const p = parties.creerPartie({ guildId: G2, game: "pendu", players: [D], state: {}, dureeMs: -1000 }).partie
    assert.strictEqual(parties.majPartie(p.id, s => s).refus, "terminee")
    assert.ok(parties.majPartie(p.id, s => ({ ...s, vu: true }), { autoriserExpiree: true }).ok)
    assert.strictEqual(parties.lirePartie(p.id).state.vu, true)

    const o = parties.creerPartie({ guildId: G2, game: "pendu", players: ["300000000000000001"], state: {} }).partie
    const E = "300000000000000002", F = "300000000000000003", H = "300000000000000004"
    assert.deepStrictEqual(parties.ajouterJoueur(o.id, E).partie.players, ["300000000000000001", E])
    assert.strictEqual(parties.partieEnCours(G2, E).id, o.id, "le participant est maintenant « en partie »")
    assert.ok(parties.ajouterJoueur(o.id, E).deja, "déjà joueur : rien à faire")
    // Une partie à la fois : F est déjà dans une autre partie
    const autre = parties.creerPartie({ guildId: G2, game: "pfc", players: [F, H] }).partie
    assert.deepStrictEqual([parties.ajouterJoueur(o.id, F).refus, parties.ajouterJoueur(o.id, F).partieId], ["deja_en_partie", autre.id])
    assert.strictEqual(parties.lirePartie(o.id).players.length, 2)
    // Partie pleine, partie terminée, partie inconnue
    assert.strictEqual(parties.ajouterJoueur(o.id, "300000000000000005", { max: 2 }).refus, "complete")
    assert.strictEqual(parties.ajouterJoueur(99999, E).refus, "introuvable")
    assert.strictEqual(parties.ajouterJoueur(p.id, "300000000000000006").refus, "terminee", "partie dépassée")
})

test("parties : expiration propre à un jeu (définirExpiration), repli sans résultat si elle échoue", async (t) => {
    t.after(() => parties.definirExpiration("jeu-test", null))
    const editions = []
    const bot = { channels: { fetch: async () => ({ messages: { fetch: async () => ({ edit: async contenu => editions.push(contenu) }) } }) } }
    await parties.expirerParties(null) // parties dépassées laissées par les tests précédents
    const nouvelle = () => {
        const p = parties.creerPartie({ guildId: G2, game: "jeu-test", players: [`4000000000000000${Math.floor(Math.random() * 90 + 10)}`], dureeMs: -1000 }).partie
        parties.lierMessage(p.id, "1", "2")
        return p
    }
    // Le jeu gère l'expiration : il termine la partie et fournit le message final
    const gerees = []
    parties.definirExpiration("jeu-test", async partie => {
        gerees.push(partie.id)
        const fin = await parties.terminerPartie(partie.id, { status: "finie", gagnants: [partie.players[0]] })
        return { fait: true, partie: fin.partie, contenu: { content: "résultat", components: [] } }
    })
    const p1 = nouvelle()
    assert.strictEqual(await parties.expirerParties(bot), 1)
    assert.deepStrictEqual([gerees, parties.lirePartie(p1.id).status, editions], [[p1.id], "finie", [{ content: "résultat", components: [] }]])

    // Le gestionnaire plante : la partie expire sans résultat (jamais bloquée)
    const log = console.error
    console.error = () => {}
    parties.definirExpiration("jeu-test", async () => { throw new Error("boum") })
    const p2 = nouvelle()
    editions.length = 0
    assert.strictEqual(await parties.expirerParties(bot), 1)
    console.error = log
    assert.strictEqual(parties.lirePartie(p2.id).status, "expiree")
    assert.match(editions[0].content, /Partie expirée/)

    // Terminée ailleurs entre-temps (fait: false) : laissée telle quelle
    parties.definirExpiration("jeu-test", async partie => { await parties.terminerPartie(partie.id, { status: "finie" }); return { fait: false } })
    const p3 = nouvelle()
    assert.strictEqual(await parties.expirerParties(bot), 0)
    assert.strictEqual(parties.lirePartie(p3.id).status, "finie")
})
