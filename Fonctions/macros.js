const Discord = require('discord.js')
const { t } = require('./i18n')
const db = require('./db')
const { refuser } = require('./erreurs')
const { sendModLog } = require('./logs')
const tickets = require('./tickets')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral

const MAX_MACROS = 25 // par serveur
const MAX_NOM = 32
const MAX_TEXTE = 2000

// Nom de réponse : minuscules, sans accents, espaces et séparateurs en tirets, [a-z0-9-] seulement
function normaliserNom(brut) {
    return String(brut ?? "")
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[\s_]+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, MAX_NOM)
}

const lister = guildId => db.sqlAll("SELECT name, content, author_id, created_at FROM ticket_macros WHERE guild_id = ? ORDER BY name", [guildId])
const trouver = (guildId, nom) => db.sqlAll("SELECT name, content FROM ticket_macros WHERE guild_id = ? AND name = ?", [guildId, nom])[0] ?? null

// Renvoie { etat } : "ok", "nom_invalide", "texte_invalide", "doublon" ou "limite" (et le nom normalisé)
// Un nom déjà pris est refusé (pas de remplacement silencieux) : il faut d'abord retirer l'ancienne réponse.
function ajouter(guildId, nomBrut, texte, auteurId) {
    const nom = normaliserNom(nomBrut)
    if (!nom) return { etat: "nom_invalide" }
    const contenu = String(texte ?? "").trim()
    if (!contenu || contenu.length > MAX_TEXTE) return { etat: "texte_invalide" }
    if (trouver(guildId, nom)) return { etat: "doublon", nom }
    if (lister(guildId).length >= MAX_MACROS) return { etat: "limite" }
    db.sqlRun("INSERT INTO ticket_macros (guild_id, name, content, author_id, created_at) VALUES (?, ?, ?, ?, ?)", [guildId, nom, contenu, auteurId, Date.now()])
    return { etat: "ok", nom }
}

const retirer = (guildId, nomBrut) => db.sqlRun("DELETE FROM ticket_macros WHERE guild_id = ? AND name = ?", [guildId, normaliserNom(nomBrut)]) > 0

// Propositions d'autocomplétion : filtrées par la saisie, 25 au plus
function propositions(guildId, saisie) {
    const filtre = normaliserNom(saisie)
    return lister(guildId)
        .filter(m => m.name.includes(filtre))
        .slice(0, 25)
        .map(m => ({ name: m.name, value: m.name }))
}

// Poste la réponse dans le ticket : seulement un ticket ouvert, par le staff de ce ticket
async function envoyer(interaction, nomBrut) {
    const channel = interaction.channel
    const ownerId = tickets.ticketOwnerId(channel)
    if (!ownerId || !channel.name.startsWith("ticket-")) return refuser(interaction, t(interaction, "mac.hors_ticket"))
    if (!tickets.isStaff(interaction, channel)) return refuser(interaction, t(interaction, "mac.staff_seul"))
    const macro = trouver(interaction.guildId, normaliserNom(nomBrut))
    if (!macro) return refuser(interaction, t(interaction, "mac.introuvable"))

    const signature = t(interaction.guild, "mac.signature")
    await interaction.reply({ content: `${macro.content}\n\n-# ${signature}`.slice(0, 2000), allowedMentions: { parse: [] } })
    await sendModLog(interaction, { action: "ticket", details: t(interaction.guild, "mac.log_envoi", { nom: macro.name, salon: `<#${channel.id}>` }) })
}

async function montrerFormulaire(interaction, nomPropose) {
    const nom = new Discord.TextInputBuilder()
        .setCustomId("nom").setLabel(t(interaction, "mac.form_nom")).setStyle(Discord.TextInputStyle.Short)
        .setRequired(true).setMaxLength(MAX_NOM)
    const nomInitial = normaliserNom(nomPropose)
    if (nomInitial) nom.setValue(nomInitial)
    const texte = new Discord.TextInputBuilder()
        .setCustomId("texte").setLabel(t(interaction, "mac.form_texte")).setStyle(Discord.TextInputStyle.Paragraph)
        .setRequired(true).setMaxLength(MAX_TEXTE)
    await interaction.showModal(new Discord.ModalBuilder()
        .setCustomId("macro:ajouter").setTitle(t(interaction, "mac.form_titre"))
        .addComponents(new Discord.ActionRowBuilder().addComponents(nom), new Discord.ActionRowBuilder().addComponents(texte)))
}

// Formulaire envoyé : on revérifie le droit de gestion et la limite (le formulaire a pu rester ouvert)
async function onFormulaire(bot, interaction) {
    if (!interaction.inGuild()) return
    if (!interaction.memberPermissions.has(Flags.ManageGuild)) return refuser(interaction, t(interaction, "mac.perm_gestion"))
    const res = ajouter(interaction.guildId, interaction.fields.getTextInputValue("nom"), interaction.fields.getTextInputValue("texte"), interaction.user.id)
    const messages = {
        nom_invalide: () => t(interaction, "mac.nom_invalide"),
        texte_invalide: () => t(interaction, "mac.texte_invalide", { max: MAX_TEXTE }),
        doublon: () => t(interaction, "mac.doublon", { nom: res.nom }),
        limite: () => t(interaction, "mac.limite", { max: MAX_MACROS }),
        ok: () => t(interaction, "mac.ajoute", { nom: res.nom })
    }
    await interaction.reply({ content: messages[res.etat](), flags: EPHEMERAL })
    if (res.etat === "ok") await sendModLog(interaction, { action: "ticket", details: t(interaction.guild, "mac.log_ajout", { nom: res.nom }) })
}

function afficherListe(interaction) {
    const macros = lister(interaction.guildId)
    if (!macros.length) return refuser(interaction, t(interaction, "mac.vide"))
    const lignes = macros.map(m => `**${m.name}** : ${m.content.replace(/\s+/g, " ").slice(0, 60)}`)
    const titre = t(interaction, "mac.liste_titre", { n: macros.length, max: MAX_MACROS })
    return interaction.reply({ content: `${titre}\n${lignes.join("\n")}`.slice(0, 2000), flags: EPHEMERAL })
}

async function supprimer(interaction, nomBrut) {
    const nom = normaliserNom(nomBrut)
    if (!nom || !retirer(interaction.guildId, nom)) return refuser(interaction, t(interaction, "mac.introuvable"))
    await interaction.reply({ content: t(interaction, "mac.retire", { nom }), flags: EPHEMERAL })
    await sendModLog(interaction, { action: "ticket", details: t(interaction.guild, "mac.log_retrait", { nom }) })
}

module.exports = { MAX_MACROS, normaliserNom, lister, trouver, ajouter, retirer, propositions, envoyer, montrerFormulaire, onFormulaire, afficherListe, supprimer }
