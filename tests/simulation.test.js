process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const economie = require('../Fonctions/economie')
const daily = require('../Fonctions/daily')
const metiers = require('../Fonctions/metiers')
const quiz = require('../Fonctions/quiz')
const mots = require('../Fonctions/mots')
const duels = require('../Fonctions/duels')
const parties = require('../Fonctions/parties')
const drops = require('../Fonctions/drops')
const xp = require('../Fonctions/xp')
const quetes = require('../Fonctions/quetes')
const { emettre, jourParis } = require('../Fonctions/evenements')
const { dateDeParis } = require('../Fonctions/dates')

// Simulation d'un mois (30 jours, horloge injectée) d'un membre « très actif » : le profil de docs/ECONOMIE.md (§3).
// Chaque jour, il fait tout ce qui rapporte et essaie même d'aller au-delà des limites (12 quiz, 10 travaux, 12 duels, 7 pendus) :
// ce sont les limites du code qui l'arrêtent. Le test échoue si une constante dérive (limite, gain, plafond) :
// les fourchettes ci-dessous sont celles du document, à ± 15 %.
//   - plafonnés : 800 ✦ par jour (le plafond du jour) ;
//   - hors plafond livrés : daily et quêtes, ≈ 460 ✦ (le reste des 570 du profil vient de sources à venir : boss, objectif communautaire) ;
//   - potentiel plafonnable (sans plafond) : ≈ 1 130 ✦, donc le plafond de 800 coupe bien le profil très actif.
const JOURS = 30
const PLAFOND = 800
const TOLERANCE = 0.15
const HORS_PLAFOND = 460
const POTENTIEL = 1130
const SOURCES_ACTIVES = ["travail", "xp", "quiz", "mot", "enigme", "drop", "partie:pfc", "partie:pendu"]
const DEBUT = dateDeParis(2026, 11, 30, 0, 0) // un lundi : 4 semaines pleines dans les 30 jours
const MINUTE = 60 * 1000

const dans = (valeur, cible) => valeur >= cible * (1 - TOLERANCE) && valeur <= cible * (1 + TOLERANCE)

// Générateur pseudo-aléatoire à graine : le test donne toujours le même résultat
function aleatoire(graine) {
    let etat = graine >>> 0
    return () => {
        etat = (etat + 0x6D2B79F5) >>> 0
        let x = Math.imul(etat ^ (etat >>> 15), 1 | etat)
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
}

// Faux serveur et faux membres (assez proches de Discord pour l'économie, l'XP et les parties)
function creerServeur(id) {
    const guild = { id, preferredLocale: "fr", membres: {}, roles: { cache: new Discord.Collection() }, channels: { cache: new Discord.Collection() } }
    guild.members = {
        me: { id: "bot", guild, permissions: new Discord.PermissionsBitField([Discord.PermissionsBitField.Flags.ManageRoles]), roles: { highest: { position: 10, comparePositionTo: () => 1 } } },
        fetch: async userId => { if (!guild.membres[userId]) throw new Error("inconnu"); return guild.membres[userId] }
    }
    return guild
}

function ajouterMembre(guild, id) {
    const cache = new Discord.Collection()
    guild.membres[id] = {
        id, guild, joinedTimestamp: DEBUT - 60 * 24 * 3600 * 1000, communicationDisabledUntilTimestamp: null, user: { id, bot: false, username: `u${id}` },
        roles: { cache, add: async r => { cache.set(r.id, r) }, remove: async r => { cache.delete(r.id) } }
    }
    return guild.membres[id]
}

async function simuler(guildId, { plafond = null } = {}) {
    const guild = creerServeur(guildId)
    const U = "700000000000000001"
    const membre = ajouterMembre(guild, U)
    const adversaires = ["700000000000000011", "700000000000000012", "700000000000000013", "700000000000000014"].map(id => ajouterMembre(guild, id))
    const salon = { id: "c1", parentId: null, send: async () => {} }
    guild.channels.cache.set(salon.id, salon)
    const message = { guild, member: membre, channel: salon, channelId: salon.id, author: { bot: false } }
    if (plafond) economie.definirReglages(guildId, { plafondJour: plafond })

    const alea = aleatoire(12345)
    const bilan = { quiz: {}, travaux: {}, duels: {}, pendus: {} }
    let partenaires = 0
    const nouveauPartenaire = () => `800000000000000${String(++partenaires).padStart(4, "0")}`

    let horloge = DEBUT
    const dateReelle = Date.now
    Date.now = () => horloge
    parties.configurerRecompenses(async (g, userId, montant, { source }) => economie.crediter(await guild.members.fetch(userId), montant, { source, actif: true }))
    const erreurConsole = console.error
    console.error = () => {}

    try {
        metiers.choisirMetier(membre, "forgeron")

        for (let jourN = 0; jourN < JOURS; jourN++) {
            const base = DEBUT + jourN * 24 * 3600 * 1000 + 5 * 3600 * 1000 // même jour de Paris, quelle que soit l'heure d'été
            const jour = jourParis(base + 6 * 3600 * 1000)
            const heure = (h, min = 0) => dateDeParis(...jour.split("-").map(Number), h, min)
            const taches = []
            const planifier = (instant, tache) => taches.push({ instant, tache })

            planifier(heure(7, 50), () => daily.reclamer(membre, horloge))
            for (let k = 0; k < 10; k++) {
                planifier(heure(8) + k * 61 * MINUTE, () => {
                    const r = metiers.travailler(membre, { hasard: alea, maintenant: horloge })
                    if (r.ok) bilan.travaux[jour] = (bilan.travaux[jour] ?? 0) + 1
                })
            }
            for (let g = 0; g < 160; g++) planifier(heure(8, 10) + g * 61 * 1000, () => xp.gagnerXp(message, { maintenant: horloge, alea: () => 0.5 }))

            // Quiz : 12 essais, une réponse fausse sur quatre ; la limite du jour arrête le membre
            for (let q = 0; q < 12; q++) {
                planifier(heure(12) + q * 2 * MINUTE, async () => {
                    const debut = quiz.demarrerQuiz(membre, { hasard: alea, langue: "fr" })
                    if (!debut.ok) return
                    const bonne = debut.ordre.indexOf(debut.question.reponse)
                    const juste = q % 4 !== 2
                    const reponse = quiz.repondreQuiz(debut.partie.id, juste ? bonne : (bonne + 1) % 4)
                    await quiz.conclureQuiz(membre, debut.partie.id, reponse)
                    bilan.quiz[jour] = (bilan.quiz[jour] ?? 0) + 1
                })
            }

            // Mot du jour (trouvé au 4e essai) et énigme
            planifier(heure(13), () => {
                const secret = mots.motDuJour(guildId, jour, "fr")
                const faux = mots.listes("fr").cinq.filter(mot => mot !== secret).slice(0, 3)
                let dernier = null
                for (const essai of [...faux, secret]) dernier = mots.proposerEssai({ guildId, userId: U, essai, jour })
                mots.recompenserMot(membre, dernier)
            })
            planifier(heure(13, 10), () => quiz.repondreEnigme(membre, quiz.enigmeDuJour(guildId, jour).fr.reponses[0], jour))

            // Duels : 12 essais contre 4 adversaires, 6 victoires sur 10
            for (let d = 0; d < 12; d++) {
                planifier(heure(14) + d * 3 * MINUTE, async () => {
                    const adversaire = adversaires[d % adversaires.length]
                    const creation = parties.creerPartie({ guildId, game: "pfc", players: [U, adversaire.id], state: duels.etatInitialPfc(U, adversaire.id) })
                    const gagnant = d % 5 < 3 ? U : adversaire.id
                    const fin = await duels.conclureDuel(creation.partie.id, guild, { gagnants: [gagnant], montants: duels.montantsDuel(creation.partie, gagnant) })
                    if (fin.accordees[U]) bilan.duels[jour] = (bilan.duels[jour] ?? 0) + 1
                })
            }

            // Pendus : 7 essais
            for (let p = 0; p < 7; p++) {
                planifier(heure(16) + p * 5 * MINUTE, async () => {
                    const creation = parties.creerPartie({ guildId, game: "pendu", players: [U], state: { mot: "TEST" } })
                    const fin = await duels.conclureDuel(creation.partie.id, guild, { gagnants: [U], montants: { [U]: mots.GAIN_PENDU }, compteur: "pendu" })
                    if (fin.accordees[U]) bilan.pendus[jour] = (bilan.pendus[jour] ?? 0) + 1
                })
            }

            // Un coffre dans le chat
            planifier(heure(18), () => drops.ramasserCoffre(
                { guildId, channelId: salon.id, montant: drops.montantAleatoire(alea), pris: false },
                { member: membre, guildId, locale: "fr", update: async () => {}, reply: async () => {} }
            ))

            // Le soir : les quêtes (celles que les événements précédents n'ont pas faites sont complétées), puis la réclamation.
            // La quête de la semaine se termine le dimanche si elle ne l'est pas déjà.
            planifier(heure(22), () => {
                const dimanche = new Date(`${jour}T12:00:00Z`).getUTCDay() === 0
                for (const q of quetes.quetesDuMembre(guildId, U, { instant: horloge })) {
                    if (q.terminee || (q.type === "semaine" && !dimanche)) continue
                    const def = [...quetes.catalogue.jour, ...quetes.catalogue.semaine].find(d => d.id === q.id)
                    for (let i = q.progress; i < q.goal; i++) {
                        const autre = nouveauPartenaire()
                        emettre(def.evenement, { guildId, userId: U, to: autre, from: autre, amount: 100, players: [U, autre], streak: 1, level: 1 })
                    }
                }
                quetes.reclamer(membre, { instant: horloge })
            })

            taches.sort((a, b) => a.instant - b.instant)
            for (const { instant, tache } of taches) {
                horloge = instant
                await tache()
            }
        }
    } finally {
        Date.now = dateReelle
        console.error = erreurConsole
        parties.configurerRecompenses(null)
    }
    return { U, bilan, jour: instant => jourParis(instant) }
}

// Gains du journal par jour de Paris : { source: { jour: montant } }
function gainsParJour(guildId, userId) {
    const parJour = {}
    for (const l of db.sqlAll("SELECT delta, source, created_at FROM eco_journal WHERE guild_id = ? AND user_id = ? AND delta > 0", [guildId, userId])) {
        const jour = jourParis(l.created_at)
        parJour[jour] ??= {}
        parJour[jour][l.source] = (parJour[jour][l.source] ?? 0) + l.delta
    }
    return parJour
}

const somme = (objet, sources) => Object.entries(objet).filter(([source]) => !sources || sources.includes(source)).reduce((total, [, montant]) => total + montant, 0)

test("simulation de 30 jours d'un membre très actif : journal = solde, plafond respecté, moyennes du document", async () => {
    const guildId = "950000000000000001"
    // Les limites du document (§2) : toute dérive est à reporter dans docs/ECONOMIE.md
    assert.deepStrictEqual(
        [metiers.TRAVAUX_PAR_JOUR, quiz.MAX_QUIZ_JOUR, duels.MAX_RECOMPENSES_JOUR, duels.MAX_PENDUS_JOUR, duels.MAX_DUELS_ADVERSAIRE, xp.ECLATS_JOUR_MAX],
        [8, 8, 10, 5, 3, 100])
    const { U, bilan } = await simuler(guildId)

    // Journal et solde
    assert.ok(economie.verifierCoherence(guildId, U), "la somme du journal égale le solde")
    const total = db.sqlAll("SELECT SUM(delta) AS s FROM eco_journal WHERE guild_id = ? AND user_id = ?", [guildId, U])[0].s
    assert.strictEqual(economie.compte(guildId, U).balance, total)

    const parJour = gainsParJour(guildId, U)
    const jours = Object.keys(parJour)
    assert.strictEqual(jours.length, JOURS, "un gain tous les jours")

    // Les gains plafonnables ne dépassent jamais le plafond du jour, ni dans le journal ni dans le compteur de l'économie
    assert.strictEqual(economie.reglages(guildId).plafondJour, PLAFOND)
    for (const jour of jours) {
        assert.ok(somme(parJour[jour], SOURCES_ACTIVES) <= PLAFOND, `${jour} : ${somme(parJour[jour], SOURCES_ACTIVES)} ✦ plafonnables`)
        const compteur = db.sqlAll("SELECT active_earned FROM eco_compteurs WHERE guild_id = ? AND user_id = ? AND day = ?", [guildId, U, jour])[0]
        assert.ok(compteur.active_earned <= PLAFOND, `${jour} : compteur ${compteur.active_earned}`)
        assert.ok((parJour[jour].xp ?? 0) <= xp.ECLATS_JOUR_MAX, `${jour} : ${parJour[jour].xp} ✦ d'activité écrite`)
    }

    // Les limites du jour tiennent même quand le membre en demande plus
    for (const jour of jours) {
        assert.ok((bilan.travaux[jour] ?? 0) <= metiers.TRAVAUX_PAR_JOUR, `${jour} : travaux`)
        assert.ok((bilan.quiz[jour] ?? 0) <= quiz.MAX_QUIZ_JOUR, `${jour} : quiz`)
        assert.ok((bilan.duels[jour] ?? 0) <= duels.MAX_RECOMPENSES_JOUR, `${jour} : duels`)
        assert.ok((bilan.pendus[jour] ?? 0) <= duels.MAX_PENDUS_JOUR, `${jour} : pendus`)
    }
    assert.deepStrictEqual(
        [Math.max(...Object.values(bilan.travaux)), Math.max(...Object.values(bilan.quiz)), Math.max(...Object.values(bilan.duels)), Math.max(...Object.values(bilan.pendus))],
        [metiers.TRAVAUX_PAR_JOUR, quiz.MAX_QUIZ_JOUR, duels.MAX_RECOMPENSES_JOUR, duels.MAX_PENDUS_JOUR], "le membre atteint chaque limite")

    // Moyennes par jour
    const plafonne = jours.reduce((s, jour) => s + somme(parJour[jour], SOURCES_ACTIVES), 0) / JOURS
    const horsPlafond = jours.reduce((s, jour) => s + somme(parJour[jour], ["daily", "quete"]), 0) / JOURS
    assert.ok(dans(plafonne, PLAFOND), `plafonnés : ${plafonne.toFixed(0)} ✦ par jour (document : ${PLAFOND})`)
    assert.ok(dans(horsPlafond, HORS_PLAFOND), `hors plafond : ${horsPlafond.toFixed(0)} ✦ par jour (document : ${HORS_PLAFOND})`)
    // Rien d'autre que les sources connues
    const connues = [...SOURCES_ACTIVES, "daily", "quete"]
    for (const jour of jours) assert.deepStrictEqual(Object.keys(parJour[jour]).filter(s => !connues.includes(s)), [], `${jour} : source inconnue`)
})

test("simulation sans plafond : le potentiel plafonnable du profil très actif dépasse bien le plafond de 800", async () => {
    const guildId = "950000000000000002"
    const { U } = await simuler(guildId, { plafond: 2000 })
    assert.ok(economie.verifierCoherence(guildId, U))
    const parJour = gainsParJour(guildId, U)
    const potentiel = Object.values(parJour).reduce((s, gains) => s + somme(gains, SOURCES_ACTIVES), 0) / JOURS
    assert.ok(dans(potentiel, POTENTIEL), `potentiel : ${potentiel.toFixed(0)} ✦ par jour (document : ${POTENTIEL})`)
    assert.ok(potentiel > PLAFOND * (1 + TOLERANCE), "le plafond du jour coupe réellement le profil très actif")
})
