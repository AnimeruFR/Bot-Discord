const Discord = require('discord.js')
const db = require('./db')
const { sendModLog } = require('./logs')
const giveaways = require('./giveaways')

const { Flags } = Discord.PermissionsBitField
const INTERVALLE = 30 * 1000
const RETARD_MAX_ANNONCE = 24 * 60 * 60 * 1000 // annonce trop en retard (bot éteint) : abandonnée

// L'auteur d'une annonce a-t-il TOUJOURS le droit de la publier ? (vérifié à l'envoi, pas seulement à la programmation :
// un modérateur qui a perdu ses droits ne doit pas pouvoir faire parler le bot 60 jours plus tard)
async function auteurAutorise(guild, channel, authorId) {
    const member = await guild.members.fetch({ user: authorId, force: true }).catch(err => {
        if (err.code === Discord.RESTJSONErrorCodes.UnknownMember) return null
        throw err
    })
    if (!member) return "son auteur n'est plus sur le serveur"
    if (!member.permissions.has(Flags.ManageMessages)) return "son auteur n'a plus la permission « Gérer les messages »"
    if (!channel.permissionsFor(member)?.has([Flags.ViewChannel, Flags.SendMessages])) return `son auteur ne peut plus écrire dans ${channel}`
    return null
}

// Envoie une annonce programmée. Les vérifications se font d'abord (une erreur passagère de Discord garde l'annonce
// pour le passage suivant), puis « au plus une fois » : la ligne est supprimée juste AVANT l'envoi.
async function envoyerAnnonce(bot, a, maintenant = Date.now()) {
    const guild = bot.guilds.cache.get(a.guild_id)
    if (!guild?.available) return "attente" // serveur en panne ou sur un autre shard : on garde l'annonce

    const abandon = async motif => {
        if (!db.deleteAnnouncementById(a.id)) return "deja"
        await sendModLog({ guild, user: bot.user }, { action: "annonce", details: `Annonce n°${a.id} non publiée : ${motif}.` })
        return "abandon"
    }
    if (maintenant - a.send_at > RETARD_MAX_ANNONCE) return abandon("plus de 24 h de retard (bot arrêté)")
    const channel = guild.channels.cache.get(a.channel_id)
    if (!channel?.isTextBased()) return abandon("le salon n'existe plus")
    if (!channel.permissionsFor(guild.members.me)?.has([Flags.ViewChannel, Flags.SendMessages])) return abandon(`je ne peux plus écrire dans ${channel}`)
    const refus = await auteurAutorise(guild, channel, a.author_id)
    if (refus) return abandon(refus)
    if (!db.deleteAnnouncementById(a.id)) return "deja"

    // Jamais de mention active : même un @everyone écrit dans l'annonce ne notifie personne
    await channel.send({ content: a.contenu, allowedMentions: { parse: [] } })
    return "envoyee"
}

// Un passage : giveaways arrivés à échéance, résultats non publiés (après un crash), annonces dues
async function traiterProgrammes(bot, maintenant = Date.now()) {
    const bilan = { giveaways: 0, annonces: 0 }
    for (const g of db.dueGiveaways(maintenant)) {
        try {
            if (await giveaways.terminer(bot, g)) bilan.giveaways++
        } catch (err) {
            console.error(`Tirage du giveaway ${g.id} :`, err.message)
        }
    }
    for (const g of db.unannouncedGiveaways()) {
        try {
            await giveaways.publier(bot, g)
        } catch (err) {
            console.error(`Publication du giveaway ${g.id} :`, err.message)
        }
    }
    for (const a of db.dueAnnouncements(maintenant)) {
        try {
            if (await envoyerAnnonce(bot, a, maintenant) === "envoyee") bilan.annonces++
        } catch (err) {
            console.error(`Annonce ${a.id} :`, err.message)
        }
    }
    return bilan
}

function startProgrammesSchedule(bot) {
    db.resetGiveawayAnnouncing() // publication interrompue par un arrêt du bot : reprise
    let enCours = false
    const tourner = async () => {
        if (enCours) return // un passage lent ne se chevauche pas avec le suivant
        enCours = true
        try {
            await traiterProgrammes(bot)
        } catch (err) {
            console.error("Erreur des tâches programmées :", err.message)
        } finally {
            enCours = false
        }
    }
    tourner()
    return setInterval(tourner, INTERVALLE).unref()
}

module.exports = { traiterProgrammes, envoyerAnnonce, auteurAutorise, startProgrammesSchedule, RETARD_MAX_ANNONCE }
