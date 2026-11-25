const Discord = require('discord.js')
const db = require('./db')
const { t } = require('./i18n')
const { couleur } = require('./apparence')
const { fetchMember, formatReason } = require('./moderation')
const { refuser } = require('./erreurs')
const { ligneSanction } = require('./cases')
const { listerNotes, compterNotes } = require('./notes')
const { listerAppelsMembre, compterAppels } = require('./appels')

// Dossier membre unifié : /dossier (et /historique, qui l'ouvre sur les sanctions) affichent en éphémère
// un résumé, puis les sanctions, les notes du staff et les appels, page par page (boutons Précédent / Suivant).
//
// Règles de confidentialité (S6) :
//   - on ne consulte jamais son propre dossier : les notes du staff sur soi ne sont pas faites pour être lues ;
//   - les notes (texte et nombre) ne sont montrées que si le membre consulté n'a pas un rôle plus haut ou égal à celui
//     de la personne qui consulte, sauf si elle peut gérer le serveur (ou en est propriétaire). Le reste du dossier
//     (sanctions, tickets, appels) reste visible : c'est le travail normal du staff.

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const PAR_PAGE = 5
const MAX_SANCTIONS = 50
const MAX_NOTES = 50
const MAX_APPELS = 20
const DELAI = 5 * 60 * 1000

// Refus éventuel (texte traduit) : un membre ne consulte pas son propre dossier
function refusDossier(interaction, user) {
    return user.id === interaction.user.id ? t(interaction, "dossier.soi") : null
}

// Le consultant peut-il lire les notes sur ce membre ? membre : GuildMember de la cible, null si elle a quitté le serveur.
function notesVisibles(interaction, membre) {
    if (interaction.memberPermissions?.has(Discord.PermissionFlagsBits.ManageGuild)) return true
    if (interaction.user.id === interaction.guild.ownerId) return true
    if (!membre) return true
    return membre.roles.highest.comparePositionTo(interaction.member.roles.highest) < 0
}

const quand = (ms, style = "R") => ms ? `<t:${Math.floor(ms / 1000)}:${style}>` : "?"
const decouper = (liste, taille) => Array.from({ length: Math.ceil(liste.length / taille) }, (_, i) => liste.slice(i * taille, (i + 1) * taille))

function statsTickets(guildId, userId) {
    const l = db.sqlAll("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'ouvert' THEN 1 ELSE 0 END), 0) AS ouverts FROM tickets WHERE guild_id = ? AND owner_id = ?", [guildId, userId])[0]
    return { total: l.total, ouverts: l.ouverts }
}

// Pages du dossier : { pages: [EmbedBuilder], debuts: { resume, sanctions?, notes?, appels? } } (numéros de page de chaque section)
function construirePages(interaction, user, membre) {
    const guild = interaction.guild
    const guildId = guild.id
    const voirNotes = notesVisibles(interaction, membre)
    const nbNotes = compterNotes(guildId, user.id)
    const total = db.countCases(guildId, user.id)
    const actives = db.countActiveCases(guildId, user.id)
    const appels = compterAppels(guildId, user.id)
    const tickets = statsTickets(guildId, user.id)
    const tempban = db.getTempban(guildId, user.id)

    // Chaque page : { titre, texte, pied? }
    const brutes = []
    const debuts = { resume: 0 }
    const resume = [
        t(interaction, "dossier.resume", {
            creation: quand(user.createdTimestamp), arrivee: membre ? quand(membre.joinedTimestamp) : t(interaction, "dossier.absent"),
            warns: db.countWarns(guildId, user.id), actives, annulees: total - actives,
            notes: voirNotes ? t(interaction, "dossier.notes_nb", { notes: nbNotes }) : t(interaction, "dossier.notes_masquees"),
            ouverts: tickets.ouverts, tickets: tickets.total, appels: appels.total, attente: appels.attente
        })
    ]
    if (tempban) resume.push(t(interaction, "mod.historique.tempban_en_cours", { fin: Math.floor(tempban / 1000) }))
    brutes.push({ titre: "dossier.titre_resume", texte: resume.join("\n") })

    if (total > 0) {
        debuts.sanctions = brutes.length
        const lignes = db.listCases(guildId, user.id, MAX_SANCTIONS).map(c => ligneSanction(interaction, c))
        decouper(lignes, PAR_PAGE).forEach((groupe, i) => {
            const entete = []
            if (i === 0) {
                if (tempban) entete.push(t(interaction, "mod.historique.tempban_en_cours", { fin: Math.floor(tempban / 1000) }))
                if (voirNotes && nbNotes > 0) entete.push(t(interaction, "dos.historique.notes", { notes: nbNotes }))
            }
            brutes.push({ titre: "dossier.titre_sanctions", texte: [...entete, ...groupe].join("\n\n"), plus: total > MAX_SANCTIONS ? total : 0 })
        })
    }

    if (voirNotes && nbNotes > 0) {
        debuts.notes = brutes.length
        const lignes = listerNotes(guildId, user.id, MAX_NOTES).map(n =>
            t(interaction, "dos.note.ligne", { id: n.id, date: Math.floor(n.created_at / 1000), auteur: n.author_id, texte: formatReason(n.content).slice(0, 300) }))
        for (const groupe of decouper(lignes, PAR_PAGE)) brutes.push({ titre: "dossier.titre_notes", texte: groupe.join("\n\n") })
    }

    if (appels.total > 0) {
        debuts.appels = brutes.length
        const lignes = listerAppelsMembre(guildId, user.id, MAX_APPELS).map(a => t(interaction, "dossier.appel_ligne", {
            id: a.id, sanction: a.case_id, date: Math.floor(a.created_at / 1000), statut: t(interaction, `appel.statut.${a.status}`), texte: formatReason(a.content).replace(/\s+/g, " ").slice(0, 200)
        }))
        for (const groupe of decouper(lignes, PAR_PAGE)) brutes.push({ titre: "dossier.titre_appels", texte: groupe.join("\n\n") })
    }

    const pages = brutes.map((p, i) => {
        const embed = new Discord.EmbedBuilder()
            .setColor(couleur(guild))
            .setTitle(t(interaction, p.titre, { user: user.tag }))
            .setDescription(p.texte.slice(0, 4096))
            .setFooter({ text: t(interaction, p.plus ? "dossier.pied_plus" : "dossier.pied", { page: i + 1, pages: brutes.length, total: p.plus, max: MAX_SANCTIONS }) })
        if (i === 0 && user.displayAvatarURL) embed.setThumbnail(user.displayAvatarURL())
        return embed
    })
    return { pages, debuts }
}

// Une page et ses boutons (désactivés une fois le temps écoulé). Un seul bouton à afficher : pas de ligne de boutons.
function rendre(interaction, pages, i, fin = false) {
    const message = { embeds: [pages[i]], components: [] }
    if (pages.length > 1) {
        message.components = [new Discord.ActionRowBuilder().addComponents(
            new Discord.ButtonBuilder().setCustomId(`dossier-prec-${interaction.id}`).setLabel(t(interaction, "dossier.precedent")).setStyle(Discord.ButtonStyle.Secondary).setDisabled(fin || i === 0),
            new Discord.ButtonBuilder().setCustomId(`dossier-suiv-${interaction.id}`).setLabel(t(interaction, "dossier.suivant")).setStyle(Discord.ButtonStyle.Secondary).setDisabled(fin || i === pages.length - 1)
        )]
    }
    return message
}

// Affiche le dossier. depart : section ouverte en premier ("resume", "sanctions", "notes", "appels").
async function afficherDossier(interaction, user, { depart = "resume" } = {}) {
    const refus = refusDossier(interaction, user)
    if (refus) return refuser(interaction, refus)

    // Réponse différée : relire le membre auprès de Discord peut dépasser les 3 s permises
    await interaction.deferReply({ flags: EPHEMERAL })
    const membre = await fetchMember(interaction.guild, user.id)
    const { pages, debuts } = construirePages(interaction, user, membre)
    let i = debuts[depart] ?? 0
    const message = await interaction.editReply(rendre(interaction, pages, i))
    if (pages.length < 2 || typeof message?.createMessageComponentCollector !== "function") return

    // Seul l'auteur de la commande navigue (la réponse est de toute façon éphémère)
    const collecteur = message.createMessageComponentCollector({
        componentType: Discord.ComponentType.Button, time: DELAI,
        filter: clic => clic.user.id === interaction.user.id && clic.customId.endsWith(interaction.id)
    })
    collecteur.on("collect", async clic => {
        i = clic.customId.startsWith("dossier-suiv") ? Math.min(i + 1, pages.length - 1) : Math.max(i - 1, 0)
        await clic.update(rendre(interaction, pages, i)).catch(() => {})
    })
    collecteur.on("end", () => interaction.editReply(rendre(interaction, pages, i, true)).catch(() => {}))
}

module.exports = { refusDossier, notesVisibles, construirePages, rendre, afficherDossier }
