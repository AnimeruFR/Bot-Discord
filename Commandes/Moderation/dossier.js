const Discord = require('discord.js')
const { afficherDossier } = require('../../Fonctions/dossier')

module.exports = {
    name: "dossier",
    description: "Dossier complet d'un membre : sanctions, notes du staff, tickets et appels",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    // Le rôle staff du serveur (/config) suffit : lecture seule
    roleStaffSuffit: true,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre dont on veut le dossier",
            required: true
        }
    ],

    async run(bot, message, args) {
        await afficherDossier(message, args.getUser("membre"))
    }
}
