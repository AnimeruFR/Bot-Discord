const Discord = require('discord.js')
const { dossier } = require('../../Fonctions/signalements')

module.exports = {
    name: "Dossier",
    type: "user",
    description: "Affiche le dossier d'un membre : dernières sanctions, warns et notes du staff (clic droit sur le membre)",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    // Le rôle staff du serveur (/config) suffit : lecture seule
    roleStaffSuffit: true,
    dm: false,
    category: "Modération",

    async run(bot, interaction) {
        await dossier(interaction)
    }
}
