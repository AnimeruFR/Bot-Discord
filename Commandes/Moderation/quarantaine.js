const Discord = require('discord.js')
const { refuser } = require('../../Fonctions/erreurs')
const { t } = require('../../Fonctions/i18n')
const q = require('../../Fonctions/quarantaine')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral

module.exports = {
    name: "quarantaine",
    description: "Isole un membre (ses rôles sont sauvegardés puis rendus à la levée)",
    // Retirer des rôles demande « Gérer les rôles » en plus d'« Exclure temporairement »
    permission: Discord.PermissionFlagsBits.ModerateMembers | Discord.PermissionFlagsBits.ManageRoles,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Mettre un membre en quarantaine", value: "mettre" },
                { name: "Lever la quarantaine d'un membre", value: "lever" },
                { name: "Choisir le rôle isolé", value: "config" },
                { name: "Voir les membres en quarantaine", value: "liste" }
            ]
        }, {
            type: "user",
            name: "membre",
            description: "Le membre concerné (mettre, lever)",
            required: false
        }, {
            type: "string",
            name: "raison",
            description: "La raison de la quarantaine",
            required: false,
            maxLength: 400
        }, {
            type: "role",
            name: "role",
            description: "Le rôle isolé (config) : sans permission dangereuse",
            required: false
        }
    ],

    async run(bot, message, args) {
        const action = args.getString("action")
        const guild = message.guild

        // La garde a déjà refusé les autres ; on revérifie ici : cette commande retire des rôles
        const requis = Flags.ModerateMembers | Flags.ManageRoles
        if (!message.memberPermissions?.has(requis)) return refuser(message, t(message, "commun.permission"))

        if (action === "liste") return liste(message)

        // Sans « Gérer les rôles », le bot ne peut ni retirer ni rendre un rôle
        if (!guild.members.me?.permissions.has(Flags.ManageRoles)) return refuser(message, t(message, "quar.perm_bot"))

        if (action === "config") return config(message, args.getRole("role"))

        const user = args.getUser("membre")
        if (!user) return refuser(message, t(message, "quar.membre_requis"))
        await message.deferReply()

        if (action === "mettre") {
            const r = await q.mettre(message, user, args.getString("raison"))
            if (r.erreur) return refuser(message, r.erreur)
            const suite = t(message, r.prevenu ? "quar.mp_ok" : "quar.mp_ko")
            const alerte = r.salon ? `\n${t(message, "quar.salon_dangereux", { salon: `<#${r.salon.id}>` })}` : ""
            return message.editReply(t(message, "quar.mise", { moderateur: message.user, user, n: r.retires, gardes: r.gardes, suite }) + alerte)
        }

        const r = await q.lever(message, user)
        if (r.erreur) return refuser(message, r.erreur)
        if (r.absent) return message.editReply(t(message, "quar.levee_absent", { user }))
        let texte = t(message, "quar.levee", { moderateur: message.user, user, n: r.restaures })
        if (r.supprimes) texte += `\n${t(message, "quar.levee_supprimes", { n: r.supprimes })}`
        if (r.impossibles) texte += `\n${t(message, "quar.levee_impossibles", { n: r.impossibles })}`
        return message.editReply(texte)
    }
}

async function config(message, role) {
    if (!role) {
        const id = q.getRoleIsole(message.guild.id)
        return message.reply({ content: t(message, id ? "quar.config_actuelle" : "quar.config_aucune", { role: `<@&${id}>` }), flags: EPHEMERAL, allowedMentions: { parse: [] } })
    }
    const r = await q.changerRoleIsole(message, role)
    if (r.erreur) return refuser(message, r.erreur)
    if (r.inchange) return message.reply({ content: t(message, "quar.config_inchangee", { role }), flags: EPHEMERAL, allowedMentions: { parse: [] } })
    const alerte = r.salon ? `\n${t(message, "quar.salon_dangereux", { salon: `<#${r.salon.id}>` })}` : ""
    return message.reply({ content: t(message, "quar.config_ok", { role }) + alerte, flags: EPHEMERAL, allowedMentions: { parse: [] } })
}

async function liste(message) {
    const lignes = q.listerQuarantaines(message.guild.id)
    if (!lignes.length) return message.reply({ content: t(message, "quar.liste_vide"), flags: EPHEMERAL })
    const affichees = lignes.slice(0, 20).map(l => t(message, "quar.liste_ligne", {
        user: `<@${l.user_id}>`, date: `<t:${Math.floor(l.created_at / 1000)}:d>`, moderateur: `<@${l.moderator_id}>`,
        n: l.roles.length, raison: Discord.escapeMarkdown(String(l.reason).replace(/\s+/g, " ").slice(0, 80))
    }))
    const reste = lignes.length - affichees.length
    const texte = `${t(message, "quar.liste_titre", { total: lignes.length })}\n${affichees.join("\n")}${reste > 0 ? `\n${t(message, "quar.liste_reste", { n: reste })}` : ""}`
    return message.reply({ content: texte.slice(0, 2000), flags: EPHEMERAL, allowedMentions: { parse: [] } })
}
