const { envoyer } = require('../Fonctions/bienvenue')
const { appliquerFiltre } = require('../Fonctions/antiraid')
const { noterArrivee } = require('../Fonctions/raid')
const { corrigerPseudo } = require('../Fonctions/pseudos')
const { accueillir } = require('../Fonctions/verification')
const { reappliquer } = require('../Fonctions/quarantaine')

// Une étape qui échoue ne bloque jamais les suivantes ni l'événement
const sans = async (nom, fn) => {
    try {
        return await fn()
    } catch (err) {
        console.error(`Arrivée d'un membre, étape ${nom} :`, err.message)
        return null
    }
}

// Arrivée d'un membre, dans l'ordre :
//   1. anti-raid (#2) : chaque arrivée compte, même un compte filtré ensuite ;
//   2. filtre des comptes récents (#3) : un compte expulsé s'arrête là ;
//   3. filtre de pseudos (#25) ;
//   4. quarantaine (#14) : un membre parti en quarantaine la retrouve en revenant ;
//   5. vérification (#4) ;
//   6. message de bienvenue (/bienvenue).
module.exports = async (bot, member) => {
    await sans("anti-raid", () => noterArrivee(member))
    const filtre = await sans("filtre", () => appliquerFiltre(member))
    if (filtre?.action === "kick" && filtre.ok) return // expulsé : pas de bienvenue
    await sans("pseudo", () => corrigerPseudo(member))
    await sans("quarantaine", () => reappliquer(member))
    await sans("vérification", () => accueillir(member))
    await envoyer(member, "bienvenue")
}
