const Discord = require('discord.js')
const { couleur } = require('../../Fonctions/apparence')
const { refuser } = require('../../Fonctions/erreurs')
const { formatReason, formatDuree, checkHierarchy, fetchMember, auditReason } = require('../../Fonctions/moderation')
const { sendModLog } = require('../../Fonctions/logs')
const { t, langueDe } = require('../../Fonctions/i18n')
const db = require('../../Fonctions/db')
const { lireCase, listerModifs, muteActif, warnEncore, modifierRaison, annulerCase } = require('../../Fonctions/cases')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const TYPES = ["warn", "unwarn", "mute", "unmute", "kick", "ban", "tempban", "unban"]

// Cible pour sendModLog quand l'utilisateur n'est pas sous la main
const cibleDe = id => ({ id, toString: () => `<@${id}>` })

module.exports = {
    name: "case",
    description: "Voir, corriger ou annuler une sanction",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Voir la sanction", value: "voir" },
                { name: "Modifier la raison", value: "raison" },
                { name: "Annuler la sanction", value: "annuler" }
            ]
        }, {
            type: "integer",
            name: "numero",
            description: "Le numéro de la sanction (visible avec /historique)",
            required: true,
            minValue: 1
        }, {
            type: "string",
            name: "texte",
            description: "La nouvelle raison (pour modifier)",
            required: false,
            maxLength: 400
        }
    ],

    async run(bot, message, args) {
        // Réponse différée : relire le membre auprès de Discord peut dépasser les 3 s permises
        await message.deferReply({ flags: EPHEMERAL })
        const action = args.getString("action")
        const id = args.getInteger("numero")
        const guildId = message.guild.id

        const c = lireCase(guildId, id)
        if (!c) return refuser(message, t(message, "dos.case.introuvable", { id }))

        if (action === "voir") return voir(message, c)

        if (c.cancelled_at && action === "annuler") return refuser(message, t(message, "dos.case.deja_annulee", { id }))

        if (action === "raison") {
            const texte = args.getString("texte")?.trim()
            if (!texte) return refuser(message, t(message, "dos.case.texte_requis"))
            if (c.cancelled_at) return refuser(message, t(message, "dos.case.figee", { id }))
            if (!warnEncore(c)) return refuser(message, t(message, "dos.case.warn_retire", { id }))
            // Corriger la sanction d'un collègue demande de gérer le serveur
            if (c.moderator_id !== message.user.id && !message.memberPermissions?.has(Discord.PermissionFlagsBits.ManageGuild)) {
                return refuser(message, t(message, "dos.case.autre_moderateur"))
            }
            const r = modifierRaison(guildId, id, message.user.id, texte)
            if (r !== "ok") return refuser(message, t(message, `dos.case.${r === "annulee" ? "figee" : r === "warn_retire" ? "warn_retire" : "introuvable"}`, { id }))
            await message.editReply(t(message, "dos.case.raison_modifiee", { id, reason: formatReason(texte) }))
            return sendModLog(message, { action: "case", cible: cibleDe(c.user_id), details: `Sanction n°${id} : raison modifiée\nAvant : ${formatReason(c.reason).slice(0, 400)}`, raison: texte })
        }

        // Annulation : même règle que la correction (sanction d'un collègue = gérer le serveur)
        if (c.moderator_id !== message.user.id && !message.memberPermissions?.has(Discord.PermissionFlagsBits.ManageGuild)) {
            return refuser(message, t(message, "dos.case.autre_moderateur"))
        }
        let timeoutRetire = false
        if (muteActif(c) && !c.cancelled_at) {
            const member = await fetchMember(message.guild, c.user_id)
            if (member?.isCommunicationDisabled()) {
                const erreur = checkHierarchy(message, member, "unmute")
                if (erreur) return refuser(message, erreur)
                try {
                    await member.timeout(null, auditReason(message, `Annulation de la sanction n°${id}`))
                    timeoutRetire = true
                } catch {
                    return refuser(message, t(message, "dos.case.timeout_echec"))
                }
            }
        }
        const r = annulerCase(guildId, id, message.user.id)
        if (r === "deja") return refuser(message, t(message, "dos.case.deja_annulee", { id }))
        if (r === "non_annulable") return refuser(message, t(message, "dos.case.non_annulable", { id }))
        if (r !== "ok") return refuser(message, t(message, "dos.case.introuvable", { id }))

        let suite = ""
        if (c.type === "warn") suite = t(message, "dos.case.suite_warn", { total: db.countWarns(guildId, c.user_id) })
        else if (c.type === "mute") suite = t(message, timeoutRetire ? "dos.case.suite_mute_retire" : "dos.case.suite_mute_inactif")
        else if (c.type === "ban" || c.type === "tempban") suite = t(message, "dos.case.suite_ban")
        await message.editReply(t(message, "dos.case.annulee", { id }) + suite)
        await sendModLog(message, { action: "case", cible: cibleDe(c.user_id), details: `Sanction n°${id} (${c.type}) annulée` })
    }
}

async function voir(message, c) {
    const langue = langueDe(message)
    const nom = TYPES.includes(c.type) ? t(message, `mod.type.${c.type}`) : c.type
    const embed = new Discord.EmbedBuilder()
        .setColor(couleur(message.guild))
        .setTitle(t(message, "dos.case.voir_titre", { id: c.id, nom }))
        .addFields(
            { name: t(message, "dos.case.champ_membre"), value: `<@${c.user_id}> (\`${c.user_id}\`)`, inline: true },
            { name: t(message, "dos.case.champ_moderateur"), value: `<@${c.moderator_id}>${c.auto ? t(message, "mod.historique.auto") : ""}`, inline: true },
            { name: t(message, "dos.case.champ_date"), value: `<t:${Math.floor(c.created_at / 1000)}:f>`, inline: true },
            { name: t(message, "dos.case.champ_raison"), value: formatReason(c.reason).slice(0, 1024) }
        )
    if (c.duration_ms) embed.addFields({ name: t(message, "dos.case.champ_duree"), value: formatDuree(c.duration_ms, langue), inline: true })
    if (c.cancelled_at) embed.addFields({ name: t(message, "dos.case.champ_statut"), value: t(message, "dos.case.statut_annulee", { date: Math.floor(c.cancelled_at / 1000) }), inline: true })
    const modifs = listerModifs(message.guild.id, c.id, 5)
    if (modifs.length) {
        const lignes = modifs.map(m => t(message, `dos.case.modif_${m.field === "annulation" ? "annulation" : "raison"}`, {
            date: Math.floor(m.created_at / 1000), editeur: m.editor_id, ancienne: formatReason(m.old_value).slice(0, 120), nouvelle: formatReason(m.new_value).slice(0, 120)
        }))
        embed.addFields({ name: t(message, "dos.case.champ_modifs"), value: lignes.join("\n").slice(0, 1024) })
    }
    await message.editReply({ embeds: [embed] })
}
