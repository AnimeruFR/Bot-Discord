const Discord = require('discord.js')
const { couleur } = require('../Fonctions/apparence')
const { t } = require('../Fonctions/i18n')
const db = require('../Fonctions/db')
const { sendModLog } = require('../Fonctions/logs')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const DELAI_CONFIRMATION = 30 * 1000

function estAdmin(interaction) {
    return interaction.user.id === interaction.guild.ownerId || interaction.memberPermissions?.has(Discord.PermissionFlagsBits.Administrator)
}

module.exports = {
    name: "privacy",
    description: "Données conservées par le bot (et suppression pour les administrateurs)",
    permission: "Aucune",
    dm: true,
    category: "Information",
    options: [
        {
            type: "boolean",
            name: "supprimer",
            description: "Administrateurs : effacer tout de suite toutes les données de ce serveur",
            required: false
        }
    ],

    async run(bot, message, args) {
        if (args.getBoolean("supprimer")) return supprimer(message)

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

async function supprimer(interaction) {
    if (!interaction.inCachedGuild()) return interaction.reply({ content: "Cette option s'utilise sur un serveur.", flags: EPHEMERAL })
    if (!estAdmin(interaction)) return interaction.reply({ content: "Seuls les administrateurs du serveur peuvent effacer ses données.", flags: EPHEMERAL })

    const boutons = new Discord.ActionRowBuilder().addComponents(
        new Discord.ButtonBuilder().setCustomId(`privacy-oui-${interaction.id}`).setLabel("Tout effacer").setStyle(Discord.ButtonStyle.Danger),
        new Discord.ButtonBuilder().setCustomId(`privacy-non-${interaction.id}`).setLabel("Annuler").setStyle(Discord.ButtonStyle.Secondary)
    )
    const reponse = await interaction.reply({
        content: "Effacer **définitivement** toutes les données de ce serveur (avertissements, historique des sanctions, bans temporaires en cours, configuration) ? Les bans temporaires ne seront alors plus levés automatiquement. Cette action est irréversible (seules les sauvegardes récentes les contiennent encore, jusqu'à leur remplacement).",
        components: [boutons],
        flags: EPHEMERAL,
        withResponse: true
    })

    const clic = await reponse.resource.message.awaitMessageComponent({
        componentType: Discord.ComponentType.Button,
        filter: i => i.user.id === interaction.user.id && i.customId.endsWith(interaction.id),
        time: DELAI_CONFIRMATION
    }).catch(() => null)

    if (!clic) return interaction.editReply({ content: "Temps écoulé, rien n'a été effacé.", components: [] })
    if (clic.customId.startsWith("privacy-non")) return clic.update({ content: "Annulé, rien n'a été effacé.", components: [] })

    // Les droits ont pu changer pendant la confirmation
    if (!estAdmin(clic)) return clic.update({ content: "Vous n'êtes plus administrateur : rien n'a été effacé.", components: [] })

    // On répond au clic tout de suite (Discord exige une réponse en moins de 3 s)
    await clic.update({ content: "Effacement en cours…", components: [] })

    // Le log part avant l'effacement (le salon de logs fait partie des données effacées)
    await sendModLog(interaction, { action: "config", details: "Toutes les données du serveur ont été effacées (/privacy)" })
    try {
        const total = db.deleteGuildData(interaction.guild.id)
        await interaction.editReply({ content: `Données du serveur effacées (${total} enregistrement(s)).` })
    } catch (err) {
        console.error("Échec de l'effacement /privacy :", err)
        await interaction.editReply({ content: "Échec de l'effacement : rien n'a été supprimé (l'opération est annulée en bloc). Réessaie plus tard." })
    }
}
