const db = require('./db')
const { t } = require('./i18n')

// Modules activables par serveur (idée #87) et interrupteurs d'urgence (idée #96).
//
// Clés de module : "moderation", "tickets", "communaute", "communaute.<sous-module>" (ex. "communaute.animation").
// Le module Général (aide, /config, /privacy…) ne se désactive jamais : un serveur doit toujours pouvoir revenir en arrière.
// Un sous-module n'est actif que si son module l'est aussi.

const MODULES_DESACTIVABLES = ["moderation", "tickets", "communaute"]

// Sous-modules de la Communauté soumis aux salons de jeux (/config) : les jeux et ce qui en découle.
// L'Animation (giveaways, sondages, annonces) est un outil d'admin, utilisable partout.
const SOUS_MODULES_JEUX = ["jeux", "economie", "niveaux", "collection", "aventure", "casino"]

// Clé de module d'une commande ou d'un composant
const cleDe = declaration => declaration.module === "communaute" && declaration.sousModule ? `communaute.${declaration.sousModule}` : declaration.module

// Interrupteurs d'urgence (#96) : DESACTIVER=communaute.jeux,commande:quiz dans le .env coupe partout, sans redéployer
// (redémarrage du bot seulement). Sert à arrêter tout de suite une faille (ex. duplication de monnaie).
function coupures() {
    return new Set((process.env.DESACTIVER ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean))
}

// Une clé de module est-elle coupée en urgence ? "communaute.jeux" est coupée aussi si "communaute" l'est.
function estCoupeCle(cle, liste = coupures()) {
    if (!cle || cle === "general") return false
    return liste.has(cle) || liste.has(cle.split(".")[0])
}

// Le module est-il actif sur ce serveur (et pas coupé en urgence) ? Pour les événements et les tâches planifiées
// (XP au message, tirages, boucles de jeu…), qui n'ont pas de commande : moduleActif(guildId, "communaute.niveaux").
function moduleActif(guildId, cle) {
    if (!cle || cle === "general") return true
    if (estCoupeCle(cle)) return false
    if (!guildId) return true
    const reglages = db.getModules(guildId)
    const [module] = cle.split(".")
    return reglages[module] !== false && reglages[cle] !== false
}

// La commande (ou le composant) est-elle utilisable sur ce serveur ? Renvoie null si oui, sinon le motif :
// "coupe" (interrupteur d'urgence) ou "desactive" (choix du serveur).
function motifIndisponible(guildId, declaration) {
    if (declaration.module === "general") return null
    if (estCoupeCle(cleDe(declaration)) || coupures().has(`commande:${declaration.name}`)) return "coupe"
    return moduleActif(guildId, cleDe(declaration)) ? null : "desactive"
}

// Salon autorisé pour cette commande ? Renvoie null si oui, sinon la liste des salons autorisés.
function salonsRequis(guildId, channelId, declaration) {
    if (!guildId || declaration.module !== "communaute" || !SOUS_MODULES_JEUX.includes(declaration.sousModule)) return null
    const salons = db.getSalonsJeux(guildId)
    if (!salons.length || salons.includes(channelId)) return null
    return salons
}

// Modules présents dans le bot (pour /config), dans l'ordre d'affichage
function modulesConnus(commandes) {
    const sous = [...new Set([...commandes].filter(c => c.module === "communaute" && c.sousModule).map(c => c.sousModule))].sort()
    return [...MODULES_DESACTIVABLES, ...sous.map(s => `communaute.${s}`)]
}

// Nom affiché d'un module, dans une langue ("communaute.animation" -> "Communauté › Animation")
function nomModule(langue, cle) {
    const [module, sous] = cle.split(".")
    return sous ? t(langue, "modules.nom_sous", { sous: t(langue, `modules.sous_${sous}`) }) : t(langue, `modules.nom_${module}`)
}

module.exports = { motifIndisponible, moduleActif, estCoupeCle, salonsRequis, modulesConnus, nomModule, cleDe }
