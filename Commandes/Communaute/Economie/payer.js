const Discord = require('discord.js')
const economie = require('../../../Fonctions/economie')
const { t } = require('../../../Fonctions/i18n')
const { refuser } = require('../../../Fonctions/erreurs')
const { fetchMember } = require('../../../Fonctions/moderation')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const SEUIL_CONFIRMATION = 500
const FRAIS_POURCENT = 2
const DELAI_CONFIRMATION = 60 * 1000

module.exports = {
    name: "payer",
    description: "Envoyer de la monnaie à un autre membre (2 % de frais)",
    permission: "Aucune",
    dm: false,
    cooldown: 3,
    options: [
        {
            type: "user",
            name: "membre",
            description: "Qui reçoit la monnaie",
            required: true
        }, {
            type: "integer",
            name: "montant",
            description: "Montant à envoyer (confirmation au-delà de 500)",
            required: true,
            minValue: 1,
            maxValue: economie.ENVOI_MAX_JOUR
        }
    ],

    async run(bot, interaction, args) {
        const guildId = interaction.guild.id
        const montant = args.getInteger("montant")
        const cible = args.getMember("membre")
        const { nom } = economie.monnaie(guildId)
        const texteRefus = cle => t(interaction, `eco.refus.${cle}`, { monnaie: nom })

        // Refus évidents avant toute confirmation ; transferer() revérifie tout au moment du paiement
        if (!cible) return refuser(interaction, t(interaction, "portefeuille.payer.introuvable"))
        if (cible.id === interaction.user.id) return refuser(interaction, texteRefus("soi_meme"))
        if (cible.user?.bot) return refuser(interaction, texteRefus("bot"))
        if (economie.compte(guildId, interaction.user.id).balance < montant) return refuser(interaction, texteRefus("solde"))

        if (montant <= SEUIL_CONFIRMATION) {
            const resultat = economie.transferer(interaction.member, cible, montant, { source: "paiement", fraisPourcent: FRAIS_POURCENT })
            if (!resultat.ok) return refuser(interaction, texteRefus(resultat.refus))
            return interaction.reply({ content: annonce(interaction, cible, resultat), allowedMentions: { parse: [] } })
        }

        const frais = Math.max(1, Math.floor(montant * FRAIS_POURCENT / 100))
        const boutons = new Discord.ActionRowBuilder().addComponents(
            new Discord.ButtonBuilder().setCustomId(`payer-oui-${interaction.id}`).setLabel(t(interaction, "portefeuille.payer.bouton_oui")).setStyle(Discord.ButtonStyle.Success),
            new Discord.ButtonBuilder().setCustomId(`payer-non-${interaction.id}`).setLabel(t(interaction, "portefeuille.payer.bouton_non")).setStyle(Discord.ButtonStyle.Secondary)
        )
        const reponse = await interaction.reply({
            content: t(interaction, "portefeuille.payer.confirmer", {
                montant: economie.formater(guildId, montant), membre: `<@${cible.id}>`, recu: economie.formater(guildId, montant - frais), frais: economie.formater(guildId, frais)
            }),
            components: [boutons], flags: EPHEMERAL, allowedMentions: { parse: [] }, withResponse: true
        })

        // Un seul clic est attendu, de l'auteur
        const clic = await reponse.resource.message.awaitMessageComponent({
            componentType: Discord.ComponentType.Button,
            filter: i => i.user.id === interaction.user.id && i.customId.endsWith(interaction.id),
            time: DELAI_CONFIRMATION
        }).catch(() => null)
        if (!clic) return interaction.editReply({ content: t(interaction, "portefeuille.payer.temps"), components: [] })
        if (clic.customId.startsWith("payer-non")) return clic.update({ content: t(interaction, "portefeuille.payer.annule"), components: [] })
        await clic.deferUpdate()

        // Le solde, les droits et les rôles ont pu changer pendant la confirmation : on relit les deux membres
        let envoyeur, destinataire
        try {
            [envoyeur, destinataire] = await Promise.all([fetchMember(interaction.guild, interaction.user.id), fetchMember(interaction.guild, cible.id)])
        } catch {
            return interaction.editReply({ content: t(interaction, "portefeuille.payer.introuvable"), components: [] })
        }
        if (!envoyeur || !destinataire) return interaction.editReply({ content: t(interaction, "portefeuille.payer.introuvable"), components: [] })
        const resultat = economie.transferer(envoyeur, destinataire, montant, { source: "paiement", fraisPourcent: FRAIS_POURCENT })
        if (!resultat.ok) return interaction.editReply({ content: texteRefus(resultat.refus), components: [] })
        await interaction.editReply({ content: t(interaction, "portefeuille.payer.fait"), components: [] })
        return interaction.followUp({ content: annonce(interaction, cible, resultat), allowedMentions: { parse: [] } })
    }
}

function annonce(interaction, cible, { recu, frais }) {
    const guildId = interaction.guild.id
    return t(interaction, "portefeuille.payer.ok", {
        auteur: `<@${interaction.user.id}>`, membre: `<@${cible.id}>`, recu: economie.formater(guildId, recu), frais: economie.formater(guildId, frais)
    })
}
