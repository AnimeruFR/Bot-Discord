const Discord = require('discord.js')
const { ouvrirWarnRapide, warnRapide, PREFIXE_WARN } = require('../../Fonctions/signalements')

module.exports = {
    name: "Warn rapide",
    type: "user",
    description: "Avertit un membre en indiquant une raison (clic droit sur le membre)",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    dm: false,
    category: "Modération",
    composants: [
        { prefixe: PREFIXE_WARN, types: ["modal"], gestionnaire: warnRapide }
    ],

    async run(bot, interaction) {
        await ouvrirWarnRapide(interaction)
    }
}
