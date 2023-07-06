const Discord = require('discord.js')

module.exports = {

    name: "ping",
    description: "affiche le ping du bot",
    permission: "Aucune",
    dm: true,
    category: "Information",

    async run(bot,message, args) {
        await message.reply(`Ping : \`${bot.ws.ping} ms\``)
    }
}