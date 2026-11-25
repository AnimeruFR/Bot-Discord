const Discord = require('discord.js')
const { t } = require('../../Fonctions/i18n')
const { refuser } = require('../../Fonctions/erreurs')
const { isStaff } = require('../../Fonctions/tickets')
const macros = require('../../Fonctions/macros')

const { Flags } = Discord.PermissionsBitField

module.exports = {
    name: "reponse",
    description: "Réponses prédéfinies : les envoyer dans un ticket, les ajouter ou les retirer",
    // « Gérer les messages » ou staff du ticket pour envoyer et lister ; ajouter et retirer demandent « Gérer le serveur » (revérifié dans run)
    permission: Discord.PermissionFlagsBits.ManageMessages,
    acces: interaction => isStaff(interaction, interaction.channel),
    composants: [
        { prefixe: "macro:", types: ["modal"], gestionnaire: macros.onFormulaire }
    ],
    dm: false,
    category: "Modération",
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Envoyer dans ce ticket", value: "envoyer" },
                { name: "Ajouter une réponse", value: "ajouter" },
                { name: "Retirer une réponse", value: "retirer" },
                { name: "Lister les réponses", value: "liste" }
            ]
        }, {
            type: "string",
            name: "nom",
            description: "Nom de la réponse",
            required: false,
            autocomplete: true,
            maxLength: 32
        }
    ],

    async run(bot, interaction, args) {
        const action = args.getString("action")
        const nom = args.getString("nom")

        if (action === "liste") return macros.afficherListe(interaction)
        if ((action === "envoyer" || action === "retirer") && !nom) return refuser(interaction, t(interaction, "mac.nom_requis"))
        if (action === "envoyer") return macros.envoyer(interaction, nom)

        // Ajouter et retirer modifient la configuration du serveur
        if (!interaction.memberPermissions.has(Flags.ManageGuild)) return refuser(interaction, t(interaction, "mac.perm_gestion"))
        if (action === "retirer") return macros.supprimer(interaction, nom)
        return macros.montrerFormulaire(interaction, nom)
    },

    async autocomplete(bot, interaction) {
        await interaction.respond(macros.propositions(interaction.guildId, interaction.options.getFocused()))
    }
}
