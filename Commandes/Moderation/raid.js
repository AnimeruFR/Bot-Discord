const Discord = require('discord.js')
const { refuser } = require('../../Fonctions/erreurs')
const { t } = require('../../Fonctions/i18n')
const { sendModLog } = require('../../Fonctions/logs')
const raid = require('../../Fonctions/raid')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const DEFAUT = { arrivees: 10, secondes: 10 }

const niveau = (cible, n) => t(cible, `raid.niveau_${n}`)
const oui = (cible, valeur) => t(cible, valeur ? "raid.oui" : "raid.non")
const mode = (cible, alerteSeule) => t(cible, alerteSeule ? "raid.mode_alerte" : "raid.mode_verrou")

async function config(interaction, args) {
    const actuel = raid.getReglage(interaction.guildId)
    const reglage = {
        arrivees: args.getInteger("arrivees") ?? actuel?.arrivees ?? DEFAUT.arrivees,
        secondes: args.getInteger("secondes") ?? actuel?.secondes ?? DEFAUT.secondes,
        alerteSeule: args.getBoolean("alerte_seule") ?? actuel?.alerteSeule ?? false
    }
    try {
        raid.setReglage(interaction.guildId, reglage)
    } catch (err) {
        if (!(err instanceof RangeError)) throw err
        const { arrivees, secondes } = raid.BORNES
        return refuser(interaction, t(interaction, "raid.bornes", { amin: arrivees.min, amax: arrivees.max, smin: secondes.min, smax: secondes.max }))
    }
    await sendModLog(interaction, {
        action: "raid",
        details: `Anti-raid configuré : ${reglage.arrivees} arrivée(s) en ${reglage.secondes} s, ${reglage.alerteSeule ? "alerte seule" : "verrouillage automatique"}`
    })
    await interaction.editReply({ content: t(interaction, "raid.config_ok", { arrivees: reglage.arrivees, secondes: reglage.secondes, mode: mode(interaction, reglage.alerteSeule) }) })
}

async function statut(interaction) {
    const reglage = raid.getReglage(interaction.guildId)
    const lignes = [reglage
        ? t(interaction, "raid.statut_config", { arrivees: reglage.arrivees, secondes: reglage.secondes, mode: mode(interaction, reglage.alerteSeule) })
        : t(interaction, "raid.statut_aucun_reglage")]

    const enCours = raid.raidEnCours(interaction.guildId)
    const dernier = raid.dernierRaid(interaction.guildId)
    if (enCours) {
        lignes.push(t(interaction, "raid.statut_en_cours", {
            debut: Math.floor(enCours.started_at / 1000), arrivees: enCours.arrivals,
            niveau: enCours.previous_level === null ? t(interaction, "raid.inchange") : niveau(interaction, enCours.previous_level),
            invites: oui(interaction, enCours.invites_paused === 1)
        }))
    } else if (dernier) {
        lignes.push(t(interaction, "raid.statut_dernier", { debut: Math.floor(dernier.started_at / 1000), fin: Math.floor(dernier.ended_at / 1000), par: dernier.lifted_by }))
    } else {
        lignes.push(t(interaction, "raid.statut_aucun_raid"))
    }
    await interaction.editReply({ content: lignes.join("\n"), allowedMentions: { parse: [] } })
}

// Lève le raid (commande ou bouton). Renvoie true si le raid n'est plus en cours (levé maintenant ou déjà levé).
async function traiterLevee(interaction, id) {
    const r = await raid.lever(interaction.guild, { id, par: interaction.user.id })
    if (r.erreur === "aucun") {
        await refuser(interaction, t(interaction, "raid.lever_aucun"))
        return false
    }
    if (r.erreur === "deja") {
        await refuser(interaction, t(interaction, "raid.lever_deja"))
        return true
    }

    const details = []
    if (r.niveau !== null) details.push(t(interaction, "raid.detail_niveau", { niveau: niveau(interaction, r.niveau) }))
    if (r.niveauModifie) details.push(t(interaction, "raid.detail_niveau_modifie"))
    if (r.invites) details.push(t(interaction, "raid.detail_invites"))
    for (const echec of r.echecs) details.push(t(interaction, "raid.detail_echec", { motif: echec }))

    await sendModLog(interaction, { action: "raid", details: `Mode raid n°${r.id} levé${r.niveau !== null ? `, niveau restauré : ${raid.nomNiveau(r.niveau)}` : ""}${r.invites ? ", invitations rétablies" : ""}${r.echecs.length ? ` (échecs : ${r.echecs.join(" ; ")})` : ""}` })
    await interaction.editReply({ content: [t(interaction, "raid.lever_ok"), ...details].join("\n") })
    return true
}

// Bouton « Lever le mode raid » de l'alerte. Le routeur a déjà passé la garde staff ; la permission est revérifiée ici.
async function onClicLever(bot, interaction) {
    if (!interaction.memberPermissions?.has(Discord.PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: t(interaction, "commun.permission"), flags: EPHEMERAL })
    }
    const id = Number(interaction.customId.split(":")[2])
    await interaction.deferReply({ flags: EPHEMERAL })
    if (!Number.isInteger(id)) return refuser(interaction, t(interaction, "raid.lever_aucun"))
    if (await traiterLevee(interaction, id)) await interaction.message?.edit({ components: [] }).catch(() => {})
}

module.exports = {
    name: "raid",
    description: "Anti-raid : verrouillage automatique du serveur en cas d'arrivées en masse",
    permission: Discord.PermissionFlagsBits.ManageGuild,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Configurer le seuil", value: "config" },
                { name: "Voir l'état", value: "statut" },
                { name: "Lever le mode raid", value: "lever" },
                { name: "Désactiver l'anti-raid", value: "desactiver" }
            ]
        }, {
            type: "integer",
            name: "arrivees",
            description: "Nombre d'arrivées qui déclenche le mode raid (config)",
            required: false,
            minValue: raid.BORNES.arrivees.min,
            maxValue: raid.BORNES.arrivees.max
        }, {
            type: "integer",
            name: "secondes",
            description: "Durée de la fenêtre de comptage, en secondes (config)",
            required: false,
            minValue: raid.BORNES.secondes.min,
            maxValue: raid.BORNES.secondes.max
        }, {
            type: "boolean",
            name: "alerte_seule",
            description: "Prévenir le staff sans verrouiller le serveur (config)",
            required: false
        }
    ],

    composants: [{ prefixe: "raid:", types: ["bouton"], gestionnaire: onClicLever }],

    async run(bot, interaction, args) {
        await interaction.deferReply({ flags: EPHEMERAL })
        switch (args.getString("action")) {
            case "config": return config(interaction, args)
            case "statut": return statut(interaction)
            case "lever": return traiterLevee(interaction, null)
            case "desactiver": {
                if (!raid.supprimerReglage(interaction.guildId)) return refuser(interaction, t(interaction, "raid.deja_desactive"))
                await sendModLog(interaction, { action: "raid", details: "Anti-raid désactivé" })
                return interaction.editReply({ content: t(interaction, "raid.desactive_ok") })
            }
        }
    }
}
