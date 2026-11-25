const Discord = require('discord.js')
const { t } = require('../Fonctions/i18n')
const { couleur } = require('../Fonctions/apparence')
const { lienInvitation, lienValide } = require('../Fonctions/invitation')
const { version } = require('../package.json')

// Durée de fonctionnement lisible (ex : "3 j 4 h")
function dureeCourte(ms) {
    const j = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24, m = Math.floor(ms / 60000) % 60
    return j ? `${j} j ${h} h` : h ? `${h} h ${m} min` : `${m} min`
}

module.exports = {
    name: "about",
    description: "Informations sur le bot (serveurs, version, liens)",
    permission: "Aucune",
    dm: true,
    category: "Information",
    options: [],
    dureeCourte,

    async run(bot, message) {
        const embed = new Discord.EmbedBuilder()
            .setColor(couleur(message.guild))
            .setTitle(t(message, "crois.about_titre", { nom: bot.user.username }))
            .setThumbnail(bot.user.displayAvatarURL())
            .setDescription(t(message, "crois.about_description"))
            .addFields(
                // Avec plusieurs shards, ce processus ne voit que ses serveurs : on additionne ceux de tous les shards
                { name: t(message, "crois.serveurs"), value: String(bot.shard ? (await bot.shard.fetchClientValues("guilds.cache.size")).reduce((a, b) => a + b, 0) : bot.guilds.cache.size), inline: true },
                { name: t(message, "crois.version"), value: version, inline: true },
                { name: t(message, "crois.en_ligne"), value: dureeCourte(bot.uptime ?? 0), inline: true },
                { name: t(message, "crois.commandes"), value: String(bot.commands.size), inline: true }
            )

        // Seuls des liens https venant du .env : jamais de lien construit depuis une interaction
        const liens = [[t(message, "crois.bouton_inviter"), lienInvitation(bot.user.id)]]
        for (const [cle, variable] of [["crois.bouton_support", "SUPPORT_URL"], ["crois.bouton_confidentialite", "PRIVACY_URL"], ["crois.bouton_conditions", "TERMS_URL"]]) {
            const url = lienValide(process.env[variable])
            if (url) liens.push([t(message, cle), url])
        }
        const boutons = liens.map(([label, url]) => new Discord.ButtonBuilder().setStyle(Discord.ButtonStyle.Link).setLabel(label).setURL(url))

        await message.reply({ embeds: [embed], components: [new Discord.ActionRowBuilder().addComponents(boutons)], flags: Discord.MessageFlags.Ephemeral })
    }
}
