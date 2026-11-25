const { corrigerPseudo } = require('../Fonctions/pseudos')

// Changement de pseudo : le filtre de pseudos (#25) corrige le nouveau pseudo.
// Le renommage du bot redéclenche cet événement : le pseudo corrigé est déjà propre, donc rien à refaire (voir corrigerPseudo).
module.exports = async (bot, ancien, membre) => {
    try {
        // Rôles, mise en sourdine… : seul le pseudo affiché nous intéresse (ancien membre absent du cache : on vérifie quand même)
        if (!ancien.partial && ancien.displayName === membre.displayName) return
        await corrigerPseudo(membre)
    } catch (err) {
        console.error("Filtre de pseudos :", err.message)
    }
}
