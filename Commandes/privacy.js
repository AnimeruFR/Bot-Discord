const Discord = require('discord.js')
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
            .setColor(bot.color)
            .setTitle("Données conservées par le bot")
            .setDescription([
                "Le bot n'utilise que des slash commandes : il **ne lit pas** les messages en continu.",
                "",
                "**Ce qui est enregistré, par serveur :**",
                "• les avertissements (`/warn`) : membre, modérateur, raison, date ;",
                "• l'historique des sanctions (warn, mute, kick, ban…) : membre, modérateur, raison, durée, date (2 ans maximum) ;",
                "• les bans temporaires en cours (date de fin) ;",
                "• les giveaways (participants, gagnants : 30 jours après la fin) et les annonces programmées (jusqu'à leur envoi) ;",
                "• le suivi des tickets : auteur, staff qui l'a pris en charge, dates, note de 1 à 5 (90 jours après la suppression ; jamais le contenu) ;",
                "• la configuration : salon de logs, tickets, sanctions automatiques, salons verrouillés ;",
                "• la date de dernière ouverture d'un ticket (effacée dans les 24 h environ).",
                "",
                "Les transcripts de tickets ne sont pas gardés par le bot : ils sont envoyés dans le salon de logs du serveur.",
                "",
                "**Durée :** tant que le bot est sur le serveur. S'il est retiré, tout est effacé **30 jours** après. Les sauvegardes quotidiennes de la base sont gardées quelques jours (7 par défaut) puis remplacées.",
                "**Effacement immédiat :** un administrateur peut utiliser `/privacy supprimer:True`.",
                lien ? `\nPolitique de confidentialité complète : ${lien}` : ""
            ].join("\n"))

        if (message.inGuild()) {
            const mesWarns = db.countWarns(message.guild.id, message.user.id)
            const mesSanctions = db.countCases(message.guild.id, message.user.id)
            embed.addFields({ name: "Te concernant sur ce serveur", value: `${mesWarns} avertissement(s) actif(s), ${mesSanctions} ligne(s) dans l'historique des sanctions` })
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
