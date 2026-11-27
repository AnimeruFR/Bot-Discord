const Discord = require('discord.js')
const mots = require('../../../Fonctions/mots')
const economie = require('../../../Fonctions/economie')
const { jourParis } = require('../../../Fonctions/evenements')
const { refuser } = require('../../../Fonctions/erreurs')
const { t } = require('../../../Fonctions/i18n')

const EPHEMERAL = Discord.MessageFlags.Ephemeral

// Motif de refus économique (module coupé, compte gelé, sanction), traduit, ou null
function refusEconomie(interaction) {
    const refus = economie.peutJouer(interaction.member)
    return refus ? t(interaction, `eco.refus.${refus}`, { monnaie: economie.monnaie(interaction.guildId).nom }) : null
}

// Ce que le joueur voit : ses essais en couleurs, le nombre d'essais restants et le bouton adapté à l'état de la partie
function panneau(interaction, etat, { lignesFin = null } = {}) {
    const { guildId, user } = interaction
    const jour = jourParis()
    const secret = mots.motDuJour(guildId, jour, etat.langue)
    const lignes = [t(interaction, "mots.mot.titre")]
    if (!etat.essais.length) lignes.push(t(interaction, "mots.mot.intro", { max: mots.ESSAIS_MAX }))
    for (const essai of etat.essais) lignes.push(`${mots.ligneEmojis(secret, essai)}  \`${essai}\``)

    if (!etat.termine) {
        lignes.push(t(interaction, "mots.mot.restants", { restants: mots.ESSAIS_MAX - etat.essais.length, max: mots.ESSAIS_MAX }))
    } else if (etat.gagne) {
        lignes.push(...(lignesFin ?? [t(interaction, "mots.mot.gagne_sans_gain", { essais: etat.essais.length, max: mots.ESSAIS_MAX })]))
    } else {
        lignes.push(t(interaction, "mots.mot.perdu", { mot: secret }))
    }
    const serie = mots.serieActuelle(guildId, user.id, jour)
    if (serie > 0) lignes.push(t(interaction, "mots.mot.serie", { serie }))

    const bouton = etat.termine
        ? new Discord.ButtonBuilder().setCustomId("mot:partager").setLabel(t(interaction, "mots.mot.bouton_partager")).setEmoji("📤").setStyle(Discord.ButtonStyle.Secondary)
        : new Discord.ButtonBuilder().setCustomId("mot:essai").setLabel(t(interaction, "mots.mot.bouton_essai")).setEmoji("✏️").setStyle(Discord.ButtonStyle.Primary)
    return { content: lignes.join("\n"), components: [new Discord.ActionRowBuilder().addComponents(bouton)] }
}

// Lignes de fin d'une partie gagnée, selon ce que l'économie a répondu (gain, plafond du jour atteint, compte refusé)
function lignesGain(interaction, essais, recompense) {
    const base = { essais, max: mots.ESSAIS_MAX }
    const credit = recompense?.credit
    if (!credit?.ok) {
        const lignes = [t(interaction, "mots.mot.gagne_sans_gain", base)]
        if (credit?.refus) lignes.push(t(interaction, `eco.refus.${credit.refus}`, { monnaie: economie.monnaie(interaction.guildId).nom }))
        return lignes
    }
    if (credit.credite > 0) return [t(interaction, "mots.mot.gagne", { ...base, gain: economie.formater(interaction.guildId, credit.credite) })]
    const lignes = [t(interaction, "mots.mot.gagne_sans_gain", base)]
    if (credit.plafonne) lignes.push(t(interaction, "eco.plafonne", { monnaie: economie.monnaie(interaction.guildId).nom }))
    return lignes
}

function formulaire(interaction) {
    const champ = new Discord.TextInputBuilder().setCustomId("essai").setLabel(t(interaction, "mots.mot.modal_champ"))
        .setStyle(Discord.TextInputStyle.Short).setMinLength(mots.LONGUEUR).setMaxLength(mots.LONGUEUR).setRequired(true)
    return new Discord.ModalBuilder().setCustomId("mot:modal").setTitle(t(interaction, "mots.mot.modal_titre"))
        .addComponents(new Discord.ActionRowBuilder().addComponents(champ))
}

async function soumettre(interaction) {
    const avertissement = refusEconomie(interaction)
    if (avertissement) return refuser(interaction, avertissement)
    const resultat = mots.proposerEssai({ guildId: interaction.guildId, userId: interaction.user.id, essai: interaction.fields.getTextInputValue("essai"), jour: jourParis() })
    // Refusé : rien n'est écrit, l'essai ne coûte rien
    if (!resultat.ok) return refuser(interaction, t(interaction, `mots.mot.refus_${resultat.refus}`, { mot: resultat.mot }))

    const recompense = resultat.gagne ? mots.recompenserMot(interaction.member, resultat) : null
    const vue = panneau(interaction, resultat.etat, { lignesFin: resultat.gagne ? lignesGain(interaction, resultat.etat.essais.length, recompense) : null })
    // Le formulaire a été ouvert depuis le message du joueur : on le met à jour (sinon, nouvelle réponse éphémère)
    if (interaction.isFromMessage?.()) return interaction.update(vue)
    return interaction.reply({ ...vue, flags: EPHEMERAL })
}

async function partager(interaction) {
    const { guildId, user } = interaction
    const jour = jourParis()
    const etat = mots.etatDuJour(guildId, user.id, jour)
    if (!etat.termine) return refuser(interaction, t(interaction, "mots.mot.partage_refus"))
    const serie = mots.serieActuelle(guildId, user.id, jour)
    // Seulement les couleurs : ni les lettres essayées ni le mot du jour
    return interaction.reply({
        content: t(interaction, "mots.mot.partage", {
            user: user.id, jour, essais: etat.gagne ? etat.essais.length : "X", max: mots.ESSAIS_MAX,
            serie: serie > 1 ? t(interaction, "mots.mot.partage_serie", { serie }) : "",
            grille: mots.grille(mots.motDuJour(guildId, jour, etat.langue), etat.essais)
        })
    })
}

async function gerer(bot, interaction) {
    if (interaction.isModalSubmit()) return soumettre(interaction)
    if (interaction.customId === "mot:partager") return partager(interaction)
    // mot:essai : on vérifie avant d'ouvrir le formulaire pour ne pas faire saisir un mot pour rien
    const etat = mots.etatDuJour(interaction.guildId, interaction.user.id)
    if (etat.termine) return refuser(interaction, t(interaction, "mots.mot.refus_deja_fini"))
    const avertissement = refusEconomie(interaction)
    if (avertissement) return refuser(interaction, avertissement)
    return interaction.showModal(formulaire(interaction))
}

module.exports = {
    name: "mot",
    description: "Le Mot du jour : trouvez le mot de 5 lettres en 6 essais",
    permission: "Aucune",
    dm: false,
    composants: [{ prefixe: "mot:", types: ["bouton", "modal"], public: true, gestionnaire: gerer }],
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Jouer au mot du jour", value: "jouer" },
                { name: "Voir ma série", value: "serie" }
            ]
        }
    ],

    async run(bot, interaction, args) {
        const avertissement = refusEconomie(interaction)
        if (avertissement) return refuser(interaction, avertissement)
        const { guildId, user } = interaction
        if (args.getString("action") === "serie") {
            const serie = mots.serieActuelle(guildId, user.id)
            return interaction.reply({ content: t(interaction, serie > 0 ? "mots.mot.serie" : "mots.mot.serie_vide", { serie }), flags: EPHEMERAL })
        }
        const etat = mots.etatDuJour(guildId, user.id)
        return interaction.reply({ ...panneau(interaction, etat), flags: EPHEMERAL })
    }
}
