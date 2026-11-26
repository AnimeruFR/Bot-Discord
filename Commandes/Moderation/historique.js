const Discord = require('discord.js')
const { afficherDossier } = require('../../Fonctions/dossier')

// Gardée pour les habitudes : ouvre le dossier du membre (mêmes pages, mêmes règles) directement sur ses sanctions
module.exports = {
    name: "historique",
    description: "Affiche l'historique des sanctions d'un membre",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    // Le rôle staff du serveur (/config) suffit : aucune action avec les pouvoirs propres du bot
    roleStaffSuffit: true,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre dont on veut voir l'historique",
            required: true
        }
    ],

    async run(bot, message, args) {
        await afficherDossier(message, args.getUser("membre"), { depart: "sanctions" })
    }
}
