const Discord = require('discord.js')
const { couleur } = require('../../Fonctions/apparence')
const { t, langueDe, traductionsCommande } = require('../../Fonctions/i18n')
const { nomModule, cleDe } = require('../../Fonctions/modules')
const { commandesVisibles } = require('../../Fonctions/garde')

// Description d'une commande dans la langue de la personne
const description = (command, langue) => langue === "en" ? traductionsCommande(command.name)?.description ?? command.description : command.description

// Ordre d'affichage : Général, Communauté (par sous-module), Tickets, Modération en dernier
const ORDRE = { general: 0, communaute: 1, tickets: 2, moderation: 3 }

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

    async run(bot, message, args) {
        const langue = langueDe(message)
        // Seulement ce que ce membre peut utiliser : rien du staff pour un membre, rien d'un module désactivé
        const visibles = await commandesVisibles(bot, message)
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
                const g = nomModule(langue, cleDe(c))
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
                    dm: t(langue, command.dm ? "help.oui" : "help.non"), categorie: nomModule(langue, cleDe(command))
                }))
        }
        await message.reply({ embeds: [embed], flags: Discord.MessageFlags.Ephemeral })
    }
}
