const Discord = require('discord.js')
const { couleur } = require('../../Fonctions/apparence')
const { t } = require('../../Fonctions/i18n')
const db = require('../../Fonctions/db')
const { compterNotes } = require('../../Fonctions/notes')
const { ligneSanction } = require('../../Fonctions/cases')

const AFFICHES = 10

module.exports = {
    name: "historique",
    description: "Affiche l'historique des sanctions d'un membre",
    permission: Discord.PermissionFlagsBits.ModerateMembers,
    // Le rôle staff du serveur (/config) suffit : aucune action avec les pouvoirs propres du bot
    roleStaffSuffit: true,
    dm: false,
    category: "Modération",
    options: [
        {
            type: "user",
            name: "membre",
            description: "Le membre dont on veut voir l'historique",
            required: true
        }
    ],

    async run(bot, message, args) {
        const user = args.getUser("membre")
        const total = db.countCases(message.guild.id, user.id)
        // Notes privées du staff : seulement leur nombre ici, le détail est dans /note
        const notes = compterNotes(message.guild.id, user.id)
        const mentionNotes = notes > 0 ? t(message, "dos.historique.notes", { notes }) : ""
        if (total === 0) return message.reply({ content: t(message, "mod.historique.aucune", { user }) + (mentionNotes && `\n${mentionNotes}`), flags: Discord.MessageFlags.Ephemeral })

        const tempban = db.getTempban(message.guild.id, user.id)
        const lignes = db.listCases(message.guild.id, user.id, AFFICHES).map(c => ligneSanction(message, c))
        if (mentionNotes) lignes.unshift(mentionNotes)
        if (tempban) lignes.unshift(t(message, "mod.historique.tempban_en_cours", { fin: Math.floor(tempban / 1000) }))

        const embed = new Discord.EmbedBuilder()
            .setColor(couleur(message.guild))
            .setTitle(t(message, "mod.historique.titre", { user: user.tag }))
            .setThumbnail(user.displayAvatarURL())
            .setDescription(lignes.join("\n\n").slice(0, 4096))
            .setFooter({ text: t(message, total > AFFICHES ? "mod.historique.pied_plus" : "mod.historique.pied", { total, affiches: AFFICHES }) })

        await message.reply({ embeds: [embed], flags: Discord.MessageFlags.Ephemeral })
    }
}
