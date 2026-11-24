const Discord = require('discord.js')
const db = require('../Fonctions/db')
const { sendModLog } = require('../Fonctions/logs')
const { roleValide, categorieUtilisable } = require('../Fonctions/tickets')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const P = Discord.PermissionFlagsBits
const MAX_TYPES = 10

function decrire(type) {
    return `**${type.id}. ${Discord.escapeMarkdown(type.nom)}**${type.description ? ` – ${Discord.escapeMarkdown(type.description)}` : ""}\n`
        + `Catégorie : ${type.category_id ? `<#${type.category_id}>` : "par défaut"} · Staff : ${type.staff_role_id ? `<@&${type.staff_role_id}>` : "par défaut"}`
}

module.exports = {
    name: "tickettype",
    description: "Types de tickets (menu déroulant du panneau)",
    // Comme /setticket : un type donne à un rôle l'accès à des tickets
    permission: P.ManageGuild | P.ManageChannels | P.ManageRoles,
    dm: false,
    category: "Configuration",
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Voir les types", value: "liste" },
                { name: "Ajouter un type", value: "ajouter" },
                { name: "Modifier un type", value: "modifier" },
                { name: "Retirer un type", value: "retirer" }
            ]
        }, {
            type: "integer",
            name: "numero",
            description: "Numéro du type (pour modifier ou retirer)",
            required: false,
            minValue: 1
        }, {
            type: "string",
            name: "nom",
            description: "Nom affiché dans le menu (ex : Support, Signalement, Partenariat)",
            required: false,
            maxLength: 50
        }, {
            type: "string",
            name: "description",
            description: "Petite description affichée dans le menu",
            required: false,
            maxLength: 100
        }, {
            type: "channel",
            name: "categorie",
            description: "Catégorie des tickets de ce type",
            required: false,
            channelTypes: [Discord.ChannelType.GuildCategory]
        }, {
            type: "role",
            name: "staff",
            description: "Rôle qui voit et gère les tickets de ce type",
            required: false
        }
    ],

    async run(bot, message, args) {
        const guild = message.guild
        const action = args.getString("action")
        const numero = args.getInteger("numero")
        const nom = args.getString("nom")?.trim() || null
        const description = args.getString("description")?.trim() || null
        const categorie = args.getChannel("categorie")
        const role = args.getRole("staff")

        if (action === "liste") {
            const types = db.listTicketTypes(guild.id)
            return message.reply({
                content: types.length
                    ? `${types.map(decrire).join("\n\n")}\n\n-# Repostez le panneau avec \`/ticket action:Panneau\` après un changement.`
                    : "Aucun type : le panneau affiche un simple bouton. Exemple : `/tickettype action:Ajouter nom:Support`",
                flags: EPHEMERAL
            })
        }

        if (action === "retirer") {
            const type = numero ? db.getTicketType(guild.id, numero) : null
            if (!type) return message.reply({ content: "Numéro de type inconnu (voir `/tickettype action:Voir`).", flags: EPHEMERAL })
            db.removeTicketType(guild.id, numero)
            await message.reply({ content: `Type « ${Discord.escapeMarkdown(type.nom)} » retiré. Les tickets déjà ouverts ne changent pas.`, flags: EPHEMERAL })
            return sendModLog(message, { action: "config", details: `Type de ticket retiré : ${type.nom}` })
        }

        // Mêmes contrôles que /setticket
        if (categorie && !categorieUtilisable(categorie)) {
            return message.reply({ content: `Je ne peux pas créer de salons dans ${categorie} (il me faut Voir les salons et Gérer les salons).`, flags: EPHEMERAL })
        }
        if (role) {
            if (!roleValide(guild, role.id)) return message.reply({ content: "Ce rôle ne peut pas être un rôle staff (@everyone ou rôle d'un bot).", flags: EPHEMERAL })
            if (message.user.id !== guild.ownerId && role.comparePositionTo(message.member.roles.highest) >= 0) {
                return message.reply({ content: "Vous ne pouvez choisir qu'un rôle inférieur à votre rôle le plus haut.", flags: EPHEMERAL })
            }
        }

        if (action === "ajouter") {
            if (!nom) return message.reply({ content: "Donnez un nom au type (option `nom`).", flags: EPHEMERAL })
            if (db.listTicketTypes(guild.id).length >= MAX_TYPES) return message.reply({ content: `${MAX_TYPES} types au maximum.`, flags: EPHEMERAL })
            const id = db.addTicketType(guild.id, { nom, description, categoryId: categorie?.id ?? null, staffRoleId: role?.id ?? null })
            await message.reply({ content: `Type ajouté :\n${decrire(db.getTicketType(guild.id, id))}\n\nRepostez le panneau avec \`/ticket action:Panneau\` pour afficher le menu.`, flags: EPHEMERAL })
            return sendModLog(message, { action: "config", details: `Type de ticket ajouté : ${nom}` })
        }

        // modifier
        if (!numero || !db.getTicketType(guild.id, numero)) return message.reply({ content: "Numéro de type inconnu (voir `/tickettype action:Voir`).", flags: EPHEMERAL })
        if (!nom && !description && !categorie && !role) return message.reply({ content: "Rien à modifier : donnez un nom, une description, une catégorie ou un rôle.", flags: EPHEMERAL })
        db.updateTicketType(guild.id, numero, { nom, description, categoryId: categorie?.id ?? null, staffRoleId: role?.id ?? null })
        const type = db.getTicketType(guild.id, numero)
        await message.reply({ content: `Type modifié :\n${decrire(type)}\nLes tickets déjà ouverts gardent leurs permissions.`, flags: EPHEMERAL })
        await sendModLog(message, { action: "config", details: `Type de ticket modifié : ${type.nom}` })
    }
}
