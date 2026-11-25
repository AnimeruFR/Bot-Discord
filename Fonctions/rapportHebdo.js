const Discord = require('discord.js')
const { t } = require('./i18n')
const { couleur } = require('./apparence')
const { getLogChannel } = require('./logs')
const { moduleActif } = require('./modules')
const { nomType } = require('./cases')
const { JOUR, donneesRapport, estLundi9hParis, cleSemaine, dejaEnvoye } = require('./statsMod')

// Rapport hebdomadaire du staff (idée #17) : chaque lundi vers 9 h (heure de Paris), résumé des 7 derniers jours
// dans le salon de logs « sanctions ». On vérifie toutes les 30 min, au plus un rapport par semaine et par serveur.
// La semaine envoyée est gardée en mémoire (aucune table dédiée) : après un redémarrage pendant cette heure du lundi,
// un doublon est possible. Accepté, c'est rare et sans gravité.
const INTERVALLE = 30 * 60 * 1000
const envoyes = new Map() // serveur -> clé de semaine

function construireRapport(guild, maintenant = Date.now()) {
    const d = donneesRapport(guild.id, maintenant - 7 * JOUR)
    const total = d.sanctions.reduce((s, l) => s + l.n, 0)
    const sanctions = d.sanctions.length ? d.sanctions.map(l => `${nomType(guild, l.type)} : ${l.n}`).join("\n") : t(guild, "stats.rapport.aucune")
    return new Discord.EmbedBuilder()
        .setColor(couleur(guild))
        .setTitle(t(guild, "stats.rapport.titre"))
        .addFields(
            { name: t(guild, "stats.rapport.sanctions", { total }), value: sanctions.slice(0, 1024) },
            { name: t(guild, "stats.rapport.automod"), value: String(d.automod), inline: true },
            { name: t(guild, "stats.rapport.tickets"), value: t(guild, "stats.rapport.tickets_valeur", { ouverts: d.ticketsOuverts, fermes: d.ticketsFermes }), inline: true },
            { name: t(guild, "stats.rapport.raids"), value: String(d.raids), inline: true },
            { name: t(guild, "stats.rapport.appels"), value: t(guild, "stats.rapport.appels_valeur", { total: d.appels, acceptes: d.appelsAcceptes }), inline: true }
        )
        .setTimestamp(maintenant)
}

// Un passage. Renvoie le nombre de rapports envoyés (pour les tests). Ne lève jamais.
async function traiterRapports(bot, maintenant = new Date()) {
    let nombre = 0
    try {
        if (!estLundi9hParis(maintenant)) return 0
        const cle = cleSemaine(maintenant)
        for (const guild of bot.guilds.cache.values()) {
            try {
                if (!guild.available || dejaEnvoye(envoyes, guild.id, cle) || !moduleActif(guild.id, "moderation")) continue
                const channel = getLogChannel(guild, "sanctions")
                if (!channel) continue
                // Marqué avant l'envoi : une erreur d'envoi ne se répète pas toutes les 30 min
                envoyes.set(guild.id, cle)
                await channel.send({ embeds: [construireRapport(guild, maintenant.getTime())] })
                nombre++
            } catch (err) {
                console.error(`Rapport hebdomadaire (${guild.id}) :`, err.message)
            }
        }
    } catch (err) {
        console.error("Rapport hebdomadaire :", err.message)
    }
    return nombre
}

function startRapportHebdoSchedule(bot) {
    let enCours = false
    const tourner = async () => {
        if (enCours) return
        enCours = true
        try {
            await traiterRapports(bot)
        } finally {
            enCours = false
        }
    }
    tourner()
    return setInterval(tourner, INTERVALLE).unref()
}

module.exports = { startRapportHebdoSchedule, traiterRapports, construireRapport }
