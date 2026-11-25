const Discord = require('discord.js')
const { formatReason, checkHierarchy, fetchMember } = require('../../Fonctions/moderation')
const { appliquerSeuil } = require('../../Fonctions/sanctions')
const { sendModLog } = require('../../Fonctions/logs')
const { t } = require('../../Fonctions/i18n')
const db = require('../../Fonctions/db')

module.exports = {
    name: "warn",
    description: "Warn un membre",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre à warn",
            required: true
        }, {
            type: "string",
            name: "raison",
            description: "La raison du warn",
            required: false,
            maxLength: 400
        }
    ],

    async run(bot, message, args) {
        // Réponse différée : relire le membre et agir peut dépasser les 3 s permises par Discord
        await message.deferReply()
        const user = args.getUser("membre")
        const member = await fetchMember(message.guild, user.id)
        if (!member) return message.editReply(t(message, "mod.absent"))

        const reason = formatReason(args.getString("raison"))

        const erreur = checkHierarchy(message, member, "warn")
        if (erreur) return message.editReply(erreur)

        // On enregistre la raison brute : elle est échappée au moment de l'affichage.
        // Ajout et comptage sans "await" entre les deux : chaque warn obtient un total différent,
        // même si deux modérateurs warnent en même temps (un seuil ne se déclenche donc qu'une fois)
        const raisonBrute = args.getString("raison")?.trim() || "Aucune raison fournie"
        const id = db.addWarn(message.guild.id, user.id, message.user.id, raisonBrute)
        const total = db.countWarns(message.guild.id, user.id)

        const prevenu = await user.send(t(message.guild, "mod.warn.mp", { serveur: message.guild.name, reason }))
            .then(() => true)
            .catch(() => false)

        await message.editReply(t(message, "mod.warn.reponse", { moderateur: message.user, user, reason, id, total }) + (prevenu ? "" : t(message, "mod.warn.pas_prevenu")))
        await sendModLog(message, { action: "warn", cible: user, raison: raisonBrute, details: `Warn n°${id}, ${total} au total` })

        // Sanction automatique configurée avec /sanctions (seuil atteint)
        const auto = await appliquerSeuil(message, user, total)
        if (auto) await message.followUp(t(message, "mod.warn.seuil", { total, user, auto }))
    }
}
