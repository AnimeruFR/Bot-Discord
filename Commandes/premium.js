const Discord = require('discord.js')
const { t } = require('../Fonctions/i18n')
const { couleur } = require('../Fonctions/apparence')
const { estPremium, boutonAchat, premiumActif, serveursOfferts } = require('../Fonctions/premium')

module.exports = {
    name: "premium",
    description: "Offre premium de ce serveur (statut et fonctions)",
    permission: "Aucune",
    dm: false,
    category: "Information",
    options: [],

    async run(bot, message) {
        const embed = new Discord.EmbedBuilder().setColor(couleur(message.guild)).setTitle(t(message, "premium.titre"))
        if (!premiumActif()) {
            embed.setDescription(t(message, "premium.desactive"))
            return message.reply({ embeds: [embed], flags: Discord.MessageFlags.Ephemeral })
        }

        const premium = await estPremium(bot, message.guildId, message)
        const statut = !premium ? "premium.inactif" : serveursOfferts().has(message.guildId) ? "premium.offert" : "premium.actif"
        embed.setDescription(`${t(message, statut)}\n\n${t(message, "premium.liste")}`)
        // Bouton d'achat seulement si le serveur n'a pas déjà le premium
        await message.reply({ embeds: [embed], components: premium ? [] : boutonAchat(), flags: Discord.MessageFlags.Ephemeral })
    }
}
