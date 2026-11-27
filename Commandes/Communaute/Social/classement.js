const Discord = require('discord.js')
const db = require('../../../Fonctions/db')
const economie = require('../../../Fonctions/economie')
const { couleur } = require('../../../Fonctions/apparence')
const { t } = require('../../../Fonctions/i18n')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const PAR_PAGE = 10
const DUREE_COLLECTEUR = 5 * 60 * 1000
const MEDAILLES = ["🥇", "🥈", "🥉"]

// Une source par type de classement : total, lignes d'une page, place d'un membre, texte de la valeur.
// Égalités départagées par l'ID du membre, comme economie.classement().
const SOURCES = {
    monnaie: {
        total: g => db.sqlAll("SELECT COUNT(*) AS n FROM eco_comptes WHERE guild_id = ? AND frozen = 0 AND balance > 0", [g])[0].n,
        lignes: (g, decalage) => economie.classement(g, { limite: PAR_PAGE, decalage }).map(l => ({ userId: l.userId, valeur: l.balance })),
        place: (g, u) => {
            const rang = economie.rang(g, u)
            return rang ? { rang, valeur: economie.compte(g, u).balance } : null
        },
        texte: (i, l) => economie.formater(i.guild.id, l.valeur)
    },
    niveau: {
        total: g => db.sqlAll("SELECT COUNT(*) AS n FROM xp WHERE guild_id = ? AND xp > 0", [g])[0].n,
        lignes: (g, decalage) => db.sqlAll("SELECT user_id, xp, level FROM xp WHERE guild_id = ? AND xp > 0 ORDER BY xp DESC, user_id ASC LIMIT ? OFFSET ?",
            [g, PAR_PAGE, decalage]).map(l => ({ userId: l.user_id, valeur: l.xp, niveau: l.level })),
        place: (g, u) => {
            const ligne = db.sqlAll("SELECT xp, level FROM xp WHERE guild_id = ? AND user_id = ?", [g, u])[0]
            if (!ligne || ligne.xp <= 0) return null
            const { devant } = db.sqlAll("SELECT COUNT(*) AS devant FROM xp WHERE guild_id = ? AND xp > 0 AND (xp > ? OR (xp = ? AND user_id < ?))",
                [g, ligne.xp, ligne.xp, u])[0]
            return { rang: devant + 1, valeur: ligne.xp, niveau: ligne.level }
        },
        texte: (i, l) => t(i, "portefeuille.classement.valeur.niveau", { niveau: l.niveau, xp: l.valeur })
    },
    jeux: {
        total: g => db.sqlAll("SELECT COUNT(*) AS n FROM stats_joueur WHERE guild_id = ? AND stat = 'parties_gagnees' AND value > 0", [g])[0].n,
        lignes: (g, decalage) => db.sqlAll(`SELECT user_id, value FROM stats_joueur WHERE guild_id = ? AND stat = 'parties_gagnees' AND value > 0
            ORDER BY value DESC, user_id ASC LIMIT ? OFFSET ?`, [g, PAR_PAGE, decalage]).map(l => ({ userId: l.user_id, valeur: l.value })),
        place: (g, u) => {
            const ligne = db.sqlAll("SELECT value FROM stats_joueur WHERE guild_id = ? AND user_id = ? AND stat = 'parties_gagnees'", [g, u])[0]
            if (!ligne || ligne.value <= 0) return null
            const { devant } = db.sqlAll(`SELECT COUNT(*) AS devant FROM stats_joueur WHERE guild_id = ? AND stat = 'parties_gagnees' AND value > 0
                AND (value > ? OR (value = ? AND user_id < ?))`, [g, ligne.value, ligne.value, u])[0]
            return { rang: devant + 1, valeur: ligne.value }
        },
        texte: (i, l) => t(i, "portefeuille.classement.valeur.jeux", { valeur: l.valeur })
    }
}

// Contenu d'une page. La place de celui qui demande est toujours en bas, même hors de la page affichée.
function vue(interaction, type, page, desactiver = false) {
    const source = SOURCES[type]
    const guildId = interaction.guild.id
    const total = source.total(guildId)
    const pages = Math.max(1, Math.ceil(total / PAR_PAGE))
    page = Math.min(Math.max(page, 0), pages - 1)

    const lignes = source.lignes(guildId, page * PAR_PAGE).map((l, i) => {
        const rang = page * PAR_PAGE + i + 1
        return `${MEDAILLES[rang - 1] ?? `**${rang}.**`} <@${l.userId}> : ${source.texte(interaction, l)}`
    })
    const place = source.place(guildId, interaction.user.id)
    const bas = place
        ? t(interaction, "portefeuille.classement.place", { rang: `#${place.rang}`, total, valeur: source.texte(interaction, place) })
        : t(interaction, "portefeuille.classement.sans_place")

    const embed = new Discord.EmbedBuilder()
        .setColor(couleur(interaction.guild))
        .setTitle(t(interaction, `portefeuille.classement.titre.${type}`, { monnaie: economie.monnaie(guildId).nom }))
        .setDescription(`${lignes.length ? lignes.join("\n") : t(interaction, "portefeuille.classement.vide")}\n\n${bas}`)
        .setFooter({ text: t(interaction, "portefeuille.classement.page", { page: page + 1, pages }) })

    const contenu = { embeds: [embed], components: [], page }
    if (pages > 1) {
        contenu.components = [new Discord.ActionRowBuilder().addComponents(
            new Discord.ButtonBuilder().setCustomId(`classement-prec-${interaction.id}`).setLabel(t(interaction, "portefeuille.classement.precedent"))
                .setStyle(Discord.ButtonStyle.Secondary).setDisabled(desactiver || page === 0),
            new Discord.ButtonBuilder().setCustomId(`classement-suiv-${interaction.id}`).setLabel(t(interaction, "portefeuille.classement.suivant"))
                .setStyle(Discord.ButtonStyle.Secondary).setDisabled(desactiver || page >= pages - 1)
        )]
    }
    return contenu
}

module.exports = {
    name: "classement",
    description: "Voir le classement du serveur (monnaie, niveau ou jeux)",
    permission: "Aucune",
    dm: false,
    options: [
        {
            type: "string",
            name: "type",
            description: "Quel classement (monnaie par défaut)",
            required: false,
            choices: [
                { name: "Monnaie", value: "monnaie" },
                { name: "Niveau", value: "niveau" },
                { name: "Parties gagnées", value: "jeux" }
            ]
        }
    ],

    async run(bot, interaction, args) {
        const type = args.getString("type") ?? "monnaie"
        if (!SOURCES[type]) return interaction.reply({ content: t(interaction, "portefeuille.classement.vide"), flags: EPHEMERAL })

        let affichee = vue(interaction, type, 0)
        const reponse = await interaction.reply({ embeds: affichee.embeds, components: affichee.components, withResponse: true })
        if (!affichee.components.length) return

        const collecteur = reponse.resource.message.createMessageComponentCollector({
            componentType: Discord.ComponentType.Button,
            filter: i => i.customId.endsWith(`-${interaction.id}`),
            time: DUREE_COLLECTEUR
        })
        collecteur.on("collect", async i => {
            // Le classement est public : les autres membres voient les boutons mais ne les pilotent pas
            if (i.user.id !== interaction.user.id) return i.reply({ content: t(i, "portefeuille.classement.pas_auteur"), flags: EPHEMERAL })
            affichee = vue(interaction, type, affichee.page + (i.customId.startsWith("classement-suiv") ? 1 : -1))
            await i.update({ embeds: affichee.embeds, components: affichee.components })
        })
        collecteur.on("end", () => {
            const fin = vue(interaction, type, affichee.page, true)
            interaction.editReply({ embeds: fin.embeds, components: fin.components }).catch(() => {})
        })
    }
}
