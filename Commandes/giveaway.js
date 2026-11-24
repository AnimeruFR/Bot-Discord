const Discord = require('discord.js')
const db = require('../Fonctions/db')
const { sendModLog } = require('../Fonctions/logs')
const { parseDuree } = require('../Fonctions/moderation')
const giveaways = require('../Fonctions/giveaways')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral
const MAX_EN_COURS = 10
const DUREE_MAX = 30 * 24 * 60 * 60 * 1000

module.exports = {
    name: "giveaway",
    description: "Giveaways : lancer, terminer, relancer un tirage",
    permission: Discord.PermissionFlagsBits.ManageGuild,
    dm: false,
    category: "Engagement",
    options: [
        {
            type: "string",
            name: "action",
            description: "Que faire ?",
            required: true,
            choices: [
                { name: "Voir les giveaways", value: "liste" },
                { name: "Lancer un giveaway", value: "lancer" },
                { name: "Terminer maintenant", value: "terminer" },
                { name: "Relancer le tirage (nouveaux gagnants)", value: "relancer" },
                { name: "Annuler (sans tirage)", value: "annuler" }
            ]
        }, {
            type: "string",
            name: "prix",
            description: "Ce qu'on gagne",
            required: false,
            maxLength: 200
        }, {
            type: "string",
            name: "duree",
            description: "Durée (ex : 1h, 2d ; 30 jours maximum)",
            required: false,
            maxLength: 20
        }, {
            type: "integer",
            name: "gagnants",
            description: "Nombre de gagnants (1 par défaut)",
            required: false,
            minValue: 1,
            maxValue: 20
        }, {
            type: "integer",
            name: "numero",
            description: "Numéro du giveaway (terminer, relancer, annuler)",
            required: false,
            minValue: 1
        }, {
            type: "channel",
            name: "salon",
            description: "Salon du giveaway (par défaut : celui-ci)",
            required: false,
            channelTypes: [Discord.ChannelType.GuildText, Discord.ChannelType.GuildAnnouncement]
        }
    ],

    async run(bot, message, args) {
        const guild = message.guild
        const action = args.getString("action")

        if (action === "liste") {
            const lignes = db.listGiveaways(guild.id).map(g => `• n°${g.id} – **${Discord.escapeMarkdown(g.prix)}** dans <#${g.channel_id}> – `
                + (g.status === "en_cours" ? `fin <t:${Math.floor(g.ends_at / 1000)}:R>, ${db.countEntries(g.id)} participant(s)` : "terminé"))
            return message.reply({ content: lignes.length ? lignes.join("\n") : "Aucun giveaway.", flags: EPHEMERAL })
        }

        if (action === "lancer") {
            const prix = args.getString("prix")?.trim()
            if (!prix) return message.reply({ content: "Précise le prix (option `prix`).", flags: EPHEMERAL })
            const { duree, erreur } = parseDuree(args.getString("duree") ?? "", { max: DUREE_MAX })
            if (erreur) return message.reply({ content: `Option \`duree\` : ${erreur}`, flags: EPHEMERAL })
            const channel = args.getChannel("salon") ?? message.channel
            if (!channel.permissionsFor(guild.members.me)?.has([Flags.ViewChannel, Flags.SendMessages, Flags.EmbedLinks])) {
                return message.reply({ content: `Je ne peux pas écrire dans ${channel}.`, flags: EPHEMERAL })
            }
            if (!channel.permissionsFor(message.member)?.has([Flags.ViewChannel, Flags.SendMessages])) {
                return message.reply({ content: `Vous ne pouvez pas écrire dans ${channel}.`, flags: EPHEMERAL })
            }
            // Comptage et insertion sans "await" entre les deux : deux commandes simultanées ne dépassent pas la limite
            if (db.countActiveGiveaways(guild.id) >= MAX_EN_COURS) return message.reply({ content: `${MAX_EN_COURS} giveaways en cours au maximum.`, flags: EPHEMERAL })
            const id = db.addGiveaway(guild.id, { channelId: channel.id, prix, gagnants: args.getInteger("gagnants") ?? 1, endsAt: Date.now() + duree, hostId: message.user.id })

            try {
                const envoye = await channel.send(giveaways.contenuGiveaway(db.getGiveaway(guild.id, id), { guild }))
                db.setGiveawayMessage(id, envoye.id)
            } catch (err) {
                db.deleteGiveaway(id) // pas de message : pas de giveaway fantôme
                throw err
            }
            await message.reply({ content: `Giveaway n°${id} lancé dans ${channel}.`, flags: EPHEMERAL })
            return sendModLog(message, { action: "giveaway", details: `Giveaway n°${id} lancé dans ${channel} : ${prix}` })
        }

        const g = db.getGiveaway(guild.id, args.getInteger("numero") ?? 0)
        if (!g) return message.reply({ content: "Numéro de giveaway inconnu (voir `/giveaway action:Voir`).", flags: EPHEMERAL })
        await message.deferReply({ flags: EPHEMERAL })

        if (action === "terminer") {
            if (g.status !== "en_cours") return message.editReply("Ce giveaway est déjà terminé.")
            if (!await giveaways.terminer(bot, g)) return message.editReply("Le tirage n'a pas pu être fait maintenant (déjà en cours ou serveur indisponible). Réessaie dans un instant.")
            return message.editReply(`Giveaway n°${g.id} terminé, résultat publié dans <#${g.channel_id}>.`)
        }
        if (action === "relancer") {
            if (g.status !== "termine") return message.editReply("On ne peut relancer qu'un giveaway terminé.")
            const gagnants = await giveaways.relancer(bot, g)
            await sendModLog(message, { action: "giveaway", details: `Nouveau tirage du giveaway n°${g.id}` })
            if (gagnants === null) return message.editReply("Nouveau tirage impossible pour le moment, réessaie dans un instant.")
            return message.editReply(gagnants.length ? "Nouveau tirage publié." : "Plus aucun participant disponible : rien n'a été changé.")
        }
        // annuler
        if (g.status !== "en_cours") return message.editReply("Ce giveaway est déjà terminé.")
        db.deleteGiveaway(g.id)
        const channel = guild.channels.cache.get(g.channel_id)
        if (channel && g.message_id) await channel.messages.delete(g.message_id).catch(() => {})
        await sendModLog(message, { action: "giveaway", details: `Giveaway n°${g.id} annulé (${g.prix})` })
        return message.editReply(`Giveaway n°${g.id} annulé, participations effacées.`)
    }
}
