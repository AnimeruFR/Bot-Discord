const Discord = require('discord.js')

module.exports = async(bot, interaction) => {

    if(interaction.type === Discord.InteractionType.ApplicationCommandAutocomplete){

        let entry = interaction.options.getFocused()

        if(interaction.commandName){
            let choices = bot.commands.filter(cmd => cmd.name.includes(entry))
            await interaction.respond(entry === "" ? bot.commands.map(cmd => ({name: cmd.name, value: cmd.name})) : choices.map(choice => ({name: choice, value: choice})))
        }
    }

    if(interaction.type === Discord.InteractionType.ApplicationCommand) {
        let command = require(`../Commandes/${interaction.commandName}`)
        command.run(bot, interaction, interaction.options)
    }

    if(interaction.isButton()) {
        if(interaction.customId === "ticket"){

            let channel = await interaction.guild.channels.create({
                name : `ticket-${interaction.user.username}`,
                type : Discord.ChannelType.GuildText
            })
            
            await channel.setParent(interaction.channel.parent.id)

            await channel.permissionOverwrites.create(interaction.guild.roles.everyone, {
                ViewChannel: false
            })

            await channel.permissionOverwrites.create(interaction.user, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
                AttachFiles: true,
                EmbedLinks: true
            })

            await channel.permissionOverwrites.create("1105190954710868070", {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
                AttachFiles: true,
                EmbedLinks: true
            })

            await channel.setTopic(interaction.user.id)
            await interaction.reply({content: `Votre ticket a correctement été créé : ${channel}`, ephemeral: true})

            let Embed = new Discord.EmbedBuilder()
            .setColor(bot.color)
            .setTitle("Ticket")
            .setThumbnail(bot.user.displayAvatarURL({dynamic: true}))
            .setDescription("Bienvenue dans votre ticket woullah")
            .setTimestamp()
            .setFooter({text: bot.user.username, iconURL: bot.user.displayAvatarURL({dynamic: true})})

            const btn = new Discord.ActionRowBuilder().addComponents(new Discord.ButtonBuilder()
            .setCustomId("close")
            .setLabel("Fermer le ticket")
            .setStyle(Discord.ButtonStyle.Danger)
            .setEmoji("🗑️"))

            await channel.send({embeds: [Embed], components: [btn]})
        }

        if(interaction.customId === "close"){
            let user = bot.users.cache.get(interaction.channel.topic)
            try{await user.send(`Votre ticker a été fermé`)} catch(err) {}

            await interaction.channel.delete()
        }
    }
}