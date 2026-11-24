const Discord = require('discord.js')
const db = require('./db')
const { sendModLog } = require('./logs')
const { marqueurTempban } = require('./sanctions')

const INTERVALLE = 60 * 1000
const REPORT = 6 * 60 * 60 * 1000 // déban refusé (permission perdue) : nouvel essai 6 h plus tard
const CODE_BAN_INCONNU = Discord.RESTJSONErrorCodes.UnknownBan
const CODE_PERMISSION = Discord.RESTJSONErrorCodes.MissingPermissions

// Débannit les membres dont le ban temporaire est terminé, y compris ceux en retard après un redémarrage.
// Renvoie le nombre de débans faits (pour les tests).
async function traiterTempbans(bot, maintenant = Date.now()) {
    let debans = 0
    for (const { guild_id: guildId, user_id: userId, expires_at: fin } of db.expiredTempbans(maintenant)) {
        const guild = bot.guilds.cache.get(guildId)
        // Serveur absent de ce processus (autre shard, panne, bot retiré) : on ne touche à rien.
        // Si le bot a été retiré, la purge RGPD effacera l'entrée.
        if (!guild?.available) continue

        try {
            const ban = await guild.bans.fetch({ user: userId, force: true }).catch(err => {
                if (err.code === CODE_BAN_INCONNU) return null
                throw err
            })
            // Déjà débanni (à la main, ou pendant que le bot était éteint) : on n'insiste pas
            // Re-banni par un humain entre-temps (le marqueur ne correspond plus) : on ne débannit pas
            if (!ban || !ban.reason?.startsWith(marqueurTempban(fin))) {
                db.removeTempban(guildId, userId)
                continue
            }

            await guild.bans.remove(userId, "Fin du bannissement temporaire").catch(err => {
                if (err.code !== CODE_BAN_INCONNU) throw err // débanni entre-temps : c'est le résultat voulu
            })
            db.removeTempban(guildId, userId)
            db.addCase(guildId, { userId, moderatorId: bot.user.id, type: "unban", reason: "Fin du bannissement temporaire", auto: true })
            debans++
            await sendModLog({ guild, user: bot.user }, { action: "unban", cible: ban.user, raison: "Fin du bannissement temporaire" })
        } catch (err) {
            if (err.code === CODE_PERMISSION) {
                // Le bot a perdu la permission de bannir : on prévient le serveur et on réessaie plus tard
                db.reporterTempban(guildId, userId, maintenant + REPORT)
                await sendModLog({ guild, user: bot.user }, {
                    action: "unban",
                    details: `Impossible de débannir <@${userId}> à la fin de son ban temporaire : il me manque la permission « Bannir des membres ». Nouvel essai dans 6 h.`
                })
            } else {
                // Erreur passagère (réseau, Discord indisponible) : nouvel essai à la prochaine minute
                console.error(`Échec du déban automatique (${guildId}/${userId}) :`, err.message)
            }
        }
    }
    return debans
}

function startTempbanSchedule(bot) {
    let enCours = false
    const tourner = async () => {
        if (enCours) return // un passage lent ne doit pas se chevaucher avec le suivant
        enCours = true
        try {
            await traiterTempbans(bot)
        } catch (err) {
            console.error("Erreur pendant les débans automatiques :", err.message)
        } finally {
            enCours = false
        }
    }
    tourner()
    return setInterval(tourner, INTERVALLE).unref()
}

module.exports = { traiterTempbans, startTempbanSchedule }
