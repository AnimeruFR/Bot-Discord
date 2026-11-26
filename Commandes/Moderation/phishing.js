const Discord = require('discord.js')
const { auditReason } = require('../../Fonctions/moderation')
const { sendModLog, getLogChannel } = require('../../Fonctions/logs')
const { t } = require('../../Fonctions/i18n')
const { refuser } = require('../../Fonctions/erreurs')
const am = require('../../Fonctions/automod')
const ph = require('../../Fonctions/phishing')

const EPHEMERAL = Discord.MessageFlags.Ephemeral

// Domaine affiché dans une réponse : sans accent grave, ni mise en forme
const affiche = domaine => String(domaine).replace(/[`\s]/g, "").slice(0, 80)

module.exports = {
    name: "phishing",
    description: "Anti-phishing : bloque les liens d'arnaque connus avec une règle AutoMod",
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
                { name: "Activer ou mettre à jour la règle", value: "activer" },
                { name: "Désactiver (supprime la règle)", value: "desactiver" },
                { name: "Autoriser un domaine", value: "autoriser" },
                { name: "Ne plus autoriser un domaine", value: "retirer" },
                { name: "Voir l'état et les domaines autorisés", value: "liste" }
            ]
        }, {
            type: "string",
            name: "domaine",
            description: "Domaine à autoriser ou à ne plus autoriser (ex : exemple.com)",
            required: false,
            maxLength: 253
        }
    ],

    async run(bot, message, args) {
        const action = args.getString("action")
        const guild = message.guild
        const saisi = args.getString("domaine")

        // Ce qui se vérifie sans Discord est vérifié avant tout appel
        let domaine = null
        if (action === "autoriser" || action === "retirer") {
            if (!saisi?.trim()) return refuser(message, t(message, "phish.domaine_requis"))
            domaine = ph.normaliserDomaine(saisi)
            if (!domaine) return refuser(message, t(message, "phish.domaine_invalide", { domaine: affiche(saisi).slice(0, 60) }))
        }

        if (action === "liste") return voirEtat(message, bot)

        const peutGererRegles = guild.members.me?.permissions.has(Discord.PermissionFlagsBits.ManageGuild) === true
        const logs = getLogChannel(guild, "automod")

        if (action === "autoriser" || action === "retirer") return changerListeBlanche(message, bot, domaine, action === "autoriser", { peutGererRegles, logs })

        // Activer et désactiver passent forcément par Discord
        if (!peutGererRegles) return refuser(message, t(message, "phish.perm_bot"))
        await message.deferReply({ flags: EPHEMERAL })

        if (action === "desactiver") {
            let existait
            try {
                existait = await ph.supprimer(guild, bot, auditReason(message, "Désactivation de l'anti-phishing"))
            } catch (err) {
                console.error("Échec de la suppression de la règle anti-phishing :", err.message)
                return message.editReply(t(message, "phish.echec"))
            }
            if (!existait) return message.editReply(t(message, "phish.deja_inactif"))
            await message.editReply(t(message, "phish.desactive", { nom: ph.NOM_REGLE }))
            return sendModLog(message, { action: "automod", details: "Anti-phishing désactivé (règle supprimée)" })
        }

        const r = await ph.appliquer(guild, bot, logs, auditReason(message, "Anti-phishing : liste de domaines"))
        if (r.etat === "echec") return message.editReply(t(message, "phish.echec"))
        if (r.etat === "pas_de_place") return message.editReply(t(message, "phish.plus_de_place", { max: ph.LIMITES.reglesMotsCles }))
        if (r.etat === "vide") return message.editReply(t(message, "phish.tout_autorise"))

        const alerte = t(message, logs ? "phish.alertes" : "phish.alertes_aucune", { salon: logs })
        let texte = t(message, r.etat === "creee" ? "phish.active_creee" : "phish.active_maj", { nom: ph.NOM_REGLE, n: r.mots, alerte })
        if (r.retires) texte += `\n${t(message, "phish.retires", { n: r.retires })}`
        if (r.tronques) texte += `\n${t(message, "phish.tronque", { n: r.mots, perdus: r.tronques, max: ph.LIMITES.mots })}`
        await message.editReply(texte)
        await sendModLog(message, { action: "automod", details: `Anti-phishing ${r.etat === "creee" ? "activé" : "mis à jour"} : ${r.mots} domaine(s) bloqué(s)` })
    }
}

// Liste blanche : l'enregistrement est local, la règle est ensuite remise à jour si elle existe
async function changerListeBlanche(message, bot, domaine, ajout, { peutGererRegles, logs }) {
    const guild = message.guild
    if (ajout) {
        const etat = ph.autoriser(guild.id, domaine)
        if (etat === "deja") return refuser(message, t(message, "phish.blanche_deja", { domaine }))
        if (etat === "max") return refuser(message, t(message, "phish.blanche_max", { max: ph.LIMITES.blanche }))
    } else if (!ph.retirerAutorisation(guild.id, domaine)) {
        return refuser(message, t(message, "phish.blanche_inconnue", { domaine }))
    }

    await message.deferReply({ flags: EPHEMERAL })
    let suite
    if (!peutGererRegles) suite = t(message, "phish.sync_perm")
    else {
        const sync = await ph.synchroniser(guild, bot, logs, auditReason(message, `Anti-phishing : ${ajout ? "autorisation" : "fin d'autorisation"} de ${domaine}`))
        suite = sync === "aucune" ? "" : t(message, `phish.sync_${sync}`)
    }
    // Autoriser un domaine absent de la liste (ou sous-domaine d'un domaine bloqué) ne change rien : on le dit
    if (ajout && !ph.chargerListe().some(d => ph.estAutorise(d, [domaine]))) suite += t(message, "phish.sans_effet")
    await message.editReply(t(message, ajout ? "phish.autorise" : "phish.retire", { domaine, suite }))
    await sendModLog(message, { action: "automod", details: `Anti-phishing : ${ajout ? "domaine autorisé" : "domaine non autorisé"} : ${domaine}` })
}

async function voirEtat(message, bot) {
    const guild = message.guild
    const blanche = ph.listeBlanche(guild.id)
    // La règle ne se lit que si le bot peut interroger AutoMod ; sinon l'état reste inconnu
    let etat = t(message, "phish.etat_inconnu")
    if (guild.members.me?.permissions.has(Discord.PermissionFlagsBits.ManageGuild)) {
        await message.deferReply({ flags: EPHEMERAL })
        try {
            const regle = ph.trouverRegle(await am.reglesDuBot(guild, bot), bot.user.id)
            etat = t(message, regle?.enabled ? "phish.etat_actif" : "phish.etat_inactif")
        } catch (err) {
            console.error("Lecture de la règle anti-phishing impossible :", err.message)
        }
    }
    const { mots } = ph.construireMotsCles(ph.chargerListe(), blanche)
    const texte = t(message, "phish.statut", {
        etat, n: mots.length, m: blanche.length, max: ph.LIMITES.blanche,
        liste: blanche.length ? blanche.map(d => `\`${d}\``).join(", ") : t(message, "phish.aucun_autorise")
    }).slice(0, 2000)
    if (message.deferred) return message.editReply({ content: texte, allowedMentions: { parse: [] } })
    return message.reply({ content: texte, flags: EPHEMERAL, allowedMentions: { parse: [] } })
}
