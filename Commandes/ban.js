const Discord = require('discord.js')
const { formatReason, auditReason, checkHierarchy } = require('../Fonctions/moderation')
const { sendModLog } = require('../Fonctions/logs')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const DELAI_CONFIRMATION = 30 * 1000

// Vérifie qu'on peut bannir l'utilisateur. Renvoie un message d'erreur, ou null.
async function verifier(message, user) {
    // force : on relit toujours le membre auprès de Discord (le cache peut avoir des rôles périmés)
    const member = await message.guild.members.fetch({ user: user.id, force: true }).catch(() => null)

    if (member) {
        const erreur = checkHierarchy(message, member, "bannir")
        if (erreur) return { erreur }
        if (!member.bannable) return { erreur: "Je ne peux pas bannir ce membre (rôle trop haut pour moi) !" }
    } else if (user.id === message.user.id) {
        return { erreur: "Vous ne pouvez pas vous bannir vous-même !" }
    }

    if (await message.guild.bans.fetch(user.id).catch(() => null)) return { erreur: "Ce membre est déjà banni !" }
    return { member }
}

module.exports = {
    name: "ban",
    description: "Ban un membre",
    permission: Discord.PermissionFlagsBits.BanMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre à bannir",
            required: true
        }, {
            type: "string",
            name: "raison",
            description: "La raison du bannissement",
            required: true,
            maxLength: 400
        }
    ],

    async run(bot, message, args) {
        const user = args.getUser("membre")
        const raisonBrute = args.getString("raison")
        const reason = formatReason(raisonBrute)

        const premier = await verifier(message, user)
        if (premier.erreur) return message.reply({ content: premier.erreur, flags: EPHEMERAL })

        // Confirmation par bouton, visible seulement par le modérateur
        const boutons = new Discord.ActionRowBuilder().addComponents(
            new Discord.ButtonBuilder().setCustomId(`ban-oui-${message.id}`).setLabel("Bannir").setStyle(Discord.ButtonStyle.Danger),
            new Discord.ButtonBuilder().setCustomId(`ban-non-${message.id}`).setLabel("Annuler").setStyle(Discord.ButtonStyle.Secondary)
        )
        const reponse = await message.reply({
            content: `Confirmer le bannissement de ${user} (\`${user.id}\`) pour la raison : ***${reason}*** ?`,
            components: [boutons],
            flags: EPHEMERAL,
            withResponse: true
        })

        const clic = await reponse.resource.message.awaitMessageComponent({
            componentType: Discord.ComponentType.Button,
            filter: i => i.user.id === message.user.id && i.customId.endsWith(message.id),
            time: DELAI_CONFIRMATION
        }).catch(() => null)

        if (!clic) return message.editReply({ content: "Temps écoulé, bannissement annulé.", components: [] })
        if (clic.customId.startsWith("ban-non")) return clic.update({ content: "Bannissement annulé.", components: [] })

        await clic.update({ content: "Bannissement en cours…", components: [] })

        // La situation a pu changer pendant la confirmation : on revérifie la permission du modérateur
        // (celle du clic est à jour) puis la hiérarchie et l'état du ban
        if (!clic.memberPermissions?.has(Discord.PermissionFlagsBits.BanMembers)) {
            return message.editReply({ content: "Vous n'avez plus la permission de bannir." })
        }
        const second = await verifier(message, user)
        if (second.erreur) return message.editReply({ content: second.erreur })

        // Le MP doit partir avant le ban, sinon le bot ne partage plus de serveur avec lui
        if (second.member) await user.send(`Tu as été banni du serveur ${message.guild.name} pour la raison : ***${reason}***`).catch(() => {})

        try {
            await message.guild.bans.create(user.id, { reason: auditReason(message, raisonBrute) })
        } catch (err) {
            console.error("Échec du bannissement :", err)
            return message.editReply({ content: "Échec du bannissement (permissions du bot ?)." })
        }
        await message.editReply({ content: "Bannissement effectué." })
        await message.followUp(`${message.user} a banni ${user} pour la raison : ***${reason}***`)
        await sendModLog(message, { action: "ban", cible: user, raison: raisonBrute })
    }
}
