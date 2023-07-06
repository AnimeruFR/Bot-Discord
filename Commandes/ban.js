const Discord = require('discord.js')

module.exports = {
    name: "ban",
    description: "Ban un membre",
    permission: Discord.PermissionFlagsBits.BanMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre à bannir",
            required: true,
            autocomplete: true
        }, {
            type: "string",
            name: "raison",
            description: "La raison du bannissement",
            required: true,
            autocomplete: false
        }
    ],

    async run(bot, message, args) {
        try{
            let user = await bot.users.fetch(args._hoistedOptions[0].value)
            if(!user) return message.reply("Le membre n'existe pas !")
            let member = message.guild.members.cache.get(user.id)

            let reason = args.get("raison").value;
            if(!reason) reason = "Aucune raison fournie";

            if(message.user.id === user.id) return message.reply("Vous ne pouvez pas vous bannir vous-même !")
            if((await message.guild.fetchOwner()).id === user.id) return message.reply("Ne ban pas le propriétaire du serv !")
            if(member && !member.bannable) return message.reply("Ce membre n'est pas bannissable !")
            if(member && message.member.roles.highest.position <= member.roles.highest.position) return message.reply("Vous ne pouvez pas bannir cette personne !")
            if((await message.guild.bans.fetch()).get(user.id)) return message.reply("Ce membre est déjà ban !!!")

            try{await user.send(`Tu as été banni du serveur ${message.guild.name} par ${message.user.tag} pour la raison : ***${reason}*** !`)} catch(err) {}

            await message.reply(`${message.user} a banni ${user} pour la raison : ***${reason}***`)

            await message.guild.bans.create(user.id, {reason: reason})

        } catch (err) {

            return message.reply("L'utilisateur n'existe pas !")

        }
    }
}