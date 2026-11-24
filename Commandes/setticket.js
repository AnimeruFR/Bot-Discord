const Discord = require('discord.js')
const db = require('../Fonctions/db')
const { sendModLog } = require('../Fonctions/logs')
const { PERMISSION_TICKETS, refusCategorie, refusRoleStaff } = require('../Fonctions/config')

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
            if (categorie || role || args.getBoolean("reinitialiser")) return message.reply({ content: "Utilise `inactivite` seul.", flags: EPHEMERAL })
            db.setTicketInactivity(message.guild.id, inactivite)
            const texte = inactivite
                ? `Les tickets sans message depuis ${inactivite} jour(s) recevront un avertissement, puis seront fermés 24 h après s'il n'y a pas de réponse (le staff les supprime ensuite, avec transcript).`
                : "Fermeture automatique des tickets inactifs désactivée."
            await message.reply({ content: texte, flags: EPHEMERAL })
            return sendModLog(message, { action: "config", details: inactivite ? `Tickets fermés après ${inactivite} jour(s) d'inactivité` : "Fermeture des tickets inactifs désactivée" })
        }

        if (args.getBoolean("reinitialiser")) {
            if (categorie || role) return message.reply({ content: "Utilise `reinitialiser` seul, sans catégorie ni rôle.", flags: EPHEMERAL })
            db.resetTicketConfig(message.guild.id)
            await message.reply({ content: "Configuration des tickets réinitialisée (catégorie du panneau, rôle du .env).", flags: EPHEMERAL })
            return sendModLog(message, { action: "config", details: "Configuration des tickets réinitialisée" })
        }
        if (!categorie && !role) {
            const { categoryId, staffRoleId } = db.getTicketConfig(message.guild.id)
            return message.reply({
                content: `Configuration actuelle – Catégorie : ${categoryId ? `<#${categoryId}>` : "celle du panneau"} – Rôle staff : ${staffRoleId ? `<@&${staffRoleId}>` : "celui du .env"}`
                    + ` – Fermeture après inactivité : ${db.getTicketInactivity(message.guild.id) ? `${db.getTicketInactivity(message.guild.id)} jour(s)` : "jamais"}`
                    + "\nTypes de tickets : `/tickettype action:Voir`",
                flags: EPHEMERAL
            })
        }

        const refus = (categorie && refusCategorie(categorie)) || (role && refusRoleStaff(message, role))
        if (refus) return message.reply({ content: refus, flags: EPHEMERAL })

        db.setTicketConfig(message.guild.id, categorie?.id ?? null, role?.id ?? null)
        const { categoryId, staffRoleId } = db.getTicketConfig(message.guild.id)

        const details = `Catégorie : ${categoryId ? `<#${categoryId}>` : "celle du panneau"} – Rôle staff : ${staffRoleId ? `<@&${staffRoleId}>` : "celui du .env"}`
        // Réponse d'abord (Discord exige une réponse en moins de 3 s), log ensuite
        await message.reply({
            content: `Tickets configurés.\n${details}\nLes tickets déjà ouverts gardent leurs permissions actuelles.`
                + (role ? "\nTous les membres ayant ce rôle verront les nouveaux tickets." : ""),
            flags: EPHEMERAL
        })
        await sendModLog(message, { action: "config", details: `Tickets configurés. ${details}` })
    }
}
