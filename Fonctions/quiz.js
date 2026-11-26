const fs = require('fs')
const path = require('path')
const db = require('./db')
const economie = require('./economie')
const parties = require('./parties')
const { emettre, jourParis } = require('./evenements')

// Quiz (idée #46) et énigme du jour (idée #48). Les questions et les énigmes sont dans data-statique/ (JSON).
// Le quiz passe par le moteur de parties (une partie, un joueur, 30 s) ; l'énigme par la table jeux_quotidiens.
// Événements émis : quiz:bonne_reponse (theme, difficulte, gain), enigme:trouvee (rang, gain, essais).

const THEMES = ["sciences", "histoire", "geographie", "langue", "nature", "arts", "sport", "technologie"]
const DIFFICULTES = ["facile", "moyen", "difficile"]
const GAINS_QUIZ = { facile: 10, moyen: 20, difficile: 40 }
const DUREE_QUIZ_MS = 30 * 1000
const NB_CHOIX = 4

const GAINS_ENIGME = [40, 30, 20]
const GAIN_ENIGME_DEFAUT = 10
const ESSAIS_ENIGME = 3
const JEU_ENIGME = "enigme"

const DOSSIER = path.join(__dirname, '..', 'data-statique')

// --- Banques de données (lues une seule fois) ---------------------------------------------------------------------

const caches = {}
function lireJson(nom) {
    caches[nom] ??= JSON.parse(fs.readFileSync(path.join(DOSSIER, nom), 'utf8'))
    return caches[nom]
}

const langueBanque = langue => langue === "en" ? "en" : "fr"
const banque = langue => lireJson(`quiz/${langueBanque(langue)}.json`)
const enigmes = () => lireJson('enigmes.json')

// --- Quiz ----------------------------------------------------------------------------------------------------------

// Tire une question (les filtres sont facultatifs). Renvoie null si aucune ne correspond.
function tirerQuestion({ theme = null, difficulte = null } = {}, hasard = Math.random) {
    const candidates = banque("fr").filter(q => (!theme || q.theme === theme) && (!difficulte || q.difficulte === difficulte))
    return candidates.length ? candidates[Math.floor(hasard() * candidates.length)] : null
}

const questionLocalisee = (id, langue) => banque(langue).find(q => q.id === id) ?? null

// Ordre d'affichage des 4 choix (mélange de Fisher-Yates) : ordre[i] = indice du choix affiché en position i
function melanger(hasard = Math.random) {
    const ordre = Array.from({ length: NB_CHOIX }, (_, i) => i)
    for (let i = ordre.length - 1; i > 0; i--) {
        const j = Math.floor(hasard() * (i + 1))
        const memo = ordre[i]
        ordre[i] = ordre[j]
        ordre[j] = memo
    }
    return ordre
}

// Lance une partie de quiz pour un membre. Renvoie { ok, partie, question, ordre } ou { ok: false, refus }.
function demarrerQuiz(member, { theme = null, difficulte = null, langue = "fr", channelId = null, hasard = Math.random } = {}) {
    const refus = economie.peutJouer(member)
    if (refus) return { ok: false, refus }
    const question = tirerQuestion({ theme, difficulte }, hasard)
    if (!question) return { ok: false, refus: "aucune_question" }
    const ordre = melanger(hasard)
    const etat = { qid: question.id, ordre, langue: langueBanque(langue), theme: question.theme, difficulte: question.difficulte, gain: GAINS_QUIZ[question.difficulte] }
    const creation = parties.creerPartie({ guildId: member.guild.id, game: "quiz", channelId, players: [member.id], state: etat, dureeMs: DUREE_QUIZ_MS })
    if (!creation.ok) return { ok: false, refus: creation.refus }
    return { ok: true, partie: creation.partie, question: questionLocalisee(question.id, etat.langue), ordre }
}

// Enregistre la réponse choisie (position affichée). Une seule réponse compte : la première, même si deux clics
// arrivent en même temps (majPartie lit et écrit dans la même transaction).
function repondreQuiz(partieId, position) {
    if (!Number.isInteger(position) || position < 0 || position >= NB_CHOIX) return { ok: false, refus: "position" }
    let premier = false
    const resultat = parties.majPartie(partieId, etat => {
        if (etat.reponse !== undefined) return
        etat.reponse = position
        premier = true
    })
    if (!resultat.ok) return { ok: false, refus: "terminee" }
    if (!premier) return { ok: false, refus: "deja_repondu" }
    const etat = resultat.partie.state
    const question = questionLocalisee(etat.qid, etat.langue)
    return { ok: true, bonne: etat.ordre[position] === question.reponse, question, etat }
}

// Termine la partie, verse le gain d'une bonne réponse (gain « actif », donc plafonné) et annonce l'événement.
async function conclureQuiz(member, partieId, reponse) {
    const { bonne, etat } = reponse
    const fin = await parties.terminerPartie(partieId, { status: "finie", gagnants: bonne ? [member.id] : [] })
    if (!fin.ok) return { ok: false, refus: "terminee" }
    const resultat = { ok: true, bonne, gain: 0, credite: 0, plafonne: false, refusEco: null }
    if (!bonne) return resultat
    const credit = economie.crediter(member, etat.gain, { source: "quiz", actif: true, details: { theme: etat.theme, difficulte: etat.difficulte } })
    if (credit.ok) {
        resultat.credite = credit.credite
        resultat.plafonne = credit.plafonne
    } else {
        resultat.refusEco = credit.refus
    }
    resultat.gain = etat.gain
    emettre("quiz:bonne_reponse", { guildId: member.guild.id, userId: member.id, theme: etat.theme, difficulte: etat.difficulte, gain: resultat.credite })
    return resultat
}

// --- Énigme du jour ------------------------------------------------------------------------------------------------

// Minuscules, sans accents ni ponctuation, sans article au début : « L'Éponge ! » -> « eponge »
const ARTICLES = new Set(["le", "la", "les", "l", "un", "une", "des", "du", "the", "a", "an"])
function normaliser(texte) {
    const mots = String(texte ?? "")
        .toLowerCase()
        .replaceAll("œ", "oe").replaceAll("æ", "ae")
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim().split(" ").filter(Boolean)
    // Un mot seul (« a », « m ») reste tel quel : c'est peut-être la réponse
    while (mots.length > 1 && ARTICLES.has(mots[0])) mots.shift()
    return mots.join(" ")
}

// Même énigme toute la journée sur un serveur, différente d'un jour à l'autre, et pas la même sur tous les serveurs
function enigmeDuJour(guildId, jour = jourParis()) {
    const liste = enigmes()
    const [annee, mois, j] = jour.split("-").map(Number)
    const numero = Math.floor(Date.UTC(annee, mois - 1, j) / 86400000)
    let decalage = 0
    for (const c of String(guildId)) decalage = (decalage * 31 + c.charCodeAt(0)) % 100003
    return liste[(numero + decalage) % liste.length]
}

// La réponse peut être donnée dans l'une ou l'autre langue
function reponseCorrecte(enigme, reponse) {
    const donnee = normaliser(reponse)
    if (!donnee) return false
    return [...enigme.fr.reponses, ...enigme.en.reponses].some(r => normaliser(r) === donnee)
}

const gainEnigme = rang => GAINS_ENIGME[rang - 1] ?? GAIN_ENIGME_DEFAUT

function etatEnigme(guildId, userId, jour = jourParis()) {
    const ligne = db.sqlAll("SELECT state, finished FROM jeux_quotidiens WHERE guild_id = ? AND user_id = ? AND game = ? AND day = ?",
        [guildId, userId, JEU_ENIGME, jour])[0]
    const etat = ligne ? JSON.parse(ligne.state) : {}
    return { essais: etat.essais ?? 0, restants: Math.max(0, ESSAIS_ENIGME - (etat.essais ?? 0)), trouvee: ligne?.finished === 1, rang: etat.rang ?? null }
}

const nombreTrouveurs = (guildId, jour = jourParis()) =>
    db.sqlAll("SELECT COUNT(*) AS n FROM jeux_quotidiens WHERE guild_id = ? AND game = ? AND day = ? AND finished = 1", [guildId, JEU_ENIGME, jour])[0].n

// Un essai. Tout se passe dans une transaction (BEGIN IMMEDIATE) : le nombre d'essais, la fin de l'énigme et le rang
// d'arrivée sont lus et écrits ensemble, donc deux bonnes réponses simultanées n'ont jamais le même rang.
// Renvoie { etat: "trouvee" | "ratee" | "deja_trouvee" | "plus_essais" | "vide", essais, restants, rang }.
function tenterEnigme(guildId, userId, reponse, jour = jourParis()) {
    if (!normaliser(reponse)) return { etat: "vide" }
    const enigme = enigmeDuJour(guildId, jour)
    return db.transaction(() => {
        const ligne = db.sqlAll("SELECT state, finished FROM jeux_quotidiens WHERE guild_id = ? AND user_id = ? AND game = ? AND day = ?",
            [guildId, userId, JEU_ENIGME, jour])[0]
        const etat = ligne ? JSON.parse(ligne.state) : { essais: 0 }
        if (ligne?.finished === 1) return { etat: "deja_trouvee", essais: etat.essais, restants: 0, rang: etat.rang }
        if (etat.essais >= ESSAIS_ENIGME) return { etat: "plus_essais", essais: etat.essais, restants: 0 }
        etat.essais++
        const bonne = reponseCorrecte(enigme, reponse)
        if (bonne) etat.rang = nombreTrouveurs(guildId, jour) + 1
        db.sqlRun(`INSERT INTO jeux_quotidiens (guild_id, user_id, game, day, state, finished, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (guild_id, user_id, game, day) DO UPDATE SET state = excluded.state, finished = excluded.finished, finished_at = excluded.finished_at`,
        [guildId, userId, JEU_ENIGME, jour, JSON.stringify(etat), bonne ? 1 : 0, bonne ? Date.now() : null])
        return { etat: bonne ? "trouvee" : "ratee", essais: etat.essais, restants: ESSAIS_ENIGME - etat.essais, rang: etat.rang ?? null }
    })
}

// Essai complet d'un membre : droits, essai, puis gain. Le crédit est fait après la transaction de l'essai
// (l'économie ouvre la sienne, SQLite refuse les transactions imbriquées).
function repondreEnigme(member, reponse, jour = jourParis()) {
    const refus = economie.peutJouer(member)
    if (refus) return { etat: "refus", refus }
    const guildId = member.guild.id
    const essai = tenterEnigme(guildId, member.id, reponse, jour)
    if (essai.etat !== "trouvee") return essai
    const gain = gainEnigme(essai.rang)
    const credit = economie.crediter(member, gain, { source: "enigme", actif: true, details: { rang: essai.rang, jour } })
    const resultat = { ...essai, gain, credite: credit.ok ? credit.credite : 0, plafonne: credit.ok && credit.plafonne, refusEco: credit.ok ? null : credit.refus }
    emettre("enigme:trouvee", { guildId, userId: member.id, rang: essai.rang, gain: resultat.credite, essais: essai.essais })
    return resultat
}

module.exports = {
    THEMES, DIFFICULTES, GAINS_QUIZ, DUREE_QUIZ_MS, GAINS_ENIGME, GAIN_ENIGME_DEFAUT, ESSAIS_ENIGME,
    banque, enigmes, tirerQuestion, questionLocalisee, melanger, demarrerQuiz, repondreQuiz, conclureQuiz,
    normaliser, enigmeDuJour, reponseCorrecte, gainEnigme, etatEnigme, nombreTrouveurs, tenterEnigme, repondreEnigme
}
