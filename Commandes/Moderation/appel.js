const Discord = require('discord.js')
const { couleur } = require('../../Fonctions/apparence')
const { t } = require('../../Fonctions/i18n')
const { formatReason } = require('../../Fonctions/moderation')
const {
    PREFIXE_OUVRIR, PREFIXE_ENVOI, PREFIXE_OUI, PREFIXE_NON, listerEnAttente, ouvrirAppel, envoyerAppel, decider
} = require('../../Fonctions/appels')

const EPHEMERAL = Discord.MessageFlags.Ephemeral

module.exports = {
    name: "appel",
    description: "Liste les appels de sanction en attente",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: false,
            choices: [
                { name: "Voir les appels en attente", value: "liste" }
            ]
        }
    ],

    // Les boutons du MP et le formulaire sont publics (le membre n'est pas staff) : ils vérifient eux-mêmes ses droits.
    // Accepter et Refuser passent par la garde staff de la commande (ModerateMembers), comme /case.
    composants: [
        { prefixe: PREFIXE_OUVRIR, types: ["bouton"], public: true, gestionnaire: ouvrirAppel },
        { prefixe: PREFIXE_ENVOI, types: ["modal"], public: true, gestionnaire: envoyerAppel },
        { prefixe: PREFIXE_OUI, types: ["bouton"], gestionnaire: decider },
        { prefixe: PREFIXE_NON, types: ["bouton"], gestionnaire: decider }
    ],

    async run(bot, message) {
        const appels = listerEnAttente(message.guild.id)
        if (appels.length === 0) return message.reply({ content: t(message, "appel.liste_aucune"), flags: EPHEMERAL })
        const lignes = appels.map(a => t(message, "appel.liste_ligne", {
            id: a.id, sanction: a.case_id, user: a.user_id, date: Math.floor(a.created_at / 1000), texte: formatReason(a.content).replace(/\s+/g, " ").slice(0, 150)
        }))
        const embed = new Discord.EmbedBuilder()
            .setColor(couleur(message.guild))
            .setTitle(t(message, "appel.liste_titre"))
            .setDescription(lignes.join("\n\n").slice(0, 4096))
            .setFooter({ text: t(message, "appel.liste_pied") })
        await message.reply({ embeds: [embed], flags: EPHEMERAL })
    }
}
