const Discord = require('discord.js')
const { traductionsCommande, localisation } = require('../Fonctions/i18n')

// Construit la définition d'une slash commande à partir du fichier de commande
function buildSlashCommand(command) {
    const contexts = [Discord.InteractionContextType.Guild]
    if (command.dm) contexts.push(Discord.InteractionContextType.BotDM)

    const slashcommand = new Discord.SlashCommandBuilder()
        .setName(command.name)
        .setDescription(command.description)
        .setIntegrationTypes(Discord.ApplicationIntegrationType.GuildInstall)
        .setContexts(contexts)
        .setDefaultMemberPermissions(command.permission === "Aucune" ? null : command.permission)

    // Traductions anglaises (locales/commandes.en.json) : Discord les affiche aux membres dont le client est en anglais
    const en = traductionsCommande(command.name)
    if (en?.description) slashcommand.setDescriptionLocalizations(localisation(en.description))

    for (const opt of command.options ?? []) {
        const type = opt.type.charAt(0).toUpperCase() + opt.type.slice(1)
        slashcommand[`add${type}Option`](option => {
            option.setName(opt.name).setDescription(opt.description).setRequired(opt.required)
            if (en?.options?.[opt.name]) option.setDescriptionLocalizations(localisation(en.options[opt.name]))
            if (opt.type === "string") {
                option.setAutocomplete(opt.autocomplete ?? false)
                if (opt.maxLength) option.setMaxLength(opt.maxLength)
            }
            // Liste fermée de valeurs (25 au plus) : { name: "texte affiché", value: "valeur reçue" }
            if (opt.choices) {
                option.addChoices(...opt.choices.map(choix => {
                    const traduit = en?.choix?.[opt.name]?.[choix.value]
                    return traduit ? { ...choix, name_localizations: localisation(traduit) } : choix
                }))
            }
            if (opt.minValue !== undefined) option.setMinValue(opt.minValue)
            if (opt.maxValue !== undefined) option.setMaxValue(opt.maxValue)
            if (opt.channelTypes) option.addChannelTypes(...opt.channelTypes)
            return option
        })
    }

    return slashcommand
}

// Envoie les commandes à Discord : sur un serveur précis (immédiat, pour tester) ou partout (global)
async function deploySlashCommands(token, commands, guildId) {
    const rest = new Discord.REST({ version: '10' }).setToken(token)
    const application = await rest.get(Discord.Routes.currentApplication())
    const body = commands.map(command => buildSlashCommand(command).toJSON())

    const route = guildId
        ? Discord.Routes.applicationGuildCommands(application.id, guildId)
        : Discord.Routes.applicationCommands(application.id)

    return rest.put(route, { body })
}

module.exports = { buildSlashCommand, deploySlashCommands }
