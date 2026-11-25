const db = require('./db')

// Modules activables par serveur (idée #87) et interrupteurs d'urgence (idée #96).
//
// Clés de module : "moderation", "communaute", "communaute.<sous-module>" (ex. "communaute.animation").
// Le module Général (aide, /config, /privacy…) ne se désactive jamais : un serveur doit toujours pouvoir revenir en arrière.
// Un sous-module n'est actif que si son module l'est aussi.

const MODULES_DESACTIVABLES = ["moderation", "communaute"]

// Sous-modules de la Communauté soumis aux salons de jeux (/config) : les jeux et ce qui en découle.
// L'Animation (giveaways, sondages, annonces) est un outil d'admin, utilisable partout.
const SOUS_MODULES_JEUX = ["jeux", "economie", "niveaux", "collection", "aventure", "casino"]

const cleDe = command => command.module === "communaute" && command.sousModule ? `communaute.${command.sousModule}` : command.module

// Interrupteurs d'urgence (#96) : DESACTIVER=communaute.jeux,commande:quiz dans le .env coupe partout, sans redéployer
// (redémarrage du bot seulement). Sert à arrêter tout de suite une faille (ex. duplication de monnaie).
function coupures() {
    return new Set((process.env.DESACTIVER ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean))
}
function estCoupe(command, liste = coupures()) {
    if (command.module === "general") return false
    return liste.has(`commande:${command.name}`) || liste.has(command.module)
        || (command.sousModule !== null && command.sousModule !== undefined && liste.has(cleDe(command)))
}

// La commande (ou le composant) est-elle utilisable sur ce serveur ? Renvoie null si oui, sinon le motif :
// "coupe" (interrupteur d'urgence) ou "desactive" (choix du serveur).
function motifIndisponible(guildId, command) {
    if (command.module === "general") return null
    if (estCoupe(command)) return "coupe"
    if (!guildId) return null
    const reglages = db.getModules(guildId)
    if (reglages[command.module] === false) return "desactive"
    if (command.module === "communaute" && command.sousModule && reglages[cleDe(command)] === false) return "desactive"
    return null
}

// Salon autorisé pour cette commande ? Renvoie null si oui, sinon la liste des salons autorisés.
function salonsRequis(guildId, channelId, command) {
    if (!guildId || command.module !== "communaute" || !SOUS_MODULES_JEUX.includes(command.sousModule)) return null
    const salons = db.getSalonsJeux(guildId)
    if (!salons.length || salons.includes(channelId)) return null
    return salons
}

// Modules présents dans le bot (pour /config et /help), dans l'ordre d'affichage
function modulesConnus(commandes) {
    const sous = [...new Set([...commandes].filter(c => c.module === "communaute" && c.sousModule).map(c => c.sousModule))].sort()
    return [...MODULES_DESACTIVABLES, ...sous.map(s => `communaute.${s}`)]
}

module.exports = { motifIndisponible, salonsRequis, estCoupe, coupures, modulesConnus, cleDe, MODULES_DESACTIVABLES, SOUS_MODULES_JEUX }
