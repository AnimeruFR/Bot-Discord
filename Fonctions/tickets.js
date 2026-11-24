const Discord = require('discord.js')
const { couleur } = require('./apparence')
const { t, langueDe } = require('./i18n')
const db = require('./db')
const { getLogChannel, sendModLog } = require('./logs')
const { buildTranscript, sendAttachments, messageContentActive } = require('./transcript')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral
const PERMS_TICKET = [Flags.ViewChannel, Flags.SendMessages, Flags.ReadMessageHistory, Flags.AttachFiles, Flags.EmbedLinks]

const DELAI_ENTRE_TICKETS = 10 * 60 * 1000 // 10 minutes entre deux ouvertures pour un même membre
const MAX_TICKETS_OUVERTS = 50 // par serveur
const MAX_SALONS_CATEGORIE = 50 // limite de Discord
const DELAI_CONFIRMATION = 30 * 1000
const DELAI_NOTE = 7 * 24 * 60 * 60 * 1000 // une note est acceptée pendant 7 jours
const MAX_MEMBRES_AJOUTES = 10 // par ticket, avec /ticket ajouter

const enCours = new Set() // ouvertures/fermetures en cours (évite les doubles clics)
const dernierePrise = new Map() // salon -> date de la dernière prise en charge (anti double clic)

// Un rôle staff valable : il existe et n'est ni @everyone ni un rôle géré par une intégration
function roleValide(guild, id) {
    const role = id ? guild.roles.cache.get(id) : null
    return role && role.id !== guild.id && !role.managed ? role : null
}

// Rôle staff : celui du type de ticket, sinon celui de /setticket, sinon celui du .env
function staffRoleId(guild, type = null) {
    const { staffRoleId } = db.getTicketConfig(guild.id)
    return roleValide(guild, type?.staff_role_id)?.id
        ?? roleValide(guild, staffRoleId)?.id
        ?? roleValide(guild, process.env.TICKET_STAFF_ROLE_ID)?.id
        ?? null
}

// Staff : « Gérer les salons », ou le rôle staff global, ou le rôle posé sur ce ticket à sa création
// (celui de son type à ce moment-là : modifier le type ensuite ne change pas qui voit le salon)
function isStaff(interaction, channel = null) {
    if (interaction.memberPermissions.has(Flags.ManageChannels)) return true
    const roles = interaction.member.roles.cache
    const global = staffRoleId(interaction.guild)
    if (global && roles.has(global)) return true
    const duTicket = channel ? roleValide(interaction.guild, db.getTicket(channel.id)?.staff_role_id)?.id : null
    return Boolean(duTicket && roles.has(duTicket))
}

// Catégorie des tickets : celle du type, sinon celle de /setticket, sinon celle du panneau
function ticketCategory(interaction, type = null) {
    const { categoryId } = db.getTicketConfig(interaction.guild.id)
    for (const id of [type?.category_id, categoryId]) {
        const categorie = id ? interaction.guild.channels.cache.get(id) : null
        if (categorieUtilisable(categorie)) return categorie
    }
    const parent = interaction.channel?.parent
    return categorieUtilisable(parent) ? parent : null
}

// Une catégorie où le bot peut réellement créer des salons
function categorieUtilisable(categorie) {
    if (categorie?.type !== Discord.ChannelType.GuildCategory) return false
    return Boolean(categorie.permissionsFor(categorie.guild.members.me)?.has([Flags.ViewChannel, Flags.ManageChannels]))
}

// Un ticket est un salon texte "ticket-..." (ouvert) ou "ferme-..." (fermé) dont le sujet contient l'ID de son auteur.
// Renvoie cet ID, ou null.
function ticketOwnerId(channel) {
    if (channel?.type !== Discord.ChannelType.GuildText) return null
    if (!channel.name.startsWith("ticket-") && !channel.name.startsWith("ferme-")) return null
    return /^\d{17,20}$/.test(channel.topic ?? "") ? channel.topic : null
}

// Ligne en base d'un ticket : créée à la volée pour les tickets d'avant le lot F
function assurerTicket(channel, ownerId) {
    db.addTicket(channel.guild.id, channel.id, ownerId, null, {
        status: channel.name.startsWith("ferme-") ? "ferme" : "ouvert",
        createdAt: channel.createdTimestamp ?? Date.now()
    })
    return db.getTicket(channel.id)
}

// Tous les tickets du serveur, ouverts ou fermés en attente de suppression par le staff
function allTickets(guild) {
    return guild.channels.cache.filter(c => ticketOwnerId(c))
}

// Vérifications avant d'ouvrir un ticket. Renvoie un message d'erreur, ou null.
function verifierOuverture(interaction, type = null) {
    const { guild, user } = interaction
    const tickets = allTickets(guild)
    // Un ticket fermé compte toujours tant que le staff ne l'a pas supprimé
    const existant = tickets.find(c => c.topic === user.id)
    if (existant) {
        return existant.name.startsWith("ferme-")
            ? t(interaction, "tickets.ancien_en_attente")
            : t(interaction, "tickets.deja_ouvert", { salon: existant })
    }
    if (enCours.has(`${guild.id}-${user.id}`)) return t(interaction, "tickets.en_creation")

    // Délai stocké en base : il survit à un redémarrage du bot
    const attente = db.getTicketCooldown(guild.id, user.id) + DELAI_ENTRE_TICKETS - Date.now()
    if (attente > 0) return t(interaction, "tickets.attendre", { minutes: Math.ceil(attente / 60000) })
    if (tickets.size >= MAX_TICKETS_OUVERTS) return t(interaction, "tickets.trop")

    const categorie = ticketCategory(interaction, type)
    if (categorie && categorie.children.cache.size >= MAX_SALONS_CATEGORIE) return t(interaction, "tickets.categorie_pleine")
    return null
}

// Menu déroulant des types (panneau, ou réponse au bouton d'un ancien panneau)
function menuTypes(types, langue = "fr") {
    return new Discord.ActionRowBuilder().addComponents(new Discord.StringSelectMenuBuilder()
        .setCustomId("ticket-type")
        .setPlaceholder(t(langue, "tickets.menu_placeholder"))
        .addOptions(types.map(t => {
            const option = { label: t.nom.slice(0, 100), value: String(t.id) }
            if (t.description) option.description = t.description.slice(0, 100)
            return option
        })))
}

// Bouton « Créer un ticket » : choix du type s'il y en a, sinon formulaire directement
async function onBoutonTicket(bot, interaction) {
    if (!interaction.inCachedGuild()) return
    const types = db.listTicketTypes(interaction.guild.id)
    if (types.length === 0) return montrerFormulaire(interaction, null)
    const erreur = verifierOuverture(interaction)
    if (erreur) return interaction.reply({ content: erreur, flags: EPHEMERAL })
    return interaction.reply({ content: t(interaction, "tickets.question_type"), components: [menuTypes(types, langueDe(interaction))], flags: EPHEMERAL })
}

// Menu des types : on relit le type en base (il a pu être supprimé depuis la pose du panneau)
async function onMenuType(bot, interaction) {
    if (!interaction.inCachedGuild()) return
    const id = Number(interaction.values[0])
    const type = Number.isInteger(id) ? db.getTicketType(interaction.guild.id, id) : null
    if (!type) return interaction.reply({ content: t(interaction, "tickets.type_disparu"), flags: EPHEMERAL })
    await montrerFormulaire(interaction, type)
    // Le menu du panneau garde l'option choisie affichée : on le remet à zéro pour pouvoir la rechoisir
    // (si le formulaire est annulé). Sans effet sur le menu éphémère des anciens panneaux.
    if (!interaction.message.flags.has(Discord.MessageFlags.Ephemeral)) {
        await interaction.message.edit({ components: interaction.message.components }).catch(() => {})
    }
}

// Formulaire (modal) : il doit être la première réponse à l'interaction, sans « defer » avant
async function montrerFormulaire(interaction, type) {
    const erreur = verifierOuverture(interaction, type)
    if (erreur) return interaction.reply({ content: erreur, flags: EPHEMERAL })

    const modal = new Discord.ModalBuilder()
        .setCustomId(`ticket-form:${type?.id ?? 0}`)
        .setTitle((type ? t(interaction, "tickets.formulaire_titre_type", { type: type.nom }) : t(interaction, "tickets.formulaire_titre")).slice(0, 45))
        .addComponents(
            new Discord.ActionRowBuilder().addComponents(new Discord.TextInputBuilder()
                .setCustomId("sujet").setLabel(t(interaction, "tickets.formulaire_sujet")).setStyle(Discord.TextInputStyle.Short)
                .setRequired(true).setMinLength(3).setMaxLength(100)),
            new Discord.ActionRowBuilder().addComponents(new Discord.TextInputBuilder()
                .setCustomId("details").setLabel(t(interaction, "tickets.formulaire_details")).setStyle(Discord.TextInputStyle.Paragraph)
                .setRequired(false).setMaxLength(1000))
        )
    await interaction.showModal(modal)
}

// Texte d'un membre affiché dans un embed : sans mise en forme, sans lien déguisé
function texteSur(texte) {
    return Discord.escapeMarkdown(texte, { maskedLink: true, heading: true, bulletedList: true, numberedList: true })
}

// Formulaire envoyé : on revérifie tout (il a pu rester ouvert longtemps), puis on crée le salon
async function onFormulaire(bot, interaction) {
    if (!interaction.inCachedGuild()) return
    const typeId = Number(interaction.customId.split(":")[1])
    const type = typeId ? db.getTicketType(interaction.guild.id, typeId) : null
    if (typeId && !type) return interaction.reply({ content: t(interaction, "tickets.type_supprime"), flags: EPHEMERAL })

    const erreur = verifierOuverture(interaction, type)
    if (erreur) return interaction.reply({ content: erreur, flags: EPHEMERAL })

    const sujet = interaction.fields.getTextInputValue("sujet").trim()
    const details = interaction.fields.getTextInputValue("details")?.trim() ?? ""
    if (!sujet) return interaction.reply({ content: t(interaction, "tickets.sujet_vide"), flags: EPHEMERAL })

    const { guild, user } = interaction
    const cle = `${guild.id}-${user.id}`
    enCours.add(cle)
    try {
        await interaction.deferReply({ flags: EPHEMERAL })

        // Les permissions sont posées dès la création : le salon n'est jamais visible par @everyone
        const permissionOverwrites = [
            { id: guild.roles.everyone.id, deny: [Flags.ViewChannel] },
            { id: user.id, allow: PERMS_TICKET },
            { id: bot.user.id, allow: [...PERMS_TICKET, Flags.ManageChannels] }
        ]
        const staff = staffRoleId(guild, type)
        if (staff) permissionOverwrites.push({ id: staff, allow: PERMS_TICKET })

        const categorie = ticketCategory(interaction, type)
        const channel = await guild.channels.create({
            name: `ticket-${user.username}`,
            type: Discord.ChannelType.GuildText,
            parent: categorie?.id ?? null,
            topic: user.id,
            permissionOverwrites,
            reason: `Ticket ouvert par ${user.tag}`
        })
        db.addTicket(guild.id, channel.id, user.id, type?.id ?? null, { staffRoleId: staff })

        const embed = new Discord.EmbedBuilder()
            .setColor(couleur(guild))
            .setTitle(type ? t(guild, "tickets.formulaire_titre_type", { type: type.nom }) : t(guild, "tickets.bienvenue_titre"))
            .setThumbnail(bot.user.displayAvatarURL())
            .setDescription(t(guild, "tickets.bienvenue", { membre: user }))
            .addFields({ name: t(guild, "tickets.champ_sujet"), value: texteSur(sujet).slice(0, 1024) })
            .setTimestamp()
            .setFooter({ text: bot.user.username, iconURL: bot.user.displayAvatarURL() })
        if (details) embed.addFields({ name: t(guild, "tickets.champ_details"), value: texteSur(details).slice(0, 1024) })

        const boutons = new Discord.ActionRowBuilder().addComponents(
            new Discord.ButtonBuilder().setCustomId("claim").setLabel(t(guild, "tickets.bouton_prendre")).setStyle(Discord.ButtonStyle.Success).setEmoji("🙋"),
            new Discord.ButtonBuilder().setCustomId("close").setLabel(t(guild, "tickets.bouton_fermer")).setStyle(Discord.ButtonStyle.Danger).setEmoji("🗑️")
        )

        await channel.send({ embeds: [embed], components: [boutons] })
        await interaction.editReply(t(interaction, "tickets.cree", { salon: channel }))

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

// Bouton « Prendre en charge » : un seul membre du staff à la fois ; un nouveau clic le libère
async function claimTicket(bot, interaction) {
    if (!interaction.inCachedGuild()) return
    const channel = interaction.channel
    const ownerId = ticketOwnerId(channel)
    if (!ownerId) return interaction.reply({ content: "Ce salon n'est pas un ticket.", flags: EPHEMERAL })
    if (!isStaff(interaction, channel)) return interaction.reply({ content: "Seul le staff peut prendre un ticket en charge.", flags: EPHEMERAL })
    if (interaction.user.id === ownerId) return interaction.reply({ content: "Vous ne pouvez pas prendre en charge votre propre ticket.", flags: EPHEMERAL })
    if (channel.name.startsWith("ferme-")) return interaction.reply({ content: "Ce ticket est fermé.", flags: EPHEMERAL })

    const ticket = db.getTicket(channel.id) ?? assurerTicket(channel, ownerId)
    if (ticket.claimed_by === interaction.user.id) {
        // Double clic : un 2e clic dans les 5 s ne libère pas le ticket qu'on vient de prendre
        if (Date.now() - (dernierePrise.get(channel.id) ?? 0) < 5000) return interaction.reply({ content: "Vous avez déjà pris ce ticket en charge.", flags: EPHEMERAL })
        db.unclaimTicket(channel.id, interaction.user.id)
        return interaction.reply(`${interaction.user} ne s'occupe plus de ce ticket.`)
    }
    if (!db.claimTicket(channel.id, interaction.user.id)) {
        const actuel = db.getTicket(channel.id).claimed_by
        // Un responsable (« Gérer les salons ») peut reprendre un ticket déjà pris
        if (!interaction.memberPermissions.has(Flags.ManageChannels)) {
            return interaction.reply({ content: `Ce ticket est déjà pris en charge par <@${actuel}>.`, flags: EPHEMERAL })
        }
        db.takeOverTicket(channel.id, interaction.user.id)
        return interaction.reply(`🙋 ${interaction.user} reprend ce ticket (il était suivi par <@${actuel}>).`)
    }
    dernierePrise.set(channel.id, Date.now())
    await interaction.reply(`🙋 ${interaction.user} a pris en charge ce ticket.`)
}

// /ticket ajouter|retirer : donne ou retire l'accès d'un membre au ticket
async function gererMembre(interaction, action, user) {
    if (!interaction.inCachedGuild()) return
    const channel = interaction.channel
    const ownerId = ticketOwnerId(channel)
    if (!ownerId) return interaction.reply({ content: "Utilisez cette commande dans un salon de ticket.", flags: EPHEMERAL })
    if (!isStaff(interaction, channel)) return interaction.reply({ content: "Seul le staff du ticket peut ajouter ou retirer des membres.", flags: EPHEMERAL })
    if (!channel.permissionsFor(interaction.guild.members.me)?.has([Flags.ViewChannel, Flags.ManageChannels, Flags.ManageRoles])) {
        return interaction.reply({ content: "Il me faut « Gérer les salons » et « Gérer les permissions » dans ce ticket.", flags: EPHEMERAL })
    }
    if (user.bot) return interaction.reply({ content: "On n'ajoute ou ne retire pas un bot d'un ticket.", flags: EPHEMERAL })
    if (user.id === ownerId) return interaction.reply({ content: "L'auteur du ticket ne peut pas être ajouté ou retiré.", flags: EPHEMERAL })
    if (channel.name.startsWith("ferme-")) return interaction.reply({ content: "Ce ticket est fermé.", flags: EPHEMERAL })

    const member = await interaction.guild.members.fetch({ user: user.id, force: true }).catch(err => {
        if (err.code === Discord.RESTJSONErrorCodes.UnknownMember) return null
        throw err
    })
    const raison = `${interaction.user.tag} : /ticket ${action}`

    if (action === "ajouter") {
        if (!member) return interaction.reply({ content: "Ce membre n'est pas sur le serveur.", flags: EPHEMERAL })
        if (channel.permissionsFor(member)?.has(Flags.ViewChannel)) return interaction.reply({ content: `${user} voit déjà ce ticket.`, flags: EPHEMERAL })
        const ajoutes = channel.permissionOverwrites.cache.filter(o => o.type === Discord.OverwriteType.Member && o.id !== ownerId && o.id !== interaction.guild.members.me.id)
        if (ajoutes.size >= MAX_MEMBRES_AJOUTES) return interaction.reply({ content: `${MAX_MEMBRES_AJOUTES} membres ajoutés au maximum par ticket.`, flags: EPHEMERAL })
        await channel.permissionOverwrites.edit(user.id, Object.fromEntries(PERMS_TICKET.map(p => [new Discord.PermissionsBitField(p).toArray()[0], true])),
            { reason: raison, type: Discord.OverwriteType.Member })
        await interaction.reply(`${user} a été ajouté au ticket par ${interaction.user}.`)
    } else {
        // On ne retire pas un membre plus haut que soi (ex : un administrateur)
        if (member && interaction.user.id !== interaction.guild.ownerId && member.roles.highest.comparePositionTo(interaction.member.roles.highest) >= 0) {
            return interaction.reply({ content: "Vous ne pouvez pas retirer un membre dont le rôle est supérieur ou égal au vôtre.", flags: EPHEMERAL })
        }
        if (!channel.permissionOverwrites.cache.has(user.id)) return interaction.reply({ content: `${user} n'a pas été ajouté à ce ticket.`, flags: EPHEMERAL })
        // Accès par un rôle (staff, administrateur) : retirer son autorisation personnelle ne changerait rien
        const parRole = member && (member.permissions.has(Flags.Administrator) || member.permissionsIn(channel).has(Flags.ManageChannels)
            || channel.permissionOverwrites.cache.some(o => o.type === Discord.OverwriteType.Role && member.roles.cache.has(o.id) && o.allow.has(Flags.ViewChannel)))
        if (parRole) return interaction.reply({ content: `${user} voit ce ticket grâce à l'un de ses rôles : impossible de le retirer avec cette commande.`, flags: EPHEMERAL })
        await channel.permissionOverwrites.delete(user.id, raison)
        await interaction.reply(`${user} a été retiré du ticket par ${interaction.user}.`)
    }
    await sendModLog(interaction, { action: "ticket", cible: user, details: `${action === "ajouter" ? "Ajouté au" : "Retiré du"} ticket ${channel}` })
}

// L'auteur perd l'accès. type Member : l'ID seul ne suffit pas à discord.js si l'utilisateur n'est pas en cache
// (cas normal après un redémarrage, le bot n'ayant pas l'intent des membres).
function retirerAccesAuteur(channel, ownerId, raison) {
    return channel.permissionOverwrites.edit(ownerId, { ViewChannel: false }, { reason: raison, type: Discord.OverwriteType.Member })
}

// L'auteur a-t-il vraiment perdu l'accès ? (un renommage seul ne prouve rien)
function accesAuteurRetire(channel, ownerId) {
    return Boolean(channel.permissionOverwrites.cache.get(ownerId)?.deny.has(Flags.ViewChannel))
}

// Fermeture « douce » : renommé "ferme-", l'auteur perd l'accès, le staff garde l'historique pour le supprimer ensuite
async function fermerPourAuteur(channel, ownerId, raison) {
    // On renomme d'abord : si ça échoue, l'auteur garde l'accès à son ticket.
    // Discord limite les renommages (2 par 10 min) et discord.js attendrait sans fin : on abandonne après 15 s.
    await Promise.race([
        channel.setName(`ferme-${channel.name.replace(/^ticket-/, "")}`, raison),
        new Promise((_, rejeter) => setTimeout(() => rejeter(new Error("Renommage du salon trop lent (limite de Discord)")), 15000).unref())
    ])
    await retirerAccesAuteur(channel, ownerId, raison)
    assurerTicket(channel, ownerId)
    db.setTicketStatus(channel.id, "ferme")
}

// L'auteur qui ferme son ticket perd seulement l'accès (le staff garde l'historique).
// Le staff, lui, supprime le salon après confirmation, avec un transcript envoyé dans le salon de logs.
async function closeTicket(bot, interaction) {
    if (!interaction.inCachedGuild()) return

    const channel = interaction.channel
    const ownerId = ticketOwnerId(channel)
    if (!ownerId) return interaction.reply({ content: "Ce salon n'est pas un ticket.", flags: EPHEMERAL })

    const staff = isStaff(interaction, channel)
    if (interaction.user.id !== ownerId && !staff) {
        return interaction.reply({ content: "Seul l'auteur du ticket ou le staff peut le fermer.", flags: EPHEMERAL })
    }

    const cle = `close-${channel.id}`
    if (enCours.has(cle)) return interaction.reply({ content: "Fermeture déjà en cours…", flags: EPHEMERAL })
    enCours.add(cle)

    try {
        if (!staff) {
            if (channel.name.startsWith("ferme-")) return interaction.reply({ content: "Ce ticket est déjà fermé.", flags: EPHEMERAL })
            await interaction.deferReply()
            await fermerPourAuteur(channel, ownerId, "Ticket fermé par son auteur")
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
            : `\nUn transcript (texte et HTML) et les pièces jointes seront envoyés dans ${logs}.`
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
    if (!isStaff(clic, channel)) return interaction.editReply({ content: "Vous n'avez plus le droit de supprimer ce ticket." })

    const owner = await bot.users.fetch(ownerId).catch(() => null)
    const ticket = db.getTicket(channel.id) ?? assurerTicket(channel, ownerId)

    // Le transcript sert de preuve : s'il ne peut pas être envoyé, on ne supprime pas
    if (logs && peutJoindre) {
        try {
            const { texte, html, nombre, pieces } = await buildTranscript(channel, { fermePar: interaction.user, auteurId: ownerId })
            const embed = new Discord.EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle("Ticket supprimé")
                .addFields(
                    { name: "Ticket", value: `\`#${channel.name}\``, inline: true },
                    { name: "Auteur", value: owner ? `${owner} (\`${owner.id}\`)` : `\`${ownerId}\``, inline: true },
                    { name: "Supprimé par", value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true },
                    { name: "Pris en charge par", value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : "Personne", inline: true },
                    { name: "Messages", value: String(nombre), inline: true },
                    { name: "Pièces jointes", value: String(pieces.length), inline: true }
                )
                .setTimestamp()
            if (!contenu) embed.addFields({ name: "⚠️ Attention", value: "Message Content Intent désactivé : le texte des messages des membres est absent du transcript." })
            const fichier = new Discord.AttachmentBuilder(Buffer.from(texte, "utf8"), { name: `transcript-${channel.name}.txt` })
            await logs.send({ embeds: [embed], files: [fichier] })
            // HTML dans un 2e message : chaque envoi reste sous la limite de taille de Discord
            if (html) await logs.send({ files: [new Discord.AttachmentBuilder(Buffer.from(html, "utf8"), { name: `transcript-${channel.name}.html` })] })
            else await logs.send("Transcript HTML trop volumineux : seule la version texte est jointe.")

            const ignorees = await sendAttachments(logs, pieces, channel.name)
            if (ignorees.length) await logs.send(`Pièces jointes non conservées (trop lourdes ou indisponibles) : ${ignorees.length}`)
        } catch (err) {
            console.error("Transcript impossible :", err)
            return interaction.editReply({ content: "Impossible d'enregistrer le transcript ou les pièces jointes : suppression annulée pour ne pas perdre l'historique (un envoi partiel a pu avoir lieu dans les logs)." })
        }
    }

    await channel.delete(`Ticket supprimé par ${interaction.user.tag}`)
    db.setTicketStatus(channel.id, "supprime")

    // Demande de note (1 à 5) en MP à l'auteur
    const notes = new Discord.ActionRowBuilder().addComponents([1, 2, 3, 4, 5].map(n =>
        new Discord.ButtonBuilder().setCustomId(`note:${channel.id}:${n}`).setLabel("⭐".repeat(n)).setStyle(Discord.ButtonStyle.Secondary)))
    await owner?.send({
        content: `Votre ticket sur le serveur **${Discord.escapeMarkdown(interaction.guild.name)}** a été fermé. Comment s'est passée la prise en charge ?`
            + (logs && peutJoindre ? "\n-# Une copie de la conversation est conservée par le staff du serveur." : ""),
        components: [notes]
    }).catch(() => {})
}

// Clic sur une note en MP. Tout vient du customId : on revérifie en base que c'est bien l'auteur,
// que le ticket est supprimé, pas encore noté, et depuis moins de 7 jours.
async function noterTicket(bot, interaction) {
    const [, channelId, texteNote] = interaction.customId.split(":")
    const note = Number(texteNote)
    const ticket = /^\d{17,20}$/.test(channelId ?? "") ? db.getTicket(channelId) : null
    if (!ticket || !Number.isInteger(note) || note < 1 || note > 5 || ticket.owner_id !== interaction.user.id) {
        return interaction.reply({ content: "Cette note n'est pas valable.", flags: EPHEMERAL })
    }
    if (Date.now() - (ticket.closed_at ?? 0) > DELAI_NOTE) return interaction.update({ content: "Le délai pour noter ce ticket est dépassé.", components: [] })
    if (!db.rateTicket(channelId, interaction.user.id, note)) return interaction.update({ content: "Ce ticket a déjà été noté.", components: [] })

    await interaction.update({ content: `Merci pour ta note : ${"⭐".repeat(note)}`, components: [] })
    const guild = bot.guilds.cache.get(ticket.guild_id)
    if (guild) await sendModLog({ guild, user: interaction.user }, { action: "ticket", details: `Note du ticket \`${channelId}\` : ${note}/5${ticket.claimed_by ? ` (pris en charge par <@${ticket.claimed_by}>)` : ""}` })
}

module.exports = {
    onBoutonTicket, onMenuType, onFormulaire, claimTicket, closeTicket, noterTicket, gererMembre, fermerPourAuteur,
    retirerAccesAuteur, accesAuteurRetire, menuTypes, ticketOwnerId, roleValide, categorieUtilisable, isStaff, staffRoleId, verifierOuverture, texteSur
}
