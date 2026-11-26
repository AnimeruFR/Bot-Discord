const Discord = require('discord.js')
const economie = require('../../Fonctions/economie')
const { sendModLog } = require('../../Fonctions/logs')
const { couleur } = require('../../Fonctions/apparence')
const { t } = require('../../Fonctions/i18n')
const { refuser } = require('../../Fonctions/erreurs')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const PERMISSION = Discord.PermissionFlagsBits.ManageGuild
const PAR_PAGE = 10
const DUREE_COLLECTEUR = 5 * 60 * 1000
const DELAI_CONFIRMATION = 60 * 1000

// Journal : page = lignes du compte, du plus récent au plus ancien. On lit une ligne de plus que la page
// pour savoir s'il y a une suite ; le curseur de chaque page est l'ID de la dernière ligne de la précédente.
function vueJournal(interaction, user, curseurs, indice, desactiver = false) {
    const guildId = interaction.guild.id
    const lues = economie.journal(guildId, user.id, { limite: PAR_PAGE + 1, avant: curseurs[indice] })
    const lignes = lues.slice(0, PAR_PAGE)
    const suite = lues.length > PAR_PAGE
    curseurs[indice + 1] = suite ? lignes.at(-1).id : undefined

    const texte = lignes.map(l => t(interaction, "portefeuille.eco.journal.ligne", {
        date: Math.floor(l.createdAt / 1000), source: Discord.escapeMarkdown(String(l.source)),
        delta: `${l.delta > 0 ? "+" : ""}${economie.formater(guildId, l.delta)}`, solde: economie.formater(guildId, l.balanceAfter),
        autre: l.otherId ? t(interaction, "portefeuille.eco.journal.autre", { id: l.otherId }) : ""
    })).join("\n")
    const embed = new Discord.EmbedBuilder()
        .setColor(couleur(interaction.guild))
        .setTitle(t(interaction, "portefeuille.eco.journal.titre"))
        .setDescription(`${t(interaction, "portefeuille.eco.journal.entete", { membre: `<@${user.id}>` })}\n\n${texte || t(interaction, "portefeuille.eco.journal.vide")}`)
        .setFooter({ text: t(interaction, "portefeuille.classement.page", { page: indice + 1, pages: suite ? `${indice + 2}+` : indice + 1 }) })

    const composants = !suite && indice === 0 ? [] : [new Discord.ActionRowBuilder().addComponents(
        new Discord.ButtonBuilder().setCustomId(`eco-prec-${interaction.id}`).setLabel(t(interaction, "portefeuille.classement.precedent"))
            .setStyle(Discord.ButtonStyle.Secondary).setDisabled(desactiver || indice === 0),
        new Discord.ButtonBuilder().setCustomId(`eco-suiv-${interaction.id}`).setLabel(t(interaction, "portefeuille.classement.suivant"))
            .setStyle(Discord.ButtonStyle.Secondary).setDisabled(desactiver || !suite)
    )]
    return { embeds: [embed], components: composants }
}

async function journal(interaction, user) {
    const curseurs = [null]
    let indice = 0
    const vue = vueJournal(interaction, user, curseurs, indice)
    const reponse = await interaction.reply({ ...vue, flags: EPHEMERAL, allowedMentions: { parse: [] }, withResponse: true })
    if (!vue.components.length) return

    const collecteur = reponse.resource.message.createMessageComponentCollector({
        componentType: Discord.ComponentType.Button,
        // Seul l'auteur de la commande pilote les pages
        filter: i => i.user.id === interaction.user.id && i.customId.endsWith(`-${interaction.id}`),
        time: DUREE_COLLECTEUR
    })
    collecteur.on("collect", async i => {
        indice = Math.max(0, indice + (i.customId.startsWith("eco-suiv") ? 1 : -1))
        await i.update(vueJournal(interaction, user, curseurs, indice))
    })
    collecteur.on("end", () => interaction.editReply(vueJournal(interaction, user, curseurs, indice, true)).catch(() => {}))
}

async function reinitialiser(interaction, user) {
    const guildId = interaction.guild.id
    const { balance } = economie.compte(guildId, user.id)
    const boutons = new Discord.ActionRowBuilder().addComponents(
        new Discord.ButtonBuilder().setCustomId(`eco-oui-${interaction.id}`).setLabel(t(interaction, "portefeuille.eco.reinit.bouton_oui")).setStyle(Discord.ButtonStyle.Danger),
        new Discord.ButtonBuilder().setCustomId(`eco-non-${interaction.id}`).setLabel(t(interaction, "portefeuille.eco.reinit.bouton_non")).setStyle(Discord.ButtonStyle.Secondary)
    )
    const reponse = await interaction.reply({
        content: t(interaction, "portefeuille.eco.reinit.confirmer", { membre: `<@${user.id}>`, solde: economie.formater(guildId, balance) }),
        components: [boutons], flags: EPHEMERAL, allowedMentions: { parse: [] }, withResponse: true
    })
    const clic = await reponse.resource.message.awaitMessageComponent({
        componentType: Discord.ComponentType.Button,
        filter: i => i.user.id === interaction.user.id && i.customId.endsWith(`-${interaction.id}`),
        time: DELAI_CONFIRMATION
    }).catch(() => null)
    if (!clic) return interaction.editReply({ content: t(interaction, "portefeuille.eco.reinit.temps"), components: [] })
    if (clic.customId.startsWith("eco-non")) return clic.update({ content: t(interaction, "portefeuille.eco.reinit.annule"), components: [] })
    // Les droits du clic sont ceux d'aujourd'hui, pas ceux du début de la commande
    if (!clic.memberPermissions?.has(PERMISSION)) return clic.update({ content: t(interaction, "portefeuille.eco.reinit.droits"), components: [] })

    const ancien = economie.reinitialiser(guildId, user.id, interaction.user.id)
    const coherent = economie.verifierCoherence(guildId, user.id)
    const membre = `<@${user.id}>`
    const message = t(interaction, "portefeuille.eco.reinit.ok", { membre, solde: economie.formater(guildId, ancien) })
        + (coherent ? "" : `\n${t(interaction, "portefeuille.eco.reinit.incoherent", { membre })}`)
    await clic.update({ content: message, components: [], allowedMentions: { parse: [] } })
    return sendModLog(interaction, { action: "economie", cible: user, details: `Remise à zéro (ancien solde : ${ancien})`, famille: "economie" })
}

async function reglages(interaction, args) {
    const demandes = {
        plafondJour: args.getInteger("plafond"), multiplicateur: args.getNumber("multiplicateur"),
        nom: args.getString("nom"), emoji: args.getString("emoji")
    }
    const valeurs = Object.fromEntries(Object.entries(demandes).filter(([, v]) => v !== null && v !== undefined))
    if (!Object.keys(valeurs).length) return refuser(interaction, t(interaction, "portefeuille.eco.reglages.aucun"))
    try {
        economie.definirReglages(interaction.guild.id, valeurs)
    } catch (err) {
        if (!(err instanceof RangeError)) throw err
        return refuser(interaction, t(interaction, "portefeuille.eco.reglages.invalide", { erreur: err.message }))
    }
    const liste = Object.entries(valeurs).map(([cle, v]) => `${cle} = ${v}`).join(", ")
    await interaction.reply({ content: t(interaction, "portefeuille.eco.reglages.ok", { liste: Discord.escapeMarkdown(liste) }), flags: EPHEMERAL, allowedMentions: { parse: [] } })
    return sendModLog(interaction, { action: "economie", details: `Réglages : ${liste}`, famille: "economie" })
}

module.exports = {
    name: "eco",
    description: "Économie : journal, gel, remise à zéro et réglages (staff)",
    permission: PERMISSION,
    dm: false,
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Voir le journal d'un membre", value: "journal" },
                { name: "Geler un compte", value: "geler" },
                { name: "Dégeler un compte", value: "degeler" },
                { name: "Remettre un compte à zéro", value: "reinitialiser" },
                { name: "Modifier les réglages", value: "reglages" }
            ]
        }, {
            type: "user",
            name: "membre",
            description: "Le membre concerné (journal, gel, dégel, remise à zéro)",
            required: false
        }, {
            type: "integer",
            name: "plafond",
            description: "Plafond quotidien des gains actifs (300 à 2000)",
            required: false,
            minValue: 300,
            maxValue: 2000
        }, {
            type: "number",
            name: "multiplicateur",
            description: "Multiplicateur global des gains (0,5 à 2)",
            required: false,
            minValue: 0.5,
            maxValue: 2
        }, {
            type: "string",
            name: "nom",
            description: "Nom de la monnaie (32 caractères au plus)",
            required: false,
            maxLength: 32
        }, {
            type: "string",
            name: "emoji",
            description: "Emoji de la monnaie",
            required: false,
            maxLength: 64
        }
    ],

    async run(bot, interaction, args) {
        const action = args.getString("action")
        if (action === "reglages") return reglages(interaction, args)

        const user = args.getUser("membre")
        if (!user) return refuser(interaction, t(interaction, "portefeuille.eco.membre_requis"))
        if (user.bot) return refuser(interaction, t(interaction, "portefeuille.eco.bot"))

        if (action === "journal") {
            await journal(interaction, user)
            return sendModLog(interaction, { action: "economie", cible: user, details: "Journal consulté", famille: "economie" })
        }
        if (action === "reinitialiser") return reinitialiser(interaction, user)

        // geler / degeler
        const gele = action === "geler"
        economie.geler(interaction.guild.id, user.id, gele)
        await interaction.reply({ content: t(interaction, gele ? "portefeuille.eco.geler" : "portefeuille.eco.degeler", { membre: `<@${user.id}>` }), flags: EPHEMERAL, allowedMentions: { parse: [] } })
        return sendModLog(interaction, { action: "economie", cible: user, details: gele ? "Compte gelé" : "Compte dégelé", famille: "economie" })
    }
}
