const Discord = require('discord.js')
const { couleur } = require('../../Fonctions/apparence')
const { t } = require('../../Fonctions/i18n')
const db = require('../../Fonctions/db')
const { sendModLog } = require('../../Fonctions/logs')
const donneesMembre = require('../../Fonctions/donneesMembre')
const cooldowns = require('../../Fonctions/cooldowns')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const DELAI_CONFIRMATION = 30 * 1000
const COOLDOWN_EFFACEMENT = "privacy-effacer"

function estAdmin(interaction) {
    return interaction.user.id === interaction.guild.ownerId || interaction.memberPermissions?.has(Discord.PermissionFlagsBits.Administrator)
}

module.exports = {
    name: "privacy",
    description: "Données conservées par le bot (export et effacement de vos données)",
    permission: "Aucune",
    dm: true,
    category: "Information",
    options: [
        {
            type: "boolean",
            name: "supprimer",
            description: "Administrateurs : effacer tout de suite toutes les données de ce serveur",
            required: false
        }, {
            type: "string",
            name: "moi",
            description: "Vos données sur ce serveur : les exporter ou les effacer",
            required: false,
            choices: [
                { name: "Exporter mes données", value: "exporter" },
                { name: "Effacer mes données", value: "effacer" }
            ]
        }
    ],

    async run(bot, message, args) {
        if (args.getBoolean("supprimer")) return supprimer(message)
        const moi = args.getString("moi")
        if (moi === "exporter") return exporterMoi(message)
        if (moi === "effacer") return effacerMoi(message)

        const lien = process.env.PRIVACY_URL
        const embed = new Discord.EmbedBuilder()
            .setColor(couleur(message.guild))
            .setTitle(t(message, "privacy.titre"))
            .setDescription(t(message, "privacy.description") + (lien ? `\n\n${t(message, "privacy.lien", { lien })}` : ""))

        if (message.inGuild()) {
            const mesWarns = db.countWarns(message.guild.id, message.user.id)
            const mesSanctions = db.countCases(message.guild.id, message.user.id)
            embed.addFields({ name: t(message, "privacy.vous_titre"), value: t(message, "privacy.vous", { warns: mesWarns, sanctions: mesSanctions }) })
        }

        await message.reply({ embeds: [embed], flags: EPHEMERAL })
    }
}

// Question avec deux boutons (confirmer / annuler). Renvoie le clic de confirmation (pas encore acquitté),
// ou null si le membre a annulé ou n'a pas répondu à temps (la réponse est alors déjà envoyée).
async function demanderConfirmation(interaction, { prefixe, question, confirmer, annuler, temps, annule }) {
    const boutons = new Discord.ActionRowBuilder().addComponents(
        new Discord.ButtonBuilder().setCustomId(`${prefixe}-oui-${interaction.id}`).setLabel(confirmer).setStyle(Discord.ButtonStyle.Danger),
        new Discord.ButtonBuilder().setCustomId(`${prefixe}-non-${interaction.id}`).setLabel(annuler).setStyle(Discord.ButtonStyle.Secondary)
    )
    const reponse = await interaction.reply({ content: question, components: [boutons], flags: EPHEMERAL, withResponse: true })

    const clic = await reponse.resource.message.awaitMessageComponent({
        componentType: Discord.ComponentType.Button,
        filter: i => i.user.id === interaction.user.id && i.customId.endsWith(interaction.id),
        time: DELAI_CONFIRMATION
    }).catch(() => null)

    if (!clic) {
        await interaction.editReply({ content: temps, components: [] })
        return null
    }
    if (clic.customId.startsWith(`${prefixe}-non`)) {
        await clic.update({ content: annule, components: [] })
        return null
    }
    return clic
}

async function supprimer(interaction) {
    if (!interaction.inCachedGuild()) return interaction.reply({ content: t(interaction, "tk.pv_serveur"), flags: EPHEMERAL })
    if (!estAdmin(interaction)) return interaction.reply({ content: t(interaction, "tk.pv_admin"), flags: EPHEMERAL })

    const clic = await demanderConfirmation(interaction, {
        prefixe: "privacy",
        question: t(interaction, "tk.pv_question"),
        confirmer: t(interaction, "tk.pv_tout"),
        annuler: t(interaction, "tk.pv_annuler"),
        temps: t(interaction, "tk.pv_temps"),
        annule: t(interaction, "tk.pv_annule")
    })
    if (!clic) return
    // Les droits ont pu changer pendant la confirmation
    if (!estAdmin(clic)) return clic.update({ content: t(interaction, "tk.pv_plus_admin"), components: [] })

    // On répond au clic tout de suite (Discord exige une réponse en moins de 3 s)
    await clic.update({ content: t(interaction, "tk.pv_en_cours"), components: [] })

    // Le log part avant l'effacement (le salon de logs fait partie des données effacées)
    await sendModLog(interaction, { action: "config", details: "Toutes les données du serveur ont été effacées (/privacy)" })
    try {
        const total = db.deleteGuildData(interaction.guild.id)
        await interaction.editReply({ content: t(interaction, "tk.pv_ok", { total }) })
    } catch (err) {
        console.error("Échec de l'effacement /privacy :", err)
        await interaction.editReply({ content: t(interaction, "tk.pv_echec") })
    }
}

// Export des données du membre sur ce serveur : fichier JSON visible de lui seul
async function exporterMoi(interaction) {
    if (!interaction.inCachedGuild()) return interaction.reply({ content: t(interaction, "rgpd.serveur"), flags: EPHEMERAL })
    const donnees = donneesMembre.exporter(interaction.guild.id, interaction.user.id)
    const fichier = new Discord.AttachmentBuilder(Buffer.from(JSON.stringify(donnees, null, 2), "utf8"), { name: `mes-donnees-${interaction.guild.id}.json` })
    await interaction.reply({ content: t(interaction, "rgpd.export_ok"), files: [fichier], flags: EPHEMERAL })
}

// Effacement des données du membre sur ce serveur, après confirmation par bouton
async function effacerMoi(interaction) {
    if (!interaction.inCachedGuild()) return interaction.reply({ content: t(interaction, "rgpd.serveur"), flags: EPHEMERAL })

    const differe = donneesMembre.refusEffacement(interaction.guild.id, interaction.user.id)
    if (differe) return interaction.reply({ content: t(interaction, "rgpd.differe", { motif: differe }), flags: EPHEMERAL })

    // Une fois par heure : l'effacement est lourd et ne sert pas à être répété (libéré si rien n'est effacé)
    const restant = cooldowns.prendre(COOLDOWN_EFFACEMENT, 60 * 60, interaction.guild.id, interaction.user.id)
    if (restant > 0) return interaction.reply({ content: t(interaction, "rgpd.cooldown", { minutes: Math.ceil(restant / 60000) }), flags: EPHEMERAL })

    const clic = await demanderConfirmation(interaction, {
        prefixe: "rgpdmoi",
        question: t(interaction, "rgpd.question"),
        confirmer: t(interaction, "rgpd.confirmer"),
        annuler: t(interaction, "rgpd.annuler"),
        temps: t(interaction, "rgpd.temps"),
        annule: t(interaction, "rgpd.annule")
    }).catch(err => {
        cooldowns.liberer(COOLDOWN_EFFACEMENT, interaction.guild.id, interaction.user.id)
        throw err
    })
    if (!clic) {
        cooldowns.liberer(COOLDOWN_EFFACEMENT, interaction.guild.id, interaction.user.id)
        return
    }
    await clic.update({ content: t(interaction, "rgpd.en_cours"), components: [] })

    let efface = false
    try {
        const resume = donneesMembre.effacer(interaction.guild.id, interaction.user.id)
        efface = true
        const texte = donneesMembre.resumeTexte(resume)
        // Le log ne contient que l'identifiant du membre et le résumé (des nombres par table)
        await sendModLog(interaction, { action: "config", details: `Effacement RGPD du membre ${interaction.user.id} (/privacy moi) : ${texte}` })
        await interaction.editReply({ content: t(interaction, "rgpd.ok", { resume: texte }) })
    } catch (err) {
        if (!efface) cooldowns.liberer(COOLDOWN_EFFACEMENT, interaction.guild.id, interaction.user.id) // rien n'a été effacé : le membre peut réessayer
        if (err.code === "RGPD_DIFFERE") return interaction.editReply({ content: t(interaction, "rgpd.differe", { motif: err.motif }) })
        console.error("Échec de l'effacement /privacy moi :", err)
        await interaction.editReply({ content: t(interaction, "rgpd.echec") })
    }
}
