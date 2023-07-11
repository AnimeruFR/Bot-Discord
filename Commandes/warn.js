const Discord = require('discord.js')

module.exports = {
    name: "warn",
    description: "Warn un membre",
    permission: Discord.PermissionFlagsBits.ManageMessages,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre à warn",
            required: true,
            autocomplete: true
        }, {
            type: "string",
            name: "raison",
            description: "La raison du warn",
            required: false,
            autocomplete: false
        }
    ],

    async run(bot, message, args) {
        let user = args.getUser("membre")
        if(!user) return message.reply("Pas de membre !")
        let member = message.guild.members.cache.get(user.id)
        if(!member) return message.reply("Pas de membre !")

        let reason = args.getString("raison")
        if(!reason) reason = "Pas de raison fournis."

        if(message.user.id === user.id) return message.reply("Vous ne pouvez pas vous warn vous-même !")
        if((await message.guild.fetchOwner()).id === user.id) return message.reply("Ne warn pas le propriétaire du serv !")
        if(member && message.member.roles.highest.position <= member.roles.highest.position) return message.reply("Vous ne pouvez pas warn cette personne !")

        try{
            await user.send(`${message.user.tag} vous a warn sur le serveur ${message.guild.name}, pour la raison : \`${reason}\``)
        }
        catch(error){}
        
        await message.reply(`Vous avez warn ${user} pour la raison : \`${reason}\` avec succès !`)
    }
}