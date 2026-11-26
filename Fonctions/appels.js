const Discord = require('discord.js')
const db = require('./db')
const { t } = require('./i18n')
const { couleur } = require('./apparence')
const { formatReason, auditReason } = require('./moderation')
const { getLogChannel, sendModLog } = require('./logs')
const { moduleActif } = require('./modules')
const { refuser } = require('./erreurs')
const { ANNULABLES, lireCase, warnEncore, muteActif, annulerCase, ligneSanction, cibleDe, verifierDroitSurCible } = require('./cases')

// Appels de sanction (table appeals). Le membre sanctionné clique sur « Faire appel » dans son MP,
// écrit son texte dans un formulaire, le staff accepte ou refuse dans le salon des appels (/setlogs famille:appels).
// Un appel par sanction (UNIQUE), sur une sanction de moins de 30 jours et non annulée.

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const DELAI_APPEL = 30 * 24 * 60 * 60 * 1000
const TAILLE_MAX = 1000
const AFFICHES = 15

const PREFIXE_OUVRIR = "appel-ouvrir:"
const PREFIXE_ENVOI = "appel-envoi:"
const PREFIXE_OUI = "appel-oui:"
const PREFIXE_NON = "appel-non:"
const RE_MEMBRE = /^appel-(?:ouvrir|envoi):(\d{1,20}):(\d{1,12})$/
const RE_STAFF = /^appel-(oui|non):(\d{1,12})$/

// ---- Base de données ----

function lireAppel(guildId, id) {
    return db.sqlAll("SELECT * FROM appeals WHERE guild_id = ? AND id = ?", [guildId, id])[0] ?? null
}

const appelDeCase = (guildId, caseId) => db.sqlAll("SELECT * FROM appeals WHERE guild_id = ? AND case_id = ?", [guildId, caseId])[0] ?? null

// Appels d'un membre, les plus récents d'abord
function listerAppelsMembre(guildId, userId, limite = 20) {
    return db.sqlAll("SELECT * FROM appeals WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?", [guildId, userId, limite])
}

function compterAppels(guildId, userId) {
    const l = db.sqlAll("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'en_attente' THEN 1 ELSE 0 END), 0) AS attente FROM appeals WHERE guild_id = ? AND user_id = ?", [guildId, userId])[0]
    return { total: l.total, attente: l.attente }
}

// Appels à traiter, les plus anciens d'abord
function listerEnAttente(guildId, limite = AFFICHES) {
    return db.sqlAll("SELECT * FROM appeals WHERE guild_id = ? AND status = 'en_attente' ORDER BY id LIMIT ?", [guildId, limite])
}

// Le membre peut-il faire appel de cette sanction ? Renvoie la clé du refus (appel.*) ou null.
// Une sanction d'un autre membre répond « introuvable » : on ne révèle rien sur les sanctions des autres.
function refusEligibilite(guildId, userId, caseId) {
    const c = lireCase(guildId, caseId)
    if (!c || c.user_id !== userId) return { cle: "introuvable", c: null }
    if (!ANNULABLES.includes(c.type)) return { cle: "non_appelable", c }
    if (c.cancelled_at || !warnEncore(c)) return { cle: "deja_annulee", c }
    if (Date.now() - c.created_at > DELAI_APPEL) return { cle: "trop_ancienne", c }
    if (appelDeCase(guildId, caseId)) return { cle: "deja", c }
    return { cle: null, c }
}

// Enregistre l'appel, en vérifiant tout dans la même transaction (deux envois en même temps : un seul passe).
// Renvoie { id } ou { cle } (clé du refus).
function creerAppel(guildId, userId, caseId, texte) {
    return db.transaction(() => {
        const { cle } = refusEligibilite(guildId, userId, caseId)
        if (cle) return { cle }
        db.sqlRun("INSERT INTO appeals (guild_id, case_id, user_id, content, status, created_at) VALUES (?, ?, ?, ?, 'en_attente', ?)", [guildId, caseId, userId, texte, Date.now()])
        return { id: db.sqlAll("SELECT last_insert_rowid() AS id")[0].id }
    })
}

function retirerAppel(guildId, id) {
    return db.sqlRun("DELETE FROM appeals WHERE guild_id = ? AND id = ?", [guildId, id]) > 0
}

// Passe l'appel de « en attente » à accepté/refusé. L'UPDATE conditionnel est atomique : un seul clic gagne (renvoie true).
function trancher(guildId, id, statut, decideurId) {
    return db.sqlRun("UPDATE appeals SET status = ?, decided_by = ?, decided_at = ? WHERE guild_id = ? AND id = ? AND status = 'en_attente'",
        [statut, decideurId, Date.now(), guildId, id]) > 0
}

// ---- MP de sanction ----

// Bouton « Faire appel » à joindre au MP d'une sanction ([] si on ne peut pas faire appel : pas de salon d'appels, sanction non annulable)
function composantsAppel(guild, caseId) {
    try {
        if (!caseId) return []
        const c = lireCase(guild.id, caseId)
        if (!c || !ANNULABLES.includes(c.type) || c.cancelled_at || !getLogChannel(guild, "appels")) return []
        return [new Discord.ActionRowBuilder().addComponents(
            new Discord.ButtonBuilder().setCustomId(`${PREFIXE_OUVRIR}${guild.id}:${caseId}`).setLabel(t(guild, "appel.bouton")).setStyle(Discord.ButtonStyle.Secondary)
        )]
    } catch (err) {
        console.error("Bouton d'appel impossible :", err.message)
        return []
    }
}

// Envoie le MP d'une sanction, avec le bouton d'appel s'il y a lieu (texte seul sinon). La sanction doit déjà être écrite.
function mpSanction(user, guild, texte, caseId) {
    const components = composantsAppel(guild, caseId)
    return user.send(components.length ? { content: texte, components } : texte)
}

// ---- Côté membre (en MP : public, tout est revérifié ici) ----

// Contexte d'un composant du membre : { guild, caseId } ou { refus } (texte traduit)
function lireContexte(interaction) {
    const m = RE_MEMBRE.exec(interaction.customId)
    const guild = m && interaction.client.guilds.cache.get(m[1])
    // Module Modération coupé, serveur quitté ou salon d'appels supprimé : plus d'appel possible
    if (!guild || !moduleActif(guild.id, "moderation") || !getLogChannel(guild, "appels")) return { refus: t(interaction, "appel.ferme") }
    return { guild, caseId: Number(m[2]) }
}

// Clic sur « Faire appel » : vérifie puis ouvre le formulaire
async function ouvrirAppel(bot, interaction) {
    const { guild, caseId, refus } = lireContexte(interaction)
    if (refus) return interaction.reply({ content: refus, flags: EPHEMERAL })
    const { cle } = refusEligibilite(guild.id, interaction.user.id, caseId)
    if (cle) return interaction.reply({ content: t(interaction, `appel.${cle}`, { serveur: guild.name }), flags: EPHEMERAL })

    const texte = new Discord.TextInputBuilder()
        .setCustomId("texte")
        .setLabel(t(interaction, "appel.modal_label"))
        .setStyle(Discord.TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(TAILLE_MAX)
    await interaction.showModal(new Discord.ModalBuilder()
        .setCustomId(`${PREFIXE_ENVOI}${guild.id}:${caseId}`)
        .setTitle(t(interaction, "appel.modal_titre"))
        .addComponents(new Discord.ActionRowBuilder().addComponents(texte)))
}

// Soumission du formulaire : écrit l'appel puis prévient le staff
async function envoyerAppel(bot, interaction) {
    const { guild, caseId, refus } = lireContexte(interaction)
    if (refus) return interaction.reply({ content: refus, flags: EPHEMERAL })
    const texte = interaction.fields.getTextInputValue("texte").trim()
    if (!texte || texte.length > TAILLE_MAX) return interaction.reply({ content: t(interaction, "appel.vide", { max: TAILLE_MAX }), flags: EPHEMERAL })

    const r = creerAppel(guild.id, interaction.user.id, caseId, texte)
    if (r.cle) return interaction.reply({ content: t(interaction, `appel.${r.cle}`, { serveur: guild.name }), flags: EPHEMERAL })

    try {
        const salon = getLogChannel(guild, "appels")
        if (!salon) throw new Error("salon d'appels indisponible")
        await salon.send(messageStaff(guild, lireAppel(guild.id, r.id), lireCase(guild.id, caseId)))
    } catch (err) {
        // Le staff n'a rien reçu : l'appel est retiré pour que le membre puisse réessayer
        console.error("Impossible d'envoyer l'appel au staff :", err.message)
        retirerAppel(guild.id, r.id)
        return interaction.reply({ content: t(interaction, "appel.echec"), flags: EPHEMERAL })
    }
    await interaction.reply({ content: t(interaction, "appel.envoye", { serveur: guild.name }), flags: EPHEMERAL })
}

// ---- Côté staff (garde staff du module Modération) ----

// Message posté dans le salon des appels : le texte du membre est échappé, les boutons décident
function messageStaff(guild, appel, c, resultat = null) {
    const embed = new Discord.EmbedBuilder()
        .setColor(couleur(guild))
        .setTitle(t(guild, "appel.embed_titre", { id: appel.id, sanction: appel.case_id }))
        .addFields(
            { name: t(guild, "appel.champ_membre"), value: `<@${appel.user_id}> (\`${appel.user_id}\`)` },
            { name: t(guild, "appel.champ_sanction"), value: c ? ligneSanction(guild, c).slice(0, 1024) : t(guild, "appel.sanction_effacee") },
            { name: t(guild, "appel.champ_texte"), value: formatReason(appel.content).slice(0, 1024) }
        )
        .setTimestamp(appel.created_at)
    if (resultat) {
        embed.addFields({ name: t(guild, "appel.champ_resultat"), value: resultat })
        return { embeds: [embed], components: [] }
    }
    const boutons = new Discord.ActionRowBuilder().addComponents(
        new Discord.ButtonBuilder().setCustomId(`${PREFIXE_OUI}${appel.id}`).setLabel(t(guild, "appel.bouton_accepter")).setStyle(Discord.ButtonStyle.Success),
        new Discord.ButtonBuilder().setCustomId(`${PREFIXE_NON}${appel.id}`).setLabel(t(guild, "appel.bouton_refuser")).setStyle(Discord.ButtonStyle.Danger)
    )
    return { embeds: [embed], components: [boutons] }
}

// Effets d'un appel accepté au-delà de l'annulation de la sanction : mute levé, ban levé si le décideur peut bannir.
// Renvoie le texte à ajouter à la réponse du décideur.
async function lever(interaction, c, membre) {
    const guild = interaction.guild
    const audit = auditReason(interaction, `Appel accepté (sanction n°${c.id})`)
    if (c.type === "warn") return t(interaction, "appel.suite_warn", { total: db.countWarns(guild.id, c.user_id) })
    if (c.type === "mute") {
        if (!muteActif(c) || !membre?.isCommunicationDisabled()) return ""
        try {
            await membre.timeout(null, audit)
            return t(interaction, "appel.suite_mute")
        } catch {
            return t(interaction, "appel.suite_mute_echec")
        }
    }
    if (c.type === "ban" || c.type === "tempban") {
        if (!interaction.memberPermissions?.has(Discord.PermissionFlagsBits.BanMembers)) return t(interaction, "appel.suite_ban_manuel")
        try {
            await guild.bans.remove(c.user_id, audit)
            db.removeTempban(guild.id, c.user_id)
            return t(interaction, "appel.suite_ban_leve")
        } catch (err) {
            if (err.code === Discord.RESTJSONErrorCodes.UnknownBan) {
                db.removeTempban(guild.id, c.user_id)
                return t(interaction, "appel.suite_ban_deja")
            }
            console.error("Déban après appel impossible :", err.message)
            return t(interaction, "appel.suite_ban_echec")
        }
    }
    return ""
}

// Boutons Accepter / Refuser. Un seul clic produit un effet : le statut est pris par un UPDATE conditionnel.
async function decider(bot, interaction) {
    const m = RE_STAFF.exec(interaction.customId)
    await interaction.deferReply({ flags: EPHEMERAL })
    if (!m) return refuser(interaction, t(interaction, "appel.introuvable_staff"))
    const accepter = m[1] === "oui"
    const guild = interaction.guild
    const appel = lireAppel(guild.id, Number(m[2]))
    if (!appel) return refuser(interaction, t(interaction, "appel.introuvable_staff"))
    if (appel.status !== "en_attente") return refuser(interaction, t(interaction, "appel.deja_traite", { statut: t(interaction, `appel.statut.${appel.status}`) }))

    const c = lireCase(guild.id, appel.case_id)
    let membre = null
    if (!c) {
        // Sanction effacée : rien à annuler. Un refus reste possible, mais seulement pour qui gère le serveur
        if (accepter) return refuser(interaction, t(interaction, "appel.sanction_effacee"))
        if (!interaction.memberPermissions?.has(Discord.PermissionFlagsBits.ManageGuild)) return refuser(interaction, t(interaction, "appel.pas_auteur"))
    } else {
        // Accepter comme refuser : même garde que /case annuler (auteur de la sanction ou ManageGuild, puis hiérarchie actuelle),
        // revérifiée ici à chaque clic
        const droit = await verifierDroitSurCible(interaction, { auteurId: c.moderator_id, userId: appel.user_id, cleAutre: "appel.pas_auteur" })
        if (droit.refus) return refuser(interaction, droit.refus)
        membre = droit.membre
    }

    const statut = accepter ? "accepte" : "refuse"
    if (!trancher(guild.id, appel.id, statut, interaction.user.id)) {
        const actuel = lireAppel(guild.id, appel.id)?.status ?? "refuse"
        return refuser(interaction, t(interaction, "appel.deja_traite", { statut: t(interaction, `appel.statut.${actuel}`) }))
    }

    let suite = ""
    if (accepter) {
        // annulerCase a sa propre transaction (db.transaction ne s'imbrique pas) : les deux écritures se suivent sans await,
        // et si l'annulation échoue le statut revient à « en attente » pour que le staff puisse réessayer.
        // « deja » : la sanction a été annulée entre-temps, c'est le but recherché
        let r, motif = null
        try {
            r = annulerCase(guild.id, c.id, interaction.user.id)
        } catch (err) {
            console.error("Appel : annulation impossible :", err.message)
            motif = err.message
        }
        if (motif !== null || (r !== "ok" && r !== "deja")) {
            db.sqlRun("UPDATE appeals SET status = 'en_attente', decided_by = NULL, decided_at = NULL WHERE guild_id = ? AND id = ? AND status = 'accepte' AND decided_by = ?",
                [guild.id, appel.id, interaction.user.id])
            return refuser(interaction, t(interaction, "appel.annulation_echec", { motif: motif ?? r }))
        }
        if (r === "ok") suite = await lever(interaction, c, membre)
    }

    const resultat = t(interaction, accepter ? "appel.resultat_accepte" : "appel.resultat_refuse", { decideur: interaction.user.id, date: Math.floor(Date.now() / 1000) })
    await interaction.message?.edit(messageStaff(guild, appel, c, resultat)).catch(() => {})

    // Le membre est prévenu (MP fermés : sans importance)
    const user = await interaction.client.users.fetch(appel.user_id).catch(() => null)
    await user?.send(t(guild, accepter ? "appel.mp_accepte" : "appel.mp_refuse", { serveur: guild.name, sanction: appel.case_id })).catch(() => {})

    await interaction.editReply({ content: t(interaction, accepter ? "appel.decision_acceptee" : "appel.decision_refusee", { id: appel.id, sanction: appel.case_id }) + suite })
    await sendModLog(interaction, {
        action: "appel", cible: cibleDe(appel.user_id),
        details: `Appel n°${appel.id} ${accepter ? "accepté" : "refusé"} (sanction n°${appel.case_id})`
    })
}

module.exports = {
    PREFIXE_OUVRIR, PREFIXE_ENVOI, PREFIXE_OUI, PREFIXE_NON,
    lireAppel, appelDeCase, listerAppelsMembre, compterAppels, listerEnAttente, creerAppel, trancher,
    composantsAppel, mpSanction, ouvrirAppel, envoyerAppel, decider
}
