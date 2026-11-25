const Discord = require('discord.js')
const { auditReason } = require('../../Fonctions/moderation')
const { sendModLog, getLogChannel } = require('../../Fonctions/logs')
const { t } = require('../../Fonctions/i18n')
const { refuser } = require('../../Fonctions/erreurs')
const am = require('../../Fonctions/automod')
const { PERMISSIONS } = require('../../Fonctions/sanctions')
const db = require('../../Fonctions/db')

const EPHEMERAL = Discord.MessageFlags.Ephemeral

module.exports = {
    name: "automod",
    description: "Règles AutoMod natives de Discord (préréglages, mots, regex, exemptions, dossiers)",
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
                { name: "Voir les règles du bot", value: "liste" },
                { name: "Appliquer un préréglage (souple, normal, strict)", value: "preset" },
                { name: "Mots interdits (remplace la liste)", value: "mots-interdits" },
                { name: "Bloquer les invitations Discord", value: "invitations" },
                { name: "Limiter les mentions", value: "mentions" },
                { name: "Filtre anti-spam de Discord", value: "spam" },
                { name: "Expressions régulières (remplace la liste)", value: "regex" },
                { name: "Exempter un rôle ou un salon", value: "exempter" },
                { name: "Retirer une exemption", value: "retirer-exemption" },
                { name: "Voir les exemptions", value: "exemptions" },
                { name: "Blocages comptés comme avertissements", value: "dossiers" },
                { name: "Supprimer une règle du bot", value: "supprimer" }
            ]
        }, {
            type: "string",
            name: "valeur",
            description: "Mots (virgules), nombre de mentions, regex (séparées par ;;) ou ID de la règle à supprimer",
            required: false,
            maxLength: 4000
        }, {
            type: "string",
            name: "niveau",
            description: "Niveau du préréglage",
            required: false,
            choices: [
                { name: "Souple", value: "souple" },
                { name: "Normal", value: "normal" },
                { name: "Strict", value: "strict" }
            ]
        }, {
            type: "role",
            name: "role",
            description: "Rôle à exempter ou à ne plus exempter",
            required: false
        }, {
            type: "channel",
            name: "salon",
            description: "Salon à exempter ou à ne plus exempter",
            required: false
        }, {
            type: "boolean",
            name: "jeux",
            description: "Inclure les salons de jeux du bot dans les exemptions",
            required: false
        }, {
            type: "boolean",
            name: "actif",
            description: "Pour « dossiers » : activer ou couper (vide : voir l'état)",
            required: false
        }
    ],

    async run(bot, message, args) {
        const action = args.getString("action")
        const valeur = args.getString("valeur")
        const guild = message.guild

        // Réglage en base seulement : aucun appel à Discord
        if (action === "dossiers") return dossiers(message, args.getBoolean("actif"))

        if (!guild.members.me.permissions.has(Discord.PermissionFlagsBits.ManageGuild)) {
            return refuser(message, t(message, "eng.automod.perm_bot"))
        }

        // Tout ce qui se vérifie sans Discord est vérifié avant tout appel
        const reglage = am.REGLES[action] ? am.metadonnees(action, valeur, message) : {}
        if (reglage.erreur) return refuser(message, reglage.erreur)
        if (action === "preset" && !am.NIVEAUX[args.getString("niveau")]) return refuser(message, t(message, "am.niveau_requis"))
        const role = args.getRole("role"), salon = args.getChannel("salon"), jeux = args.getBoolean("jeux") === true
        if (["exempter", "retirer-exemption"].includes(action)) {
            if (!role && !salon && !jeux) return refuser(message, t(message, "am.exempt_rien"))
            if (role?.id === guild.id) return refuser(message, t(message, "am.exempt_everyone"))
        }

        await message.deferReply({ flags: EPHEMERAL })
        // Seules les règles créées par le bot sont listées, modifiées ou supprimées (jamais celles des admins)
        const reglesBot = await am.reglesDuBot(guild, bot)

        if (action === "liste") {
            const lignes = reglesBot.map(r => t(message, "eng.automod.ligne", { nom: r.name, id: r.id, etat: t(message, r.enabled ? "eng.automod.etat_active" : "eng.automod.etat_desactivee") }))
            return message.editReply(lignes.length
                ? `${lignes.join("\n")}${t(message, "eng.automod.liste_pied")}`
                : t(message, "eng.automod.aucune"))
        }

        if (action === "supprimer") {
            const regle = /^\d{17,20}$/.test(valeur?.trim() ?? "") ? reglesBot.get(valeur.trim()) : null
            if (!regle) return message.editReply(t(message, "eng.automod.supprimer_id"))
            await regle.delete(auditReason(message, "Suppression de règle AutoMod"))
            await message.editReply(t(message, "eng.automod.supprimee", { nom: regle.name }))
            return sendModLog(message, { action: "automod", details: `Règle supprimée : ${regle.name}` })
        }

        if (action === "exemptions") return voirExemptions(message, reglesBot)
        if (action === "exempter" || action === "retirer-exemption") {
            return changerExemptions(message, reglesBot, action === "exempter", { role, salon, jeux })
        }

        const logs = getLogChannel(guild, "automod")
        const alerte = logs ? t(message, "eng.automod.alertes", { salon: logs }) : t(message, "eng.automod.alertes_aucune")

        if (action === "preset") {
            const niveau = args.getString("niveau")
            const resultats = await am.appliquerPreset(guild, bot, niveau, logs, auditReason(message, `Préréglage AutoMod : ${niveau}`))
            const lignes = resultats.map(r => t(message, `am.preset_${r.etat}`, { nom: r.nom })).join("\n")
            const jeuxTexte = jeux ? await exempterJeux(message, guild, bot) : ""
            await message.editReply(t(message, "am.preset_fait", { niveau: t(message, `am.niveau_${niveau}`), lignes, alerte }) + jeuxTexte)
            return sendModLog(message, { action: "automod", details: `Préréglage appliqué : ${niveau}` })
        }

        const regle = am.REGLES[action]
        const existante = reglesBot.find(r => r.name === regle.nom && r.triggerType === regle.type)
        try {
            await am.creerOuMettreAJour(guild, reglesBot, { ...regle, triggerMetadata: reglage.triggerMetadata }, logs,
                auditReason(message, existante ? "Mise à jour AutoMod" : "Création de règle AutoMod"))
        } catch (err) {
            console.error("Échec AutoMod :", err.message)
            return message.editReply(t(message, "eng.automod.refuse"))
        }

        const jeuxTexte = jeux ? await exempterJeux(message, guild, bot) : ""
        await message.editReply(t(message, existante ? "eng.automod.maj" : "eng.automod.creee", { nom: regle.nom, alerte }) + jeuxTexte)
        await sendModLog(message, { action: "automod", details: `Règle ${existante ? "mise à jour" : "créée"} : ${regle.nom}` })
    }
}

// Après la création d'une règle : exempte les salons de jeux sur toutes les règles du bot. Renvoie une phrase à ajouter.
async function exempterJeux(message, guild, bot) {
    const salons = am.salonsDeJeux(guild)
    if (!salons.length) return `\n${t(message, "am.exempt_jeux_aucun")}`
    const regles = await am.reglesDuBot(guild, bot)
    const resultat = await am.modifierExemptions(regles, { ajoutSalons: salons }, auditReason(message, "Exemption des salons de jeux"))
    return `\n${texteExemption(message, resultat)}`
}

function texteExemption(message, resultat) {
    if (resultat.erreur === "roles") return t(message, "am.exempt_limite_roles", { nom: resultat.regle })
    if (resultat.erreur === "salons") return t(message, "am.exempt_limite_salons", { nom: resultat.regle })
    if (resultat.erreur) return t(message, "am.exempt_refuse")
    return resultat.modifiees ? t(message, "am.exempt_ok", { n: resultat.modifiees }) : t(message, "am.exempt_inchange")
}

async function changerExemptions(message, reglesBot, ajout, { role, salon, jeux }) {
    if (reglesBot.size === 0) return message.editReply(t(message, "am.exempt_aucune_regle"))
    const salons = [...(salon ? [salon.id] : []), ...(jeux ? am.salonsDeJeux(message.guild) : [])]
    if (jeux && !salon && !role && !salons.length) return message.editReply(t(message, "am.exempt_jeux_aucun"))
    const roles = role ? [role.id] : []
    const resultat = await am.modifierExemptions([...reglesBot.values()], ajout
        ? { ajoutRoles: roles, ajoutSalons: salons }
        : { retraitRoles: roles, retraitSalons: salons }, auditReason(message, ajout ? "Exemption AutoMod" : "Fin d'exemption AutoMod"))
    await message.editReply(texteExemption(message, resultat))
    if (!resultat.erreur) await sendModLog(message, { action: "automod", details: `${ajout ? "Exemption ajoutée" : "Exemption retirée"} sur ${resultat.modifiees} règle(s)` })
}

async function voirExemptions(message, reglesBot) {
    if (reglesBot.size === 0) return message.editReply(t(message, "eng.automod.aucune"))
    const aucun = t(message, "am.exempt_aucun")
    const liste = (collection, prefixe) => {
        const mentions = [...collection?.keys?.() ?? []].map(id => `<${prefixe}${id}>`)
        return mentions.length ? mentions.join(" ") : aucun
    }
    const lignes = reglesBot.map(r => t(message, "am.exempt_ligne", { nom: r.name, roles: liste(r.exemptRoles, "@&"), salons: liste(r.exemptChannels, "#") }))
    await message.editReply({ content: `${lignes.join("\n")}${t(message, "am.exempt_pied")}`.slice(0, 2000), allowedMentions: { parse: [] } })
}

async function dossiers(message, actif) {
    const guildId = message.guild.id
    if (actif === null || actif === undefined) {
        return message.reply({ content: t(message, am.getCountWarns(guildId) ? "am.dossiers_on" : "am.dossiers_off"), flags: EPHEMERAL })
    }
    // Activer : le bot appliquera seul les seuils de /sanctions ; celui qui active doit avoir lui-même ces pouvoirs
    if (actif) {
        const manquante = db.listThresholds(guildId).find(seuil => !message.memberPermissions?.has(PERMISSIONS[seuil.action]))
        if (manquante) return refuser(message, t(message, "am.dossiers_pouvoir", { warns: manquante.warns }))
    }
    am.setCountWarns(guildId, actif)
    await message.reply({ content: t(message, actif ? "am.dossiers_active" : "am.dossiers_coupe"), flags: EPHEMERAL })
    await sendModLog(message, { action: "automod", details: `Blocages AutoMod ${actif ? "comptés" : "non comptés"} comme avertissements` })
}
