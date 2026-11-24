const Discord = require('discord.js')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral

module.exports = {
    name: "ticket",
    description: "Poste le panneau de création de tickets dans ce salon",
    permission: Discord.PermissionFlagsBits.ManageMessages,
    dm: false,
    category: "Modération",
    options: [],

    async run(bot, message, args) {
        const channel = message.channel
        if (channel?.type !== Discord.ChannelType.GuildText) {
            return message.reply({ content: "Le panneau doit être posté dans un salon textuel.", flags: EPHEMERAL })
        }
        if (!channel.permissionsFor(message.guild.members.me)?.has([Flags.ViewChannel, Flags.SendMessages, Flags.EmbedLinks])) {
            return message.reply({ content: "Je ne peux pas écrire dans ce salon (il me faut Voir, Envoyer des messages et Intégrer des liens).", flags: EPHEMERAL })
        }

        const embed = new Discord.EmbedBuilder()
            .setColor(bot.color)
            .setTitle("Besoin d'aide ?")
            .setThumbnail(bot.user.displayAvatarURL())
            .setDescription("Clique sur le bouton ci-dessous pour ouvrir un ticket privé avec le staff.")
            .setFooter({ text: bot.user.username, iconURL: bot.user.displayAvatarURL() })

        const btn = new Discord.ActionRowBuilder().addComponents(new Discord.ButtonBuilder()
            .setCustomId("ticket")
            .setLabel("Créer un ticket")
            .setStyle(Discord.ButtonStyle.Primary)
            .setEmoji("🎫"))

        // Message simple (pas une réponse à la commande) : le panneau ne montre pas qui l'a posté
        await channel.send({ embeds: [embed], components: [btn] })
        await message.reply({ content: "Panneau de tickets posté.", flags: EPHEMERAL })
    }
}
