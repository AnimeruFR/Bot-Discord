const Discord = require('discord.js')
const { t } = require('../Fonctions/i18n')
const { traiterErreur } = require('../Fonctions/erreurs')
const { verifierCommande } = require('../Fonctions/cooldowns')
const { verifierAcces } = require('../Fonctions/staff')
const { motifIndisponible, salonsRequis } = require('../Fonctions/modules')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const refuser = interaction => interaction.reply({ content: t(interaction, "commun.permission"), flags: EPHEMERAL })
const indisponible = (interaction, motif) => interaction.reply({ content: t(interaction, `modules.${motif}`), flags: EPHEMERAL })

module.exports = async (bot, interaction) => {
    try {
        if (interaction.isAutocomplete()) {
            const entry = interaction.options.getFocused().toLowerCase()
            const choices = bot.commands
                .filter(cmd => cmd.name.includes(entry))
                .first(25)
                .map(cmd => ({ name: cmd.name, value: cmd.name }))
            return await interaction.respond(choices)
        }

        if (interaction.isChatInputCommand()) {
            // On ne charge que les commandes connues (jamais un require construit depuis l'interaction)
            const command = bot.commands.get(interaction.commandName)
            if (!command) return

            // Module désactivé sur ce serveur (/config) ou coupé en urgence (DESACTIVER) : #87, #96
            const motif = motifIndisponible(interaction.guildId, command)
            if (motif) return await indisponible(interaction, motif)

            // Les permissions par défaut d'une slash commande peuvent être modifiées par un admin du serveur
            // (Paramètres > Intégrations) : on revérifie donc les droits réels du membre à chaque appel (garde staff, #1)
            if (!await verifierAcces(interaction, command)) return await refuser(interaction)

            // Jeux limités à certains salons (/config)
            const salons = salonsRequis(interaction.guildId, interaction.channelId, command)
            if (salons) {
                return await interaction.reply({ content: t(interaction, "modules.salons_jeux", { salons: salons.map(id => `<#${id}>`).join(", ") }), flags: EPHEMERAL })
            }

            // Délai entre deux utilisations (`cooldown` dans la commande), vérifié après les droits :
            // un membre refusé ne bloque pas son propre délai
            const restant = verifierCommande(command, interaction)
            if (restant > 0) {
                const fin = Math.ceil((Date.now() + restant) / 1000)
                return await interaction.reply({ content: t(interaction, "commun.cooldown", { quand: `<t:${fin}:R>` }), flags: EPHEMERAL })
            }

            return await command.run(bot, interaction, interaction.options)
        }

        // Boutons, menus et formulaires persistants : déclarés par les commandes (`composants`), routés par préfixe (#89).
        // Les boutons de confirmation, eux, sont attendus directement par la commande qui les a posés (awaitMessageComponent).
        await bot.routeur?.router(bot, interaction, refuser, indisponible)
    } catch (err) {
        // Erreur attendue (ErreurUtilisateur) : message clair ; sinon numéro d'incident montré au membre et écrit dans les logs
        await traiterErreur(interaction, err)
    }
}
