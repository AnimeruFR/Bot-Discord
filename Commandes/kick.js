const Discord = require('discord.js')

module.exports = {
    name: "kick",
    description: "Kick un membre",
    permission: Discord.PermissionFlagsBits.KickMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre à kick",
            required: true,
            autocomplete: true
        }, {
            type: "string",
            name: "raison",
            description: "La raison du kick",
            required: true,
            autocomplete: false
        }
    ],

    async run(bot, message, args) {
        let user = args.getUser("membre")
        if(!user) return message.reply("Le membre n'existe pas !")
        let member = message.guild.members.cache.get(user.id)
        if(!member) return message.reply("Pas de membre à kick !")

        let reason = args.getString("raison")
        if(!reason) reason = "Aucune raison fournie";

        if(message.user.id === user.id) return message.reply("Vous ne pouvez pas vous kick vous-même !")
        if((await message.guild.fetchOwner()).id === user.id) return message.reply("Ne kick pas le propriétaire du serv !")
        if(member && !member.kickable) return message.reply("Ce membre ne peut pas être kick !")
        if(member && message.member.roles.highest.position <= member.roles.highest.position) return message.reply("Vous ne pouvez pas kick cette personne !")

        try{await user.send(`Tu as été kick du serveur ${message.guild.name} par ${message.user.tag} pour la raison : ***${reason}*** !`)} catch(err) {}

        await message.reply(`${message.user} a kick ${user} pour la raison : ***${reason}***`)

        await member.kick(reason)
        
    }
}