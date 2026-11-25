const Discord = require('discord.js')
const { muteRapide, traiterSignalement, PREFIXE_ACTION } = require('../../Fonctions/signalements')

module.exports = {
    name: "Mute 10 min",
    type: "user",
    description: "Mute un membre pendant 10 minutes (clic droit sur le membre)",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    dm: false,
    category: "Modération",
    composants: [
        // Boutons Warn / Mute 10 min / Ignorer des signalements : déclarés ici (sans roleStaffSuffit) car le mute
        // utilise les pouvoirs du bot, donc la vraie permission ModerateMembers est exigée, comme pour /mute
        { prefixe: PREFIXE_ACTION, types: ["bouton"], gestionnaire: traiterSignalement }
    ],

    async run(bot, interaction) {
        await muteRapide(interaction)
    }
}
