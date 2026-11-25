const Discord = require('discord.js')
const { formatReason, auditReason } = require('../../Fonctions/moderation')
const { sendModLog } = require('../../Fonctions/logs')
const { t } = require('../../Fonctions/i18n')
const db = require('../../Fonctions/db')

module.exports = {
    name: "unban",
    description: "Déban un membre",
    permission: Discord.PermissionFlagsBits.BanMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "utilisateur",
            description: "L'utilisateur à débannir",
            required: true
        }, {
            type: "string",
            name: "raison",
            description: "La raison du débannissement",
            required: false,
            maxLength: 400
        }
    ],

    async run(bot, message, args) {
        const user = args.getUser("utilisateur")
        const raisonBrute = args.getString("raison")
        const reason = formatReason(raisonBrute)

        if (!await message.guild.bans.fetch({ user: user.id, force: true }).catch(() => null)) return message.reply(t(message, "mod.unban.pas_banni"))

        await message.guild.members.unban(user, auditReason(message, raisonBrute))
        // Un ban temporaire levé à la main n'a plus d'échéance
        db.removeTempban(message.guild.id, user.id)
        db.addCase(message.guild.id, { userId: user.id, moderatorId: message.user.id, type: "unban", reason: raisonBrute })
        await message.reply(t(message, "mod.unban.reponse", { moderateur: message.user, user: Discord.escapeMarkdown(user.tag), reason }))
        await sendModLog(message, { action: "unban", cible: user, raison: raisonBrute })
    }
}
