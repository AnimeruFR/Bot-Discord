const Discord = require('discord.js')
const db = require('../../Fonctions/db')
const { sendModLog } = require('../../Fonctions/logs')
const { t } = require('../../Fonctions/i18n')
const { PERMISSION_TICKETS, refusCategorie, refusRoleStaff } = require('../../Fonctions/config')

const EPHEMERAL = Discord.MessageFlags.Ephemeral

module.exports = {
    name: "setticket",
    description: "Configure la catégorie et le rôle staff des tickets",
    // Le rôle staff obtient l'accès à tous les tickets : il faut pouvoir gérer le serveur, les salons ET les rôles
    permission: PERMISSION_TICKETS,
    dm: false,
    category: "Configuration",
    options: [
        {
            type: "channel",
            name: "categorie",
            description: "La catégorie où créer les tickets",
            required: false,
            channelTypes: [Discord.ChannelType.GuildCategory]
        }, {
            type: "role",
            name: "staff",
            description: "Le rôle qui voit et gère les tickets",
            required: false
        }, {
            type: "integer",
            name: "inactivite",
            description: "Fermer les tickets sans message depuis N jours (0 = jamais)",
            required: false,
            minValue: 0,
            maxValue: 30
        }, {
            type: "boolean",
            name: "reinitialiser",
            description: "Revenir aux valeurs par défaut (catégorie du panneau, rôle du .env)",
            required: false
        }
    ],

    async run(bot, message, args) {
        const categorie = args.getChannel("categorie")
        const role = args.getRole("staff")
        const inactivite = args.getInteger("inactivite")

        if (inactivite !== null) {
            if (categorie || role || args.getBoolean("reinitialiser")) return message.reply({ content: t(message, "tk.st_inactivite_seul"), flags: EPHEMERAL })
            db.setTicketInactivity(message.guild.id, inactivite)
            const texte = inactivite ? t(message, "tk.st_inactivite_on", { jours: inactivite }) : t(message, "tk.st_inactivite_off")
            await message.reply({ content: texte, flags: EPHEMERAL })
            return sendModLog(message, { action: "config", details: inactivite ? `Tickets fermés après ${inactivite} jour(s) d'inactivité` : "Fermeture des tickets inactifs désactivée" })
        }

        if (args.getBoolean("reinitialiser")) {
            if (categorie || role) return message.reply({ content: t(message, "tk.st_reinit_seul"), flags: EPHEMERAL })
            db.resetTicketConfig(message.guild.id)
            await message.reply({ content: t(message, "tk.st_reinit_ok"), flags: EPHEMERAL })
            return sendModLog(message, { action: "config", details: "Configuration des tickets réinitialisée" })
        }
        if (!categorie && !role) {
            const { categoryId, staffRoleId } = db.getTicketConfig(message.guild.id)
            const jours = db.getTicketInactivity(message.guild.id)
            return message.reply({
                content: t(message, "tk.st_actuel", {
                    categorie: categoryId ? `<#${categoryId}>` : t(message, "tk.st_celle_panneau"),
                    role: staffRoleId ? `<@&${staffRoleId}>` : t(message, "tk.st_celui_env"),
                    inactivite: jours ? t(message, "config.jours", { jours }) : t(message, "config.jamais")
                }),
                flags: EPHEMERAL
            })
        }

        const refus = (categorie && refusCategorie(categorie, message)) || (role && refusRoleStaff(message, role))
        if (refus) return message.reply({ content: refus, flags: EPHEMERAL })

        db.setTicketConfig(message.guild.id, categorie?.id ?? null, role?.id ?? null)
        const { categoryId, staffRoleId } = db.getTicketConfig(message.guild.id)

        const details = t("fr", "tk.st_details", { categorie: categoryId ? `<#${categoryId}>` : "celle du panneau", role: staffRoleId ? `<@&${staffRoleId}>` : "celui du .env" })
        const detailsMembre = t(message, "tk.st_details", { categorie: categoryId ? `<#${categoryId}>` : t(message, "tk.st_celle_panneau"), role: staffRoleId ? `<@&${staffRoleId}>` : t(message, "tk.st_celui_env") })
        // Réponse d'abord (Discord exige une réponse en moins de 3 s), log ensuite
        await message.reply({
            content: t(message, "tk.st_configure", { details: detailsMembre }) + (role ? t(message, "tk.st_role_visible") : ""),
            flags: EPHEMERAL
        })
        await sendModLog(message, { action: "config", details: `Tickets configurés. ${details}` })
    }
}
