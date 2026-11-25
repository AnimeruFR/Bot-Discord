const Discord = require('discord.js')
const tickets = require('../Fonctions/tickets')
const { t } = require('../Fonctions/i18n')
const { onClicRole } = require('../Fonctions/rolesBoutons')
const { onClicGiveaway } = require('../Fonctions/giveaways')
const { traiterErreur } = require('../Fonctions/erreurs')
const { verifierCommande } = require('../Fonctions/cooldowns')

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
                return await interaction.reply({ content: t(interaction, "commun.permission"), flags: Discord.MessageFlags.Ephemeral })
            }

            // Délai entre deux utilisations (`cooldown` dans la commande), vérifié après les droits :
            // un membre refusé ne bloque pas son propre délai
            const restant = verifierCommande(command, interaction)
            if (restant > 0) {
                const fin = Math.ceil((Date.now() + restant) / 1000)
                return await interaction.reply({ content: t(interaction, "commun.cooldown", { quand: `<t:${fin}:R>` }), flags: Discord.MessageFlags.Ephemeral })
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
            if (interaction.customId.startsWith("role:")) return await onClicRole(bot, interaction)
            if (interaction.customId.startsWith("giveaway:")) return await onClicGiveaway(bot, interaction)
        }
        if (interaction.isStringSelectMenu() && interaction.customId === "ticket-type") return await tickets.onMenuType(bot, interaction)
        if (interaction.isModalSubmit() && interaction.customId.startsWith("ticket-form:")) return await tickets.onFormulaire(bot, interaction)
    } catch (err) {
        // Erreur attendue (ErreurUtilisateur) : message clair ; sinon numéro d'incident montré au membre et écrit dans les logs
        await traiterErreur(interaction, err)
    }
}
