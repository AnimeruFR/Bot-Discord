const Discord = require('discord.js')
const { refuser } = require('../../Fonctions/erreurs')
const { sendModLog } = require('../../Fonctions/logs')
const { t } = require('../../Fonctions/i18n')
const { lireFiltre, activerFiltre, desactiverFiltre, ajouterMot, retirerMot, MAX_MOTS, MAX_LONGUEUR_MOT } = require('../../Fonctions/pseudos')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral

module.exports = {
    name: "pseudos",
    description: "Filtre de pseudos : caractères qui placent en haut de la liste, zalgo, mots interdits",
    // Base : « Gérer les pseudos » (désactiver, voir la liste). Activer et changer les mots demandent aussi « Gérer le serveur ».
    permission: Discord.PermissionFlagsBits.ManageNicknames,
    dm: false,
    category: "Configuration",
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Activer le filtre", value: "activer" },
                { name: "Désactiver le filtre", value: "desactiver" },
                { name: "Ajouter un mot interdit", value: "ajouter" },
                { name: "Retirer un mot interdit", value: "retirer" },
                { name: "Voir les mots interdits", value: "liste" }
            ]
        }, {
            type: "string",
            name: "mot",
            description: "Le mot interdit (pour ajouter ou retirer)",
            required: false,
            maxLength: MAX_LONGUEUR_MOT
        }
    ],

    async run(bot, message, args) {
        const guild = message.guild
        const action = args.getString("action")

        // Le bot renomme des membres à la place de celui qui règle le filtre : activer et changer les mots demandent
        // « Gérer le serveur » en plus de « Gérer les pseudos » (revérifié ici, la garde commune ne regarde que la seconde)
        if (["activer", "ajouter", "retirer"].includes(action) && !message.memberPermissions?.has(Flags.ManageGuild)) {
            return refuser(message, t(message, "pseudo.config_guild"))
        }

        if (action === "activer") {
            if (!activerFiltre(guild.id, message.user.id)) return refuser(message, t(message, "pseudo.deja_actif"))
            await sendModLog(message, { action: "config", details: "Filtre de pseudos : activé" })
            const manque = guild.members.me?.permissions.has(Flags.ManageNicknames) ? "" : `\n${t(message, "pseudo.bot_perm")}`
            return message.reply({ content: t(message, "pseudo.active") + manque, flags: EPHEMERAL })
        }
        if (action === "desactiver") {
            if (!desactiverFiltre(guild.id)) return refuser(message, t(message, "pseudo.deja_inactif"))
            await sendModLog(message, { action: "config", details: "Filtre de pseudos : désactivé (liste des mots effacée)" })
            return message.reply({ content: t(message, "pseudo.desactive"), flags: EPHEMERAL })
        }

        const filtre = lireFiltre(guild.id)
        if (!filtre) return refuser(message, t(message, "pseudo.inactif"))

        if (action === "liste") {
            const mots = filtre.mots.length ? filtre.mots.map(m => `\`${m}\``).join(", ") : t(message, "pseudo.liste_vide")
            return message.reply({ content: `${t(message, "pseudo.liste_titre", { n: filtre.mots.length, max: MAX_MOTS })}\n${mots}`, flags: EPHEMERAL })
        }

        const mot = args.getString("mot")?.trim()
        if (!mot) return refuser(message, t(message, "pseudo.mot_requis"))
        if (action === "ajouter") {
            const r = ajouterMot(guild.id, mot, message.user.id)
            if (r !== "ok") return refuser(message, t(message, `pseudo.refus_${r}`, { max: MAX_MOTS, longueur: MAX_LONGUEUR_MOT }))
            await sendModLog(message, { action: "config", details: `Filtre de pseudos : mot interdit ajouté (\`${mot.replace(/`/g, "")}\`)` })
            return message.reply({ content: t(message, "pseudo.ajoute", { mot: mot.replace(/`/g, "") }), flags: EPHEMERAL })
        }
        const r = retirerMot(guild.id, mot)
        if (r !== "ok") return refuser(message, t(message, `pseudo.refus_${r}`))
        await sendModLog(message, { action: "config", details: `Filtre de pseudos : mot interdit retiré (\`${mot.replace(/`/g, "")}\`)` })
        return message.reply({ content: t(message, "pseudo.retire", { mot: mot.replace(/`/g, "") }), flags: EPHEMERAL })
    }
}
