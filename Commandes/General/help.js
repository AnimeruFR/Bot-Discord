const Discord = require('discord.js')
const { couleur } = require('../../Fonctions/apparence')
const { t, langueDe, traductionsCommande } = require('../../Fonctions/i18n')
const { estStaff } = require('../../Fonctions/staff')
const { motifIndisponible } = require('../../Fonctions/modules')

// Description d'une commande dans la langue de la personne
const description = (command, langue) => langue === "en" ? traductionsCommande(command.name)?.description ?? command.description : command.description

// Nom du groupe affiché : module, ou « Communauté › sous-module »
const groupe = (command, langue) => command.module === "communaute" && command.sousModule
    ? t(langue, "modules.nom_sous", { sous: t(langue, `modules.sous_${command.sousModule}`) })
    : t(langue, `modules.nom_${command.module}`)

// Commandes que CE membre peut voir (idée #95) : jamais celles du staff pour un membre normal,
// jamais celles d'un module désactivé ou coupé. Sert aussi à l'autocomplétion.
function commandesVisibles(bot, interaction) {
    const staff = estStaff(interaction)
    return [...bot.commands.values()].filter(c =>
        (c.module !== "moderation" || staff) && !motifIndisponible(interaction.guildId, c))
}

// Ordre d'affichage : Général, Communauté (par sous-module), Modération en dernier
const ORDRE = { general: 0, communaute: 1, moderation: 2 }

module.exports = {
    name: "help",
    description: "Affiche les commandes avec leurs informations",
    permission: "Aucune",
    dm: true,
    category: "Information",
    options: [
        {
            type: "string",
            name: "commande",
            description: "Commande à afficher",
            required: false,
            autocomplete: true
        }
    ],
    commandesVisibles,

    async run(bot, message, args) {
        const langue = langueDe(message)
        const visibles = commandesVisibles(bot, message)
        const nom = args.getString("commande")
        // Une commande cachée à ce membre est traitée comme inconnue (on ne confirme pas qu'elle existe)
        const command = nom ? visibles.find(c => c.name === nom) : null
        if (nom && !command) return message.reply({ content: t(langue, "help.inconnue"), flags: Discord.MessageFlags.Ephemeral })

        const embed = new Discord.EmbedBuilder()
            .setColor(couleur(message.guild))
            .setThumbnail(bot.user.displayAvatarURL())
            .setTimestamp()
            .setFooter({ text: t(langue, "help.pied") })

        if (!command) {
            embed.setTitle(t(langue, "help.titre")).setDescription(t(langue, "help.description", { commandes: visibles.length }))
            const tri = [...visibles].sort((a, b) => ORDRE[a.module] - ORDRE[b.module]
                || (a.sousModule ?? "").localeCompare(b.sousModule ?? "") || a.name.localeCompare(b.name))
            const groupes = new Map()
            for (const c of tri) {
                const g = groupe(c, langue)
                if (!groupes.has(g)) groupes.set(g, [])
                groupes.get(g).push(c)
            }
            for (const [nomGroupe, commandes] of [...groupes].slice(0, 25)) {
                let valeur = ""
                for (const c of commandes) {
                    const ligne = `\`${c.name}\` : ${description(c, langue)}`
                    if (valeur.length + ligne.length + 1 > 1024) break // limite d'un champ d'embed : on ne coupe pas une ligne
                    valeur += (valeur ? "\n" : "") + ligne
                }
                embed.addFields({ name: nomGroupe, value: valeur || "—" })
            }
        } else {
            const permission = typeof command.permission === "bigint"
                ? new Discord.PermissionsBitField(command.permission).toArray().join(", ")
                : t(langue, "help.aucune")
            embed.setTitle(t(langue, "help.commande_titre", { nom: command.name }))
                .setDescription(t(langue, "help.commande_detail", {
                    nom: command.name, description: description(command, langue), permission,
                    dm: t(langue, command.dm ? "help.oui" : "help.non"), categorie: groupe(command, langue)
                }))
        }
        await message.reply({ embeds: [embed], flags: Discord.MessageFlags.Ephemeral })
    }
}
