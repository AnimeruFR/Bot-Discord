const Discord = require('discord.js')

// Construit la définition d'une slash commande à partir du fichier de commande
function buildSlashCommand(command) {
    const slashcommand = new Discord.SlashCommandBuilder()
        .setName(command.name)
        .setDescription(command.description)
        .setDMPermission(command.dm)
        .setDefaultMemberPermissions(command.permission === "Aucune" ? null : command.permission)

    for (const opt of command.options ?? []) {
        const type = opt.type.charAt(0).toUpperCase() + opt.type.slice(1)
        slashcommand[`add${type}Option`](option => {
            option.setName(opt.name).setDescription(opt.description).setRequired(opt.required)
            if (opt.type === "string") {
                option.setAutocomplete(opt.autocomplete ?? false)
                if (opt.maxLength) option.setMaxLength(opt.maxLength)
            }
            if (opt.minValue !== undefined) option.setMinValue(opt.minValue)
            if (opt.maxValue !== undefined) option.setMaxValue(opt.maxValue)
            if (opt.channelTypes) option.addChannelTypes(...opt.channelTypes)
            return option
        })
    }

    return slashcommand
}

module.exports = async bot => {
    const commands = bot.commands.map(buildSlashCommand)

    const rest = new Discord.REST({ version: '10' }).setToken(bot.token)
    await rest.put(Discord.Routes.applicationCommands(bot.user.id), { body: commands })
    console.log(`Les slashs commandes sont créées avec succès !`)
}

module.exports.buildSlashCommand = buildSlashCommand
