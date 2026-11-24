const fs = require('fs')
const path = require('path')

module.exports = bot => {
    const dossier = path.join(__dirname, '..', 'Events')

    fs.readdirSync(dossier).filter(f => f.endsWith('.js')).forEach(file => {
        const event = require(path.join(dossier, file))
        bot.on(path.basename(file, '.js'), event.bind(null, bot))
        console.log(`Événement ${file} chargé avec succès !`)
    })
}
