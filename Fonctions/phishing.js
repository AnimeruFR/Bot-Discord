const fs = require('fs')
const path = require('path')
const Discord = require('discord.js')
const db = require('./db')
const am = require('./automod')

// Anti-phishing (idée #5) : une règle AutoMod native, remplie avec une liste de domaines d'arnaque versionnée
// (data-statique/domaines-phishing.txt) moins la liste blanche du serveur.

const FICHIER = path.join(__dirname, '..', 'data-statique', 'domaines-phishing.txt')
const NOM_REGLE = "Anti-phishing (bot)"
const TYPE_REGLE = Discord.AutoModerationRuleTriggerType.Keyword

// Limites de Discord (mots-clés d'une règle, règles de mots-clés par serveur) et limite propre au bot (liste blanche)
const LIMITES = { mots: am.LIMITES.mots, longueurMot: am.LIMITES.longueurMot, reglesMotsCles: 6, blanche: 50 }
// Le motif est *domaine* : deux caractères de plus que le domaine
const LONGUEUR_DOMAINE_MAX = LIMITES.longueurMot - 2

// Nom de domaine ASCII (les noms internationaux s'écrivent en xn--) : jamais de "*", d'espace ni de "/"
const DOMAINE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]{2,20})$/

// Texte saisi (domaine, adresse, avec ou sans https:// et www.) -> domaine en minuscules, ou null s'il n'est pas valide
function normaliserDomaine(texte) {
    let d = String(texte ?? "").trim().toLowerCase()
    d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0]
    d = d.slice(d.lastIndexOf("@") + 1).replace(/:\d{1,5}$/, "").replace(/\.$/, "").replace(/^www\./, "")
    return d.length <= LONGUEUR_DOMAINE_MAX && DOMAINE.test(d) ? d : null
}

// Contenu du fichier -> { domaines, invalides, doublons }. Les domaines sont normalisés et sans doublon (l'ordre est gardé).
function analyserListe(contenu) {
    const domaines = [], invalides = [], doublons = []
    for (const [i, ligne] of String(contenu).split(/\r?\n/).entries()) {
        const brut = ligne.trim()
        if (!brut || brut.startsWith("#")) continue
        // Seul un domaine nu, déjà en minuscules, est accepté dans le fichier : pas d'adresse complète
        const d = normaliserDomaine(brut)
        if (!d || d !== brut) invalides.push({ ligne: i + 1, texte: brut })
        else if (domaines.includes(d)) doublons.push(d)
        else domaines.push(d)
    }
    return { domaines, invalides, doublons }
}

// Liste du dépôt. Une ligne invalide est ignorée (le test du dépôt échoue avant qu'elle n'arrive en production).
let cache = null
function chargerListe() {
    if (!cache) {
        const { domaines, invalides } = analyserListe(fs.readFileSync(FICHIER, "utf8"))
        if (invalides.length) console.error(`Liste anti-phishing : ${invalides.length} ligne(s) invalide(s) ignorée(s) (première : ligne ${invalides[0].ligne})`)
        cache = domaines
    }
    return [...cache]
}

// --- Liste blanche du serveur ---------------------------------------------------------------------------------

const listeBlanche = guildId => db.sqlAll("SELECT domain FROM phishing_whitelist WHERE guild_id = ? ORDER BY domain", [guildId]).map(l => l.domain)

// Renvoie "ok", "deja" ou "max"
function autoriser(guildId, domaine) {
    return db.transaction(() => {
        const actuelle = listeBlanche(guildId)
        if (actuelle.includes(domaine)) return "deja"
        if (actuelle.length >= LIMITES.blanche) return "max"
        db.sqlRun("INSERT INTO phishing_whitelist (guild_id, domain) VALUES (?, ?)", [guildId, domaine])
        return "ok"
    })
}

// true si le domaine était autorisé
const retirerAutorisation = (guildId, domaine) => db.sqlRun("DELETE FROM phishing_whitelist WHERE guild_id = ? AND domain = ?", [guildId, domaine]) > 0

// Un domaine autorisé libère aussi ses sous-domaines (a.exemple.com pour exemple.com)
const estAutorise = (domaine, blanche) => blanche.some(b => domaine === b || domaine.endsWith(`.${b}`))

// --- Mots-clés de la règle ------------------------------------------------------------------------------------

// Domaines bloqués -> mots-clés d'une règle native. Renvoie { mots, retires, tronques } :
// retires = domaines écartés par la liste blanche ; tronques = domaines laissés de côté faute de place (on garde les premiers).
function construireMotsCles(domaines, blanche = []) {
    const gardes = domaines.filter(d => !estAutorise(d, blanche))
    return {
        mots: gardes.slice(0, LIMITES.mots).map(d => `*${d}*`),
        retires: domaines.length - gardes.length,
        tronques: Math.max(0, gardes.length - LIMITES.mots)
    }
}

const valeurs = regles => Array.isArray(regles) ? regles : [...(regles?.values?.() ?? [])]

// Reste-t-il de la place pour notre règle ? toutes : toutes les règles AutoMod du serveur (celles des admins comprises).
// La règle du bot, si elle existe déjà, est simplement mise à jour : elle ne prend pas de place en plus.
function placeDisponible(toutes, botId) {
    const motsCles = valeurs(toutes).filter(r => r.triggerType === TYPE_REGLE)
    const aNous = motsCles.some(r => r.creatorId === botId && r.name === NOM_REGLE)
    return aNous || motsCles.length < LIMITES.reglesMotsCles
}

// --- Règle AutoMod --------------------------------------------------------------------------------------------

// Notre règle (jamais celle d'un admin, même si elle porte le même nom)
const trouverRegle = (reglesBot, botId) => valeurs(reglesBot).find(r => r.creatorId === botId && r.name === NOM_REGLE && r.triggerType === TYPE_REGLE) ?? null

// Crée ou met à jour la règle. Renvoie { etat, mots, retires, tronques } avec etat :
// "creee" | "maj" | "vide" (tout est autorisé : rien à bloquer) | "pas_de_place" | "echec"
async function appliquer(guild, bot, logs, reason) {
    const { mots, retires, tronques } = construireMotsCles(chargerListe(), listeBlanche(guild.id))
    const resultat = { mots: mots.length, retires, tronques }
    if (!mots.length) return { ...resultat, etat: "vide" }
    try {
        const toutes = await guild.autoModerationRules.fetch()
        if (!placeDisponible(toutes, bot.user.id)) return { ...resultat, etat: "pas_de_place" }
        const reglesBot = valeurs(toutes).filter(r => r.creatorId === bot.user.id)
        // creerOuMettreAJour reprend les exemptions des autres règles du bot pour une nouvelle règle
        const etat = await am.creerOuMettreAJour(guild, new Discord.Collection(reglesBot.map(r => [r.id, r])),
            { nom: NOM_REGLE, type: TYPE_REGLE, triggerMetadata: { keywordFilter: mots } }, logs, reason)
        return { ...resultat, etat }
    } catch (err) {
        console.error("Échec de l'anti-phishing :", err.message)
        return { ...resultat, etat: "echec" }
    }
}

// Supprime notre règle. Renvoie true si elle existait. Lève l'erreur de Discord en cas d'échec.
async function supprimer(guild, bot, reason) {
    const regle = trouverRegle(await am.reglesDuBot(guild, bot), bot.user.id)
    if (!regle) return false
    await regle.delete(reason)
    return true
}

// Après un changement de liste blanche : remet la règle à jour si elle existe. Renvoie "aucune" | "maj" | "desactivee" | "echec".
async function synchroniser(guild, bot, logs, reason) {
    try {
        const regle = trouverRegle(await am.reglesDuBot(guild, bot), bot.user.id)
        if (!regle) return "aucune"
        const { mots } = construireMotsCles(chargerListe(), listeBlanche(guild.id))
        if (!mots.length) {
            await regle.edit({ enabled: false, reason })
            return "desactivee"
        }
        await am.creerOuMettreAJour(guild, new Discord.Collection([[regle.id, regle]]),
            { nom: NOM_REGLE, type: TYPE_REGLE, triggerMetadata: { keywordFilter: mots } }, logs, reason)
        return "maj"
    } catch (err) {
        console.error("Échec de la mise à jour de l'anti-phishing :", err.message)
        return "echec"
    }
}

module.exports = {
    FICHIER, NOM_REGLE, LIMITES, normaliserDomaine, analyserListe, chargerListe, listeBlanche, autoriser, retirerAutorisation,
    estAutorise, construireMotsCles, placeDisponible, trouverRegle, appliquer, supprimer, synchroniser
}
