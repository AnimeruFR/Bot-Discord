const Discord = require('discord.js')
const succes = require('../../../Fonctions/succes')
const { formater } = require('../../../Fonctions/economie')
const { couleur } = require('../../../Fonctions/apparence')
const { t, langueDe } = require('../../../Fonctions/i18n')

const PAR_PAGE = 8
const PREFIXE = "succes:"

// Obtenus d'abord (du plus ancien au plus récent), puis ceux qui restent à obtenir
function contenu(interaction, userId, page) {
    const langue = langueDe(interaction)
    const tous = succes.liste(interaction.guildId, userId)
    const obtenus = tous.filter(s => s.obtenuLe).sort((a, b) => a.obtenuLe - b.obtenuLe)
    const ordre = [...obtenus, ...tous.filter(s => !s.obtenuLe)]
    const pages = Math.max(1, Math.ceil(ordre.length / PAR_PAGE))
    const numero = Math.min(Math.max(page, 0), pages - 1)

    const lignes = ordre.slice(numero * PAR_PAGE, (numero + 1) * PAR_PAGE).map(s => {
        const base = {
            nom: s.nom[langue] ?? s.nom.fr, description: s.description[langue] ?? s.description.fr,
            recompense: formater(interaction.guildId, s.recompense)
        }
        return s.obtenuLe
            ? t(interaction, "succes.ligne_obtenu", { ...base, date: Math.floor(s.obtenuLe / 1000) })
            : t(interaction, "succes.ligne_a_obtenir", { ...base, valeur: s.valeur, seuil: s.condition.seuil })
    })
    const embed = new Discord.EmbedBuilder()
        .setColor(couleur(interaction.guild))
        .setTitle(t(interaction, "succes.titre", { nombre: obtenus.length, total: tous.length }))
        .setDescription(lignes.join("\n\n"))
        .setFooter({ text: t(interaction, "succes.page", { page: numero + 1, pages }) })
    const bouton = (libelle, cible, desactive) => new Discord.ButtonBuilder()
        .setCustomId(`${PREFIXE}${cible}:${userId}`).setLabel(libelle).setStyle(Discord.ButtonStyle.Secondary).setDisabled(desactive)
    const boutons = new Discord.ActionRowBuilder().addComponents(
        bouton("◀", numero - 1, numero === 0),
        bouton("▶", numero + 1, numero >= pages - 1)
    )
    return { embeds: [embed], components: [boutons] }
}

// Boutons de pagination : succes:<page>:<id du membre regardé>
async function onClic(bot, interaction) {
    const [, page, userId] = interaction.customId.split(":")
    if (!/^\d+$/.test(page) || !/^\d{15,25}$/.test(userId ?? "")) return
    return interaction.update(contenu(interaction, userId, Number(page)))
}

module.exports = {
    name: "succes",
    description: "Voir les succès obtenus et ceux qu'il reste à obtenir",
    permission: "Aucune",
    dm: false,
    cooldown: 3,
    composants: [{ prefixe: PREFIXE, types: ["bouton"], public: true, gestionnaire: onClic }],
    options: [{
        type: "user",
        name: "membre",
        description: "Le membre à regarder (vous par défaut)",
        required: false
    }],

    async run(bot, interaction, args) {
        const cible = args.getUser("membre") ?? interaction.user
        return interaction.reply({ ...contenu(interaction, cible.id, 0), flags: Discord.MessageFlags.Ephemeral })
    }
}
