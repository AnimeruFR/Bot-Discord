const Discord = require('discord.js')
const db = require('./db')
const { enHeureDeParis } = require('./dates')
const { jourParis } = require('./evenements')
const { moduleActif } = require('./modules')
const { peutDonnerRole } = require('./moderation')
const { t } = require('./i18n')

// Anniversaires (idée #78). On ne garde que le jour et le mois, jamais l'année.
// startAnniversairesSchedule(bot) : toutes les 30 minutes, annonce les anniversaires du jour (une seule fois par jour de Paris
// et par serveur), donne le rôle du jour et le retire aux membres dont ce n'est plus l'anniversaire.
// Ordre : retrait des rôles de la veille, puis jour noté (last_run_day), puis rôles du jour et annonce. Si le retrait échoue
// en bloc (erreur levée), le jour n'est pas noté et le passage suivant réessaie. Les serveurs sont traités à la suite,
// avec une courte pause entre deux, pour ne pas lancer toutes les requêtes Discord d'un coup.

const INTERVALLE = 30 * 60 * 1000
const MAX_ANNONCES = 25
const PAUSE_SERVEURS = 1000
const JOURS_PAR_MOIS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] // février : 29 accepté (fêté le 28 les années non bissextiles)

// Permissions qu'un rôle du jour ne doit jamais avoir
const PERMISSIONS_DANGEREUSES = Discord.PermissionsBitField.resolve([
    "Administrator", "ManageGuild", "ManageRoles", "ManageChannels", "ManageWebhooks", "ManageMessages", "ManageNicknames",
    "KickMembers", "BanMembers", "ModerateMembers", "MentionEveryone", "ViewAuditLog", "ManageEvents", "ManageThreads",
    "ManageGuildExpressions", "MoveMembers", "MuteMembers", "DeafenMembers"
])

const roleDangereux = role => role.permissions.any(PERMISSIONS_DANGEREUSES)

const dateValide = (jour, mois) => Number.isInteger(jour) && Number.isInteger(mois) && mois >= 1 && mois <= 12 && jour >= 1 && jour <= JOURS_PAR_MOIS[mois - 1]

const estBissextile = annee => (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0

// --- Données ---------------------------------------------------------------------------------------------------

function definir(guildId, userId, jour, mois) {
    if (!dateValide(jour, mois)) return false
    db.sqlRun(`INSERT INTO anniversaires (guild_id, user_id, day, month) VALUES (?, ?, ?, ?)
        ON CONFLICT (guild_id, user_id) DO UPDATE SET day = excluded.day, month = excluded.month`, [guildId, userId, jour, mois])
    return true
}

const retirer = (guildId, userId) => db.sqlRun("DELETE FROM anniversaires WHERE guild_id = ? AND user_id = ?", [guildId, userId]) > 0

function lire(guildId, userId) {
    const ligne = db.sqlAll("SELECT day, month FROM anniversaires WHERE guild_id = ? AND user_id = ?", [guildId, userId])[0]
    return ligne ? { ...ligne } : null
}

function lireConfig(guildId) {
    const ligne = db.sqlAll("SELECT channel_id, role_id, last_run_day FROM anniv_config WHERE guild_id = ?", [guildId])[0]
    return ligne ? { ...ligne } : { channel_id: null, role_id: null, last_run_day: null }
}

// Un champ absent (undefined) ne change pas ; null l'efface
function ecrireConfig(guildId, { salon, role }) {
    const actuel = lireConfig(guildId)
    db.sqlRun(`INSERT INTO anniv_config (guild_id, channel_id, role_id) VALUES (?, ?, ?)
        ON CONFLICT (guild_id) DO UPDATE SET channel_id = excluded.channel_id, role_id = excluded.role_id`,
    [guildId, salon === undefined ? actuel.channel_id : salon, role === undefined ? actuel.role_id : role])
}

// Membres à fêter à cet instant (heure de Paris). Les 29/02 sont fêtés le 28/02 les années non bissextiles.
function fetesDuJour(guildId, instant = Date.now()) {
    const { annee, mois, jour } = enHeureDeParis(instant)
    const jours = mois === 2 && jour === 28 && !estBissextile(annee) ? [28, 29] : [jour]
    return db.sqlAll(`SELECT user_id FROM anniversaires WHERE guild_id = ? AND month = ? AND day IN (${jours.map(() => "?").join(",")})`,
        [guildId, mois, ...jours]).map(l => l.user_id)
}

// --- Tâche de fond ---------------------------------------------------------------------------------------------

// Membre du cache, sinon récupéré seul (jamais de fetch de tout le serveur) ; null s'il est parti
const trouverMembre = (guild, id) => guild.members.cache?.get(id) ?? guild.members.fetch(id).catch(() => null)

// Retire le rôle du jour à ceux dont ce n'est plus l'anniversaire : les porteurs connus du cache (role.members), plus les
// fêtés de la veille, récupérés un par un au cas où ils ne seraient pas en cache.
async function retirerRoles(guild, role, ids, instant) {
    const { annee, mois, jour } = enHeureDeParis(instant)
    const veille = Date.UTC(annee, mois - 1, jour - 1, 12) // midi UTC : même jour à Paris, été comme hiver
    const candidats = new Set([...role.members.keys(), ...fetesDuJour(guild.id, veille)])
    for (const id of candidats) {
        if (ids.includes(id)) continue
        const porteur = role.members.get(id)
        const membre = porteur ?? await trouverMembre(guild, id)
        if (!membre || (!porteur && !membre.roles?.cache?.has(role.id))) continue
        await membre.roles.remove(role, "Anniversaire terminé").catch(() => null)
    }
}

async function traiterServeur(guild, instant = Date.now()) {
    const config = lireConfig(guild.id)
    if (!config.channel_id && !config.role_id) return
    if (!moduleActif(guild.id, "communaute.social")) return
    const aujourdhui = jourParis(instant)
    if (config.last_run_day === aujourdhui) return

    const ids = fetesDuJour(guild.id, instant)
    const role = config.role_id ? guild.roles.cache.get(config.role_id) : null
    const moi = guild.members.me
    const roleUtilisable = Boolean(role && moi && !roleDangereux(role) && peutDonnerRole(moi, role))
    // Les rôles de la veille d'abord : si cette étape lève une erreur, le jour n'est pas noté et le passage suivant réessaie
    if (roleUtilisable) await retirerRoles(guild, role, ids, instant)

    // Jour noté avant l'annonce : un échec ou un redémarrage ne provoque jamais une seconde annonce
    const reserve = db.sqlRun("UPDATE anniv_config SET last_run_day = ? WHERE guild_id = ? AND (last_run_day IS NULL OR last_run_day != ?)",
        [aujourdhui, guild.id, aujourdhui])
    if (!reserve) return

    const membres = []
    for (const id of ids) {
        const membre = await trouverMembre(guild, id)
        if (membre && !membre.user.bot) membres.push(membre)
    }
    if (roleUtilisable) for (const membre of membres) await membre.roles.add(role, "Anniversaire du jour").catch(() => null)

    if (!config.channel_id || !membres.length) return
    const salon = guild.channels.cache.get(config.channel_id)
    if (!salon?.isTextBased() || !salon.permissionsFor(moi)?.has([Discord.PermissionFlagsBits.ViewChannel, Discord.PermissionFlagsBits.SendMessages])) return
    // Mentions affichées mais jamais notifiantes
    const liste = membres.slice(0, MAX_ANNONCES).map(m => `<@${m.id}>`).join(", ")
    await salon.send({ content: t(guild, "social.anniv.annonce", { membres: liste }), allowedMentions: { parse: [] } }).catch(() => null)
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function traiter(bot, { pauseServeurs = PAUSE_SERVEURS } = {}) {
    let premier = true
    for (const guild of bot.guilds.cache.values()) {
        if (!premier && pauseServeurs > 0) await pause(pauseServeurs)
        premier = false
        try {
            await traiterServeur(guild)
        } catch (err) {
            console.error(`Anniversaires : échec sur le serveur ${guild.id} :`, err.message)
        }
    }
}

let enCours = false
function startAnniversairesSchedule(bot) {
    const tourner = async () => {
        if (enCours) return
        enCours = true
        try {
            await traiter(bot)
        } finally {
            enCours = false
        }
    }
    tourner()
    return setInterval(tourner, INTERVALLE).unref()
}

module.exports = {
    startAnniversairesSchedule, traiter, traiterServeur, dateValide, estBissextile, roleDangereux,
    definir, retirer, lire, lireConfig, ecrireConfig, fetesDuJour
}
