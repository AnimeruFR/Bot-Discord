const Discord = require('discord.js')
const eco = require('../../../Fonctions/economie')
const boutique = require('../../../Fonctions/boutique')
const inventaire = require('../../../Fonctions/inventaire')
const { sendModLog } = require('../../../Fonctions/logs')
const { parseDuree } = require('../../../Fonctions/moderation')
const { refuser } = require('../../../Fonctions/erreurs')
const { couleur } = require('../../../Fonctions/apparence')
const { t, langueDe } = require('../../../Fonctions/i18n')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral
const ACTIONS_ADMIN = ["ajouter", "retirer", "modifier"]

// Texte traduit d'un refus de la boutique ou de l'économie
function texteRefus(cible, refus, { roleId = null } = {}) {
    const monnaie = eco.monnaie(cible.guildId ?? cible.id).nom
    if (boutique.REFUS_ECONOMIE.includes(refus)) return t(cible, `eco.refus.${refus}`, { monnaie })
    return t(cible, `boutique.refus.${refus}`, {
        role: roleId ? `<@&${roleId}>` : "?", max: boutique.ARTICLES_MAX, min: boutique.PRIX_MIN, maxprix: boutique.PRIX_MAX
    })
}

// « ≈ 4,7 jours de jeu actif »
function texteJours(cible, prix) {
    const jours = boutique.joursDeJeu(prix)
    const fr = langueDe(cible) === "fr"
    const nombre = jours.toLocaleString(fr ? "fr-FR" : "en-US", { maximumFractionDigits: 1 })
    return t(cible, (fr ? jours < 2 : jours <= 1) ? "boutique.jours_un" : "boutique.jours_plusieurs", { nombre })
}

function texteDuree(cible, secondes) {
    const heures = secondes / 3600
    if (heures < 48) return t(cible, "boutique.duree_heures", { nombre: Math.round(heures * 10) / 10 })
    return t(cible, "boutique.duree_jours", { nombre: Math.round(secondes / 86400 * 10) / 10 })
}

const libelleType = (cible, a) =>
    t(cible, `boutique.type.${a.type}`, { duree: a.dureeS ? texteDuree(cible, a.dureeS) : "" })

// Une ligne par article : « **n°3** Rôle VIP » puis le type, le prix et le stock
function ligneArticle(cible, a) {
    const guildId = cible.guildId
    const type = libelleType(cible, a)
    let stock = ""
    if (a.stock !== null) stock = a.stock > 0 ? ` · ${t(cible, "boutique.stock", { nombre: a.stock })}` : ` · ${t(cible, "boutique.epuise")}`
    return `**n°${a.id}** ${Discord.escapeMarkdown(a.nom)}\n${type} · **${eco.formater(guildId, a.prix)}**${stock}`
}

// Vitrine : liste des articles et menu d'achat
function vitrine(interaction) {
    const guildId = interaction.guildId
    const liste = boutique.articles(guildId)
    const embed = new Discord.EmbedBuilder().setColor(couleur(interaction.guild)).setTitle(t(interaction, "boutique.titre"))
    if (!liste.length) return { embeds: [embed.setDescription(t(interaction, "boutique.vide"))], components: [] }

    embed.setDescription(`${t(interaction, "boutique.solde", { solde: eco.formater(guildId, eco.compte(guildId, interaction.user.id).balance) })}\n\n${liste.map(a => ligneArticle(interaction, a)).join("\n\n")}`)
    const menu = new Discord.StringSelectMenuBuilder()
        .setCustomId("boutique:choisir")
        .setPlaceholder(t(interaction, "boutique.menu"))
        .addOptions(liste.map(a => ({
            label: `${a.nom} (n°${a.id})`.slice(0, 100),
            description: `${eco.formater(guildId, a.prix)} · ${libelleType(interaction, a)}`.slice(0, 100),
            value: String(a.id)
        })))
    return { embeds: [embed], components: [new Discord.ActionRowBuilder().addComponents(menu)] }
}

// Achète et renvoie le message à montrer au membre
async function achat(interaction, id) {
    const r = await boutique.acheter(interaction.member, id)
    if (!r.ok) {
        if (r.refus === "role_impossible") return t(interaction, r.rembourse ? "boutique.refus.role_impossible_rembourse" : "boutique.refus.role_impossible")
        return texteRefus(interaction, r.refus, r)
    }
    const guildId = interaction.guildId
    let texte = t(interaction, "boutique.achete", {
        nom: Discord.escapeMarkdown(r.article.nom), prix: eco.formater(guildId, r.article.prix), solde: eco.formater(guildId, r.solde)
    })
    if (r.expireA) texte += ` ${t(interaction, "boutique.achete_temp", { fin: `<t:${Math.floor(r.expireA / 1000)}:R>` })}`
    if (r.article.type === "objet") texte += ` ${t(interaction, "boutique.achete_objet")}`
    return texte
}

// Retrouve un article par son numéro (valeur de l'autocomplétion) ou par son nom
function trouverArticle(guildId, texte) {
    const valeur = String(texte ?? "").trim()
    if (!valeur) return null
    if (/^\d{1,9}$/.test(valeur)) return boutique.lireArticle(guildId, Number(valeur))
    return boutique.articles(guildId).find(a => a.nom.toLowerCase() === valeur.toLowerCase()) ?? null
}

// Menu de la vitrine : demande confirmation. Bouton de confirmation : achat.
async function onComposant(bot, interaction) {
    const [, action, texteId] = interaction.customId.split(":")
    const guildId = interaction.guildId
    if (interaction.isAnySelectMenu() && action === "choisir") {
        const a = boutique.lireArticle(guildId, Number(interaction.values[0]))
        if (!a) return refuser(interaction, texteRefus(interaction, "inconnu"))
        const bouton = new Discord.ButtonBuilder().setCustomId(`boutique:ok:${a.id}`).setStyle(Discord.ButtonStyle.Success)
            .setLabel(t(interaction, "boutique.confirmer_bouton"))
        return interaction.reply({
            content: t(interaction, "boutique.confirmer", { nom: Discord.escapeMarkdown(a.nom), prix: eco.formater(guildId, a.prix) }),
            components: [new Discord.ActionRowBuilder().addComponents(bouton)], flags: EPHEMERAL
        })
    }
    if (interaction.isButton() && action === "ok" && /^\d{1,9}$/.test(texteId ?? "")) {
        await interaction.deferUpdate()
        return interaction.editReply({ content: await achat(interaction, Number(texteId)), components: [] })
    }
}

async function administrer(bot, interaction, args, action) {
    const guild = interaction.guild
    // Revérifié ici : un admin peut ouvrir la commande à d'autres rôles dans Paramètres > Intégrations
    if (!interaction.memberPermissions?.has(Flags.ManageGuild)) return refuser(interaction, t(interaction, "commun.permission"))
    const guildId = guild.id

    if (action === "ajouter") {
        const type = args.getString("type")
        if (!type) return refuser(interaction, texteRefus(interaction, "type_manquant"))
        const role = args.getRole("role")
        if (type !== "objet" && !role) return refuser(interaction, texteRefus(interaction, "role_manquant"))
        if (type === "objet" && !args.getString("objet")) return refuser(interaction, texteRefus(interaction, "objet_manquant"))
        let dureeS = null
        if (type === "role_temp") {
            const texte = args.getString("duree")
            if (!texte) return refuser(interaction, texteRefus(interaction, "duree"))
            const { duree, erreur } = parseDuree(texte, { min: boutique.DUREE_MIN * 1000, max: boutique.DUREE_MAX * 1000, cible: interaction })
            if (erreur) return refuser(interaction, t(interaction, "boutique.duree_erreur", { erreur }))
            dureeS = Math.round(duree / 1000)
        }
        const r = boutique.ajouterArticle(guild, interaction.member, {
            type, role, dureeS, objet: args.getString("objet"), nom: args.getString("nom"), prix: args.getInteger("prix"), stock: args.getInteger("stock")
        })
        if (!r.ok) return refuser(interaction, texteRefus(interaction, r.refus, { roleId: role?.id }))
        const a = r.article
        await interaction.reply({
            content: t(interaction, "boutique.ajoute", { id: a.id, nom: Discord.escapeMarkdown(a.nom), prix: eco.formater(guildId, a.prix), jours: texteJours(interaction, a.prix) }),
            flags: EPHEMERAL
        })
        return sendModLog(interaction, { action: "config", details: `Boutique : article n°${a.id} ajouté (${a.type}, ${a.nom}, ${a.prix})` })
    }

    const a = trouverArticle(guildId, args.getString("article"))
    if (!a) return refuser(interaction, texteRefus(interaction, args.getString("article") ? "inconnu" : "article_manquant"))

    if (action === "retirer") {
        boutique.retirerArticle(guildId, a.id)
        await interaction.reply({ content: t(interaction, "boutique.retire", { id: a.id, nom: Discord.escapeMarkdown(a.nom) }), flags: EPHEMERAL })
        return sendModLog(interaction, { action: "config", details: `Boutique : article n°${a.id} retiré (${a.nom})` })
    }

    // modifier : un stock donné remplace l'ancien, « illimite » le supprime
    const changements = {}
    const nom = args.getString("nom"), prix = args.getInteger("prix"), stock = args.getInteger("stock")
    if (nom !== null) changements.nom = nom
    if (prix !== null) changements.prix = prix
    if (args.getBoolean("illimite")) changements.stock = null
    else if (stock !== null) changements.stock = stock
    const r = boutique.modifierArticle(guildId, a.id, changements)
    if (!r.ok) return refuser(interaction, texteRefus(interaction, r.refus))
    await interaction.reply({
        content: t(interaction, "boutique.modifie", { id: a.id, nom: Discord.escapeMarkdown(r.article.nom), prix: eco.formater(guildId, r.article.prix), jours: texteJours(interaction, r.article.prix) }),
        flags: EPHEMERAL
    })
    return sendModLog(interaction, { action: "config", details: `Boutique : article n°${a.id} modifié (${JSON.stringify(changements)})` })
}

async function autocompleter(bot, interaction) {
    const focus = interaction.options.getFocused(true)
    const saisie = String(focus.value).toLowerCase()
    let propositions = []
    if (focus.name === "article") {
        propositions = boutique.articles(interaction.guildId)
            .filter(a => !saisie || a.nom.toLowerCase().includes(saisie) || String(a.id) === saisie)
            .map(a => ({ name: `n°${a.id} ${a.nom} (${a.prix})`.slice(0, 100), value: String(a.id) }))
    } else if (focus.name === "objet") {
        propositions = inventaire.objets().filter(o => o.vendable)
            .map(o => ({ name: inventaire.nomObjet(o.id, interaction), value: o.id }))
            .filter(p => !saisie || p.name.toLowerCase().includes(saisie))
    }
    return interaction.respond(propositions.slice(0, 25))
}

module.exports = {
    name: "boutique",
    description: "Boutique du serveur : voir, acheter, et gérer les articles (admin)",
    permission: "Aucune",
    dm: false,
    cooldown: 3,
    category: "Économie",
    // Menu d'achat et bouton de confirmation : publics, l'achat revérifie tout (module, solde, rôle)
    composants: [{ prefixe: "boutique:", types: ["menu", "bouton"], public: true, cooldown: 2, gestionnaire: onComposant }],
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Voir la boutique", value: "voir" },
                { name: "Acheter un article", value: "acheter" },
                { name: "Ajouter un article (admin)", value: "ajouter" },
                { name: "Retirer un article (admin)", value: "retirer" },
                { name: "Modifier un article (admin)", value: "modifier" }
            ]
        }, {
            type: "string",
            name: "article",
            description: "L'article (acheter, retirer, modifier)",
            required: false,
            autocomplete: true,
            maxLength: 60
        }, {
            type: "string",
            name: "type",
            description: "Type d'article (ajouter)",
            required: false,
            choices: [
                { name: "Rôle permanent", value: "role" },
                { name: "Rôle temporaire", value: "role_temp" },
                { name: "Couleur (rôle de couleur sans permission)", value: "couleur" },
                { name: "Objet du catalogue", value: "objet" }
            ]
        }, {
            type: "role",
            name: "role",
            description: "Le rôle vendu (rôle, rôle temporaire, couleur)",
            required: false
        }, {
            type: "string",
            name: "objet",
            description: "L'objet vendu (type objet)",
            required: false,
            autocomplete: true,
            maxLength: 40
        }, {
            type: "string",
            name: "duree",
            description: "Durée du rôle temporaire (1h à 90d, ex : 7d)",
            required: false,
            maxLength: 10
        }, {
            type: "string",
            name: "nom",
            description: "Nom affiché de l'article (50 caractères au plus)",
            required: false,
            maxLength: 50
        }, {
            type: "integer",
            name: "prix",
            description: "Prix en monnaie du serveur (1 à 1 000 000)",
            required: false,
            minValue: 1,
            maxValue: 1000000
        }, {
            type: "integer",
            name: "stock",
            description: "Stock limité (vide : illimité ; 0 : épuisé en modifiant)",
            required: false,
            minValue: 0,
            maxValue: 1000000
        }, {
            type: "boolean",
            name: "illimite",
            description: "Modifier : supprimer la limite de stock",
            required: false
        }
    ],

    async run(bot, interaction, args) {
        const action = args.getString("action")
        if (ACTIONS_ADMIN.includes(action)) return administrer(bot, interaction, args, action)

        if (action === "voir") return interaction.reply({ ...vitrine(interaction), flags: EPHEMERAL })

        // acheter
        const a = trouverArticle(interaction.guildId, args.getString("article"))
        if (!a) return refuser(interaction, texteRefus(interaction, args.getString("article") ? "inconnu" : "article_manquant"))
        await interaction.deferReply({ flags: EPHEMERAL })
        return interaction.editReply(await achat(interaction, a.id))
    },

    autocomplete: autocompleter
}
