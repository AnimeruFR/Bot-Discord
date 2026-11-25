const fs = require('fs')
const path = require('path')
const { verifierDeclaration } = require('../Fonctions/staff')

const RACINE = path.join(__dirname, '..', 'Commandes')

// Les commandes sont rangées par module : le dossier décide du module, jamais le fichier lui-même.
//   Commandes/Moderation/x.js            -> module "moderation" (staff uniquement)
//   Commandes/Tickets/x.js               -> module "tickets" (configuration staff ; boutons des membres publics)
//   Commandes/Communaute/<Sous>/x.js     -> module "communaute", sous-module "<sous>" en minuscules
//   Commandes/General/x.js               -> module "general" (aide, configuration, confidentialité…)
const MODULES = { Moderation: "moderation", Tickets: "tickets", Communaute: "communaute", General: "general" }

// Liste des fichiers de commandes avec leur module, dans un ordre stable
function listerCommandes(racine = RACINE) {
    const fichiers = []
    const entrees = fs.readdirSync(racine, { withFileTypes: true })
    for (const f of entrees) {
        if (f.isFile() && f.name.endsWith('.js')) throw new Error(`Commandes/${f.name} doit être rangée dans Moderation/, Communaute/<Sous-module>/ ou General/`)
    }
    for (const dossier of entrees.filter(e => e.isDirectory()).map(e => e.name).sort()) {
        const module = MODULES[dossier]
        if (!module) throw new Error(`Dossier de commandes inconnu : Commandes/${dossier}`)
        const chemin = path.join(racine, dossier)
        if (module === "communaute") {
            for (const sous of fs.readdirSync(chemin, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
                if (!sous.isDirectory()) throw new Error(`Commandes/Communaute/${sous.name} : une commande Communauté doit être dans un sous-module (Jeux/, Economie/…)`)
                for (const f of fs.readdirSync(path.join(chemin, sous.name)).filter(f => f.endsWith('.js')).sort()) {
                    fichiers.push({ fichier: path.join(chemin, sous.name, f), module, sousModule: sous.name.toLowerCase() })
                }
            }
        } else {
            for (const f of fs.readdirSync(chemin).filter(f => f.endsWith('.js')).sort()) {
                fichiers.push({ fichier: path.join(chemin, f), module, sousModule: null })
            }
        }
    }
    return fichiers
}

// Discord limite à 5 les menus contextuels de chaque type (clic droit sur un membre, sur un message)
const MAX_MENUS_PAR_TYPE = 5

module.exports = (bot, { silencieux = false } = {}) => {
    const menus = { user: 0, message: 0 }
    for (const { fichier, module, sousModule } of listerCommandes()) {
        const nomFichier = path.relative(RACINE, fichier)
        const command = require(fichier)
        if (!command.name || typeof command.name !== 'string') throw new TypeError(`La commande ${nomFichier} n'a pas de nom valide !`)
        if (typeof command.run !== 'function') throw new TypeError(`La commande ${nomFichier} n'a pas de fonction run !`)
        if (bot.commands.has(command.name)) throw new Error(`Deux commandes s'appellent « ${command.name} » (${nomFichier})`)
        if (command.type !== undefined) {
            if (!(command.type in menus)) throw new TypeError(`${nomFichier} : type de menu contextuel inconnu (user ou message)`)
            if (command.options?.length || command.dm) throw new TypeError(`${nomFichier} : un menu contextuel n'a ni option ni accès en MP`)
            if (++menus[command.type] > MAX_MENUS_PAR_TYPE) throw new Error(`Plus de ${MAX_MENUS_PAR_TYPE} menus contextuels de type ${command.type} (${nomFichier})`)
        }
        command.module = module
        command.sousModule = sousModule
        verifierDeclaration(command)
        bot.commands.set(command.name, command)
        // Pas de routeur pour npm run deploy ni pour certains tests : seules les définitions comptent alors
        if (bot.routeur) bot.routeur.enregistrerCommande(command)
        if (!silencieux) console.log(`Commande ${nomFichier} chargée avec succès !`)
    }
}

module.exports.listerCommandes = listerCommandes
