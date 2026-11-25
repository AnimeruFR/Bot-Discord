const fs = require('fs')
const path = require('path')
const { verifierDeclaration } = require('../Fonctions/staff')

const RACINE = path.join(__dirname, '..', 'Commandes')

// Les commandes sont rangées par module : le dossier décide du module, jamais le fichier lui-même.
//   Commandes/Moderation/x.js            -> module "moderation" (staff uniquement)
//   Commandes/Communaute/<Sous>/x.js     -> module "communaute", sous-module "<sous>" en minuscules
//   Commandes/General/x.js               -> module "general" (aide, configuration, confidentialité…)
const MODULES = { Moderation: "moderation", Communaute: "communaute", General: "general" }

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

module.exports = (bot, { silencieux = false } = {}) => {
    for (const { fichier, module, sousModule } of listerCommandes()) {
        const nomFichier = path.relative(RACINE, fichier)
        const command = require(fichier)
        if (!command.name || typeof command.name !== 'string') throw new TypeError(`La commande ${nomFichier} n'a pas de nom valide !`)
        if (typeof command.run !== 'function') throw new TypeError(`La commande ${nomFichier} n'a pas de fonction run !`)
        if (bot.commands.has(command.name)) throw new Error(`Deux commandes s'appellent « ${command.name} » (${nomFichier})`)
        command.module = module
        command.sousModule = sousModule
        verifierDeclaration(command)
        bot.commands.set(command.name, command)
        if (!silencieux) console.log(`Commande ${nomFichier} chargée avec succès !`)
    }
}

module.exports.listerCommandes = listerCommandes
module.exports.MODULES = MODULES
