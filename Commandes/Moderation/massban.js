const Discord = require('discord.js')
const db = require('../../Fonctions/db')
const { refuser } = require('../../Fonctions/erreurs')
const { t } = require('../../Fonctions/i18n')
const { sendModLog } = require('../../Fonctions/logs')
const { checkHierarchy, auditReason, formatReason } = require('../../Fonctions/moderation')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral
const MAX_CIBLES = 200
const DELAI_CONFIRMATION = 60 * 1000
const SUPPRESSION_MESSAGES = 0 // secondes de messages supprimées (comme /ban : aucun)
const PERMISSIONS_REQUISES = Flags.BanMembers | Flags.ManageGuild // celles de l'API de ban en masse
const ID = /^\d{17,20}$/

// "123… 456…, <@789…>" -> { ids (sans doublon), invalides }
function parserIds(texte) {
    const ids = new Set(), invalides = []
    for (const brut of String(texte ?? "").split(/[\s,;]+/).filter(Boolean)) {
        const jeton = brut.replace(/^<@!?(\d+)>$/, "$1")
        if (ID.test(jeton)) ids.add(jeton)
        else invalides.push(brut)
    }
    return { ids: [...ids], invalides }
}

// Membres arrivés depuis `minutes` minutes (les bots sont ignorés : ce sont des intégrations ajoutées par le staff)
async function recentsDepuis(guild, minutes, maintenant = Date.now()) {
    const limite = maintenant - minutes * 60 * 1000
    const membres = await guild.members.fetch()
    return [...membres.values()].filter(m => !m.user?.bot && (m.joinedTimestamp ?? 0) >= limite).map(m => m.id)
}

// Trie les cibles : { cibles (ids à bannir), exclus: { soi, bot, proprietaire, hierarchie } }.
// Pour ceux qui sont sur le serveur : hiérarchie du modérateur (checkHierarchy) et du bot (bannable).
// Lève une erreur si les membres ne peuvent pas être lus : sans cela, la hiérarchie ne serait pas vérifiée.
async function evaluer(interaction, ids) {
    const { guild } = interaction
    const exclus = { soi: 0, bot: 0, proprietaire: 0, hierarchie: 0 }
    const candidats = []
    for (const id of ids) {
        if (id === interaction.user.id) exclus.soi++
        else if (id === interaction.client.user.id) exclus.bot++
        else if (id === guild.ownerId) exclus.proprietaire++
        else candidats.push(id)
    }

    const presents = new Map()
    for (let i = 0; i < candidats.length; i += 100) {
        const lot = await guild.members.fetch({ user: candidats.slice(i, i + 100) })
        for (const membre of lot.values()) presents.set(membre.id, membre)
    }

    const cibles = []
    for (const id of candidats) {
        const membre = presents.get(id)
        if (membre && (checkHierarchy(interaction, membre, "ban") || !membre.bannable)) exclus.hierarchie++
        else cibles.push(id)
    }
    return { cibles, exclus }
}

function resumeExclus(interaction, exclus) {
    const total = Object.values(exclus).reduce((a, b) => a + b, 0)
    if (!total) return ""
    const detail = Object.entries(exclus).filter(([, n]) => n > 0).map(([cle, n]) => `${t(interaction, `raid.exclu_${cle}`)} : ${n}`).join(", ")
    return t(interaction, "raid.massban_exclus", { total, detail })
}

// Ban groupé (API de ban en masse si disponible, sinon un par un). Renvoie { bannis, echecs } (listes d'identifiants).
async function bannirEnMasse(guild, ids, raison) {
    const options = { reason: raison, deleteMessageSeconds: SUPPRESSION_MESSAGES }
    const bannis = new Set()
    if (typeof guild.bans.bulkCreate === "function") {
        try {
            const resultat = await guild.bans.bulkCreate(ids, options)
            for (const id of resultat.bannedUsers ?? []) bannis.add(id)
        } catch (err) {
            console.error("Ban en masse :", err.message)
        }
    } else {
        for (const id of ids) {
            try {
                await guild.bans.create(id, options)
                bannis.add(id)
            } catch (err) {
                console.error(`Ban en masse (${id}) :`, err.message)
            }
        }
    }
    // Un identifiant absent de la réponse est compté en échec
    return { bannis: ids.filter(id => bannis.has(id)), echecs: ids.filter(id => !bannis.has(id)) }
}

const permissionsOk = permissions => Boolean(permissions?.has(PERMISSIONS_REQUISES))

module.exports = {
    name: "massban",
    description: "Ban en masse : liste d'identifiants ou membres arrivés récemment (avec confirmation)",
    permission: Discord.PermissionFlagsBits.BanMembers,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "string",
            name: "ids",
            description: "Identifiants à bannir, séparés par des espaces ou des virgules (200 au plus)",
            required: false,
            maxLength: 4000
        }, {
            type: "integer",
            name: "depuis_minutes",
            description: "Bannir aussi les membres arrivés depuis ce nombre de minutes",
            required: false,
            minValue: 1,
            maxValue: 1440
        }, {
            type: "string",
            name: "raison",
            description: "La raison des bannissements",
            required: false,
            maxLength: 300
        }
    ],

    // Exposés pour les tests
    parserIds, evaluer, bannirEnMasse, MAX_CIBLES,

    async run(bot, interaction, args) {
        const { guild } = interaction
        // Comme l'API de ban en masse : Bannir des membres ET Gérer le serveur, côté modérateur et côté bot
        if (!permissionsOk(interaction.memberPermissions)) return refuser(interaction, t(interaction, "raid.massban_perm_membre"))
        if (!permissionsOk(guild.members.me?.permissions)) return refuser(interaction, t(interaction, "raid.massban_perm_bot"))

        const texte = args.getString("ids")
        const minutes = args.getInteger("depuis_minutes")
        if (!texte?.trim() && minutes === null) return refuser(interaction, t(interaction, "raid.massban_manque_cible"))
        const analyse = parserIds(texte)
        if (analyse.invalides.length) return refuser(interaction, t(interaction, "raid.massban_invalides", { liste: analyse.invalides.slice(0, 5).join(", ").slice(0, 300) }))

        await interaction.deferReply({ flags: EPHEMERAL })
        let ids = analyse.ids
        let evaluation
        try {
            if (minutes !== null) ids = [...new Set([...ids, ...await recentsDepuis(guild, minutes)])]
            if (ids.length > MAX_CIBLES) return refuser(interaction, t(interaction, "raid.massban_trop", { total: ids.length, max: MAX_CIBLES }))
            evaluation = await evaluer(interaction, ids)
        } catch (err) {
            return refuser(interaction, t(interaction, "raid.massban_fetch_echec", { erreur: err.message }))
        }
        const { cibles, exclus } = evaluation
        if (!cibles.length) return refuser(interaction, t(interaction, "raid.massban_aucune", { exclus: resumeExclus(interaction, exclus) }))

        // Raison enregistrée en français, comme les autres sanctions
        const raisonBrute = `Ban en masse : ${args.getString("raison")?.trim() || "Aucune raison fournie"}`
        const liste = cibles.slice(0, 10).map(id => `<@${id}> (\`${id}\`)`).join(", ")
        const suite = cibles.length > 10 ? t(interaction, "raid.massban_suite", { reste: cibles.length - 10 }) : ""
        const boutons = new Discord.ActionRowBuilder().addComponents(
            new Discord.ButtonBuilder().setCustomId(`massban-oui-${interaction.id}`).setLabel(t(interaction, "raid.massban_bouton_oui")).setStyle(Discord.ButtonStyle.Danger),
            new Discord.ButtonBuilder().setCustomId(`massban-non-${interaction.id}`).setLabel(t(interaction, "raid.massban_bouton_non")).setStyle(Discord.ButtonStyle.Secondary)
        )
        const reponse = await interaction.editReply({
            content: t(interaction, "raid.massban_apercu", { total: cibles.length, reason: formatReason(raisonBrute), liste, suite, exclus: resumeExclus(interaction, exclus) }),
            components: [boutons], allowedMentions: { parse: [] }
        })

        // Un seul clic est attendu, de l'auteur : le collecteur s'arrête au premier
        const clic = await reponse.awaitMessageComponent({
            componentType: Discord.ComponentType.Button,
            filter: i => i.user.id === interaction.user.id && i.customId.endsWith(interaction.id),
            time: DELAI_CONFIRMATION
        }).catch(() => null)
        if (!clic) return interaction.editReply({ content: t(interaction, "raid.massban_temps"), components: [] })
        if (clic.customId.startsWith("massban-non")) return clic.update({ content: t(interaction, "raid.massban_annule"), components: [] })
        await clic.update({ content: t(interaction, "raid.massban_en_cours", { total: cibles.length }), components: [] })

        // Tout a pu changer pendant la confirmation : permissions (celles du clic sont à jour) et hiérarchie
        if (!permissionsOk(clic.memberPermissions) || !permissionsOk(guild.members.me?.permissions)) {
            return interaction.editReply({ content: t(interaction, "raid.massban_plus_permission") })
        }
        let verifie
        try {
            verifie = await evaluer(clic, cibles)
        } catch (err) {
            return interaction.editReply({ content: t(interaction, "raid.massban_verif_impossible", { erreur: err.message }) })
        }
        if (!verifie.cibles.length) return interaction.editReply({ content: t(interaction, "raid.massban_aucune", { exclus: resumeExclus(interaction, verifie.exclus) }) })

        const { bannis, echecs } = await bannirEnMasse(guild, verifie.cibles, auditReason(interaction, raisonBrute))
        // Une sanction par membre banni ; un ban définitif remplace un éventuel ban temporaire
        db.transaction(() => {
            for (const userId of bannis) {
                db.removeTempban(guild.id, userId)
                db.addCase(guild.id, { userId, moderatorId: interaction.user.id, type: "ban", reason: raisonBrute })
            }
        })

        await interaction.editReply({ content: t(interaction, "raid.massban_resultat", { bannis: bannis.length, echecs: echecs.length }) })
        await sendModLog(interaction, {
            action: "ban", raison: raisonBrute,
            details: `Ban en masse : ${bannis.length} banni(s), ${echecs.length} échec(s) sur ${verifie.cibles.length} cible(s)\nIdentifiants : ${bannis.slice(0, 30).join(", ")}${bannis.length > 30 ? "…" : ""}`
        })
    }
}
