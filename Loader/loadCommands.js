const fs = require('fs')
const path = require('path')

module.exports = bot => {
    const dossier = path.join(__dirname, '..', 'Commandes')

    fs.readdirSync(dossier).filter(f => f.endsWith('.js')).forEach(file => {
        const command = require(path.join(dossier, file))
        if (!command.name || typeof command.name !== 'string') throw new TypeError(`La commande ${file} n'a pas de nom valide !`)
        if (typeof command.run !== 'function') throw new TypeError(`La commande ${file} n'a pas de fonction run !`)
        bot.commands.set(command.name, command)
        console.log(`Commande ${file} chargée avec succès !`)
    })
}
