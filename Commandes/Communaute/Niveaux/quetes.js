const Discord = require('discord.js')
const quetes = require('../../../Fonctions/quetes')
const { peutJouer, formater, monnaie } = require('../../../Fonctions/economie')
const { couleur } = require('../../../Fonctions/apparence')
const { refuser } = require('../../../Fonctions/erreurs')
const { t, langueDe } = require('../../../Fonctions/i18n')

const EPHEMERAL = Discord.MessageFlags.Ephemeral

function barre(progression, objectif) {
    const plein = Math.round(10 * Math.min(progression, objectif) / objectif)
    return "▰".repeat(plein) + "▱".repeat(10 - plein)
}

function ligne(interaction, q) {
    const etat = q.claimed ? "✅" : q.terminee ? "🎁" : "▫️"
    const texte = t(interaction, "quetes.ligne", {
        etat, nom: q.nom[langueDe(interaction)] ?? q.nom.fr, barre: barre(q.progress, q.goal), progression: q.progress, objectif: q.goal,
        recompense: formater(interaction.guildId, q.recompense)
    })
    return q.claimed ? `${texte} ${t(interaction, "quetes.reclamee")}` : texte
}

function afficher(interaction) {
    const liste = quetes.quetesDuMembre(interaction.guildId, interaction.user.id)
    const embed = new Discord.EmbedBuilder()
        .setColor(couleur(interaction.guild))
        .setTitle(t(interaction, "quetes.titre"))
        .addFields(
            { name: t(interaction, "quetes.jour"), value: liste.filter(q => q.type === "jour").map(q => ligne(interaction, q)).join("\n") || "-" },
            { name: t(interaction, "quetes.semaine"), value: liste.filter(q => q.type === "semaine").map(q => ligne(interaction, q)).join("\n") || "-" }
        )
        .setFooter({ text: t(interaction, liste.some(q => q.terminee && !q.claimed) ? "quetes.pied_a_reclamer" : "quetes.pied") })
    return interaction.reply({ embeds: [embed], flags: EPHEMERAL })
}

async function reclamer(interaction) {
    const refus = peutJouer(interaction.member)
    if (refus) return refuser(interaction, t(interaction, `eco.refus.${refus}`, { monnaie: monnaie(interaction.guildId).nom }))

    const resultat = quetes.reclamer(interaction.member)
    if (resultat.refus && !resultat.reclamees.length) {
        return refuser(interaction, t(interaction, `eco.refus.${resultat.refus}`, { monnaie: monnaie(interaction.guildId).nom }))
    }
    if (resultat.rien) return refuser(interaction, t(interaction, "quetes.rien"))
    return interaction.reply({
        content: t(interaction, "quetes.reclame", { nombre: resultat.reclamees.length, total: formater(interaction.guildId, resultat.total) }),
        flags: EPHEMERAL
    })
}

module.exports = {
    name: "quetes",
    description: "Vos quêtes du jour et de la semaine : voir l'avancement, réclamer les récompenses",
    permission: "Aucune",
    dm: false,
    cooldown: 3,
    options: [{
        type: "string",
        name: "action",
        description: "Que faire ?",
        required: false,
        choices: [
            { name: "Voir mes quêtes", value: "voir" },
            { name: "Réclamer les récompenses", value: "reclamer" }
        ]
    }],

    async run(bot, interaction, args) {
        if (args.getString("action") === "reclamer") return reclamer(interaction)
        return afficher(interaction)
    }
}
