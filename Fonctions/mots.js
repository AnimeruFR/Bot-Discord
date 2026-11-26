const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const db = require('./db')
const { emettre, jourParis } = require('./evenements')

// Jeux de mots (idées #47 et #49) : « Le Mot du jour » et le pendu. Les listes sont dans data-statique/mots-<langue>.txt.

const LONGUEUR = 5
const ESSAIS_MAX = 6
const ERREURS_MAX = 7
const GAINS_MOT = [40, 34, 28, 22, 16, 10] // selon le nombre d'essais utilisés (1 à 6)
const GAIN_PENDU = 20
const DUREE_PENDU = 2 * 60 * 1000 // sans coup pendant 2 minutes : partie expirée
const LANGUES = ["fr", "en"]
const EMOJIS = { juste: "🟩", present: "🟨", absent: "⬛" }

// Majuscules sans accents, seulement A-Z : « Élève » et « eleve » donnent le même mot
function normaliser(texte) {
    return String(texte ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/œ/gi, "oe").replace(/æ/gi, "ae").toUpperCase().replace(/[^A-Z]/g, "")
}

// Listes chargées une seule fois par langue : mots de 5 lettres (mot du jour) et de 6 à 10 lettres (pendu)
const cacheListes = {}
function listes(langue) {
    const cle = LANGUES.includes(langue) ? langue : "fr"
    if (!cacheListes[cle]) {
        const brut = fs.readFileSync(path.join(__dirname, '..', 'data-statique', `mots-${cle}.txt`), 'utf8')
        const tous = [...new Set(brut.split(/\r?\n/).filter(ligne => ligne.trim() && !ligne.startsWith("#")).map(ligne => ligne.trim().normalize("NFC")))]
            .map(mot => ({ mot, norme: normaliser(mot) }))
            .filter(({ norme }) => norme.length > 0)
        const cinq = [...new Set(tous.filter(({ norme }) => norme.length === LONGUEUR).map(({ norme }) => norme))].sort()
        const pendu = [...new Set(tous.filter(({ norme }) => norme.length >= 6 && norme.length <= 10).map(({ norme }) => norme))].sort()
        cacheListes[cle] = { cinq, ensemble: new Set(cinq), pendu }
    }
    return cacheListes[cle]
}

// Langue des mots d'un serveur : celle imposée dans /config, français sinon (les mots ne suivent pas le client de chaque joueur)
function langueServeur(guildId) {
    const imposee = db.getApparence(guildId).langue
    return LANGUES.includes(imposee) ? imposee : "fr"
}

// --- Le Mot du jour ---------------------------------------------------------------------------------------------

// Le même mot pour tout le serveur et pour la journée : dérivé du serveur et du jour, sans rien stocker
function motDuJour(guildId, jour, langue) {
    const { cinq } = listes(langue)
    const empreinte = crypto.createHash("sha256").update(`mot:${guildId}:${jour}`).digest()
    return cinq[empreinte.readUInt32BE(0) % cinq.length]
}

// Indice de chaque case : "juste" (bonne place), "present" (ailleurs), "absent".
// Deux passes : les bonnes places consomment leur lettre, puis les lettres présentes ailleurs ne sont signalées
// que tant qu'il en reste dans le mot (un L en trop reste « absent »).
function evaluer(secret, essai) {
    const indices = Array(essai.length).fill("absent")
    const restantes = {}
    for (let i = 0; i < essai.length; i++) {
        if (essai[i] === secret[i]) indices[i] = "juste"
        else restantes[secret[i]] = (restantes[secret[i]] ?? 0) + 1
    }
    for (let i = 0; i < essai.length; i++) {
        if (indices[i] === "juste") continue
        if (restantes[essai[i]] > 0) {
            indices[i] = "present"
            restantes[essai[i]]--
        }
    }
    return indices
}

const ligneEmojis = (secret, essai) => evaluer(secret, essai).map(i => EMOJIS[i]).join("")

// Grille à partager : seulement les couleurs, jamais les lettres ni le mot
const grille = (secret, essais) => essais.map(essai => ligneEmojis(secret, essai)).join("\n")

const gainMot = essais => GAINS_MOT[Math.min(Math.max(essais, 1), ESSAIS_MAX) - 1]

// La veille d'un jour AAAA-MM-JJ (calcul sur le calendrier, sans dépendre des changements d'heure)
function jourPrecedent(jour) {
    const [annee, mois, j] = jour.split("-").map(Number)
    return new Date(Date.UTC(annee, mois - 1, j - 1)).toISOString().slice(0, 10)
}

const lireJour = (guildId, userId, jour) =>
    db.sqlAll("SELECT * FROM jeux_quotidiens WHERE guild_id = ? AND user_id = ? AND game = 'mot' AND day = ?", [guildId, userId, jour])[0] ?? null

// État du joueur pour la journée : { langue, essais, gagne } et si c'est terminé
function etatDuJour(guildId, userId, jour = jourParis()) {
    const ligne = lireJour(guildId, userId, jour)
    if (!ligne) return { langue: langueServeur(guildId), essais: [], gagne: false, termine: false }
    return { ...JSON.parse(ligne.state), termine: ligne.finished === 1 }
}

function lireSerie(guildId, userId) {
    return db.sqlAll("SELECT value FROM stats_joueur WHERE guild_id = ? AND user_id = ? AND stat = 'mot_serie'", [guildId, userId])[0]?.value ?? 0
}

// Série en cours : elle n'est vivante que si le mot a été trouvé aujourd'hui ou hier
function serieActuelle(guildId, userId, jour = jourParis()) {
    const trouve = j => {
        const ligne = lireJour(guildId, userId, j)
        return ligne?.finished === 1 && JSON.parse(ligne.state).gagne === true
    }
    return trouve(jour) || trouve(jourPrecedent(jour)) ? lireSerie(guildId, userId) : 0
}

// À appeler dans la transaction de fin de partie : +1 si hier aussi, 1 sinon ; une défaite remet à 0
function majSerie(guildId, userId, jour, gagne) {
    let serie = 0
    if (gagne) {
        const hier = lireJour(guildId, userId, jourPrecedent(jour))
        const hierTrouve = hier?.finished === 1 && JSON.parse(hier.state).gagne === true
        serie = hierTrouve ? lireSerie(guildId, userId) + 1 : 1
    }
    db.sqlRun(`INSERT INTO stats_joueur (guild_id, user_id, stat, value) VALUES (?, ?, 'mot_serie', ?)
        ON CONFLICT (guild_id, user_id, stat) DO UPDATE SET value = excluded.value`, [guildId, userId, serie])
    return serie
}

// Enregistre un essai. Refusé sans rien écrire (donc sans coûter d'essai) si le mot est mal formé, absent de la liste,
// déjà essayé, ou si la partie du jour est finie. Une seule ligne par membre, serveur et jour : une seule partie par jour.
function proposerEssai({ guildId, userId, essai, jour = jourParis() }) {
    const mot = normaliser(essai)
    if (mot.length !== LONGUEUR) return { ok: false, refus: "longueur", mot }
    return db.transaction(() => {
        const ligne = lireJour(guildId, userId, jour)
        if (ligne?.finished === 1) return { ok: false, refus: "deja_fini", mot }
        const etat = ligne ? JSON.parse(ligne.state) : { langue: langueServeur(guildId), essais: [], gagne: false }
        if (!listes(etat.langue).ensemble.has(mot)) return { ok: false, refus: "inconnu", mot }
        if (etat.essais.includes(mot)) return { ok: false, refus: "deja_essaye", mot }

        const secret = motDuJour(guildId, jour, etat.langue)
        etat.essais.push(mot)
        etat.gagne = mot === secret
        const termine = etat.gagne || etat.essais.length >= ESSAIS_MAX
        const maintenant = Date.now()
        db.sqlRun(`INSERT INTO jeux_quotidiens (guild_id, user_id, game, day, state, finished, finished_at) VALUES (?, ?, 'mot', ?, ?, ?, ?)
            ON CONFLICT (guild_id, user_id, game, day) DO UPDATE SET state = excluded.state, finished = excluded.finished, finished_at = excluded.finished_at`,
        [guildId, userId, jour, JSON.stringify(etat), termine ? 1 : 0, termine ? maintenant : null])
        const serie = termine ? majSerie(guildId, userId, jour, etat.gagne) : serieActuelle(guildId, userId, jour)
        return { ok: true, etat: { ...etat, termine }, secret, gagne: etat.gagne, termine, serie, mot }
    })
}

// Gain d'un mot trouvé (économie : gain « actif », donc soumis au plafond du jour) et événement.
// Appelé une seule fois, par celui qui vient de terminer la partie. Renvoie { gain, credit } où credit vient de crediter().
function recompenserMot(member, resultat) {
    if (!resultat.gagne) return null
    const { crediter } = require('./economie')
    const essais = resultat.etat.essais.length
    const credit = crediter(member, gainMot(essais), { source: "mot", actif: true, details: { essais } })
    emettre("mot:trouve", { guildId: member.guild.id, userId: member.id, essais, serie: resultat.serie })
    return { gain: gainMot(essais), credit }
}

// --- Pendu ------------------------------------------------------------------------------------------------------

function motPendu(langue, hasard = Math.random) {
    const { pendu } = listes(langue)
    return pendu[Math.floor(hasard() * pendu.length)]
}

// Mot avec les lettres trouvées : "_ A _ _ E"
const masque = (mot, trouvees) => [...mot].map(l => trouvees.includes(l) ? l : "_").join(" ")

const gagnePendu = etat => [...etat.mot].every(l => etat.trouvees.includes(l))

// Joue une lettre sur l'état d'une partie (modifié sur place). Une lettre déjà jouée est refusée et ne coûte rien.
function jouerLettre(etat, lettre) {
    const l = normaliser(lettre)
    if (l.length !== 1) return { ok: false, refus: "lettre" }
    if (etat.trouvees.includes(l) || etat.ratees.includes(l)) return { ok: false, refus: "deja_jouee", lettre: l }
    const bonne = etat.mot.includes(l)
    if (bonne) etat.trouvees.push(l)
    else etat.ratees.push(l)
    const gagne = gagnePendu(etat)
    const perdu = !gagne && etat.ratees.length >= ERREURS_MAX
    return { ok: true, lettre: l, bonne, gagne, perdu }
}

// Potence en texte : 0 erreur = vide, 7 erreurs = pendu complet
function dessin(erreurs) {
    const e = Math.min(Math.max(erreurs, 0), ERREURS_MAX)
    const tete = e >= 7 ? "X" : e >= 1 ? "O" : " "
    const bras = e >= 4 ? "/|\\" : e >= 3 ? "/| " : e >= 2 ? " | " : "   "
    const jambes = e >= 6 ? "/ \\" : e >= 5 ? "/  " : "   "
    return ["  +---+", "  |   |", `  ${tete}   |`, ` ${bras}  |`, ` ${jambes}  |`, "      |", "========="].join("\n")
}

module.exports = {
    LONGUEUR, ESSAIS_MAX, ERREURS_MAX, GAIN_PENDU, DUREE_PENDU, GAINS_MOT,
    normaliser, listes, langueServeur,
    motDuJour, evaluer, ligneEmojis, grille, gainMot, jourPrecedent, etatDuJour, serieActuelle, proposerEssai, recompenserMot,
    motPendu, masque, jouerLettre, gagnePendu, dessin
}
