const Discord = require('discord.js')
const db = require('./db')
const { t } = require('./i18n')
const { couleur } = require('./apparence')
const { getLogChannel } = require('./logs')
const { avertir, muter } = require('./actionsMod')
const { refuser } = require('./erreurs')
const cooldowns = require('./cooldowns')
const { compterNotes } = require('./notes')
const { ligneSanction } = require('./cases')

// Signalement d'un message au staff (#22) et menus contextuels du staff (#23).
// Rien n'est stocké en base : les données utiles voyagent dans le customId des modals et des boutons.

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const { Flags } = Discord.PermissionsBitField

const PREFIXE_SIGNALEMENT = "signal:" // modal : signal:<salon>:<message>
const PREFIXE_ACTION = "sigmod:" // boutons : sigmod:<w|m|i>:<auteur du message>
const PREFIXE_WARN = "ctxwarn:" // modal du « Warn rapide » : ctxwarn:<membre>
const MUTE_MS = 10 * 60 * 1000
const MAX_RAISON = 500
const MAX_EXTRAIT = 1000
const SANCTIONS_AFFICHEES = 5

const SNOWFLAKE = "\\d{17,20}"
const RE_SIGNALEMENT = new RegExp(`^${PREFIXE_SIGNALEMENT}(${SNOWFLAKE}):(${SNOWFLAKE})$`)
const RE_ACTION = new RegExp(`^${PREFIXE_ACTION}([wmi]):(${SNOWFLAKE})$`)
const RE_WARN = new RegExp(`^${PREFIXE_WARN}(${SNOWFLAKE})$`)
const RE_LIEN = /^https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+$/

// Verrou en mémoire : un signalement n'est traité qu'une fois, même si deux modérateurs cliquent en même temps.
// Un identifiant reste verrouillé quelques minutes après un traitement réussi (le temps que le message soit mis à jour).
const verrous = new Set()
const DUREE_VERROU = 5 * 60 * 1000
// Messages déjà signalés (id -> date), pour ne pas inonder le salon staff
const dejaSignales = new Map()
const DUREE_DEJA_SIGNALE = 10 * 60 * 1000

const echapper = texte => Discord.escapeMarkdown(texte, { maskedLink: true, heading: true, bulletedList: true, numberedList: true })

const lienMessage = message => `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`

// ---------- Signalement d'un message ----------

// Refus éventuel du signalement (texte traduit) ; null si le message peut être signalé.
// Le message d'un membre du staff peut être signalé : un abus de pouvoir doit pouvoir remonter,
// et la hiérarchie est de toute façon revérifiée au moment du warn ou du mute.
function verifierSignalement(interaction, message) {
    if (message.author.id === interaction.user.id) return t(interaction, "sig.refus.soi")
    if (message.author.bot || message.webhookId) return t(interaction, "sig.refus.bot")
    if (message.system) return t(interaction, "sig.refus.systeme")
    if (!getLogChannel(interaction.guild, "signalements")) return t(interaction, "sig.refus.aucun_salon")
    return null
}

function modalSignalement(interaction, message) {
    const raison = new Discord.TextInputBuilder()
        .setCustomId("raison")
        .setLabel(t(interaction, "sig.modal.raison"))
        .setPlaceholder(t(interaction, "sig.modal.indication"))
        .setStyle(Discord.TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(MAX_RAISON)
    return new Discord.ModalBuilder()
        .setCustomId(`${PREFIXE_SIGNALEMENT}${message.channelId}:${message.id}`)
        .setTitle(t(interaction, "sig.modal.titre"))
        .addComponents(new Discord.ActionRowBuilder().addComponents(raison))
}

// Menu « Signaler au staff » : refuse ou ouvre le modal. Un refus ne consomme pas le délai du membre.
async function ouvrirSignalement(interaction) {
    const refus = verifierSignalement(interaction, interaction.targetMessage)
    if (refus) {
        cooldowns.liberer(interaction.commandName, interaction.guildId, interaction.user.id)
        return refuser(interaction, refus)
    }
    await interaction.showModal(modalSignalement(interaction, interaction.targetMessage))
}

function boutonsAction(guild, auteurId, desactives = false) {
    const bouton = (action, cle, style) => new Discord.ButtonBuilder()
        .setCustomId(`${PREFIXE_ACTION}${action}:${auteurId}`)
        .setLabel(t(guild, cle))
        .setStyle(style)
        .setDisabled(desactives)
    return [new Discord.ActionRowBuilder().addComponents(
        bouton("w", "sig.bouton.warn", Discord.ButtonStyle.Primary),
        bouton("m", "sig.bouton.mute", Discord.ButtonStyle.Danger),
        bouton("i", "sig.bouton.ignorer", Discord.ButtonStyle.Secondary)
    )]
}

function embedSignalement(guild, message, signaleur, raison) {
    const extrait = message.content
        ? echapper(message.content).slice(0, MAX_EXTRAIT)
        : t(guild, "sig.embed.sans_texte")
    const pieces = message.attachments?.size ? t(guild, "sig.embed.pieces_jointes", { n: message.attachments.size }) : ""
    const lien = lienMessage(message)
    return new Discord.EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle(t(guild, "sig.embed.titre"))
        .setURL(lien)
        .addFields(
            { name: t(guild, "sig.embed.auteur"), value: `<@${message.author.id}> (\`${message.author.id}\`)`, inline: true },
            { name: t(guild, "sig.embed.salon"), value: `<#${message.channelId}>`, inline: true },
            { name: t(guild, "sig.embed.signale_par"), value: `<@${signaleur.id}> (\`${signaleur.id}\`)`, inline: true },
            { name: t(guild, "sig.embed.lien"), value: t(guild, "sig.embed.lien_texte", { lien }) },
            { name: t(guild, "sig.embed.extrait"), value: (extrait + pieces).slice(0, 1024) },
            { name: t(guild, "sig.embed.raison"), value: echapper(raison).slice(0, MAX_RAISON) }
        )
        .setTimestamp()
}

// Le signaleur peut-il lire ce salon ? Il faut voir le salon ET son historique, et, pour un fil privé, en être membre
// (ou pouvoir gérer les fils). Sinon on ne recopie pas un message qu'il ne pourrait pas lire lui-même.
async function peutLire(salon, membre) {
    const perms = salon.permissionsFor(membre)
    if (!perms?.has([Flags.ViewChannel, Flags.ReadMessageHistory])) return false
    if (salon.type !== Discord.ChannelType.PrivateThread || perms.has(Flags.ManageThreads)) return true
    return Boolean(await salon.members.fetch(membre.id).catch(() => null))
}

// Soumission du modal : relit le message, revérifie tout, puis l'envoie au staff. La réponse au signaleur est éphémère
// et l'auteur du message n'apprend jamais qui l'a signalé (le signalement ne va que dans le salon staff).
async function recevoirSignalement(bot, interaction) {
    const m = RE_SIGNALEMENT.exec(interaction.customId)
    const raison = interaction.fields.getTextInputValue("raison")?.trim()
    if (!m) return refuser(interaction, t(interaction, "sig.refus.introuvable"))
    if (!raison) return refuser(interaction, t(interaction, "sig.raison_vide"))

    // Réponse différée d'abord : relire le message peut dépasser les 3 s permises par Discord
    await interaction.deferReply({ flags: EPHEMERAL })
    const salon = interaction.guild?.channels.cache.get(m[1])
    if (!salon?.isTextBased() || !await peutLire(salon, interaction.member)) {
        return refuser(interaction, t(interaction, "sig.refus.introuvable"))
    }
    const message = await salon.messages.fetch(m[2]).catch(() => null)
    if (!message) return refuser(interaction, t(interaction, "sig.refus.introuvable"))

    const refus = verifierSignalement(interaction, message)
    if (refus) return refuser(interaction, refus)
    // Un même message signalé par plusieurs membres : un seul signalement au staff pendant 10 min
    if (dejaSignales.has(message.id)) return interaction.editReply({ content: t(interaction, "sig.deja_signale") })
    dejaSignales.set(message.id, Date.now())
    for (const [id, date] of dejaSignales) if (Date.now() - date > DUREE_DEJA_SIGNALE) dejaSignales.delete(id)
    try {
        await getLogChannel(interaction.guild, "signalements").send({
            embeds: [embedSignalement(interaction.guild, message, interaction.user, raison)],
            components: boutonsAction(interaction.guild, message.author.id)
        })
    } catch (err) {
        console.error("Impossible d'envoyer le signalement :", err.message)
        dejaSignales.delete(message.id)
        return refuser(interaction, t(interaction, "sig.echec_envoi"))
    }
    await interaction.editReply({ content: t(interaction, "sig.envoye") })
}

// Clic sur Warn / Mute 10 min / Ignorer (réservé au staff par la garde du routeur)
async function traiterSignalement(bot, interaction) {
    const m = RE_ACTION.exec(interaction.customId)
    if (!m) return refuser(interaction, t(interaction, "sig.refus.introuvable"))
    const [, action, auteurId] = m
    const message = interaction.message

    const lignes = message.components ?? []
    if (lignes.length && lignes.every(l => l.components.every(c => c.disabled))) return refuser(interaction, t(interaction, "sig.deja_traite"))
    if (verrous.has(message.id)) return refuser(interaction, t(interaction, "sig.en_cours"))
    verrous.add(message.id)

    let reussi = false
    try {
        await interaction.deferReply({ flags: EPHEMERAL })
        let reponse, suite
        if (action === "i") {
            reponse = t(interaction, "sig.ignore_ok")
        } else {
            const user = await interaction.client.users.fetch(auteurId).catch(() => null)
            if (!user) return await refuser(interaction, t(interaction, "sig.ctx.introuvable"))
            const url = message.embeds?.[0]?.url
            const raison = t(interaction.guild, "sig.action.raison", { lien: RE_LIEN.test(url ?? "") ? ` : ${url}` : "" })
            if (action === "w") {
                const r = await avertir(interaction, user, raison)
                if (r.erreur) return await refuser(interaction, r.erreur)
                reponse = t(interaction, "mod.warn.reponse", { moderateur: interaction.user, user, reason: r.reason, id: r.id, total: r.total })
                    + (r.prevenu ? "" : t(interaction, "mod.warn.pas_prevenu"))
                if (r.auto) suite = t(interaction, "mod.warn.seuil", { total: r.total, user, auto: r.auto })
            } else {
                const r = await muter(interaction, user, MUTE_MS, raison)
                if (r.erreur) return await refuser(interaction, r.erreur)
                reponse = t(interaction, "mod.mute.reponse", { moderateur: interaction.user, user, temps: r.temps, reason: r.reason, numero: r.numero })
            }
        }
        reussi = true

        const cle = { w: "sig.traite.warn", m: "sig.traite.mute", i: "sig.traite.ignorer" }[action]
        const embed = Discord.EmbedBuilder.from(message.embeds[0])
            .addFields({ name: t(interaction.guild, "sig.traite.titre"), value: t(interaction.guild, cle, { moderateur: interaction.user }) })
        // Si les boutons ne peuvent pas être désactivés, le verrou reste jusqu'au redémarrage (pas de 2e sanction)
        const desactive = await message.edit({ embeds: [embed], components: boutonsAction(interaction.guild, auteurId, true) })
            .then(() => true)
            .catch(err => { console.error("Impossible de mettre à jour le signalement :", err.message); return false })
        if (!desactive) reussi = "verrouille"

        await interaction.editReply({ content: reponse })
        if (suite) await interaction.followUp({ content: suite, flags: EPHEMERAL })
    } finally {
        if (reussi === true) setTimeout(() => verrous.delete(message.id), DUREE_VERROU).unref()
        else if (!reussi) verrous.delete(message.id)
    }
}

// ---------- Menus contextuels du staff ----------

// Refus éventuel d'un menu sur un membre : soi-même et les bots sont exclus
function verifierMembre(interaction, user) {
    if (user.id === interaction.user.id) return t(interaction, "sig.ctx.soi")
    if (user.bot) return t(interaction, "sig.ctx.bot")
    return null
}

// « Dossier » : 5 dernières sanctions, nombre de warns, nombre de notes du staff
async function dossier(interaction) {
    const user = interaction.targetUser
    const refus = verifierMembre(interaction, user)
    if (refus) return refuser(interaction, refus)

    const guildId = interaction.guild.id
    const cases = db.listCases(guildId, user.id, SANCTIONS_AFFICHEES)
    const lignes = cases.map(c => ligneSanction(interaction, c))
    const resume = t(interaction, "sig.dossier.resume", {
        warns: db.countWarns(guildId, user.id),
        sanctions: db.countActiveCases(guildId, user.id),
        notes: compterNotes(guildId, user.id)
    })
    const embed = new Discord.EmbedBuilder()
        .setColor(couleur(interaction.guild))
        .setTitle(t(interaction, "sig.dossier.titre", { user: user.tag }))
        .setThumbnail(user.displayAvatarURL())
        .setDescription([resume, lignes.length ? lignes.join("\n\n") : t(interaction, "sig.dossier.aucune")].join("\n\n").slice(0, 4096))
    if (lignes.length) embed.setFooter({ text: t(interaction, "sig.dossier.pied", { affiches: lignes.length }) })
    await interaction.reply({ embeds: [embed], flags: EPHEMERAL })
}

// « Warn rapide » : ouvre le modal de raison
async function ouvrirWarnRapide(interaction) {
    const user = interaction.targetUser
    const refus = verifierMembre(interaction, user)
    if (refus) return refuser(interaction, refus)
    const raison = new Discord.TextInputBuilder()
        .setCustomId("raison")
        .setLabel(t(interaction, "sig.warn.raison"))
        .setStyle(Discord.TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(400)
    await interaction.showModal(new Discord.ModalBuilder()
        .setCustomId(`${PREFIXE_WARN}${user.id}`)
        .setTitle(t(interaction, "sig.warn.modal_titre"))
        .addComponents(new Discord.ActionRowBuilder().addComponents(raison)))
}

// Soumission du modal « Warn rapide »
async function warnRapide(bot, interaction) {
    const m = RE_WARN.exec(interaction.customId)
    await interaction.deferReply({ flags: EPHEMERAL })
    const user = m && await interaction.client.users.fetch(m[1]).catch(() => null)
    if (!user) return refuser(interaction, t(interaction, "sig.ctx.introuvable"))
    const refus = verifierMembre(interaction, user)
    if (refus) return refuser(interaction, refus)
    const r = await avertir(interaction, user, interaction.fields.getTextInputValue("raison"))
    if (r.erreur) return refuser(interaction, r.erreur)
    await interaction.editReply({
        content: t(interaction, "mod.warn.reponse", { moderateur: interaction.user, user, reason: r.reason, id: r.id, total: r.total })
            + (r.prevenu ? "" : t(interaction, "mod.warn.pas_prevenu"))
    })
    if (r.auto) await interaction.followUp({ content: t(interaction, "mod.warn.seuil", { total: r.total, user, auto: r.auto }), flags: EPHEMERAL })
}

// « Mute 10 min » : raison fixe
async function muteRapide(interaction) {
    const user = interaction.targetUser
    const refus = verifierMembre(interaction, user)
    if (refus) return refuser(interaction, refus)

    await interaction.deferReply({ flags: EPHEMERAL })
    const r = await muter(interaction, user, MUTE_MS, t(interaction.guild, "sig.mute.raison"))
    if (r.erreur) return refuser(interaction, r.erreur)
    await interaction.editReply({ content: t(interaction, "mod.mute.reponse", { moderateur: interaction.user, user, temps: r.temps, reason: r.reason, numero: r.numero }) })
}

module.exports = {
    PREFIXE_SIGNALEMENT, PREFIXE_ACTION, PREFIXE_WARN, MUTE_MS, verrous,
    verifierSignalement, ouvrirSignalement, modalSignalement, boutonsAction, embedSignalement, recevoirSignalement, traiterSignalement,
    verifierMembre, dossier, ouvrirWarnRapide, warnRapide, muteRapide
}
