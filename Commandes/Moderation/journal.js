const Discord = require('discord.js')
const { couleur } = require('../../Fonctions/apparence')
const { t, langueDe } = require('../../Fonctions/i18n')
const { formatReason, formatDuree } = require('../../Fonctions/moderation')
const { TYPES, nomType } = require('../../Fonctions/cases')
const { PERIODES_JOURNAL, LIMITE_SOURCE, entreesJournal } = require('../../Fonctions/statsMod')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const PAR_PAGE = 10
const DUREE_COLLECTEUR = 5 * 60 * 1000

// Une ligne du journal. Raisons et détails sont écrits par des membres : échappés et tronqués.
function ligne(interaction, e) {
    const date = Math.floor(e.created_at / 1000)
    if (e.genre === "config") {
        const details = Discord.escapeMarkdown(String(e.details).replace(/\s+/g, " ")).slice(0, 150)
        return t(interaction, "stats.journal.ligne_config", { date, moderateur: e.moderator_id, details })
    }
    const duree = e.duration_ms ? ` (${formatDuree(e.duration_ms, langueDe(interaction))})` : ""
    const reason = formatReason(e.reason).replace(/\s+/g, " ").slice(0, 100)
    return t(interaction, "stats.journal.ligne_sanction", {
        date, id: e.id, nom: nomType(interaction, e.type), duree, user: e.user_id, moderateur: e.moderator_id,
        reason: e.cancelled_at ? `~~${reason}~~` : reason
    })
}

function vue(interaction, entrees, page, desactive = false) {
    const pages = Math.max(1, Math.ceil(entrees.length / PAR_PAGE))
    const lignes = entrees.slice(page * PAR_PAGE, (page + 1) * PAR_PAGE).map(e => ligne(interaction, e))
    const embed = new Discord.EmbedBuilder()
        .setColor(couleur(interaction.guild))
        .setTitle(t(interaction, "stats.journal.titre"))
        .setDescription(lignes.length ? lignes.join("\n").slice(0, 4096) : t(interaction, "stats.journal.aucune"))
        .setFooter({ text: t(interaction, entrees.length >= LIMITE_SOURCE ? "stats.journal.pied_tronque" : "stats.journal.pied", { page: page + 1, pages, total: entrees.length }) })
    const boutons = new Discord.ActionRowBuilder().addComponents(
        new Discord.ButtonBuilder().setCustomId(`journal:prec:${interaction.id}`).setLabel(t(interaction, "stats.journal.prec")).setStyle(Discord.ButtonStyle.Secondary).setDisabled(desactive || page === 0),
        new Discord.ButtonBuilder().setCustomId(`journal:suiv:${interaction.id}`).setLabel(t(interaction, "stats.journal.suiv")).setStyle(Discord.ButtonStyle.Secondary).setDisabled(desactive || page >= pages - 1)
    )
    return { embeds: [embed], components: pages > 1 ? [boutons] : [] }
}

module.exports = {
    name: "journal",
    description: "Journal du serveur : sanctions et changements de configuration",
    permission: Discord.PermissionFlagsBits.ManageGuild,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "moderateur",
            description: "Seulement les actions de ce modérateur",
            required: false
        }, {
            type: "string",
            name: "type",
            description: "Seulement ce type d'entrée",
            required: false,
            choices: [
                ...TYPES.map(type => ({ name: nomTypeFr(type), value: type })),
                { name: "Configuration", value: "config" }
            ]
        }, {
            type: "string",
            name: "periode",
            description: "Période affichée (7 jours par défaut)",
            required: false,
            choices: [
                { name: "24 heures", value: "24h" },
                { name: "7 jours", value: "7j" },
                { name: "30 jours", value: "30j" }
            ]
        }
    ],

    async run(bot, message, args) {
        const moderateur = args.getUser("moderateur")
        const periode = args.getString("periode") ?? "7j"
        const duree = PERIODES_JOURNAL[periode]
        if (!duree) return message.reply({ content: t(message, "stats.journal.aucune"), flags: EPHEMERAL })

        const entrees = entreesJournal(message.guild.id, {
            moderateurId: moderateur?.id ?? null,
            type: args.getString("type"),
            depuis: Date.now() - duree
        })
        let page = 0
        const reponse = await message.reply({ ...vue(message, entrees, page), flags: EPHEMERAL, withResponse: true })
        if (entrees.length <= PAR_PAGE) return

        const fenetre = reponse.resource?.message
        const collecteur = fenetre.createMessageComponentCollector({
            componentType: Discord.ComponentType.Button,
            // Seul l'auteur de la commande pilote les pages
            filter: i => i.user.id === message.user.id && i.customId.endsWith(`:${message.id}`),
            time: DUREE_COLLECTEUR
        })
        collecteur.on("collect", async i => {
            page += i.customId.startsWith("journal:suiv") ? 1 : -1
            await i.update(vue(message, entrees, page))
        })
        collecteur.on("end", () => message.editReply(vue(message, entrees, page, true)).catch(() => {}))
    }
}

// Noms français des types pour les choix de la commande (les noms traduits viennent de locales/commandes.en)
function nomTypeFr(type) {
    return t("fr", `mod.type.${type}`)
}
