const Discord = require('discord.js')
const { refuser } = require('../../Fonctions/erreurs')
const { formatReason } = require('../../Fonctions/moderation')
const { sendModLog } = require('../../Fonctions/logs')
const { t } = require('../../Fonctions/i18n')
const { LIMITE_RAISONS, TAILLE_MAX, listerRaisons, ajouterRaison, retirerRaison, autocompleterRaison } = require('../../Fonctions/raisons')

const EPHEMERAL = Discord.MessageFlags.Ephemeral

module.exports = {
    name: "raisons",
    description: "Gère les raisons de sanction proposées en autocomplétion",
    permission: Discord.PermissionFlagsBits.ManageGuild,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Ajouter une raison", value: "ajouter" },
                { name: "Retirer une raison", value: "retirer" },
                { name: "Voir les raisons", value: "liste" }
            ]
        }, {
            type: "string",
            name: "texte",
            description: "La raison (pour ajouter ou retirer)",
            required: false,
            autocomplete: true,
            maxLength: TAILLE_MAX
        }
    ],

    autocomplete: (bot, interaction) => autocompleterRaison(interaction),

    async run(bot, message, args) {
        const action = args.getString("action")
        const texte = args.getString("texte")?.trim()
        const guildId = message.guild.id

        if (action === "liste") {
            const raisons = listerRaisons(guildId)
            if (raisons.length === 0) return message.reply({ content: t(message, "dos.raisons.aucune"), flags: EPHEMERAL })
            const liste = raisons.map(r => `- ${formatReason(r)}`).join("\n")
            return message.reply({ content: t(message, "dos.raisons.liste", { total: raisons.length, max: LIMITE_RAISONS, liste }), flags: EPHEMERAL })
        }

        if (!texte) return refuser(message, t(message, "dos.raisons.texte_requis"))

        if (action === "ajouter") {
            const r = ajouterRaison(guildId, texte)
            if (r !== "ok") return refuser(message, t(message, `dos.raisons.${r}`, { max: LIMITE_RAISONS, taille: TAILLE_MAX }))
            await message.reply({ content: t(message, "dos.raisons.ajoutee", { raison: formatReason(texte), total: listerRaisons(guildId).length, max: LIMITE_RAISONS }), flags: EPHEMERAL })
            return sendModLog(message, { action: "raisons", details: "Raison prédéfinie ajoutée", raison: texte })
        }

        if (!retirerRaison(guildId, texte)) return refuser(message, t(message, "dos.raisons.introuvable"))
        await message.reply({ content: t(message, "dos.raisons.retiree", { raison: formatReason(texte) }), flags: EPHEMERAL })
        await sendModLog(message, { action: "raisons", details: "Raison prédéfinie retirée", raison: texte })
    }
}
