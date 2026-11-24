const Discord = require('discord.js')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral
const PERMS_TICKET = [Flags.ViewChannel, Flags.SendMessages, Flags.ReadMessageHistory, Flags.AttachFiles, Flags.EmbedLinks]

const DELAI_ENTRE_TICKETS = 10 * 60 * 1000 // 10 minutes entre deux ouvertures pour un même membre
const MAX_TICKETS_OUVERTS = 50 // par serveur

const enCours = new Set() // ouvertures/fermetures en cours (évite les doubles clics)
const derniereOuverture = new Map() // "serveur-membre" -> date de la dernière ouverture

// Le rôle staff configuré, s'il existe et n'est ni @everyone ni un rôle géré par une intégration
function staffRoleId(guild) {
    const role = guild.roles.cache.get(process.env.TICKET_STAFF_ROLE_ID ?? "")
    if (!role || role.id === guild.id || role.managed) return null
    return role.id
}

function isStaff(interaction) {
    const staff = staffRoleId(interaction.guild)
    return interaction.memberPermissions.has(Flags.ManageChannels) || Boolean(staff && interaction.member.roles.cache.has(staff))
}

// Un ticket est un salon texte "ticket-..." (ouvert) ou "ferme-..." (fermé par son auteur)
// dont le sujet contient l'ID de son auteur. Renvoie cet ID, ou null.
function ticketOwnerId(channel) {
    if (channel?.type !== Discord.ChannelType.GuildText) return null
    if (!channel.name.startsWith("ticket-") && !channel.name.startsWith("ferme-")) return null
    return /^\d{17,20}$/.test(channel.topic ?? "") ? channel.topic : null
}

// Tous les tickets du serveur, ouverts ou fermés en attente de suppression par le staff
function allTickets(guild) {
    return guild.channels.cache.filter(c => ticketOwnerId(c))
}

function purgeCooldowns() {
    const limite = Date.now() - DELAI_ENTRE_TICKETS
    for (const [cle, date] of derniereOuverture) if (date < limite) derniereOuverture.delete(cle)
}

async function openTicket(bot, interaction) {
    if (!interaction.inCachedGuild()) return

    const guild = interaction.guild
    const user = interaction.user
    const cle = `${guild.id}-${user.id}`
    const tickets = allTickets(guild)

    // Un ticket fermé par son auteur compte toujours tant que le staff ne l'a pas supprimé
    const existant = tickets.find(c => c.topic === user.id)
    if (existant) {
        const texte = existant.name.startsWith("ferme-") ? "Ton ancien ticket n'a pas encore été traité par le staff, attends sa suppression." : `Tu as déjà un ticket ouvert : ${existant}`
        return interaction.reply({ content: texte, flags: EPHEMERAL })
    }
    if (enCours.has(cle)) return interaction.reply({ content: "Ton ticket est en cours de création…", flags: EPHEMERAL })

    purgeCooldowns()
    const attente = (derniereOuverture.get(cle) ?? 0) + DELAI_ENTRE_TICKETS - Date.now()
    if (attente > 0) return interaction.reply({ content: `Merci d'attendre ${Math.ceil(attente / 60000)} min avant d'ouvrir un nouveau ticket.`, flags: EPHEMERAL })
    if (tickets.size >= MAX_TICKETS_OUVERTS) return interaction.reply({ content: "Trop de tickets sont ouverts en ce moment, réessaie plus tard.", flags: EPHEMERAL })

    enCours.add(cle)
    try {
        await interaction.deferReply({ flags: EPHEMERAL })

        // Les permissions sont posées dès la création : le salon n'est jamais visible par @everyone
        const permissionOverwrites = [
            { id: guild.roles.everyone.id, deny: [Flags.ViewChannel] },
            { id: user.id, allow: PERMS_TICKET },
            { id: bot.user.id, allow: [...PERMS_TICKET, Flags.ManageChannels] }
        ]
        const staff = staffRoleId(guild)
        if (staff) permissionOverwrites.push({ id: staff, allow: PERMS_TICKET })

        const channel = await guild.channels.create({
            name: `ticket-${user.username}`,
            type: Discord.ChannelType.GuildText,
            // Seulement si le bouton est dans une catégorie (pas dans un fil ou un forum)
            parent: interaction.channel?.parent?.type === Discord.ChannelType.GuildCategory ? interaction.channel.parentId : null,
            topic: user.id,
            permissionOverwrites,
            reason: `Ticket ouvert par ${user.tag}`
        })
        derniereOuverture.set(cle, Date.now())

        const embed = new Discord.EmbedBuilder()
            .setColor(bot.color)
            .setTitle("Ticket")
            .setThumbnail(bot.user.displayAvatarURL())
            .setDescription("Bienvenue dans votre ticket, un membre du staff va vous répondre.")
            .setTimestamp()
            .setFooter({ text: bot.user.username, iconURL: bot.user.displayAvatarURL() })

        const btn = new Discord.ActionRowBuilder().addComponents(new Discord.ButtonBuilder()
            .setCustomId("close")
            .setLabel("Fermer le ticket")
            .setStyle(Discord.ButtonStyle.Danger)
            .setEmoji("🗑️"))

        await channel.send({ embeds: [embed], components: [btn] })
        await interaction.editReply(`Votre ticket a correctement été créé : ${channel}`)
    } finally {
        enCours.delete(cle)
    }
}

// L'auteur qui ferme son ticket perd seulement l'accès (le staff garde l'historique).
// Le staff, lui, supprime le salon.
async function closeTicket(bot, interaction) {
    if (!interaction.inCachedGuild()) return

    const channel = interaction.channel
    const ownerId = ticketOwnerId(channel)
    if (!ownerId) return interaction.reply({ content: "Ce salon n'est pas un ticket.", flags: EPHEMERAL })

    const staff = isStaff(interaction)
    if (interaction.user.id !== ownerId && !staff) {
        return interaction.reply({ content: "Seul l'auteur du ticket ou le staff peut le fermer.", flags: EPHEMERAL })
    }

    const cle = `close-${channel.id}`
    if (enCours.has(cle)) return interaction.reply({ content: "Fermeture déjà en cours…", flags: EPHEMERAL })
    enCours.add(cle)

    try {
        if (!staff) {
            if (channel.name.startsWith("ferme-")) return interaction.reply({ content: "Ce ticket est déjà fermé.", flags: EPHEMERAL })
            // On renomme d'abord : si ça échoue, l'auteur garde l'accès à son ticket
            await interaction.deferReply()
            await channel.setName(`ferme-${channel.name.replace(/^ticket-/, "")}`, "Ticket fermé par son auteur")
            await channel.permissionOverwrites.edit(ownerId, { ViewChannel: false }, { reason: "Ticket fermé par son auteur" })
            await interaction.editReply("Ticket fermé par son auteur. Le staff peut maintenant le supprimer avec le bouton.")
            return
        }

        await interaction.reply("Suppression du ticket…")

        const owner = await bot.users.fetch(ownerId).catch(() => null)
        await owner?.send(`Votre ticket sur le serveur ${interaction.guild.name} a été fermé.`).catch(() => {})

        await channel.delete(`Ticket supprimé par ${interaction.user.tag}`)
    } finally {
        enCours.delete(cle)
    }
}

module.exports = { openTicket, closeTicket, ticketOwnerId }
