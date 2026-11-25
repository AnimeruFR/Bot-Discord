const Discord = require('discord.js')
const db = require('../../../Fonctions/db')
const { sendModLog } = require('../../../Fonctions/logs')
const { t } = require('../../../Fonctions/i18n')
const { refusRole, contenuPanneau, rafraichirPanneau, onClicRole, MAX_BOUTONS } = require('../../../Fonctions/rolesBoutons')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral
const MAX_PANNEAUX = 10

module.exports = {
    name: "roles",
    description: "Panneaux de rôles à boutons (les membres prennent ou retirent un rôle eux-mêmes)",
    permission: Discord.PermissionFlagsBits.ManageRoles,
    dm: false,
    // Clic d'un membre sur un rôle du panneau : public, le rôle est revérifié à chaque clic (onClicRole)
    composants: [{ prefixe: "role:", types: ["bouton"], public: true, gestionnaire: onClicRole }],
    category: "Configuration",
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Voir les panneaux", value: "liste" },
                { name: "Créer un panneau", value: "creer" },
                { name: "Ajouter un rôle à un panneau", value: "ajouter" },
                { name: "Retirer un rôle d'un panneau", value: "retirer" },
                { name: "Supprimer un panneau", value: "supprimer" }
            ]
        }, {
            type: "string",
            name: "panneau",
            description: "ID du message du panneau (voir « Voir les panneaux »)",
            required: false,
            maxLength: 20
        }, {
            type: "role",
            name: "role",
            description: "Le rôle à ajouter ou retirer",
            required: false
        }, {
            type: "string",
            name: "texte",
            description: "Titre du panneau, ou texte du bouton",
            required: false,
            maxLength: 80
        }, {
            type: "channel",
            name: "salon",
            description: "Salon du nouveau panneau (par défaut : celui-ci)",
            required: false,
            channelTypes: [Discord.ChannelType.GuildText, Discord.ChannelType.GuildAnnouncement]
        }, {
            type: "boolean",
            name: "unique",
            description: "Un seul rôle de ce panneau à la fois (ex : couleurs)",
            required: false
        }
    ],

    async run(bot, message, args) {
        const guild = message.guild
        const action = args.getString("action")
        const me = guild.members.me

        if (action === "liste") {
            const panneaux = db.listRolePanels(guild.id)
            const lignes = panneaux.map(p => t(message, "eng.roles.ligne", {
                id: p.message_id, salon: p.channel_id, titre: Discord.escapeMarkdown(p.titre),
                nombre: db.listRoleButtons(guild.id, p.message_id).length, unique: p.mode === "unique" ? t(message, "eng.roles.ligne_unique") : ""
            }))
            return message.reply({ content: lignes.length ? lignes.join("\n") : t(message, "eng.roles.aucun"), flags: EPHEMERAL })
        }

        if (!me.permissions.has(Flags.ManageRoles)) return message.reply({ content: t(message, "eng.roles.perm_bot"), flags: EPHEMERAL })

        if (action === "creer") {
            const channel = args.getChannel("salon") ?? message.channel
            const titre = args.getString("texte")?.trim() || t(guild, "eng.roles.titre_defaut")
            if (!channel.permissionsFor(me)?.has([Flags.ViewChannel, Flags.SendMessages, Flags.EmbedLinks])) {
                return message.reply({ content: t(message, "eng.roles.salon_bot", { salon: channel }), flags: EPHEMERAL })
            }
            if (!channel.permissionsFor(message.member)?.has([Flags.ViewChannel, Flags.SendMessages])) {
                return message.reply({ content: t(message, "eng.roles.salon_membre", { salon: channel }), flags: EPHEMERAL })
            }
            if (db.listRolePanels(guild.id).length >= MAX_PANNEAUX) return message.reply({ content: t(message, "eng.roles.max_panneaux", { max: MAX_PANNEAUX }), flags: EPHEMERAL })

            const panel = { titre, mode: args.getBoolean("unique") ? "unique" : "multiple" }
            const envoye = await channel.send(contenuPanneau(panel, [], guild))
            db.addRolePanel(guild.id, { messageId: envoye.id, channelId: channel.id, ...panel })
            await message.reply({ content: t(message, "eng.roles.cree", { salon: channel, id: envoye.id }), flags: EPHEMERAL })
            return sendModLog(message, { action: "roles", details: `Panneau de rôles créé dans ${channel} : ${titre}` })
        }

        const panel = db.getRolePanel(guild.id, args.getString("panneau")?.trim() ?? "")
        if (!panel) return message.reply({ content: t(message, "eng.roles.introuvable"), flags: EPHEMERAL })

        if (action === "supprimer") {
            db.removeRolePanel(guild.id, panel.message_id)
            await guild.channels.cache.get(panel.channel_id)?.messages.delete(panel.message_id).catch(() => {})
            await message.reply({ content: t(message, "eng.roles.supprime"), flags: EPHEMERAL })
            return sendModLog(message, { action: "roles", details: `Panneau de rôles supprimé : ${panel.titre}` })
        }

        const role = args.getRole("role")
        if (!role) return message.reply({ content: t(message, "eng.roles.role_manquant"), flags: EPHEMERAL })

        if (action === "ajouter") {
            const refus = refusRole(guild, guild.roles.cache.get(role.id), message.member, message)
            if (refus) return message.reply({ content: refus, flags: EPHEMERAL })
            const boutons = db.listRoleButtons(guild.id, panel.message_id)
            if (!boutons.some(b => b.role_id === role.id) && boutons.length >= MAX_BOUTONS) {
                return message.reply({ content: t(message, "eng.roles.max_boutons", { max: MAX_BOUTONS }), flags: EPHEMERAL })
            }
            db.addRoleButton(guild.id, panel.message_id, role.id, args.getString("texte")?.trim() || role.name)
        } else {
            // Retirer un rôle d'un panneau ne donne rien à personne : pas de contrôle de hiérarchie nécessaire
            if (!db.removeRoleButton(guild.id, panel.message_id, role.id)) return message.reply({ content: t(message, "eng.roles.pas_sur_panneau"), flags: EPHEMERAL })
        }

        if (!await rafraichirPanneau(guild, panel)) {
            return message.reply({ content: t(message, "eng.roles.message_supprime"), flags: EPHEMERAL })
        }
        await message.reply({ content: t(message, action === "ajouter" ? "eng.roles.role_ajoute" : "eng.roles.role_retire", { role }), flags: EPHEMERAL })
        await sendModLog(message, { action: "roles", details: `${role} ${action === "ajouter" ? "ajouté au" : "retiré du"} panneau « ${panel.titre} »` })
    }
}
