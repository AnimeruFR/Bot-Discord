const Discord = require('discord.js')
const inventaire = require('../../../Fonctions/inventaire')
const eco = require('../../../Fonctions/economie')
const { refuser } = require('../../../Fonctions/erreurs')
const { couleur } = require('../../../Fonctions/apparence')
const { t } = require('../../../Fonctions/i18n')

const EPHEMERAL = Discord.MessageFlags.Ephemeral

const horodatage = instant => `<t:${Math.floor(instant / 1000)}:R>`

function voir(interaction) {
    const guildId = interaction.guildId, userId = interaction.user.id
    const objets = inventaire.lister(guildId, userId)
    const embed = new Discord.EmbedBuilder().setColor(couleur(interaction.guild)).setTitle(t(interaction, "inv.titre"))
    const lignes = objets.map(o => t(interaction, "inv.ligne", {
        nom: inventaire.nomObjet(o.id, interaction), nombre: o.quantite, description: inventaire.descriptionObjet(o.id, interaction)
    }))
    const restant = inventaire.boostRestant(guildId, userId)
    if (restant > 0) lignes.push("", t(interaction, "inv.boost_actif", { fin: horodatage(Date.now() + restant) }))
    embed.setDescription(lignes.length ? lignes.join("\n") : t(interaction, "inv.vide"))
    return interaction.reply({ embeds: [embed], flags: EPHEMERAL })
}

async function utiliser(interaction, id) {
    const guildId = interaction.guildId, userId = interaction.user.id
    if (!id) return refuser(interaction, t(interaction, "inv.refus.objet_manquant"))
    const r = inventaire.utiliser(interaction.member, id)
    if (!r.ok) {
        const monnaie = eco.monnaie(guildId).nom
        if (r.refus === "boost_actif") {
            return refuser(interaction, t(interaction, "inv.refus.boost_actif", { fin: horodatage(Date.now() + inventaire.boostRestant(guildId, userId)) }))
        }
        const economie = ["module", "gele", "sanctionne"].includes(r.refus)
        return refuser(interaction, economie ? t(interaction, `eco.refus.${r.refus}`, { monnaie }) : t(interaction, `inv.refus.${r.refus}`))
    }
    return interaction.reply({
        content: t(interaction, "inv.utilise_boost", { objet: inventaire.nomObjet(id, interaction), fin: horodatage(r.jusqua) }),
        flags: EPHEMERAL
    })
}

// Propose les objets que le membre possède
function autocompleter(bot, interaction) {
    const saisie = String(interaction.options.getFocused()).toLowerCase()
    const propositions = inventaire.lister(interaction.guildId, interaction.user.id)
        .map(o => ({ name: `${inventaire.nomObjet(o.id, interaction)} (×${o.quantite})`, value: o.id }))
        .filter(p => !saisie || p.name.toLowerCase().includes(saisie))
    return interaction.respond(propositions.slice(0, 25))
}

module.exports = {
    name: "inventaire",
    description: "Votre inventaire : voir vos objets et en utiliser",
    permission: "Aucune",
    dm: false,
    cooldown: 3,
    category: "Économie",
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Voir mon inventaire", value: "voir" },
                { name: "Utiliser un objet", value: "utiliser" }
            ]
        }, {
            type: "string",
            name: "objet",
            description: "L'objet à utiliser",
            required: false,
            autocomplete: true,
            maxLength: 40
        }
    ],

    async run(bot, interaction, args) {
        if (args.getString("action") === "voir") return voir(interaction)
        return utiliser(interaction, args.getString("objet"))
    },

    autocomplete: autocompleter
}
