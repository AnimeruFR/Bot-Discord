const Discord = require('discord.js')
const db = require('../../../Fonctions/db')
const { sendModLog } = require('../../../Fonctions/logs')
const { parseDuree } = require('../../../Fonctions/moderation')
const giveaways = require('../../../Fonctions/giveaways')
const { t } = require('../../../Fonctions/i18n')

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
            const lignes = db.listGiveaways(guild.id).map(g => {
                const base = { id: g.id, prix: Discord.escapeMarkdown(g.prix), salon: g.channel_id }
                return g.status === "en_cours"
                    ? t(message, "eng.giveaway.ligne_en_cours", { ...base, fin: `<t:${Math.floor(g.ends_at / 1000)}:R>`, nombre: db.countEntries(g.id) })
                    : t(message, "eng.giveaway.ligne_termine", base)
            })
            return message.reply({ content: lignes.length ? lignes.join("\n") : t(message, "eng.giveaway.aucun"), flags: EPHEMERAL })
        }

        if (action === "lancer") {
            const prix = args.getString("prix")?.trim()
            if (!prix) return message.reply({ content: t(message, "eng.giveaway.prix_manquant"), flags: EPHEMERAL })
            const { duree, erreur } = parseDuree(args.getString("duree") ?? "", { max: DUREE_MAX, cible: message })
            if (erreur) return message.reply({ content: t(message, "eng.giveaway.duree_erreur", { erreur }), flags: EPHEMERAL })
            const channel = args.getChannel("salon") ?? message.channel
            if (!channel.permissionsFor(guild.members.me)?.has([Flags.ViewChannel, Flags.SendMessages, Flags.EmbedLinks])) {
                return message.reply({ content: t(message, "eng.giveaway.salon_bot", { salon: channel }), flags: EPHEMERAL })
            }
            if (!channel.permissionsFor(message.member)?.has([Flags.ViewChannel, Flags.SendMessages])) {
                return message.reply({ content: t(message, "eng.giveaway.salon_membre", { salon: channel }), flags: EPHEMERAL })
            }
            // Comptage et insertion sans "await" entre les deux : deux commandes simultanées ne dépassent pas la limite
            if (db.countActiveGiveaways(guild.id) >= MAX_EN_COURS) return message.reply({ content: t(message, "eng.giveaway.max", { max: MAX_EN_COURS }), flags: EPHEMERAL })
            const id = db.addGiveaway(guild.id, { channelId: channel.id, prix, gagnants: args.getInteger("gagnants") ?? 1, endsAt: Date.now() + duree, hostId: message.user.id })

            try {
                const envoye = await channel.send(giveaways.contenuGiveaway(db.getGiveaway(guild.id, id), { guild }))
                db.setGiveawayMessage(id, envoye.id)
            } catch (err) {
                db.deleteGiveaway(id) // pas de message : pas de giveaway fantôme
                throw err
            }
            await message.reply({ content: t(message, "eng.giveaway.lance", { id, salon: channel }), flags: EPHEMERAL })
            return sendModLog(message, { action: "giveaway", details: `Giveaway n°${id} lancé dans ${channel} : ${prix}` })
        }

        const g = db.getGiveaway(guild.id, args.getInteger("numero") ?? 0)
        if (!g) return message.reply({ content: t(message, "eng.giveaway.numero_inconnu"), flags: EPHEMERAL })
        await message.deferReply({ flags: EPHEMERAL })

        if (action === "terminer") {
            if (g.status !== "en_cours") return message.editReply(t(message, "eng.giveaway.deja_termine"))
            if (!await giveaways.terminer(bot, g)) return message.editReply(t(message, "eng.giveaway.tirage_impossible"))
            return message.editReply(t(message, "eng.giveaway.termine_ok", { id: g.id, salon: g.channel_id }))
        }
        if (action === "relancer") {
            if (g.status !== "termine") return message.editReply(t(message, "eng.giveaway.relance_seulement_termine"))
            const gagnants = await giveaways.relancer(bot, g)
            await sendModLog(message, { action: "giveaway", details: `Nouveau tirage du giveaway n°${g.id}` })
            if (gagnants === null) return message.editReply(t(message, "eng.giveaway.relance_impossible"))
            return message.editReply(t(message, gagnants.length ? "eng.giveaway.relance_ok" : "eng.giveaway.relance_vide"))
        }
        // annuler
        if (g.status !== "en_cours") return message.editReply(t(message, "eng.giveaway.deja_termine"))
        db.deleteGiveaway(g.id)
        const channel = guild.channels.cache.get(g.channel_id)
        if (channel && g.message_id) await channel.messages.delete(g.message_id).catch(() => {})
        await sendModLog(message, { action: "giveaway", details: `Giveaway n°${g.id} annulé (${g.prix})` })
        return message.editReply(t(message, "eng.giveaway.annule", { id: g.id }))
    }
}
