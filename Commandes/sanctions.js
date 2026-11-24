const Discord = require('discord.js')
const { parseDuree, formatDuree } = require('../Fonctions/moderation')
const { DUREE_MAX_MUTE, DUREE_MAX_TEMPBAN, LIBELLES } = require('../Fonctions/sanctions')
const { sendModLog } = require('../Fonctions/logs')
const db = require('../Fonctions/db')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const MAX_SEUILS = 10

// Une durée est obligatoire pour mute et tempban, interdite pour kick et ban
const DUREES = { mute: DUREE_MAX_MUTE, tempban: DUREE_MAX_TEMPBAN }

function decrire(seuil) {
    return `**${seuil.warns} warns** → ${LIBELLES[seuil.action]}${seuil.duration_ms ? ` de ${formatDuree(seuil.duration_ms)}` : ""}`
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
                ? seuils.map(decrire).join("\n")
                : "Aucune sanction automatique. Exemple : `/sanctions action:Définir avertissements:3 sanction:Mute duree:1h`"
            return message.reply({
                content: `${texte}\n\n-# La sanction part au moment où le membre atteint **exactement** ce nombre de warns, et seulement si le modérateur qui met le warn a lui-même le droit d'appliquer cette sanction. Un seuil ajouté après coup ne s'applique pas aux membres qui l'ont déjà dépassé, et un membre qui repasse par le seuil (après un /unwarn) est sanctionné à nouveau.`,
                flags: EPHEMERAL
            })
        }

        if (!warns) return message.reply({ content: "Précise le nombre d'avertissements (option `avertissements`).", flags: EPHEMERAL })

        if (action === "retirer") {
            const ancien = db.getThreshold(guildId, warns)
            if (!db.removeThreshold(guildId, warns)) return message.reply({ content: `Aucun seuil à ${warns} warns.`, flags: EPHEMERAL })
            await message.reply({ content: `Seuil retiré : ${decrire(ancien)}`, flags: EPHEMERAL })
            return sendModLog(message, { action: "config", details: `Sanction automatique retirée : ${decrire(ancien)}` })
        }

        // definir
        const sanction = args.getString("sanction")
        if (!sanction) return message.reply({ content: "Précise la sanction (option `sanction`).", flags: EPHEMERAL })

        let duree = null
        const texteDuree = args.getString("duree")
        if (DUREES[sanction]) {
            if (!texteDuree) return message.reply({ content: `Une durée est obligatoire pour un ${LIBELLES[sanction]} (option \`duree\`).`, flags: EPHEMERAL })
            const resultat = parseDuree(texteDuree, { max: DUREES[sanction] })
            if (resultat.erreur) return message.reply({ content: resultat.erreur, flags: EPHEMERAL })
            duree = resultat.duree
        } else if (texteDuree) {
            return message.reply({ content: `Pas de durée pour un ${LIBELLES[sanction]}.`, flags: EPHEMERAL })
        }

        const existe = db.getThreshold(guildId, warns)
        if (!existe && db.listThresholds(guildId).length >= MAX_SEUILS) {
            return message.reply({ content: `${MAX_SEUILS} seuils au maximum : retire-en un d'abord.`, flags: EPHEMERAL })
        }

        db.setThreshold(guildId, warns, sanction, duree)
        const nouveau = { warns, action: sanction, duration_ms: duree }
        await message.reply({ content: `Seuil ${existe ? "modifié" : "ajouté"} : ${decrire(nouveau)}`, flags: EPHEMERAL })
        await sendModLog(message, { action: "config", details: `Sanction automatique ${existe ? "modifiée" : "ajoutée"} : ${decrire(nouveau)}` })
    }
}
