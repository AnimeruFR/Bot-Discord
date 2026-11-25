const Discord = require('discord.js')
const { couleur } = require('../../Fonctions/apparence')
const { t, langueDe, traductionsCommande } = require('../../Fonctions/i18n')

// Description d'une commande dans la langue de la personne
const description = (command, langue) => langue === "en" ? traductionsCommande(command.name)?.description ?? command.description : command.description

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
        const nom = args.getString("commande")
        const command = nom ? bot.commands.get(nom) : null
        if (nom && !command) return message.reply({ content: t(langue, "help.inconnue"), flags: Discord.MessageFlags.Ephemeral })

        const embed = new Discord.EmbedBuilder()
            .setColor(couleur(message.guild))
            .setThumbnail(bot.user.displayAvatarURL())
            .setTimestamp()
            .setFooter({ text: t(langue, "help.pied") })

        if (!command) {
            const categories = [...new Set(bot.commands.map(c => c.category))].sort()
            embed.setTitle(t(langue, "help.titre"))
                .setDescription(t(langue, "help.description", { commandes: bot.commands.size, categories: categories.length }))
            for (const categorie of categories) {
                let valeur = ""
                for (const c of bot.commands.filter(c => c.category === categorie).values()) {
                    const ligne = `\`${c.name}\` : ${description(c, langue)}`
                    if (valeur.length + ligne.length + 1 > 1024) break // limite d'un champ d'embed : on ne coupe pas une ligne
                    valeur += (valeur ? "\n" : "") + ligne
                }
                embed.addFields({ name: categorie, value: valeur || "—" })
            }
        } else {
            const permission = typeof command.permission === "bigint"
                ? new Discord.PermissionsBitField(command.permission).toArray().join(", ")
                : t(langue, "help.aucune")
            embed.setTitle(t(langue, "help.commande_titre", { nom: command.name }))
                .setDescription(t(langue, "help.commande_detail", {
                    nom: command.name, description: description(command, langue), permission,
                    dm: t(langue, command.dm ? "help.oui" : "help.non"), categorie: command.category
                }))
        }
        await message.reply({ embeds: [embed], flags: Discord.MessageFlags.Ephemeral })
    }
}
