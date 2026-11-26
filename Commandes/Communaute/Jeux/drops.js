const Discord = require('discord.js')
const drops = require('../../../Fonctions/drops')
const { refuser } = require('../../../Fonctions/erreurs')
const { t } = require('../../../Fonctions/i18n')

const { Flags } = Discord.PermissionsBitField
const TYPES_SALON = [Discord.ChannelType.GuildText, Discord.ChannelType.GuildAnnouncement]
const optionSalon = (name, description) => ({ type: "channel", name, description, required: false, channelTypes: TYPES_SALON })

// Configuration des drops (idée #72) : salons où un coffre peut apparaître dans la conversation.
module.exports = {
    name: "drops",
    description: "Choisir les salons où des coffres apparaissent dans la conversation",
    permission: Discord.PermissionFlagsBits.ManageGuild,
    dm: false,
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Choisir les salons", value: "salons" },
                { name: "Voir la configuration", value: "voir" }
            ]
        },
        optionSalon("salon", "Salon où les coffres peuvent apparaître (aucun salon : drops désactivés)"),
        optionSalon("salon2", "Deuxième salon (facultatif)"),
        optionSalon("salon3", "Troisième salon (facultatif)")
    ],

    async run(bot, interaction, options) {
        const guild = interaction.guild
        if (options.getString("action") === "voir") {
            const salons = drops.salonsDrops(guild.id)
            const texte = salons.length
                ? t(interaction, "duels.drops.voir", { salons: salons.map(id => `<#${id}>`).join(", "), min: drops.GAIN_MIN, max: drops.GAIN_MAX })
                : t(interaction, "duels.drops.voir_aucun")
            return interaction.reply({ content: texte, flags: Discord.MessageFlags.Ephemeral })
        }

        const choisis = ["salon", "salon2", "salon3"].map(nom => options.getChannel(nom)).filter(Boolean)
        // Le bot doit pouvoir écrire dans chaque salon, sinon le coffre n'apparaîtrait jamais
        for (const salon of choisis) {
            if (!salon.permissionsFor(guild.members.me)?.has([Flags.ViewChannel, Flags.SendMessages])) {
                return refuser(interaction, t(interaction, "duels.drops.salon_bot", { salon }))
            }
        }
        drops.definirSalonsDrops(guild.id, choisis.map(salon => salon.id))
        const texte = choisis.length
            ? t(interaction, "duels.drops.salons_ok", { salons: choisis.map(salon => `${salon}`).join(", ") })
            : t(interaction, "duels.drops.salons_aucun")
        return interaction.reply({ content: texte, flags: Discord.MessageFlags.Ephemeral })
    }
}
