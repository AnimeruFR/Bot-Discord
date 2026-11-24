const Discord = require('discord.js')
const { openTicket, closeTicket } = require('../Fonctions/tickets')

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

        if (interaction.isButton()) {
            if (interaction.customId === "ticket") return await openTicket(bot, interaction)
            if (interaction.customId === "close") return await closeTicket(bot, interaction)
        }
    } catch (err) {
        console.error(`Erreur sur l'interaction ${interaction.commandName ?? interaction.customId ?? interaction.type} :`, err)
        if (!interaction.isRepliable()) return

        const reponse = { content: "Une erreur est survenue, l'action n'a pas pu être effectuée.", flags: Discord.MessageFlags.Ephemeral }
        if (interaction.replied || interaction.deferred) await interaction.followUp(reponse).catch(() => {})
        else await interaction.reply(reponse).catch(() => {})
    }
}
