const { corrigerPseudo } = require('../Fonctions/pseudos')
const { retirerRolesAjoutes } = require('../Fonctions/quarantaine')

// Changement de pseudo : le filtre de pseudos (#25) corrige le nouveau pseudo.
// Le renommage du bot redéclenche cet événement : le pseudo corrigé est déjà propre, donc rien à refaire (voir corrigerPseudo).
// Un rôle ajouté à un membre en quarantaine est retiré (le retrait redéclenche l'événement, sans rien à retirer cette fois).
module.exports = async (bot, ancien, membre) => {
    try {
        await retirerRolesAjoutes(bot, membre)
    } catch (err) {
        console.error("Quarantaine (rôle ajouté) :", err.message)
    }
    try {
        // Rôles, mise en sourdine… : seul le pseudo affiché nous intéresse (ancien membre absent du cache : on vérifie quand même)
        if (!ancien.partial && ancien.displayName === membre.displayName) return
        await corrigerPseudo(membre)
    } catch (err) {
        console.error("Filtre de pseudos :", err.message)
    }
}
