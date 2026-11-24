const Discord = require('discord.js')
const tickets = require('../Fonctions/tickets')

module.exports = async (bot, interaction) => {
    try {
        if (interaction.isAutocomplete()) {
            const entry = interaction.options.getFocused().toLowerCase()
            const choices = bot.commands
                .filter(cmd => cmd.name.includes(entry))
                .first(25)
                .map(cmd => ({ name: cmd.name, value: cmd.name }))
            return await interaction.respond(choices)
        }

        if (interaction.isChatInputCommand()) {
            // On ne charge que les commandes connues (jamais un require construit depuis l'interaction)
            const command = bot.commands.get(interaction.commandName)
            if (!command) return

            // Les permissions par défaut d'une slash commande peuvent être modifiées par un admin du serveur
            // (Paramètres > Intégrations) : on revérifie donc la permission réelle du membre à chaque appel
            if (typeof command.permission === "bigint" && interaction.inGuild() && !interaction.memberPermissions?.has(command.permission)) {
                return await interaction.reply({ content: "Vous n'avez pas la permission d'utiliser cette commande !", flags: Discord.MessageFlags.Ephemeral })
            }

            return await command.run(bot, interaction, interaction.options)
        }

        // Composants persistants (panneaux et salons de tickets). Les boutons de confirmation, eux,
        // sont attendus directement par la commande qui les a posés (awaitMessageComponent).
        if (interaction.isButton()) {
            if (interaction.customId === "ticket") return await tickets.onBoutonTicket(bot, interaction)
            if (interaction.customId === "close") return await tickets.closeTicket(bot, interaction)
            if (interaction.customId === "claim") return await tickets.claimTicket(bot, interaction)
            if (interaction.customId.startsWith("note:")) return await tickets.noterTicket(bot, interaction)
        }
        if (interaction.isStringSelectMenu() && interaction.customId === "ticket-type") return await tickets.onMenuType(bot, interaction)
        if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket-form:")) return await tickets.onFormulaire(bot, interaction)
    } catch (err) {
        console.error(`Erreur sur l'interaction ${interaction.commandName ?? interaction.customId ?? interaction.type} :`, err)
        if (!interaction.isRepliable()) return

        const reponse = { content: "Une erreur est survenue, l'action n'a pas pu être effectuée.", flags: Discord.MessageFlags.Ephemeral }
        if (interaction.replied || interaction.deferred) await interaction.followUp(reponse).catch(() => {})
        else await interaction.reply(reponse).catch(() => {})
    }
}
