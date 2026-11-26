const Discord = require('discord.js')
const { refuser } = require('../../Fonctions/erreurs')
const { t } = require('../../Fonctions/i18n')
const { onClicVerification, configurer, poserPanneau, desactiver } = require('../../Fonctions/verification')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const P = Discord.PermissionFlagsBits

module.exports = {
    name: "verification",
    description: "Vérification des nouveaux membres par un défi en boutons",
    // Donner un rôle à tout nouveau membre : il faut gérer le serveur ET les rôles
    permission: P.ManageGuild | P.ManageRoles,
    dm: false,
    category: "Configuration",
    // Boutons du panneau et du défi : cliqués par les nouveaux membres, donc publics (le rôle est revérifié à chaque clic)
    composants: [{ prefixe: "verif:", types: ["bouton"], public: true, gestionnaire: onClicVerification }],
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Choisir le rôle des membres vérifiés", value: "config" },
                { name: "Poster le panneau de vérification", value: "panneau" },
                { name: "Désactiver la vérification", value: "desactiver" }
            ]
        }, {
            type: "role",
            name: "role",
            description: "Le rôle donné aux membres vérifiés (pour « Choisir le rôle »)",
            required: false
        }, {
            type: "channel",
            name: "salon",
            description: "Le salon du panneau",
            required: false,
            channelTypes: [Discord.ChannelType.GuildText]
        }
    ],

    async run(bot, message, args) {
        await message.deferReply({ flags: EPHEMERAL })
        const action = args.getString("action")
        const salon = args.getChannel("salon")

        if (action === "config") {
            const r = await configurer(message, args.getRole("role"), salon)
            if (r.erreur) return refuser(message, r.erreur)
            return message.editReply(t(message, "verif.config_ok", { role: args.getRole("role") }))
        }
        if (action === "panneau") {
            const r = await poserPanneau(message, salon)
            if (r.erreur) return refuser(message, r.erreur)
            return message.editReply(t(message, "verif.panneau_ok", { salon: r.salon }) + (r.salonInvisible ? `\n${t(message, "verif.salon_invisible")}` : ""))
        }
        const r = await desactiver(message)
        return message.editReply(t(message, r.inchange ? "verif.deja_desactive" : "verif.desactive"))
    }
}
