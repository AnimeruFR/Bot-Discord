const Discord = require('discord.js')
const { auditReason } = require('../../Fonctions/moderation')
const { sendModLog, getLogChannel } = require('../../Fonctions/logs')
const { t } = require('../../Fonctions/i18n')

const { TriggerType, ActionType, EventType } = {
    TriggerType: Discord.AutoModerationRuleTriggerType,
    ActionType: Discord.AutoModerationActionType,
    EventType: Discord.AutoModerationRuleEventType
}
const EPHEMERAL = Discord.MessageFlags.Ephemeral

// Règles que le bot sait créer. Une seule de chaque sorte : on modifie la règle existante au lieu d'en ajouter.
const REGLES = {
    "mots-interdits": { nom: "[Bot] Mots interdits", type: TriggerType.Keyword },
    invitations: { nom: "[Bot] Invitations Discord", type: TriggerType.Keyword },
    mentions: { nom: "[Bot] Mentions en masse", type: TriggerType.MentionSpam },
    spam: { nom: "[Bot] Spam", type: TriggerType.Spam }
}
// Liens d'invitation (syntaxe Rust, sans lookaround, 260 caractères maximum)
const REGEX_INVITATIONS = ["(?i)(discord\\.gg|discord(app)?\\.com/invite|discord\\.me)/[a-z0-9-]+"]

// Mots séparés par des virgules -> liste validée selon les limites de Discord (1000 mots, 60 caractères chacun)
function lireMots(valeur, cible = null) {
    const mots = [...new Set((valeur ?? "").split(",").map(m => m.trim()).filter(Boolean))]
    if (mots.length === 0) return { erreur: t(cible ?? "fr", "eng.automod.mots_vides") }
    if (mots.length > 1000) return { erreur: t(cible ?? "fr", "eng.automod.mots_max") }
    const tropLong = mots.find(m => m.length > 60)
    if (tropLong) return { erreur: t(cible ?? "fr", "eng.automod.mot_long") }
    return { mots }
}

function metadonnees(action, valeur, cible = null) {
    if (action === "mots-interdits") {
        const { mots, erreur } = lireMots(valeur, cible)
        return erreur ? { erreur } : { triggerMetadata: { keywordFilter: mots } }
    }
    if (action === "invitations") return { triggerMetadata: { regexPatterns: REGEX_INVITATIONS } }
    if (action === "mentions") {
        const limite = Number(valeur)
        if (!Number.isInteger(limite) || limite < 1 || limite > 50) return { erreur: t(cible ?? "fr", "eng.automod.mentions_valeur") }
        return { triggerMetadata: { mentionTotalLimit: limite } }
    }
    return { triggerMetadata: undefined } // spam : pas de réglage
}

module.exports = {
    name: "automod",
    description: "Règles AutoMod natives de Discord (mots interdits, invitations, mentions, spam)",
    permission: Discord.PermissionFlagsBits.ManageGuild,
    dm: false,
    category: "Configuration",
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Voir les règles du bot", value: "liste" },
                { name: "Mots interdits (remplace la liste)", value: "mots-interdits" },
                { name: "Bloquer les invitations Discord", value: "invitations" },
                { name: "Limiter les mentions", value: "mentions" },
                { name: "Filtre anti-spam de Discord", value: "spam" },
                { name: "Supprimer une règle du bot", value: "supprimer" }
            ]
        }, {
            type: "string",
            name: "valeur",
            description: "Mots séparés par des virgules, nombre de mentions, ou ID de la règle à supprimer",
            required: false,
            maxLength: 4000
        }
    ],

    async run(bot, message, args) {
        const action = args.getString("action")
        const valeur = args.getString("valeur")
        const guild = message.guild

        if (!guild.members.me.permissions.has(Discord.PermissionFlagsBits.ManageGuild)) {
            return message.reply({ content: t(message, "eng.automod.perm_bot"), flags: EPHEMERAL })
        }

        // Vérifié avant tout appel à Discord
        const reglage = REGLES[action] ? metadonnees(action, valeur, message) : {}
        if (reglage.erreur) return message.reply({ content: reglage.erreur, flags: EPHEMERAL })

        await message.deferReply({ flags: EPHEMERAL })
        // Seules les règles créées par le bot sont listées, modifiées ou supprimées (jamais celles des admins)
        const reglesDuBot = (await guild.autoModerationRules.fetch()).filter(r => r.creatorId === bot.user.id)

        if (action === "liste") {
            const lignes = reglesDuBot.map(r => t(message, "eng.automod.ligne", { nom: r.name, id: r.id, etat: t(message, r.enabled ? "eng.automod.etat_active" : "eng.automod.etat_desactivee") }))
            return message.editReply(lignes.length
                ? `${lignes.join("\n")}${t(message, "eng.automod.liste_pied")}`
                : t(message, "eng.automod.aucune"))
        }

        if (action === "supprimer") {
            const regle = /^\d{17,20}$/.test(valeur?.trim() ?? "") ? reglesDuBot.get(valeur.trim()) : null
            if (!regle) return message.editReply(t(message, "eng.automod.supprimer_id"))
            await regle.delete(auditReason(message, "Suppression de règle AutoMod"))
            await message.editReply(t(message, "eng.automod.supprimee", { nom: regle.name }))
            return sendModLog(message, { action: "automod", details: `Règle supprimée : ${regle.name}` })
        }

        const { nom, type } = REGLES[action]
        // Actions : bloquer le message, et prévenir dans le salon de logs s'il est utilisable
        const actions = [{ type: ActionType.BlockMessage, metadata: { customMessage: t(guild, "eng.automod.bloque") } }]
        const logs = getLogChannel(guild)
        if (logs) actions.push({ type: ActionType.SendAlertMessage, metadata: { channel: logs.id } })

        const existante = reglesDuBot.find(r => r.name === nom && r.triggerType === type)
        try {
            if (existante) {
                await existante.edit({ triggerMetadata: reglage.triggerMetadata, actions, enabled: true, reason: auditReason(message, "Mise à jour AutoMod") })
            } else {
                await guild.autoModerationRules.create({
                    name: nom, eventType: EventType.MessageSend, triggerType: type,
                    triggerMetadata: reglage.triggerMetadata, actions, enabled: true,
                    reason: auditReason(message, "Création de règle AutoMod")
                })
            }
        } catch (err) {
            console.error("Échec AutoMod :", err.message)
            return message.editReply(t(message, "eng.automod.refuse"))
        }

        const alerte = logs ? t(message, "eng.automod.alertes", { salon: logs }) : t(message, "eng.automod.alertes_aucune")
        await message.editReply(t(message, existante ? "eng.automod.maj" : "eng.automod.creee", { nom, alerte }))
        await sendModLog(message, { action: "automod", details: `Règle ${existante ? "mise à jour" : "créée"} : ${nom}` })
    }
}
