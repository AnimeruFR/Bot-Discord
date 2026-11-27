const Discord = require('discord.js')
const xp = require('../../../Fonctions/xp')
const paliers = require('../../../Fonctions/paliers')
const economie = require('../../../Fonctions/economie')
const { sendModLog } = require('../../../Fonctions/logs')
const { refuser } = require('../../../Fonctions/erreurs')
const { t } = require('../../../Fonctions/i18n')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral
const { ChannelType } = Discord

const formatMultiplicateur = m => String(m).replace(".", ",")

// Texte de /niveaux voir : tous les réglages du serveur
function texteReglages(interaction) {
    const guild = interaction.guild
    const config = xp.lireConfig(guild.id)
    const liste = elements => elements.length ? elements.join(", ") : t(interaction, "niv.voir.aucun")
    const bonus = kind => xp.listerBonus(guild.id, kind).map(b =>
        t(interaction, "niv.voir.bonus_ligne", { cible: kind === "salon" ? `<#${b.cible}>` : `<@&${b.cible}>`, multiplicateur: formatMultiplicateur(b.multiplicateur) }))

    let annonce = t(interaction, "niv.voir.annonce_ici")
    if (config.salonAnnonce === xp.SANS_ANNONCE) annonce = t(interaction, "niv.voir.annonce_coupees")
    else if (config.salonAnnonce) annonce = t(interaction, "niv.voir.annonce_salon", { salon: `<#${config.salonAnnonce}>` })

    const lignes = [
        `**${t(interaction, "niv.voir.titre")}**`,
        t(interaction, "niv.voir.exclus", { liste: liste(config.exclus.map(id => `<#${id}>`)) }),
        t(interaction, "niv.voir.bonus_salons", { liste: liste(bonus("salon")) }),
        t(interaction, "niv.voir.bonus_roles", { liste: liste(bonus("role")) }),
        t(interaction, "niv.voir.weekend", { etat: t(interaction, config.weekend ? "niv.voir.oui" : "niv.voir.non") }),
        annonce,
        t(interaction, "niv.voir.mode", { mode: t(interaction, `niv.voir.mode_${config.mode}`) })
    ]
    const liste_paliers = paliers.listerPaliers(guild.id)
    lignes.push(liste_paliers.length
        ? t(interaction, "niv.voir.paliers", { nombre: liste_paliers.length, max: paliers.MAX_PALIERS })
        : t(interaction, "niv.voir.aucun_palier"))
    for (const p of liste_paliers) {
        const detail = [
            p.roleId ? t(interaction, "niv.voir.palier_role", { role: `<@&${p.roleId}>` }) : null,
            p.recompense > 0 ? t(interaction, "niv.voir.palier_recompense", { montant: economie.formater(guild.id, p.recompense) }) : null
        ].filter(Boolean).join(", ")
        lignes.push(t(interaction, "niv.voir.palier_ligne", { niveau: p.niveau, detail }))
    }
    return lignes.join("\n").slice(0, 2000)
}

module.exports = {
    name: "niveaux",
    description: "Régler les niveaux : salons exclus, bonus d'XP, paliers, week-end",
    permission: Discord.PermissionFlagsBits.ManageGuild,
    dm: false,
    category: "Configuration",
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Voir les réglages", value: "voir" },
                { name: "Exclure un salon", value: "exclure" },
                { name: "Réinclure un salon", value: "inclure" },
                { name: "Régler un bonus d'XP (salon ou rôle)", value: "bonus" },
                { name: "Ajouter ou modifier un palier", value: "palier" },
                { name: "Retirer un palier", value: "retirer_palier" },
                { name: "Double XP le week-end", value: "weekend" },
                { name: "Annonces de niveau", value: "salon_annonce" },
                { name: "Mode des paliers (cumul ou remplace)", value: "mode" }
            ]
        }, {
            type: "channel",
            name: "salon",
            description: "Salon ou catégorie (exclure, inclure, bonus, annonces)",
            required: false,
            channelTypes: [
                ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildStageVoice,
                ChannelType.GuildForum, ChannelType.GuildCategory
            ]
        }, {
            type: "role",
            name: "role",
            description: "Rôle (bonus ou palier)",
            required: false
        }, {
            type: "number",
            name: "multiplicateur",
            description: "Multiplicateur d'XP de 1,1 à 2 (1 retire le bonus)",
            required: false,
            minValue: 1,
            maxValue: 2
        }, {
            type: "integer",
            name: "niveau",
            description: "Niveau du palier",
            required: false,
            minValue: 1,
            maxValue: paliers.NIVEAU_PALIER_MAX
        }, {
            type: "integer",
            name: "recompense",
            description: "Récompense en monnaie du palier (0 à 5000)",
            required: false,
            minValue: 0,
            maxValue: paliers.RECOMPENSE_MAX
        }, {
            type: "boolean",
            name: "actif",
            description: "Activer ou désactiver (week-end, annonces)",
            required: false
        }, {
            type: "string",
            name: "mode",
            description: "Mode des paliers",
            required: false,
            choices: [
                { name: "Cumul : garder tous les rôles atteints", value: "cumul" },
                { name: "Remplace : garder seulement le palier le plus haut", value: "remplace" }
            ]
        }
    ],

    async run(bot, interaction, args) {
        const guild = interaction.guild
        const action = args.getString("action")
        const salon = args.getChannel("salon")
        const role = args.getRole("role")
        const repondre = async (cle, vars = {}, journal = null) => {
            await interaction.reply({ content: t(interaction, cle, vars), flags: EPHEMERAL })
            if (journal) await sendModLog(interaction, { action: "config", details: journal })
        }

        if (action === "voir") return interaction.reply({ content: texteReglages(interaction), flags: EPHEMERAL })

        if (action === "exclure" || action === "inclure") {
            if (!salon) return refuser(interaction, t(interaction, "niv.salon_manquant"))
            const exclure = action === "exclure"
            let change
            try {
                change = xp.definirExclusion(guild.id, salon.id, exclure)
            } catch (err) {
                if (!(err instanceof RangeError)) throw err
                return refuser(interaction, t(interaction, "niv.exclus_max", { max: xp.MAX_EXCLUS }))
            }
            if (!change) return refuser(interaction, t(interaction, exclure ? "niv.deja_exclu" : "niv.pas_exclu", { salon }))
            return repondre(exclure ? "niv.exclu_ok" : "niv.inclu_ok", { salon }, `Niveaux : ${salon} ${exclure ? "exclu" : "réinclus"} (XP)`)
        }

        if (action === "bonus") {
            if (Boolean(salon) === Boolean(role)) return refuser(interaction, t(interaction, "niv.bonus_cible"))
            const multiplicateur = args.getNumber("multiplicateur")
            if (multiplicateur === null) return refuser(interaction, t(interaction, "niv.bonus_multiplicateur"))
            const cible = salon ?? role
            try {
                xp.definirBonus(guild.id, salon ? "salon" : "role", cible.id, multiplicateur)
            } catch (err) {
                if (!(err instanceof RangeError)) throw err
                return refuser(interaction, t(interaction, "niv.bonus_max", { max: xp.MAX_BONUS }))
            }
            if (multiplicateur <= 1) return repondre("niv.bonus_retire", { cible }, `Niveaux : bonus d'XP retiré pour ${cible}`)
            return repondre("niv.bonus_ok", { cible, multiplicateur: formatMultiplicateur(multiplicateur) }, `Niveaux : bonus d'XP ×${multiplicateur} pour ${cible}`)
        }

        if (action === "palier") {
            const niveau = args.getInteger("niveau")
            const recompense = args.getInteger("recompense") ?? 0
            if (niveau === null) return refuser(interaction, t(interaction, "niv.palier_niveau"))
            if (!role && recompense === 0) return refuser(interaction, t(interaction, "niv.palier_vide"))
            if (role) {
                const refus = paliers.refusRolePalier(guild, role, interaction.member, interaction)
                if (refus) return refuser(interaction, refus)
            }
            try {
                paliers.definirPalier(guild.id, { niveau, roleId: role?.id ?? null, recompense })
            } catch (err) {
                if (!(err instanceof RangeError)) throw err
                return refuser(interaction, t(interaction, "niv.palier_max", { max: paliers.MAX_PALIERS }))
            }
            return repondre("niv.palier_ok", { niveau }, `Niveaux : palier du niveau ${niveau} (${role ?? "sans rôle"}, récompense ${recompense})`)
        }

        if (action === "retirer_palier") {
            const niveau = args.getInteger("niveau")
            if (niveau === null) return refuser(interaction, t(interaction, "niv.palier_niveau"))
            if (!paliers.retirerPalier(guild.id, niveau)) return refuser(interaction, t(interaction, "niv.palier_inconnu", { niveau }))
            return repondre("niv.palier_retire", { niveau }, `Niveaux : palier du niveau ${niveau} retiré`)
        }

        if (action === "weekend") {
            // Sans précision, on bascule
            const actif = args.getBoolean("actif") ?? !xp.lireConfig(guild.id).weekend
            xp.definirWeekend(guild.id, actif)
            return repondre("niv.weekend_ok", { etat: t(interaction, actif ? "niv.voir.oui" : "niv.voir.non") }, `Niveaux : double XP le week-end ${actif ? "activé" : "désactivé"}`)
        }

        if (action === "salon_annonce") {
            if (args.getBoolean("actif") === false) {
                xp.definirSalonAnnonce(guild.id, xp.SANS_ANNONCE)
                return repondre("niv.annonce_coupees", {}, "Niveaux : annonces de niveau désactivées")
            }
            if (!salon) {
                xp.definirSalonAnnonce(guild.id, null)
                return repondre("niv.annonce_ici", {}, "Niveaux : annonces dans le salon du message")
            }
            const ecrivable = [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(salon.type)
                && salon.permissionsFor?.(guild.members.me)?.has([Flags.ViewChannel, Flags.SendMessages])
            if (!ecrivable) return refuser(interaction, t(interaction, "niv.annonce_salon_invalide"))
            xp.definirSalonAnnonce(guild.id, salon.id)
            return repondre("niv.annonce_salon_ok", { salon }, `Niveaux : annonces dans ${salon}`)
        }

        if (action === "mode") {
            const mode = args.getString("mode")
            if (!mode) return refuser(interaction, t(interaction, "niv.mode_manquant"))
            paliers.definirMode(guild.id, mode)
            return repondre("niv.mode_ok", { mode: t(interaction, `niv.voir.mode_${mode}`) }, `Niveaux : mode des paliers ${mode}`)
        }
    }
}
