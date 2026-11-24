const Discord = require('discord.js')
const db = require('./db')
const { getLogChannel } = require('./logs')
const { buildTranscript, sendAttachments, messageContentActive } = require('./transcript')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral
const PERMS_TICKET = [Flags.ViewChannel, Flags.SendMessages, Flags.ReadMessageHistory, Flags.AttachFiles, Flags.EmbedLinks]

const DELAI_ENTRE_TICKETS = 10 * 60 * 1000 // 10 minutes entre deux ouvertures pour un même membre
const MAX_TICKETS_OUVERTS = 50 // par serveur
const MAX_SALONS_CATEGORIE = 50 // limite de Discord
const DELAI_CONFIRMATION = 30 * 1000

const enCours = new Set() // ouvertures/fermetures en cours (évite les doubles clics)

// Un rôle staff valable : il existe et n'est ni @everyone ni un rôle géré par une intégration
function roleValide(guild, id) {
    const role = id ? guild.roles.cache.get(id) : null
    return role && role.id !== guild.id && !role.managed ? role : null
}

// Rôle staff : celui choisi avec /setticket, sinon celui du .env
function staffRoleId(guild) {
    const { staffRoleId } = db.getTicketConfig(guild.id)
    return roleValide(guild, staffRoleId)?.id ?? roleValide(guild, process.env.TICKET_STAFF_ROLE_ID)?.id ?? null
}

function isStaff(interaction) {
    const staff = staffRoleId(interaction.guild)
    return interaction.memberPermissions.has(Flags.ManageChannels) || Boolean(staff && interaction.member.roles.cache.has(staff))
}

// Catégorie des tickets : celle choisie avec /setticket, sinon celle du panneau
function ticketCategory(interaction) {
    const { categoryId } = db.getTicketConfig(interaction.guild.id)
    const choisie = categoryId ? interaction.guild.channels.cache.get(categoryId) : null
    if (categorieUtilisable(choisie)) return choisie
    const parent = interaction.channel?.parent
    return categorieUtilisable(parent) ? parent : null
}

// Une catégorie où le bot peut réellement créer des salons
function categorieUtilisable(categorie) {
    if (categorie?.type !== Discord.ChannelType.GuildCategory) return false
    return Boolean(categorie.permissionsFor(categorie.guild.members.me)?.has([Flags.ViewChannel, Flags.ManageChannels]))
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

    // Délai stocké en base : il survit à un redémarrage du bot
    db.purgeTicketCooldowns(Date.now() - DELAI_ENTRE_TICKETS)
    const attente = db.getTicketCooldown(guild.id, user.id) + DELAI_ENTRE_TICKETS - Date.now()
    if (attente > 0) return interaction.reply({ content: `Merci d'attendre ${Math.ceil(attente / 60000)} min avant d'ouvrir un nouveau ticket.`, flags: EPHEMERAL })
    if (tickets.size >= MAX_TICKETS_OUVERTS) return interaction.reply({ content: "Trop de tickets sont ouverts en ce moment, réessaie plus tard.", flags: EPHEMERAL })

    const categorie = ticketCategory(interaction)
    if (categorie && categorie.children.cache.size >= MAX_SALONS_CATEGORIE) {
        return interaction.reply({ content: "La catégorie des tickets est pleine, préviens le staff.", flags: EPHEMERAL })
    }

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
            parent: categorie?.id ?? null,
            topic: user.id,
            permissionOverwrites,
            reason: `Ticket ouvert par ${user.tag}`
        })

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

        // En dernier : une erreur de la base ne doit pas laisser un ticket sans bouton de fermeture
        try {
            db.setTicketCooldown(guild.id, user.id)
        } catch (err) {
            console.error("Impossible d'enregistrer le délai du ticket :", err.message)
        }
    } finally {
        enCours.delete(cle)
    }
}

// L'auteur qui ferme son ticket perd seulement l'accès (le staff garde l'historique).
// Le staff, lui, supprime le salon après confirmation, avec un transcript envoyé dans le salon de logs.
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

        await supprimerTicket(bot, interaction, channel, ownerId)
    } finally {
        enCours.delete(cle)
    }
}

async function supprimerTicket(bot, interaction, channel, ownerId) {
    const logs = getLogChannel(interaction.guild)
    const peutJoindre = logs?.permissionsFor(interaction.guild.members.me)?.has(Flags.AttachFiles)
    const contenu = await messageContentActive(bot)
    let avertissement = !logs
        ? "\n⚠️ Aucun salon de logs (`/setlogs`) : l'historique de ce ticket sera **perdu définitivement**."
        : !peutJoindre
            ? `\n⚠️ Je ne peux pas joindre de fichier dans ${logs} : l'historique sera **perdu définitivement**.`
            : `\nUn transcript et les pièces jointes seront envoyés dans ${logs}.`
    if (logs && peutJoindre && !contenu) {
        avertissement += "\n⚠️ Le **Message Content Intent** n'est pas activé : le transcript ne contiendra **pas le texte** des messages des membres."
    }

    // Confirmation par bouton, visible seulement par la personne qui a cliqué
    const boutons = new Discord.ActionRowBuilder().addComponents(
        new Discord.ButtonBuilder().setCustomId(`ticket-suppr-oui-${interaction.id}`).setLabel("Supprimer").setStyle(Discord.ButtonStyle.Danger),
        new Discord.ButtonBuilder().setCustomId(`ticket-suppr-non-${interaction.id}`).setLabel("Annuler").setStyle(Discord.ButtonStyle.Secondary)
    )
    const reponse = await interaction.reply({
        content: `Supprimer définitivement ce ticket ?${avertissement}`,
        components: [boutons],
        flags: EPHEMERAL,
        withResponse: true
    })

    const clic = await reponse.resource.message.awaitMessageComponent({
        componentType: Discord.ComponentType.Button,
        filter: i => i.user.id === interaction.user.id && i.customId.endsWith(interaction.id),
        time: DELAI_CONFIRMATION
    }).catch(() => null)

    if (!clic) return interaction.editReply({ content: "Temps écoulé, suppression annulée.", components: [] })
    if (clic.customId.startsWith("ticket-suppr-non")) return clic.update({ content: "Suppression annulée.", components: [] })
    await clic.update({ content: "Suppression du ticket…", components: [] })

    // Les droits ont pu changer pendant la confirmation : on revérifie avec le clic (données à jour)
    if (!isStaff(clic)) return interaction.editReply({ content: "Vous n'avez plus le droit de supprimer ce ticket." })

    const owner = await bot.users.fetch(ownerId).catch(() => null)

    // Le transcript sert de preuve : s'il ne peut pas être envoyé, on ne supprime pas
    if (logs && peutJoindre) {
        try {
            const { texte, nombre, pieces } = await buildTranscript(channel, { fermePar: interaction.user, auteurId: ownerId })
            const embed = new Discord.EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle("Ticket supprimé")
                .addFields(
                    { name: "Ticket", value: `\`#${channel.name}\``, inline: true },
                    { name: "Auteur", value: owner ? `${owner} (\`${owner.id}\`)` : `\`${ownerId}\``, inline: true },
                    { name: "Supprimé par", value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true },
                    { name: "Messages", value: String(nombre), inline: true },
                    { name: "Pièces jointes", value: String(pieces.length), inline: true }
                )
                .setTimestamp()
            if (!contenu) embed.addFields({ name: "⚠️ Attention", value: "Message Content Intent désactivé : le texte des messages des membres est absent du transcript." })
            const fichier = new Discord.AttachmentBuilder(Buffer.from(texte, "utf8"), { name: `transcript-${channel.name}.txt` })
            await logs.send({ embeds: [embed], files: [fichier] })

            const ignorees = await sendAttachments(logs, pieces, channel.name)
            if (ignorees.length) await logs.send(`Pièces jointes non conservées (trop lourdes ou indisponibles) : ${ignorees.length}`)
        } catch (err) {
            console.error("Transcript impossible :", err)
            return interaction.editReply({ content: "Impossible d'enregistrer le transcript ou les pièces jointes : suppression annulée pour ne pas perdre l'historique (un envoi partiel a pu avoir lieu dans les logs)." })
        }
    }

    await owner?.send(`Votre ticket sur le serveur ${interaction.guild.name} a été fermé.`).catch(() => {})
    await channel.delete(`Ticket supprimé par ${interaction.user.tag}`)
}

module.exports = { openTicket, closeTicket, ticketOwnerId, roleValide, categorieUtilisable }
