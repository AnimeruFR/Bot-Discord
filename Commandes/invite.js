const Discord = require('discord.js')
const { t } = require('../Fonctions/i18n')
const { lienInvitation, lienValide } = require('../Fonctions/invitation')

module.exports = {
    name: "invite",
    description: "Lien pour ajouter le bot à un serveur",
    permission: "Aucune",
    dm: true,
    category: "Information",
    options: [],

    async run(bot, message) {
        const boutons = [new Discord.ButtonBuilder().setStyle(Discord.ButtonStyle.Link)
            .setLabel(t(message, "crois.bouton_inviter")).setURL(lienInvitation(bot.user.id))]
        const support = lienValide(process.env.SUPPORT_URL)
        if (support) boutons.push(new Discord.ButtonBuilder().setStyle(Discord.ButtonStyle.Link).setLabel(t(message, "crois.bouton_support")).setURL(support))

        await message.reply({
            content: t(message, "crois.invite"),
            components: [new Discord.ActionRowBuilder().addComponents(boutons)],
            flags: Discord.MessageFlags.Ephemeral
        })
    }
}
