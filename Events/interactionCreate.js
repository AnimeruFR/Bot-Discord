const Discord = require('discord.js')
const { traiterErreur } = require('../Fonctions/erreurs')
const { liberer } = require('../Fonctions/cooldowns')
const { controler, commandesVisibles } = require('../Fonctions/garde')
const { verifierAcces } = require('../Fonctions/staff')
const { motifIndisponible } = require('../Fonctions/modules')

const EPHEMERAL = Discord.MessageFlags.Ephemeral

module.exports = async (bot, interaction) => {
    try {
        if (interaction.isAutocomplete()) {
            // Une commande peut fournir sa propre autocomplétion (raisons, réponses prédéfinies…) : seulement si la
            // garde la laisserait l'utiliser (sinon, aucune proposition : on ne divulgue pas de données du staff)
            const command = bot.commands.get(interaction.commandName)
            if (command?.autocomplete) {
                if (motifIndisponible(interaction.guildId, command) || !await verifierAcces(interaction, command)) return await interaction.respond([])
                return await command.autocomplete(bot, interaction)
            }
            // Autocomplétion de /help : seulement les commandes que ce membre peut utiliser (staff masqué, modules désactivés)
            const entry = String(interaction.options.getFocused()).toLowerCase()
            const choices = (await commandesVisibles(bot, interaction))
                .filter(cmd => cmd.name.includes(entry))
                .slice(0, 25)
                .map(cmd => ({ name: cmd.name, value: cmd.name }))
            return await interaction.respond(choices)
        }

        // Slash commandes et menus contextuels (clic droit sur un membre ou un message) : même garde
        if (interaction.isChatInputCommand() || interaction.isContextMenuCommand?.()) {
            // On ne charge que les commandes connues (jamais un require construit depuis l'interaction)
            const command = bot.commands.get(interaction.commandName)
            if (!command) return

            // Module, droits (revérifiés à chaque appel : un admin peut ouvrir une commande à d'autres dans
            // Paramètres > Intégrations), salons de jeux et délai : même garde que les composants (Fonctions/garde.js)
            const refus = await controler(interaction, command)
            if (refus) return await interaction.reply({ content: refus, flags: EPHEMERAL })

            try {
                return await command.run(bot, interaction, interaction.options)
            } catch (err) {
                // La commande a échoué : le membre peut réessayer sans attendre son délai
                liberer(command.name, interaction.guildId, interaction.user.id)
                throw err
            }
        }

        // Boutons, menus et formulaires persistants : déclarés par les commandes (`composants`), routés par préfixe (#89),
        // avec la même garde. Les boutons de confirmation, eux, sont attendus par la commande qui les a posés.
        await bot.routeur.router(bot, interaction)
    } catch (err) {
        // Erreur attendue (ErreurUtilisateur) : message clair ; sinon numéro d'incident montré au membre et écrit dans les logs
        await traiterErreur(interaction, err)
    }
}
