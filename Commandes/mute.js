const Discord = require('discord.js')
const ms = require('ms')

module.exports = {

    name: "mute",
    description: "mute un membre",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre à mute",
            required: true,
            autocomplete: true
        }, {
            type: "string",
            name: "temps",
            description: "Le temps à mute",
            required: true,
            autocomplete: false
        }, {
            type: "string",
            name: "raison",
            description: "La raison du mute",
            required: false,
            autocomplete: false
        }
    ],

    async run(bot,message, args) {
        
        let user = args.getUser("membre")
        if(!user) return message.reply("Le membre n'existe pas !")
        let member = message.guild.members.cache.get(user.id)
        if(!member) return message.reply("Pas de membre à mute !")

        let time = args.getString("temps")
        if(!time) return message.reply("Pas de temps indiqué !")
        if(isNaN(ms(time))) return message.reply("Le temps n'est pas un nombre!")
        if(ms(time) > 2419200000) return message.reply("Le temps est trop long !")

        let reason = args.getString("raison")
        if(!reason) reason = "Aucune raison fournie !"

        if(message.user.id === user.id) return message.reply("Vous ne pouvez vous mute vous-même !!!")
        if((await message.guild.fetchOwner()).id === user.id) return message.reply("Vous ne pouvez pas mute le propriétaire du serveur !")
        if(!member.moderatable) return message.reply("Impossible de mute ce membre !")
        if(member.roles.highest.position >= message.member.roles.highest.position) return message.reply("Vous ne pouvez pas mute ce membre!")
        if(member.isCommunicationDisabled()) return message.reply("Ce membre est déjà mute !")

        try{await user.send(`Tu as été mute du serveur ${message.guild.name} par ${message.user.tag} pendant ${time} pour la raison : ***${reason}*** !`)} catch(err) {}

        await message.reply(`${message.user} a mute ${user} pendant ${time} pour la raison : ***${reason}***`)

        await member.timeout(ms(time), reason)

    }
}