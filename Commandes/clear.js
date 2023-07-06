const Discord = require('discord.js')

module.exports = {
    name: "clear",
    description: "Clear un salon",
    permission: Discord.PermissionFlagsBits.ManageMessages,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "number",
            name: "nombre",
            description: "Nombre de message à effacer",
            required: true,
            autocomplete: false
        },
        {
            type: "channel",
            name: "salon",
            description: "Le salon dans lequel les messages seront effacés",
            required: false,
            autocomplete: true
        } 
    ],

    async run(bot, message, args) {
        let channel = args.getChannel("salon")
        if(!channel) channel = message.channel
        if(channel.id !== message.channel.id && !message.guild.channels.cache.get(channel.id)) return message.reply("Pas de salon !")

        let number = args.getNumber("nombre")
        if(parseInt(number) <= 0 || parseInt(number) > 100) return message.reply("Veuillez saisir un nombre entre 0 et 100 !")

        try {

            let messages = await channel.bulkDelete(parseInt(number))
            await message.reply({content: `Suppression de ${messages.size} messages effectué dans le salon ${channel} !`, ephemeral: true})

        } catch(err){

            let messages = [...(await channel.messages.fetch()).filter(msg => (Date.now() - msg.createdAt) <= 1209600000).values()]
            if(messages.length <= 0) return message.reply("Aucun message à effacer car ils ont tous une datation de plus de 14j !")
            await channel.bulkDelete(messages)

            await message.reply({content: `Suppression de seulement ${messages.length} messages effectué dans le salon ${channel} car les autres messages ont une datation supérieur à 14j !`, ephemeral: true})
            
        }
    }
}