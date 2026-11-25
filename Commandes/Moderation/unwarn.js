const Discord = require('discord.js')
const { formatReason, checkHierarchy } = require('../../Fonctions/moderation')
const { sendModLog } = require('../../Fonctions/logs')
const { t } = require('../../Fonctions/i18n')
const db = require('../../Fonctions/db')

module.exports = {
    name: "unwarn",
    description: "Retire un avertissement",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    // Le rôle staff du serveur (/config) suffit : aucune action avec les pouvoirs propres du bot
    roleStaffSuffit: true,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "integer",
            name: "numero",
            description: "Le numéro du warn (visible avec /warns)",
            required: true,
            minValue: 1
        }, {
            type: "string",
            name: "raison",
            description: "La raison du retrait",
            required: false,
            maxLength: 400
        }
    ],

    async run(bot, message, args) {
        const id = args.getInteger("numero")
        const raisonBrute = args.getString("raison")

        // Recherche limitée au serveur courant : impossible de toucher au warn d'un autre serveur
        const warn = db.getWarn(message.guild.id, id)
        if (!warn) return message.reply({ content: t(message, "mod.unwarn.introuvable", { id }), flags: Discord.MessageFlags.Ephemeral })

        // Personne ne peut effacer ses propres warns, ni ceux d'un membre plus haut que lui
        if (warn.user_id === message.user.id) {
            return message.reply({ content: t(message, "mod.unwarn.propre"), flags: Discord.MessageFlags.Ephemeral })
        }
        // force : on relit les rôles actuels auprès de Discord (le cache peut être périmé)
        const member = await message.guild.members.fetch({ user: warn.user_id, force: true }).catch(() => null)
        if (member) {
            const erreur = checkHierarchy(message, member, "unwarn")
            if (erreur) return message.reply({ content: erreur, flags: Discord.MessageFlags.Ephemeral })
        }

        // Si deux modérateurs retirent le même warn en même temps, un seul réussit
        if (!db.removeWarn(message.guild.id, id)) {
            return message.reply({ content: t(message, "mod.unwarn.deja", { id }), flags: Discord.MessageFlags.Ephemeral })
        }

        db.addCase(message.guild.id, { userId: warn.user_id, moderatorId: message.user.id, type: "unwarn", reason: raisonBrute ? `Warn n°${id} retiré : ${raisonBrute}` : `Warn n°${id} retiré` })

        const user = member?.user ?? await bot.users.fetch(warn.user_id).catch(() => null)
        await message.reply(t(message, "mod.unwarn.reponse", { moderateur: message.user, id, user: user ?? `<@${warn.user_id}>`, reason: formatReason(raisonBrute) }))
        await sendModLog(message, { action: "unwarn", cible: user, raison: raisonBrute, details: `Warn n°${id} retiré (raison d'origine : ${formatReason(warn.reason).slice(0, 300)})` })
    }
}
