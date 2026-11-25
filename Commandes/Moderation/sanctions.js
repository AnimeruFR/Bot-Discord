const Discord = require('discord.js')
const { parseDuree, formatDuree } = require('../../Fonctions/moderation')
const { DUREE_MAX_MUTE, DUREE_MAX_TEMPBAN, LIBELLES } = require('../../Fonctions/sanctions')
const { sendModLog } = require('../../Fonctions/logs')
const { t, langueDe } = require('../../Fonctions/i18n')
const db = require('../../Fonctions/db')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const MAX_SEUILS = 10

// Une durée est obligatoire pour mute et tempban, interdite pour kick et ban
const DUREES = { mute: DUREE_MAX_MUTE, tempban: DUREE_MAX_TEMPBAN }

// cible : interaction pour l'affichage ; sans cible, texte français (logs)
function decrire(seuil, cible = null) {
    if (!cible) return `**${seuil.warns} warns** → ${LIBELLES[seuil.action]}${seuil.duration_ms ? ` de ${formatDuree(seuil.duration_ms)}` : ""}`
    const duree = seuil.duration_ms ? t(cible, "mod.auto.de_duree", { duree: formatDuree(seuil.duration_ms, langueDe(cible)) }) : ""
    return t(cible, "mod.sanctions.seuil", { warns: seuil.warns, libelle: t(cible, `mod.libelle.${seuil.action}`), duree })
}

module.exports = {
    name: "sanctions",
    description: "Sanctions automatiques selon le nombre d'avertissements",
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
                { name: "Voir les seuils", value: "liste" },
                { name: "Définir un seuil", value: "definir" },
                { name: "Retirer un seuil", value: "retirer" }
            ]
        }, {
            type: "integer",
            name: "avertissements",
            description: "Nombre de warns qui déclenche la sanction",
            required: false,
            minValue: 1,
            maxValue: 50
        }, {
            type: "string",
            name: "sanction",
            description: "Sanction appliquée (pour « Définir »)",
            required: false,
            choices: [
                { name: "Mute", value: "mute" },
                { name: "Kick", value: "kick" },
                { name: "Ban temporaire", value: "tempban" },
                { name: "Ban définitif", value: "ban" }
            ]
        }, {
            type: "string",
            name: "duree",
            description: "Durée du mute ou du ban temporaire (ex : 1h, 7d)",
            required: false,
            maxLength: 20
        }
    ],

    async run(bot, message, args) {
        const action = args.getString("action")
        const guildId = message.guild.id
        const warns = args.getInteger("avertissements")

        if (action === "liste") {
            const seuils = db.listThresholds(guildId)
            const texte = seuils.length
                ? seuils.map(s => decrire(s, message)).join("\n")
                : t(message, "mod.sanctions.aucune")
            return message.reply({
                content: `${texte}\n\n${t(message, "mod.sanctions.explication")}`,
                flags: EPHEMERAL
            })
        }

        if (!warns) return message.reply({ content: t(message, "mod.sanctions.precise_warns"), flags: EPHEMERAL })

        if (action === "retirer") {
            const ancien = db.getThreshold(guildId, warns)
            if (!db.removeThreshold(guildId, warns)) return message.reply({ content: t(message, "mod.sanctions.aucun_seuil", { warns }), flags: EPHEMERAL })
            await message.reply({ content: t(message, "mod.sanctions.retire", { seuil: decrire(ancien, message) }), flags: EPHEMERAL })
            return sendModLog(message, { action: "config", details: `Sanction automatique retirée : ${decrire(ancien)}` })
        }

        // definir
        const sanction = args.getString("sanction")
        if (!sanction) return message.reply({ content: t(message, "mod.sanctions.precise_sanction"), flags: EPHEMERAL })

        let duree = null
        const texteDuree = args.getString("duree")
        if (DUREES[sanction]) {
            if (!texteDuree) return message.reply({ content: t(message, "mod.sanctions.duree_obligatoire", { libelle: t(message, `mod.libelle.${sanction}`) }), flags: EPHEMERAL })
            const resultat = parseDuree(texteDuree, { max: DUREES[sanction], cible: message })
            if (resultat.erreur) return message.reply({ content: resultat.erreur, flags: EPHEMERAL })
            duree = resultat.duree
        } else if (texteDuree) {
            return message.reply({ content: t(message, "mod.sanctions.pas_de_duree", { libelle: t(message, `mod.libelle.${sanction}`) }), flags: EPHEMERAL })
        }

        const existe = db.getThreshold(guildId, warns)
        if (!existe && db.listThresholds(guildId).length >= MAX_SEUILS) {
            return message.reply({ content: t(message, "mod.sanctions.max", { max: MAX_SEUILS }), flags: EPHEMERAL })
        }

        db.setThreshold(guildId, warns, sanction, duree)
        const nouveau = { warns, action: sanction, duration_ms: duree }
        await message.reply({ content: t(message, existe ? "mod.sanctions.modifie" : "mod.sanctions.ajoute", { seuil: decrire(nouveau, message) }), flags: EPHEMERAL })
        await sendModLog(message, { action: "config", details: `Sanction automatique ${existe ? "modifiée" : "ajoutée"} : ${decrire(nouveau)}` })
    }
}
