process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const economie = require('../Fonctions/economie')
const mots = require('../Fonctions/mots')
const parties = require('../Fonctions/parties')
const quiz = require('../Fonctions/quiz')
const evenements = require('../Fonctions/evenements')
const commandeQuiz = require('../Commandes/Communaute/Jeux/quiz')
const commandeEnigme = require('../Commandes/Communaute/Jeux/enigme')

let compteur = 0
// Faux membre arrivé depuis longtemps (pas de réduction des 7 premiers jours)
function membre(guildId, id = null) {
    compteur++
    return {
        id: id ?? String(300000000000000000n + BigInt(compteur)), guild: { id: guildId }, user: { bot: false },
        joinedTimestamp: Date.now() - 90 * 24 * 3600 * 1000, communicationDisabledUntilTimestamp: null
    }
}
const solde = m => economie.compte(m.guild.id, m.id).balance

function interactionCommande(m, options = {}) {
    const envoyees = []
    return {
        envoyees, guildId: m.guild.id, guild: { id: m.guild.id }, channelId: "900000000000000001", locale: "fr", member: m, user: { id: m.id },
        options: { getString: nom => options[nom] ?? null },
        reply: async r => { envoyees.push(r) }, fetchReply: async () => ({ id: "800000000000000001" }), showModal: async r => { envoyees.push({ modal: r }) },
        inGuild: () => true
    }
}

function clic(m, customId) {
    const envoyees = []
    return {
        envoyees, customId, guildId: m.guild.id, guild: { id: m.guild.id }, locale: "fr", member: m, user: { id: m.id },
        update: async r => { envoyees.push({ update: r }) }, reply: async r => { envoyees.push({ reply: r }) },
        deferred: false, replied: false
    }
}

// --- Banque de questions -------------------------------------------------------------------------------------------

test("banque du quiz : forme, ids uniques, mêmes ids en français et en anglais", () => {
    const fr = quiz.banque("fr"), en = quiz.banque("en")
    assert.ok(fr.length >= 120, "au moins 120 questions")
    assert.strictEqual(en.length, fr.length)
    assert.strictEqual(new Set(fr.map(q => q.id)).size, fr.length, "ids uniques")
    assert.deepStrictEqual(en.map(q => q.id), fr.map(q => q.id), "mêmes ids dans le même ordre")
    for (const [langue, banque] of [["fr", fr], ["en", en]]) {
        for (const q of banque) {
            assert.match(q.id, /^q\d{3}$/, `id ${q.id}`)
            assert.ok(quiz.THEMES.includes(q.theme), `thème de ${q.id} (${langue})`)
            assert.ok(quiz.DIFFICULTES.includes(q.difficulte), `difficulté de ${q.id} (${langue})`)
            assert.ok(typeof q.question === "string" && q.question.length > 5, `question de ${q.id} (${langue})`)
            assert.strictEqual(q.choix.length, 4, `4 choix pour ${q.id} (${langue})`)
            assert.strictEqual(new Set(q.choix).size, 4, `choix distincts pour ${q.id} (${langue})`)
            for (const c of q.choix) assert.ok(typeof c === "string" && c.length > 0 && c.length <= 70, `choix de ${q.id} (${langue})`)
            assert.ok(Number.isInteger(q.reponse) && q.reponse >= 0 && q.reponse < 4, `index de ${q.id} (${langue})`)
        }
    }
    fr.forEach((q, i) => {
        assert.strictEqual(en[i].theme, q.theme)
        assert.strictEqual(en[i].difficulte, q.difficulte)
        assert.strictEqual(en[i].reponse, q.reponse, `même bonne réponse pour ${q.id}`)
    })
    for (const difficulte of quiz.DIFFICULTES) assert.ok(fr.filter(q => q.difficulte === difficulte).length >= 35, `assez de questions ${difficulte}`)
    for (const theme of quiz.THEMES) assert.ok(fr.filter(q => q.theme === theme).length >= 10, `assez de questions ${theme}`)
})

test("banque des énigmes : au moins 40, ids uniques, réponses non vides dans les deux langues", () => {
    const liste = quiz.enigmes()
    assert.ok(liste.length >= 40)
    assert.strictEqual(new Set(liste.map(e => e.id)).size, liste.length)
    for (const e of liste) {
        for (const langue of ["fr", "en"]) {
            assert.ok(e[langue].enigme.length > 10, `texte de ${e.id} (${langue})`)
            assert.ok(e[langue].reponses.length >= 1, `réponses de ${e.id} (${langue})`)
            for (const r of e[langue].reponses) assert.ok(quiz.normaliser(r), `réponse vide normalisée pour ${e.id}`)
        }
        assert.ok(quiz.reponseCorrecte(e, e.fr.reponses[0]) && quiz.reponseCorrecte(e, e.en.reponses[0]), `${e.id} accepte sa 1re réponse`)
    }
})

// --- Quiz ----------------------------------------------------------------------------------------------------------

function positionDe(debut, bonne) {
    const indiceBonne = debut.question.reponse
    const position = debut.ordre.indexOf(indiceBonne)
    return bonne ? position : (position + 1) % 4
}

test("quiz : le gain suit la difficulté (10, 20, 40) et l'événement est émis", async () => {
    const G = "100000000000000011"
    const vus = []
    evenements.ecouter("quiz:bonne_reponse", d => vus.push(d))
    for (const [difficulte, gain] of [["facile", 10], ["moyen", 20], ["difficile", 40]]) {
        const m = membre(G)
        const debut = quiz.demarrerQuiz(m, { difficulte, langue: "fr" })
        assert.ok(debut.ok, difficulte)
        assert.strictEqual(debut.partie.state.difficulte, difficulte)
        const reponse = quiz.repondreQuiz(debut.partie.id, positionDe(debut, true))
        assert.ok(reponse.ok && reponse.bonne)
        const fin = await quiz.conclureQuiz(m, debut.partie.id, reponse)
        assert.strictEqual(fin.credite, gain, `gain ${difficulte}`)
        assert.strictEqual(solde(m), gain)
        assert.strictEqual(parties.lirePartie(debut.partie.id).status, "finie")
    }
    assert.deepStrictEqual(vus.filter(v => v.guildId === G).map(v => v.gain), [10, 20, 40])
})

test("quiz : une mauvaise réponse ne rapporte rien et n'émet rien", async () => {
    const G = "100000000000000012"
    const vus = []
    evenements.ecouter("quiz:bonne_reponse", d => { if (d.guildId === G) vus.push(d) })
    const m = membre(G)
    const debut = quiz.demarrerQuiz(m, { theme: "sport", difficulte: "difficile" })
    const reponse = quiz.repondreQuiz(debut.partie.id, positionDe(debut, false))
    assert.ok(reponse.ok && !reponse.bonne)
    const fin = await quiz.conclureQuiz(m, debut.partie.id, reponse)
    assert.strictEqual(fin.credite, 0)
    assert.strictEqual(solde(m), 0)
    assert.strictEqual(vus.length, 0)
    // La partie est finie : le joueur peut en relancer une
    assert.ok(quiz.demarrerQuiz(m, {}).ok)
})

test("quiz : un seul clic compte, même si deux arrivent en même temps", async () => {
    const G = "100000000000000013"
    const m = membre(G)
    const debut = quiz.demarrerQuiz(m, { difficulte: "moyen" })
    const bonne = positionDe(debut, true), mauvaise = positionDe(debut, false)
    const id = debut.partie.id
    await Promise.all([
        commandeQuiz.composants[0].gestionnaire(null, clic(m, `quiz:${id}:${bonne}`)),
        commandeQuiz.composants[0].gestionnaire(null, clic(m, `quiz:${id}:${mauvaise}`))
    ])
    assert.strictEqual(solde(m), 20, "le gain n'est versé qu'une fois")
    const apres = parties.lirePartie(id)
    assert.strictEqual(apres.state.reponse, bonne, "la première réponse est celle qui compte")
    // Une réponse tardive est refusée
    assert.deepStrictEqual(quiz.repondreQuiz(id, mauvaise), { ok: false, refus: "terminee" })
})

test("quiz : le deuxième clic reçoit un refus éphémère et ne change rien", async () => {
    const G = "100000000000000014"
    const m = membre(G)
    const debut = quiz.demarrerQuiz(m, {})
    const premier = clic(m, `quiz:${debut.partie.id}:${positionDe(debut, false)}`)
    const second = clic(m, `quiz:${debut.partie.id}:${positionDe(debut, true)}`)
    await commandeQuiz.composants[0].gestionnaire(null, premier)
    await commandeQuiz.composants[0].gestionnaire(null, second)
    assert.ok(premier.envoyees[0].update, "le premier clic met le message à jour")
    assert.ok(second.envoyees[0].reply.flags, "le second clic est refusé en éphémère")
    assert.strictEqual(solde(m), 0, "la première réponse était fausse : pas de rattrapage")
})

test("quiz : un autre membre ne peut pas répondre à la partie", async () => {
    const G = "100000000000000015"
    const joueur = membre(G), curieux = membre(G)
    const debut = quiz.demarrerQuiz(joueur, {})
    const tentative = clic(curieux, `quiz:${debut.partie.id}:${positionDe(debut, true)}`)
    await commandeQuiz.composants[0].gestionnaire(null, tentative)
    assert.ok(tentative.envoyees[0].reply.flags, "refus éphémère")
    assert.strictEqual(parties.lirePartie(debut.partie.id).state.reponse, undefined)
    assert.strictEqual(solde(curieux), 0)
})

test("quiz : une seule partie à la fois, et la langue de la question suit le membre", () => {
    const G = "100000000000000016"
    const m = membre(G)
    const en = quiz.demarrerQuiz(m, { langue: "en", theme: "arts" })
    assert.ok(en.ok)
    assert.strictEqual(en.question.question, quiz.banque("en").find(q => q.id === en.question.id).question)
    assert.deepStrictEqual(quiz.demarrerQuiz(m, {}).refus, "deja_en_partie")
    const fr = quiz.demarrerQuiz(membre(G), { langue: "fr", theme: "arts" })
    assert.strictEqual(fr.question.question, quiz.banque("fr").find(q => q.id === fr.question.id).question)
})

test("quiz : l'ordre des boutons est mélangé mais couvre les 4 choix", () => {
    const vus = new Set()
    for (let i = 0; i < 40; i++) {
        const ordre = quiz.melanger()
        assert.deepStrictEqual([...ordre].sort(), [0, 1, 2, 3])
        vus.add(ordre.join(""))
    }
    assert.ok(vus.size > 1, "l'ordre change d'une partie à l'autre")
})

test("/quiz : réponse publique à 4 boutons, partie de 30 secondes liée au message, délai rendu si refus", async () => {
    const G = "100000000000000017"
    const m = membre(G)
    const i = interactionCommande(m, { theme: "nature", difficulte: "facile" })
    await commandeQuiz.run(null, i, i.options)
    const envoi = i.envoyees[0]
    assert.ok(!envoi.flags, "message public")
    assert.strictEqual(envoi.components[0].components.length, 4)
    for (const bouton of envoi.components[0].components) assert.match(bouton.data.custom_id, /^quiz:\d+:[0-3]$/)
    const partie = parties.partieEnCours(G, m.id)
    assert.strictEqual(partie.messageId, "800000000000000001")
    assert.ok(partie.expiresAt - partie.createdAt <= 30000 + 50)
    assert.strictEqual(commandeQuiz.cooldown, 20)
    // Déjà en partie : refus éphémère
    const deuxieme = interactionCommande(m, {})
    await commandeQuiz.run(null, deuxieme, deuxieme.options)
    assert.ok(deuxieme.envoyees[0].flags)
    // Membre gelé : refus, aucune partie créée
    const gele = membre(G)
    economie.geler(G, gele.id, true)
    const refus = interactionCommande(gele, {})
    await commandeQuiz.run(null, refus, refus.options)
    assert.ok(refus.envoyees[0].flags)
    assert.strictEqual(parties.partieEnCours(G, gele.id), null)
})

// --- Énigme du jour ------------------------------------------------------------------------------------------------

test("énigmes : normalisation des réponses (casse, accents, articles, ponctuation)", () => {
    const n = quiz.normaliser
    assert.strictEqual(n("  L'Éponge !  "), "eponge")
    assert.strictEqual(n("UNE ÉPONGE"), "eponge")
    assert.strictEqual(n("œuf"), "oeuf")
    assert.strictEqual(n("Glaçon"), "glacon")
    assert.strictEqual(n("The   Moon."), "moon")
    assert.strictEqual(n("m"), "m", "une lettre seule reste telle quelle")
    assert.strictEqual(n("a"), "a", "un article seul reste la réponse")
    assert.strictEqual(n(""), "")
    assert.strictEqual(n(null), "")
    const e = quiz.enigmes().find(x => x.fr.reponses.includes("éponge"))
    assert.ok(quiz.reponseCorrecte(e, "EPONGE"))
    assert.ok(quiz.reponseCorrecte(e, "une éponge"))
    assert.ok(quiz.reponseCorrecte(e, "Sponge"), "la réponse anglaise est acceptée aussi")
    assert.ok(!quiz.reponseCorrecte(e, "éponges de mer"))
    assert.ok(!quiz.reponseCorrecte(e, "   "))
})

test("énigme du jour : stable dans la journée, jamais deux jours de suite la même, pas la même partout", () => {
    const G = "100000000000000021"
    const a = quiz.enigmeDuJour(G, "2026-11-26")
    assert.strictEqual(quiz.enigmeDuJour(G, "2026-11-26").id, a.id)
    const jours = Array.from({ length: 60 }, (_, k) => new Date(Date.UTC(2027, 0, 1 + k)).toISOString().slice(0, 10))
    const suite = jours.map(jour => quiz.enigmeDuJour(G, jour).id)
    assert.ok(new Set(suite).size > 25, "les jours donnent des énigmes variées")
    for (let k = 1; k < suite.length; k++) assert.notStrictEqual(suite[k], suite[k - 1], "pas deux fois de suite la même")
    const autre = jours.map(jour => quiz.enigmeDuJour("100000000000000099", jour).id)
    assert.notDeepStrictEqual(autre, suite, "pas la même suite sur tous les serveurs")
})

test("énigme du jour et mot du jour : imprévisibles sans le sel secret", () => {
    const G = "100000000000000023", jours = Array.from({ length: 20 }, (_, k) => `2027-02-${String(k + 1).padStart(2, "0")}`)
    const ancien = process.env.JEUX_SEL
    try {
        process.env.JEUX_SEL = "sel-un"
        const enigmesUn = jours.map(jour => quiz.enigmeDuJour(G, jour).id), motsUn = jours.map(jour => mots.motDuJour(G, jour, "fr"))
        assert.deepStrictEqual(jours.map(jour => quiz.enigmeDuJour(G, jour).id), enigmesUn, "même sel : même résultat")
        process.env.JEUX_SEL = "sel-deux"
        assert.notDeepStrictEqual(jours.map(jour => quiz.enigmeDuJour(G, jour).id), enigmesUn, "autre sel : autres énigmes")
        assert.notDeepStrictEqual(jours.map(jour => mots.motDuJour(G, jour, "fr")), motsUn, "autre sel : autres mots")
    } finally {
        if (ancien === undefined) delete process.env.JEUX_SEL
        else process.env.JEUX_SEL = ancien
    }
})

test("sel des jeux : créé au hasard à côté de la base, relu ensuite, jamais écrasé ; variable d'environnement prioritaire", () => {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "sel-jeux-"))
    try {
        const fichier = path.join(dossier, "sel-jeux.txt")
        const sel = mots.lireOuCreerSel(fichier)
        assert.match(sel, /^[0-9a-f]{64}$/)
        assert.strictEqual(fs.readFileSync(fichier, "utf8").trim(), sel)
        assert.strictEqual(mots.lireOuCreerSel(fichier), sel, "relu, pas régénéré")
    } finally {
        fs.rmSync(dossier, { recursive: true, force: true })
    }
    // Base en mémoire : sel en mémoire, stable pendant le processus, aucun fichier créé
    const ancien = process.env.JEUX_SEL
    delete process.env.JEUX_SEL
    try {
        assert.match(mots.selJeux(), /^[0-9a-f]{64}$/)
        assert.strictEqual(mots.selJeux(), mots.selJeux())
        process.env.JEUX_SEL = "force"
        assert.strictEqual(mots.selJeux(), "force")
    } finally {
        if (ancien === undefined) delete process.env.JEUX_SEL
        else process.env.JEUX_SEL = ancien
    }
})

function reponseJuste(guildId, jour) {
    return quiz.enigmeDuJour(guildId, jour).fr.reponses[0]
}

test("énigme : les 3 premiers gagnent 40/30/20, ensuite 10, même quand les réponses arrivent en même temps", async () => {
    const G = "100000000000000022"
    const jour = evenements.jourParis()
    const membres = Array.from({ length: 6 }, () => membre(G))
    const vus = []
    evenements.ecouter("enigme:trouvee", d => { if (d.guildId === G) vus.push(d) })
    const resultats = await Promise.all(membres.map(async m => quiz.repondreEnigme(m, reponseJuste(G, jour), jour)))
    const rangs = resultats.map(r => r.rang).sort((x, y) => x - y)
    assert.deepStrictEqual(rangs, [1, 2, 3, 4, 5, 6], "rangs tous différents, sans trou")
    for (const r of resultats) assert.strictEqual(r.credite, [40, 30, 20, 10, 10, 10][r.rang - 1])
    resultats.forEach((r, i) => assert.strictEqual(solde(membres[i]), r.credite))
    assert.strictEqual(quiz.nombreTrouveurs(G, jour), 6)
    assert.strictEqual(vus.length, 6)
    assert.deepStrictEqual(vus.map(v => v.rang).sort((x, y) => x - y), [1, 2, 3, 4, 5, 6])
})

test("énigme : le classement passe aussi par le formulaire, avec 4 envois simultanés", async () => {
    const G = "100000000000000023"
    const jour = evenements.jourParis()
    const membres = Array.from({ length: 4 }, () => membre(G))
    const envois = membres.map(m => ({
        ...interactionCommande(m), customId: `enigme:${jour}`, fields: { getTextInputValue: () => `Une ${reponseJuste(G, jour)}` }
    }))
    await Promise.all(envois.map(i => commandeEnigme.composants[0].gestionnaire(null, i)))
    const gains = membres.map(solde).sort((x, y) => y - x)
    assert.deepStrictEqual(gains, [40, 30, 20, 10])
    for (const i of envois) assert.ok(!i.envoyees[0].flags, "annonce publique, sans la réponse")
})

test("énigme : 3 essais par jour et par membre, puis refus ; une mauvaise réponse ne rapporte rien", () => {
    const G = "100000000000000024"
    const jour = evenements.jourParis()
    const m = membre(G)
    const r1 = quiz.repondreEnigme(m, "mauvaise reponse", jour)
    assert.strictEqual(r1.etat, "ratee")
    assert.strictEqual(r1.restants, 2)
    assert.strictEqual(quiz.repondreEnigme(m, "encore faux", jour).restants, 1)
    assert.strictEqual(quiz.repondreEnigme(m, "toujours faux", jour).restants, 0)
    assert.strictEqual(quiz.repondreEnigme(m, reponseJuste(G, jour), jour).etat, "plus_essais", "même la bonne réponse arrive trop tard")
    assert.strictEqual(solde(m), 0)
    assert.strictEqual(quiz.etatEnigme(G, m.id, jour).essais, 3)
    // Le lendemain, 3 nouveaux essais
    assert.strictEqual(quiz.repondreEnigme(m, "faux", "2099-01-02").etat, "ratee")
})

test("énigme : une fois trouvée, plus d'essai ni de second gain ; réponse vide sans essai consommé", () => {
    const G = "100000000000000025"
    const jour = evenements.jourParis()
    const m = membre(G)
    assert.strictEqual(quiz.repondreEnigme(m, "   ", jour).etat, "vide")
    assert.strictEqual(quiz.etatEnigme(G, m.id, jour).essais, 0)
    const trouvee = quiz.repondreEnigme(m, reponseJuste(G, jour), jour)
    assert.strictEqual(trouvee.credite, 40)
    assert.strictEqual(quiz.repondreEnigme(m, reponseJuste(G, jour), jour).etat, "deja_trouvee")
    assert.strictEqual(solde(m), 40)
    assert.deepStrictEqual(quiz.etatEnigme(G, m.id, jour), { essais: 1, restants: 2, trouvee: true, rang: 1 })
})

test("énigme : les rangs sont propres à chaque serveur ; un membre gelé ne perd pas d'essai", () => {
    const jour = evenements.jourParis()
    const a = membre("100000000000000026"), b = membre("100000000000000027")
    assert.strictEqual(quiz.repondreEnigme(a, reponseJuste(a.guild.id, jour), jour).rang, 1)
    assert.strictEqual(quiz.repondreEnigme(b, reponseJuste(b.guild.id, jour), jour).rang, 1, "premier sur son serveur")
    const gele = membre("100000000000000026")
    economie.geler(gele.guild.id, gele.id, true)
    assert.strictEqual(quiz.repondreEnigme(gele, reponseJuste(gele.guild.id, jour), jour).etat, "refus")
    assert.strictEqual(quiz.etatEnigme(gele.guild.id, gele.id, jour).essais, 0)
})

test("/enigme : voir répond en éphémère, répondre ouvre le formulaire daté du jour", async () => {
    const G = "100000000000000028"
    const m = membre(G)
    const voir = interactionCommande(m, { action: "voir" })
    await commandeEnigme.run(null, voir, voir.options)
    assert.ok(voir.envoyees[0].flags)
    assert.ok(voir.envoyees[0].content.includes(quiz.enigmeDuJour(G).fr.enigme))
    const repondre = interactionCommande(m, { action: "repondre" })
    await commandeEnigme.run(null, repondre, repondre.options)
    assert.strictEqual(repondre.envoyees[0].modal.data.custom_id, `enigme:${evenements.jourParis()}`)
    // Formulaire resté ouvert d'un jour à l'autre : refusé, aucun essai consommé
    const ancien = { ...interactionCommande(m), customId: "enigme:2000-01-01", fields: { getTextInputValue: () => "x" } }
    await commandeEnigme.composants[0].gestionnaire(null, ancien)
    assert.ok(ancien.envoyees[0].flags)
    assert.strictEqual(quiz.etatEnigme(G, m.id).essais, 0)
})

// --- Limites du jour : questions déjà vues, 8 quiz répondus ------------------------------------------------------

async function jouerQuiz(m, options = {}) {
    const debut = quiz.demarrerQuiz(m, { langue: "fr", hasard: () => 0, ...options })
    if (!debut.ok) return debut
    const reponse = quiz.repondreQuiz(debut.partie.id, positionDe(debut, true))
    return { ...debut, fin: await quiz.conclureQuiz(m, debut.partie.id, reponse) }
}

test("quiz : une question déjà vue aujourd'hui n'est jamais reposée au même membre", async () => {
    const G = "100000000000000031"
    const m = membre(G), autre = membre(G)
    // hasard toujours à 0 : sans exclusion, ce serait toujours la même question
    const ids = []
    for (let n = 0; n < 5; n++) {
        const r = await jouerQuiz(m, { theme: "sciences", difficulte: "facile" })
        assert.ok(r.ok, `quiz ${n + 1}`)
        ids.push(r.partie.state.qid)
    }
    assert.strictEqual(new Set(ids).size, 5, "cinq questions différentes")
    assert.deepStrictEqual(quiz.etatQuizJour(G, m.id).vues.sort(), [...ids].sort())
    // Les 5 questions sciences/facile sont toutes vues
    const plus = quiz.demarrerQuiz(m, { theme: "sciences", difficulte: "facile", hasard: () => 0 })
    assert.deepStrictEqual([plus.ok, plus.refus], [false, "toutes_vues"])
    assert.strictEqual(parties.partieEnCours(G, m.id), null, "aucune partie créée par le refus")
    // Un autre thème reste possible ; un autre membre a ses propres questions vues ; le lendemain, tout est de nouveau permis
    assert.ok(quiz.demarrerQuiz(m, { theme: "histoire", difficulte: "facile", hasard: () => 0 }).ok)
    await parties.terminerPartie(parties.partieEnCours(G, m.id).id, { status: "annulee" })
    assert.strictEqual((await jouerQuiz(autre, { theme: "sciences", difficulte: "facile" })).partie.state.qid, ids[0])
    const demain = new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10)
    assert.ok(quiz.demarrerQuiz(m, { theme: "sciences", difficulte: "facile", hasard: () => 0, jour: demain }).ok)
    await parties.terminerPartie(parties.partieEnCours(G, m.id).id, { status: "annulee" })
    // Combinaison sans question : refus distinct
    assert.strictEqual(quiz.demarrerQuiz(m, { theme: "inconnu", hasard: () => 0 }).refus, "aucune_question")
})

test("quiz : une question laissée expirer compte comme vue", async () => {
    const G = "100000000000000032"
    const m = membre(G)
    const debut = quiz.demarrerQuiz(m, { theme: "arts", difficulte: "moyen", hasard: () => 0 })
    await parties.terminerPartie(debut.partie.id, { status: "expiree" })
    const suite = quiz.demarrerQuiz(m, { theme: "arts", difficulte: "moyen", hasard: () => 0 })
    assert.notStrictEqual(suite.partie.state.qid, debut.partie.state.qid)
    await parties.terminerPartie(suite.partie.id, { status: "annulee" })
})

test("quiz : au plus 8 quiz par jour et par membre, réponses fausses comprises", async () => {
    const G = "100000000000000033"
    const m = membre(G)
    economie.definirReglages(G, { plafondJour: 2000 })
    assert.strictEqual(quiz.MAX_QUIZ_JOUR, 8)
    let bonnes = 0, fausses = 0
    for (let n = 0; n < quiz.MAX_QUIZ_JOUR; n++) {
        const debut = quiz.demarrerQuiz(m, { hasard: () => (n + 0.5) / 20 })
        assert.ok(debut.ok, `quiz ${n + 1}`)
        // Une réponse sur deux est fausse : elle compte autant dans la limite
        const juste = n % 2 === 0
        const fin = await quiz.conclureQuiz(m, debut.partie.id, quiz.repondreQuiz(debut.partie.id, positionDe(debut, juste)))
        assert.strictEqual(fin.bonne, juste)
        if (fin.bonne) bonnes++
        else fausses++
    }
    assert.deepStrictEqual([bonnes, fausses], [4, 4])
    assert.strictEqual(quiz.etatQuizJour(G, m.id).recompenses, 8)
    const neuvieme = quiz.demarrerQuiz(m, { hasard: () => 0.5 })
    assert.deepStrictEqual([neuvieme.ok, neuvieme.refus], [false, "limite_jour"])
    // Un autre membre n'est pas touché
    const autre = quiz.demarrerQuiz(membre(G), { hasard: () => 0.5 })
    assert.ok(autre.ok)
    await parties.terminerPartie(autre.partie.id, { status: "annulee" })
    // Le message de refus de la commande
    const i = interactionCommande(m)
    await commandeQuiz.run(null, i, i.options)
    assert.match(i.envoyees[0].content, /8 quiz/)
})

test("quiz : une question laissée sans réponse ne compte pas dans la limite du jour", async () => {
    const G = "100000000000000035"
    const m = membre(G)
    const debut = quiz.demarrerQuiz(m, { hasard: () => 0 })
    await parties.terminerPartie(debut.partie.id, { status: "expiree" })
    assert.strictEqual(quiz.etatQuizJour(G, m.id).recompenses, 0)
})

test("quiz : un gain refusé par l'économie ne compte pas dans la limite du jour", async () => {
    const G = "100000000000000034"
    const m = membre(G)
    const debut = quiz.demarrerQuiz(m, { hasard: () => 0 })
    const reponse = quiz.repondreQuiz(debut.partie.id, positionDe(debut, true))
    economie.geler(G, m.id, true)
    const fin = await quiz.conclureQuiz(m, debut.partie.id, reponse)
    assert.ok(fin.refusEco)
    assert.strictEqual(quiz.etatQuizJour(G, m.id).recompenses, 0)
    economie.geler(G, m.id, false)
})
