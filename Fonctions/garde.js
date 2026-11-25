const { t } = require('./i18n')
const { verifierAcces } = require('./staff')
const { motifIndisponible, salonsRequis } = require('./modules')
const cooldowns = require('./cooldowns')

// Garde commune (tribunal du jalon 0, grief A1) : la même suite de vérifications pour une slash commande
// et pour un composant (bouton, menu, modal), pour qu'un jeu en boutons ne contourne rien.
//   1. module désactivé sur ce serveur ou coupé en urgence ;
//   2. droits (garde staff pour Modération et Tickets, sauf composant `public`) ;
//   3. salons de jeux ;
//   4. délai (`cooldown` en secondes, déclaré par la commande ou par le composant lui-même).
// Renvoie null si tout est bon, sinon le texte (traduit) du refus à afficher en éphémère.
async function controler(interaction, declaration, { cleDelai } = {}) {
    const motif = motifIndisponible(interaction.guildId, declaration)
    if (motif) return t(interaction, `modules.${motif}`)

    if (!declaration.public && !await verifierAcces(interaction, declaration)) return t(interaction, "commun.permission")

    const salons = salonsRequis(interaction.guildId, interaction.channelId, declaration)
    if (salons) return t(interaction, "modules.salons_jeux", { salons: salons.map(id => `<#${id}>`).join(", ") })

    // Pris en dernier : un membre refusé plus haut ne consomme pas son délai
    const restant = cooldowns.prendre(cleDelai ?? declaration.name, declaration.cooldown, interaction.guildId, interaction.user.id)
    if (restant > 0) return t(interaction, "commun.cooldown", { quand: `<t:${Math.ceil((Date.now() + restant) / 1000)}:R>` })
    return null
}

// Commandes que CE membre peut voir dans /help et l'autocomplétion (griefs A3, P7) : exactement celles que la garde
// le laisserait utiliser (module actif + droits). Le salon et le délai n'entrent pas en compte : la commande reste utile.
async function commandesVisibles(bot, interaction) {
    const visibles = []
    for (const c of bot.commands.values()) {
        if (!interaction.inGuild?.() && !c.dm) continue // en MP, seulement les commandes utilisables en MP
        if (!motifIndisponible(interaction.guildId, c) && await verifierAcces(interaction, c)) visibles.push(c)
    }
    return visibles
}

module.exports = { controler, commandesVisibles }
