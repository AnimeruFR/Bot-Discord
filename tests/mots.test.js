process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const mots = require('../Fonctions/mots')
const eco = require('../Fonctions/economie')
const parties = require('../Fonctions/parties')
const evenements = require('../Fonctions/evenements')
const motCommande = require('../Commandes/Communaute/Jeux/mot')
const penduCommande = require('../Commandes/Communaute/Jeux/pendu')

const JOUR = 24 * 3600 * 1000
const membre = (guildId, id) => ({
    id, guild: { id: guildId }, joinedTimestamp: Date.now() - 30 * JOUR, communicationDisabledUntilTimestamp: null, user: { id }
})

test("listes de mots : assez de mots, normalisés, sans doublon, dans les deux langues", () => {
    for (const langue of ["fr", "en"]) {
        const { cinq, pendu } = mots.listes(langue)
        assert.ok(cinq.length >= 300, `${langue} : ${cinq.length} mots de 5 lettres`)
        assert.ok(pendu.length >= 200, `${langue} : ${pendu.length} mots de 6 à 10 lettres`)
        assert.strictEqual(new Set(cinq).size, cinq.length)
        for (const mot of cinq) assert.ok(/^[A-Z]{5}$/.test(mot), `mot du jour invalide : ${mot}`)
        for (const mot of pendu) assert.ok(/^[A-Z]{6,10}$/.test(mot), `mot de pendu invalide : ${mot}`)
    }
    assert.strictEqual(mots.normaliser("Élève"), "ELEVE")
    assert.strictEqual(mots.normaliser("cœur"), "COEUR")
    assert.strictEqual(mots.normaliser("a-b 1"), "AB")
})

test("indices : lettres doublées (ALLER / LILAS)", () => {
    assert.deepStrictEqual(mots.evaluer("ALLER", "LILAS"), ["present", "absent", "juste", "present", "absent"])
    // Un seul L dans le mot : le deuxième L de l'essai est « absent », pas « présent »
    assert.deepStrictEqual(mots.evaluer("ABIME", "LILAS").slice(0, 3), ["absent", "present", "absent"])
    assert.deepStrictEqual(mots.evaluer("ALLER", "ALLER"), Array(5).fill("juste"))
    // La bonne place passe avant : le L bien placé consomme sa lettre
    assert.deepStrictEqual(mots.evaluer("ALLER", "LLLLL"), ["absent", "juste", "juste", "absent", "absent"])
    assert.deepStrictEqual(mots.evaluer("ABCDE", "FGHIJ"), Array(5).fill("absent"))
})

test("mot du jour : même mot toute la journée, mots différents selon le jour, bon mot dans la liste", () => {
    const G = "800000000000000001"
    assert.strictEqual(mots.motDuJour(G, "2026-11-26", "fr"), mots.motDuJour(G, "2026-11-26", "fr"))
    const jours = Array.from({ length: 10 }, (_, i) => mots.motDuJour(G, `2026-12-0${i}`, "fr"))
    assert.ok(new Set(jours).size > 5, "les jours ne donnent pas tous le même mot")
    for (const mot of jours) assert.ok(mots.listes("fr").ensemble.has(mot))
    assert.strictEqual(mots.jourPrecedent("2026-03-01"), "2026-02-28")
    assert.strictEqual(mots.jourPrecedent("2026-01-01"), "2025-12-31")
})

// Mots faux (ni le secret) à essayer
const fauxEssais = (secret, n) => mots.listes("fr").cinq.filter(m => m !== secret).slice(0, n)

test("mot du jour : refus sans coût, 6 essais, une seule partie par jour", () => {
    const G = "800000000000000002", U = "100000000000000001", jour = "2026-11-20"
    const secret = mots.motDuJour(G, jour, "fr")

    // Mot hors liste, mal formé ou déjà essayé : refusé et rien n'est écrit
    assert.deepStrictEqual(mots.proposerEssai({ guildId: G, userId: U, essai: "ZZZZZ", jour }).refus, "inconnu")
    assert.strictEqual(mots.proposerEssai({ guildId: G, userId: U, essai: "abc", jour }).refus, "longueur")
    assert.strictEqual(mots.proposerEssai({ guildId: G, userId: U, essai: "ab1de", jour }).refus, "longueur")
    assert.strictEqual(mots.etatDuJour(G, U, jour).essais.length, 0, "aucun essai consommé")
    const [premier, ...reste] = fauxEssais(secret, 6)
    assert.ok(mots.proposerEssai({ guildId: G, userId: U, essai: premier, jour }).ok)
    assert.strictEqual(mots.proposerEssai({ guildId: G, userId: U, essai: premier.toLowerCase(), jour }).refus, "deja_essaye")
    assert.strictEqual(mots.etatDuJour(G, U, jour).essais.length, 1)

    // 6 essais au plus : le sixième termine la partie, le septième est refusé
    let dernier
    for (const essai of reste.slice(0, 5)) dernier = mots.proposerEssai({ guildId: G, userId: U, essai, jour })
    assert.ok(dernier.ok && dernier.termine && !dernier.gagne)
    assert.strictEqual(dernier.etat.essais.length, 6)
    assert.strictEqual(mots.proposerEssai({ guildId: G, userId: U, essai: secret, jour }).refus, "deja_fini", "plus d'essai après la fin, même avec le bon mot")
    assert.strictEqual(mots.recompenserMot(membre(G, U), dernier), null, "pas de gain pour une défaite")

    // Une partie par jour : le lendemain, une nouvelle partie ; un autre joueur est indépendant
    assert.ok(mots.proposerEssai({ guildId: G, userId: U, essai: fauxEssais(mots.motDuJour(G, "2026-11-21", "fr"), 1)[0], jour: "2026-11-21" }).ok)
    assert.ok(mots.proposerEssai({ guildId: G, userId: "100000000000000002", essai: premier, jour }).ok)
    const lignes = require('../Fonctions/db').sqlAll("SELECT COUNT(*) AS n FROM jeux_quotidiens WHERE guild_id = ? AND user_id = ? AND game = 'mot' AND day = ?", [G, U, jour])
    assert.strictEqual(lignes[0].n, 1, "une seule ligne par jour")
})

test("mot du jour : victoire, gain selon les essais, série, grille sans le mot, événement", () => {
    const G = "800000000000000003", U = "100000000000000003", jour = "2026-11-10"
    const trouves = []
    evenements.ecouter("mot:trouve", d => trouves.push(d))

    // Jour 1 : trouvé au 3e essai
    let secret = mots.motDuJour(G, jour, "fr")
    const [a, b] = fauxEssais(secret, 2)
    mots.proposerEssai({ guildId: G, userId: U, essai: a, jour })
    mots.proposerEssai({ guildId: G, userId: U, essai: b, jour })
    const r1 = mots.proposerEssai({ guildId: G, userId: U, essai: secret, jour })
    assert.ok(r1.gagne && r1.termine)
    assert.strictEqual(r1.serie, 1)
    assert.strictEqual(mots.gainMot(1), 40)
    assert.strictEqual(mots.gainMot(6), 10)
    const gains = [1, 2, 3, 4, 5, 6].map(mots.gainMot)
    assert.deepStrictEqual([...gains].sort((x, y) => y - x), gains, "le gain ne grimpe jamais avec les essais")
    const recompense = mots.recompenserMot(membre(G, U), r1)
    assert.strictEqual(recompense.credit.credite, mots.gainMot(3))
    assert.strictEqual(eco.compte(G, U).balance, mots.gainMot(3))
    assert.deepStrictEqual(trouves.map(e => [e.guildId, e.userId, e.essais, e.serie]), [[G, U, 3, 1]])

    // Grille : seulement des carrés de couleur, jamais le mot ni ses lettres
    const grille = mots.grille(secret, r1.etat.essais)
    assert.strictEqual(grille.split("\n").length, 3)
    assert.ok(!/[A-Za-z]/.test(grille), "aucune lettre dans la grille")
    assert.strictEqual(grille.split("\n")[2], "🟩🟩🟩🟩🟩")

    // Jour suivant trouvé aussi : série de 2 ; un jour sauté : retour à 1 ; une défaite : 0
    const gagner = j => {
        const s = mots.motDuJour(G, j, "fr")
        return mots.proposerEssai({ guildId: G, userId: U, essai: s, jour: j })
    }
    assert.strictEqual(gagner("2026-11-11").serie, 2)
    assert.strictEqual(mots.serieActuelle(G, U, "2026-11-11"), 2)
    assert.strictEqual(mots.serieActuelle(G, U, "2026-11-12"), 2, "la série survit jusqu'à la fin du lendemain")
    assert.strictEqual(mots.serieActuelle(G, U, "2026-11-13"), 0, "un jour sauté casse la série")
    assert.strictEqual(gagner("2026-11-13").serie, 1)
    secret = mots.motDuJour(G, "2026-11-14", "fr")
    let dernier
    for (const essai of fauxEssais(secret, 6)) dernier = mots.proposerEssai({ guildId: G, userId: U, essai, jour: "2026-11-14" })
    assert.strictEqual(dernier.serie, 0)
    assert.strictEqual(mots.serieActuelle(G, U, "2026-11-14"), 0)
    evenements.retirerEcouteurs()
})

// --- Commandes : faux objets Discord ---------------------------------------------------------------------------

function interaction({ guildId, userId, customId = "x", values, champs, options = {} }) {
    const i = {
        guildId, channelId: "333333333333333333", locale: "fr", user: { id: userId }, member: membre(guildId, userId),
        customId, values, reponses: [], mises: [], modals: [],
        options: { getString: nom => options[nom] ?? null },
        reply: async r => { i.reponses.push(r) },
        update: async r => { i.mises.push(r) },
        showModal: async m => { i.modals.push(m) },
        fetchReply: async () => ({ id: "444444444444444444" }),
        isModalSubmit: () => champs !== undefined,
        isFromMessage: () => true,
        fields: { getTextInputValue: () => champs?.essai }
    }
    return i
}

test("/mot : refus sans coût, partie par formulaire, partage sans le mot", async () => {
    const G = "800000000000000004", U = "100000000000000004"
    const gerer = motCommande.composants[0].gestionnaire
    const secret = mots.motDuJour(G, require('../Fonctions/evenements').jourParis(), "fr")

    const clic = interaction({ guildId: G, userId: U, customId: "mot:essai" })
    await gerer(null, clic)
    assert.strictEqual(clic.modals.length, 1, "le formulaire s'ouvre")

    // Mot hors liste : refus éphémère, aucun essai noté
    const mauvais = interaction({ guildId: G, userId: U, customId: "mot:modal", champs: { essai: "zzzzz" } })
    await gerer(null, mauvais)
    assert.ok(mauvais.reponses[0].flags, "refus éphémère")
    assert.ok(mauvais.reponses[0].content.includes("liste"))
    assert.strictEqual(mots.etatDuJour(G, U).essais.length, 0)

    // Partager avant la fin : refusé
    const tot = interaction({ guildId: G, userId: U, customId: "mot:partager" })
    await gerer(null, tot)
    assert.ok(tot.reponses[0].flags)

    // Bon mot au premier essai : le panneau montre le gain, le partage ne contient pas le mot
    const bon = interaction({ guildId: G, userId: U, customId: "mot:modal", champs: { essai: secret.toLowerCase() } })
    await gerer(null, bon)
    assert.ok(bon.mises[0].content.includes("1/6"))
    assert.strictEqual(eco.compte(G, U).balance, 40)
    const apres = interaction({ guildId: G, userId: U, customId: "mot:essai" })
    await gerer(null, apres)
    assert.ok(apres.reponses[0].flags && !apres.modals.length, "partie du jour terminée : pas de nouveau formulaire")

    const partage = interaction({ guildId: G, userId: U, customId: "mot:partager" })
    await gerer(null, partage)
    assert.ok(!partage.reponses[0].flags, "le partage est public")
    assert.ok(!partage.reponses[0].content.toUpperCase().includes(secret))
    assert.ok(partage.reponses[0].content.includes("🟩🟩🟩🟩🟩"))
})

// --- Pendu -----------------------------------------------------------------------------------------------------

test("pendu : dessin, lettres et masque", () => {
    assert.strictEqual(mots.masque("MAISON", ["M", "O"]), "M _ _ _ O _")
    const etat = { mot: "MAISON", trouvees: [], ratees: [] }
    assert.deepStrictEqual(mots.jouerLettre(etat, "m"), { ok: true, lettre: "M", bonne: true, gagne: false, perdu: false })
    assert.strictEqual(mots.jouerLettre(etat, "M").refus, "deja_jouee")
    assert.strictEqual(mots.jouerLettre(etat, "é").lettre, "E")
    assert.strictEqual(mots.jouerLettre(etat, "ab").refus, "lettre")
    assert.strictEqual(etat.ratees.length, 1)
    assert.notStrictEqual(mots.dessin(0), mots.dessin(1))
    assert.ok(mots.dessin(7).includes("X"))
    assert.strictEqual(new Set(Array.from({ length: 8 }, (_, e) => mots.dessin(e))).size, 8, "un dessin différent par erreur")
})

// Lance une partie et impose le mot (le mot réel est tiré au hasard)
async function lancer(guildId, hoteId, mode, mot = "MAISON") {
    const i = interaction({ guildId, userId: hoteId, options: { action: "lancer", mode } })
    await penduCommande.run(null, i, i.options)
    const partie = parties.partieEnCours(guildId, hoteId)
    parties.majPartie(partie.id, etat => { etat.mot = mot })
    return { partie, reponse: i.reponses[0] }
}

const jouer = async (partieId, guildId, userId, lettre) => {
    const i = interaction({ guildId, userId, customId: `pendu:${partieId}:a`, values: [lettre] })
    await penduCommande.composants[0].gestionnaire(null, i)
    return i
}

test("pendu : lancement, lettre déjà jouée, victoire avec gain et événements", async () => {
    const G = "800000000000000005", H = "100000000000000005"
    const evts = []
    evenements.ecouter("partie:gagnee", d => evts.push([d.userId, d.game]))
    const { partie, reponse } = await lancer(G, H, "solo")
    assert.strictEqual(reponse.components.length, 2, "deux menus : A à M et N à Z")
    for (const rangee of reponse.components) assert.strictEqual(rangee.components[0].options.length, 13)
    assert.ok(!reponse.content.includes("MAISON") && !reponse.content.includes("M A I"), "le mot n'est pas révélé")
    assert.ok(parties.lirePartie(partie.id).messageId, "message lié pour l'expiration")
    assert.strictEqual(parties.lirePartie(partie.id).expiresAt - parties.lirePartie(partie.id).createdAt, 2 * 60 * 1000)

    // Une seule partie à la fois
    const doublon = interaction({ guildId: G, userId: H, options: { action: "lancer" } })
    await penduCommande.run(null, doublon, doublon.options)
    assert.ok(doublon.reponses[0].flags && doublon.reponses[0].content.includes("partie"))

    // Lettre déjà jouée : refusée en éphémère, pas d'erreur de plus
    await jouer(partie.id, G, H, "Z")
    const encore = await jouer(partie.id, G, H, "Z")
    assert.ok(encore.reponses[0].flags && encore.mises.length === 0)
    assert.deepStrictEqual(parties.lirePartie(partie.id).state.ratees, ["Z"])

    for (const lettre of ["M", "A", "I", "S", "O"]) await jouer(partie.id, G, H, lettre)
    const fin = await jouer(partie.id, G, H, "N")
    assert.deepStrictEqual(fin.mises[0].components, [], "plus de menu à la fin")
    assert.ok(fin.mises[0].content.includes("MAISON") && fin.mises[0].content.includes("20"))
    assert.strictEqual(parties.lirePartie(partie.id).status, "finie")
    assert.strictEqual(eco.compte(G, H).balance, mots.GAIN_PENDU)
    assert.deepStrictEqual(evts, [[H, "pendu"]])
    const apres = await jouer(partie.id, G, H, "E")
    assert.ok(apres.reponses[0].flags, "partie terminée : refusé")
    evenements.retirerEcouteurs()
})

test("pendu : défaite à 7 erreurs, sans gain", async () => {
    const G = "800000000000000006", H = "100000000000000006"
    const evts = []
    evenements.ecouter("partie:gagnee", d => evts.push(d))
    const { partie } = await lancer(G, H, "solo")
    let dernier
    for (const lettre of ["Z", "X", "Q", "W", "K", "J", "V"]) {
        assert.strictEqual(parties.lirePartie(partie.id).status, "en_cours")
        dernier = await jouer(partie.id, G, H, lettre)
    }
    assert.strictEqual(parties.lirePartie(partie.id).state.ratees.length, 7)
    assert.strictEqual(parties.lirePartie(partie.id).status, "finie")
    assert.ok(dernier.mises[0].content.includes("MAISON"), "le mot est révélé à la fin")
    assert.deepStrictEqual(dernier.mises[0].components, [])
    assert.strictEqual(eco.compte(G, H).balance, 0)
    assert.strictEqual(evts.length, 0)
    evenements.retirerEcouteurs()
})

test("pendu : mode solo refuse un autre joueur, mode ouvert l'accepte (et seul le trouveur gagne)", async () => {
    const G = "800000000000000007", H = "100000000000000007", AUTRE = "100000000000000008"
    const solo = await lancer(G, H, "solo")
    const refus = await jouer(solo.partie.id, G, AUTRE, "A")
    assert.ok(refus.reponses[0].flags && refus.reponses[0].content.includes(`<@${H}>`))
    assert.strictEqual(refus.mises.length, 0)
    assert.deepStrictEqual(parties.lirePartie(solo.partie.id).state.trouvees, [], "rien n'a été joué")
    await parties.terminerPartie(solo.partie.id, { status: "annulee" })

    const ouvert = await lancer(G, H, "ouvert", "ARBRES")
    const accepte = await jouer(ouvert.partie.id, G, AUTRE, "A")
    assert.strictEqual(accepte.mises.length, 1, "un autre joueur peut proposer une lettre")
    for (const lettre of ["R", "B", "E"]) await jouer(ouvert.partie.id, G, H, lettre)
    const fin = await jouer(ouvert.partie.id, G, AUTRE, "S")
    assert.ok(fin.mises[0].content.includes(`<@${AUTRE}>`))
    assert.strictEqual(eco.compte(G, AUTRE).balance, mots.GAIN_PENDU, "le gain va à celui qui trouve")
    assert.strictEqual(eco.compte(G, H).balance, 0)
    assert.deepStrictEqual(parties.lirePartie(ouvert.partie.id).state.participants, [H, AUTRE])
})
