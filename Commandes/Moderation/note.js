const Discord = require('discord.js')
const { couleur } = require('../../Fonctions/apparence')
const { refuser } = require('../../Fonctions/erreurs')
const { formatReason } = require('../../Fonctions/moderation')
const { sendModLog } = require('../../Fonctions/logs')
const { t } = require('../../Fonctions/i18n')
const { LIMITE_NOTES, TAILLE_MAX, ajouterNote, listerNotes, compterNotes, lireNote, retirerNote } = require('../../Fonctions/notes')

const AFFICHEES = 10
const EPHEMERAL = Discord.MessageFlags.Ephemeral

module.exports = {
    name: "note",
    description: "Notes privées du staff sur un membre",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    // Le rôle staff du serveur (/config) suffit : aucune action avec les pouvoirs propres du bot
    roleStaffSuffit: true,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Ajouter une note", value: "ajouter" },
                { name: "Voir les notes", value: "liste" },
                { name: "Retirer une note", value: "retirer" }
            ]
        }, {
            type: "user",
            name: "membre",
            description: "Le membre concerné",
            required: true
        }, {
            type: "string",
            name: "texte",
            description: "Le texte de la note (pour ajouter)",
            required: false,
            maxLength: TAILLE_MAX
        }, {
            type: "integer",
            name: "numero",
            description: "Le numéro de la note (pour retirer)",
            required: false,
            minValue: 1
        }
    ],

    async run(bot, message, args) {
        const action = args.getString("action")
        const user = args.getUser("membre")
        const guildId = message.guild.id

        if (action === "ajouter") {
            const texte = args.getString("texte")?.trim()
            if (!texte) return refuser(message, t(message, "dos.note.texte_requis"))
            const id = ajouterNote(guildId, user.id, message.user.id, texte)
            if (id === null) return refuser(message, t(message, "dos.note.limite", { max: LIMITE_NOTES }))
            await message.reply({ content: t(message, "dos.note.ajoutee", { id, user, total: compterNotes(guildId, user.id), max: LIMITE_NOTES }), flags: EPHEMERAL })
            // Le texte de la note n'est jamais recopié dans les logs
            return sendModLog(message, { action: "note", cible: user, details: `Note n°${id} ajoutée` })
        }

        if (action === "retirer") {
            const id = args.getInteger("numero")
            if (!id) return refuser(message, t(message, "dos.note.numero_requis"))
            const note = lireNote(guildId, id)
            if (!note) return refuser(message, t(message, "dos.note.introuvable", { id }))
            // Seul l'auteur de la note, ou un membre qui gère le serveur, peut la retirer
            if (note.author_id !== message.user.id && !message.memberPermissions?.has(Discord.PermissionFlagsBits.ManageGuild)) {
                return refuser(message, t(message, "dos.note.pas_auteur"))
            }
            if (!retirerNote(guildId, id)) return refuser(message, t(message, "dos.note.introuvable", { id }))
            await message.reply({ content: t(message, "dos.note.retiree", { id }), flags: EPHEMERAL })
            return sendModLog(message, { action: "note", cible: { id: note.user_id, toString: () => `<@${note.user_id}>` }, details: `Note n°${id} retirée` })
        }

        // Liste : 300 caractères par note au plus, pour que 10 notes tiennent dans un embed (4096 caractères)
        const notes = listerNotes(guildId, user.id, AFFICHEES)
        if (notes.length === 0) return message.reply({ content: t(message, "dos.note.aucune", { user }), flags: EPHEMERAL })
        const total = compterNotes(guildId, user.id)
        const lignes = notes.map(n => t(message, "dos.note.ligne", { id: n.id, date: Math.floor(n.created_at / 1000), auteur: n.author_id, texte: formatReason(n.content).slice(0, 300) }))
        const embed = new Discord.EmbedBuilder()
            .setColor(couleur(message.guild))
            .setTitle(t(message, "dos.note.titre", { user: user.tag }))
            .setDescription(lignes.join("\n\n").slice(0, 4096))
            .setFooter({ text: t(message, total > AFFICHEES ? "dos.note.pied_plus" : "dos.note.pied", { total, affichees: AFFICHEES }) })
        await message.reply({ embeds: [embed], flags: EPHEMERAL })
    }
}
