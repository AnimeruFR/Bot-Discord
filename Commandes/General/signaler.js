const { ouvrirSignalement, recevoirSignalement, PREFIXE_SIGNALEMENT } = require('../../Fonctions/signalements')

module.exports = {
    name: "Signaler au staff",
    type: "message",
    description: "Signale un message au staff du serveur (clic droit sur le message)",
    permission: "Aucune",
    cooldown: 60,
    dm: false,
    category: "Information",
    composants: [
        // Le modal est rempli par un membre ordinaire : public (tout est revérifié à la soumission)
        { prefixe: PREFIXE_SIGNALEMENT, types: ["modal"], public: true, gestionnaire: recevoirSignalement }
    ],

    async run(bot, interaction) {
        await ouvrirSignalement(interaction)
    }
}
