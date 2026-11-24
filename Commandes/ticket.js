const Discord = require('discord.js')

module.exports = {
    name: "ticket",
    description: "Créer un ticket",
    permission: Discord.PermissionFlagsBits.ManageMessages,
    dm: false,
    category: "Modération",
    options: [],

    async run(bot, message, args) {
        const Embed = new Discord.EmbedBuilder()
        .setColor(bot.color)
        .setTitle("Création d'un ticket")
        .setThumbnail(bot.user.displayAvatarURL({dynamic: true}))
        .setDescription("Créer un ticket")
        .setTimestamp()
        .setFooter({text: bot.user.username, iconURL: bot.user.displayAvatarURL({dynamic: true})})

        const btn = new Discord.ActionRowBuilder().addComponents(new Discord.ButtonBuilder()
        .setCustomId("ticket")
        .setLabel("Créer un ticket")
        .setStyle(Discord.ButtonStyle.Primary)
        .setEmoji("🎫"))

        await message.reply({embeds: [Embed], components: [btn]})
    }
}