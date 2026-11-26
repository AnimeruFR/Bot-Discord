const Discord = require('discord.js')
const economie = require('../../../Fonctions/economie')
const metiers = require('../../../Fonctions/metiers')
const { refuser } = require('../../../Fonctions/erreurs')
const { t } = require('../../../Fonctions/i18n')

const nomMonnaie = guildId => {
    const m = economie.monnaie(guildId)
    return `${m.nom} ${m.emoji}`
}
const nomMetier = (cible, job) => t(cible, `travail.metier.${job}`)
const quand = ms => `<t:${Math.floor(ms / 1000)}:R>`

// Message d'un refus de metiers.js : clé propre à /travail ou refus de l'économie
function texteRefus(interaction, resultat) {
    const monnaie = nomMonnaie(interaction.guildId)
    const cle = ["sans_metier", "cooldown", "limite_jour", "meme_metier", "metier_inconnu"].includes(resultat.refus)
        ? `travail.refus.${resultat.refus}` : `eco.refus.${resultat.refus}`
    return t(interaction, cle, { monnaie, quand: resultat.prochain ? quand(resultat.prochain) : "", prix: economie.formater(interaction.guildId, metiers.PRIX_CHANGEMENT) })
}

// Boutons de confirmation du changement de métier : travail:ok:<membre>:<métier> / travail:non:<membre>
async function surBouton(bot, interaction) {
    const [, action, userId, job] = interaction.customId.split(":")
    if (interaction.user.id !== userId) return refuser(interaction, t(interaction, "travail.pas_a_vous"))
    if (action !== "ok") return interaction.update({ content: t(interaction, "travail.change_annule"), components: [] })
    const resultat = metiers.choisirMetier(interaction.member, job)
    if (!resultat.ok) return interaction.update({ content: texteRefus(interaction, resultat), components: [] })
    return interaction.update({
        content: t(interaction, "travail.change_ok", { metier: nomMetier(interaction, job), prix: economie.formater(interaction.guildId, resultat.paye) }),
        components: []
    })
}

module.exports = {
    name: "travail",
    description: "Travailler pour gagner de la monnaie, voir ou changer de métier",
    permission: "Aucune",
    dm: false,
    composants: [{ prefixe: "travail:", types: ["bouton"], public: true, gestionnaire: surBouton }],
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Travailler", value: "travailler" },
                { name: "Voir mon métier", value: "metier" },
                { name: "Choisir ou changer de métier", value: "choisir" }
            ]
        }, {
            type: "string",
            name: "metier",
            description: "Le métier à choisir (pour « Choisir ou changer de métier »)",
            required: false,
            choices: [
                { name: "Forgeron", value: "forgeron" },
                { name: "Cartographe", value: "cartographe" },
                { name: "Herboriste", value: "herboriste" },
                { name: "Horloger", value: "horloger" },
                { name: "Archiviste", value: "archiviste" }
            ]
        }
    ],

    async run(bot, interaction, args) {
        const guildId = interaction.guildId
        const action = args.getString("action")

        if (action === "travailler") {
            const r = metiers.travailler(interaction.member)
            if (!r.ok) return refuser(interaction, texteRefus(interaction, r))
            const lignes = [
                t(interaction, `travail.texte.${r.job}.${r.texte}`),
                r.credite > 0
                    ? t(interaction, "travail.gain", { gain: economie.formater(guildId, r.credite), solde: economie.formater(guildId, r.solde) })
                    : t(interaction, "eco.plafonne", { monnaie: nomMonnaie(guildId) })
            ]
            if (r.credite > 0 && r.plafonne) lignes.push(t(interaction, "eco.plafonne", { monnaie: nomMonnaie(guildId) }))
            if (r.monte) lignes.push(t(interaction, "travail.niveau_monte", { niveau: r.niveau }))
            lignes.push(t(interaction, "travail.suite", { restants: r.restants, quand: quand(Date.now() + metiers.COOLDOWN) }))
            return interaction.reply({ content: lignes.join("\n") })
        }

        if (action === "metier") {
            const m = metiers.lireMetier(guildId, interaction.user.id)
            if (!m) return refuser(interaction, t(interaction, "travail.refus.sans_metier"))
            const lignes = [
                t(interaction, "travail.fiche", { metier: nomMetier(interaction, m.job), niveau: m.level, max: metiers.NIVEAU_MAX }),
                m.requis ? t(interaction, "travail.fiche_xp", { xp: m.reste, requis: m.requis }) : t(interaction, "travail.fiche_max"),
                t(interaction, "travail.fiche_jour", { faits: metiers.travauxDuJour(guildId, interaction.user.id), max: metiers.TRAVAUX_PAR_JOUR })
            ]
            const prochain = (m.lastWorkAt ?? 0) + metiers.COOLDOWN
            lignes.push(prochain > Date.now() ? t(interaction, "travail.fiche_attente", { quand: quand(prochain) }) : t(interaction, "travail.fiche_libre"))
            return interaction.reply({ content: lignes.join("\n"), flags: Discord.MessageFlags.Ephemeral })
        }

        // action === "choisir"
        const job = args.getString("metier")
        if (!job) return refuser(interaction, t(interaction, "travail.refus.metier_manquant"))
        const actuel = metiers.lireMetier(guildId, interaction.user.id)
        if (actuel && actuel.job !== job) {
            // Changement payant : on demande confirmation (le paiement a lieu au clic)
            const lignes = [
                t(interaction, "travail.change_confirme", { metier: nomMetier(interaction, job), prix: economie.formater(guildId, metiers.PRIX_CHANGEMENT), niveau: actuel.level })
            ]
            const boutons = new Discord.ActionRowBuilder().addComponents(
                new Discord.ButtonBuilder().setCustomId(`travail:ok:${interaction.user.id}:${job}`).setStyle(Discord.ButtonStyle.Danger).setLabel(t(interaction, "travail.bouton_ok")),
                new Discord.ButtonBuilder().setCustomId(`travail:non:${interaction.user.id}`).setStyle(Discord.ButtonStyle.Secondary).setLabel(t(interaction, "travail.bouton_non"))
            )
            return interaction.reply({ content: lignes.join("\n"), components: [boutons], flags: Discord.MessageFlags.Ephemeral })
        }
        const r = metiers.choisirMetier(interaction.member, job)
        if (!r.ok) return refuser(interaction, texteRefus(interaction, r))
        return interaction.reply({ content: t(interaction, "travail.choisi", { metier: nomMetier(interaction, job) }), flags: Discord.MessageFlags.Ephemeral })
    }
}
