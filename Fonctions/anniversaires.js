const Discord = require('discord.js')
const db = require('./db')
const { enHeureDeParis } = require('./dates')
const { jourParis } = require('./evenements')
const { moduleActif } = require('./modules')
const { fetchMember } = require('./moderation')
const { refusRoleCommunaute, PERMISSIONS_INTERDITES } = require('./rolesCommunaute')
const { t } = require('./i18n')

// Anniversaires (idée #78). On ne garde que le jour et le mois, jamais l'année.
// startAnniversairesSchedule(bot) : toutes les 30 minutes, annonce les anniversaires du jour (une seule fois par jour de Paris
// et par serveur), donne le rôle du jour et le retire aux membres dont ce n'est plus l'anniversaire.
// Le rôle du jour n'est retiré qu'aux membres à qui le bot l'a donné (table anniv_roles_donnes), jamais aux autres porteurs ;
// à la configuration, un rôle qui a déjà des porteurs est refusé (refusRoleAnniv). La date ne change qu'une fois par 30 jours.
// Ordre : retrait des rôles de la veille, puis jour noté (last_run_day), puis rôles du jour et annonce. Si le retrait échoue
// en bloc (erreur levée), le jour n'est pas noté et le passage suivant réessaie. Les serveurs sont traités à la suite,
// avec une courte pause entre deux, pour ne pas lancer toutes les requêtes Discord d'un coup.

const INTERVALLE = 30 * 60 * 1000
const MAX_ANNONCES = 25
const PAUSE_SERVEURS = 1000
const JOURS_PAR_MOIS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] // février : 29 accepté (fêté le 28 les années non bissextiles)

const DELAI_CHANGEMENT = 30 * 24 * 3600 * 1000

// Un rôle du jour avec un pouvoir dangereux (même liste que la boutique et les paliers)
const roleDangereux = role => role.permissions.any(PERMISSIONS_INTERDITES)

const dateValide = (jour, mois) => Number.isInteger(jour) && Number.isInteger(mois) && mois >= 1 && mois <= 12 && jour >= 1 && jour <= JOURS_PAR_MOIS[mois - 1]

const estBissextile = annee => (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0

// --- Données ---------------------------------------------------------------------------------------------------

// Enregistre la date. Renvoie { ok: true }, ou { ok: false, refus: "date" } (date inexistante), ou
// { ok: false, refus: "delai", prochain } (changée il y a moins de 30 jours ; prochain = instant où elle sera modifiable).
// Redonner la même date ne compte pas comme un changement. Seul un changement ou une première saisie démarre le délai
// (retirer reste libre : le délai peut donc être contourné en retirant puis en redéfinissant, ce qui ne laisse aucune trace).
function definir(guildId, userId, jour, mois, instant = Date.now()) {
    if (!dateValide(jour, mois)) return { ok: false, refus: "date" }
    return db.transaction(() => {
        const actuel = db.sqlAll("SELECT day, month, changed_at FROM anniversaires WHERE guild_id = ? AND user_id = ?", [guildId, userId])[0]
        if (actuel && actuel.day === jour && actuel.month === mois) return { ok: true }
        if (actuel?.changed_at && instant - actuel.changed_at < DELAI_CHANGEMENT) {
            return { ok: false, refus: "delai", prochain: actuel.changed_at + DELAI_CHANGEMENT }
        }
        db.sqlRun(`INSERT INTO anniversaires (guild_id, user_id, day, month, changed_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (guild_id, user_id) DO UPDATE SET day = excluded.day, month = excluded.month, changed_at = excluded.changed_at`,
        [guildId, userId, jour, mois, instant])
        return { ok: true }
    })
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

// Le rôle du jour peut-il être choisi ? Renvoie la clé i18n du refus (rolecom.refus.* ou social.anniv.role_porteurs), ou null.
// Contrôle commun (pouvoirs, staff, quarantaine, vérification, hiérarchie du bot et du configurateur), plus : le rôle ne doit
// avoir aucun porteur (le bot ne doit retirer que ce qu'il a donné ; le rôle déjà configuré garde ses porteurs, donnés par lui).
function refusRoleAnniv(guild, role, configurateur) {
    const refus = refusRoleCommunaute(guild, role, configurateur)
    if (refus) return refus
    if (role.id !== lireConfig(guild.id).role_id && role.members?.size > 0) return "social.anniv.role_porteurs"
    return null
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

// Retire le rôle du jour aux membres à qui le bot l'a donné (anniv_roles_donnes) et dont ce n'est plus l'anniversaire,
// ainsi que les rôles d'une ancienne configuration. Les autres porteurs du rôle ne sont jamais touchés.
// Une ligne disparaît quand le rôle est retiré, ou que le membre ou le rôle n'existent plus ; elle reste si le retrait échoue
// (nouvel essai au prochain jour traité).
async function retirerRoles(guild, ids) {
    const lignes = db.sqlAll("SELECT user_id, role_id FROM anniv_roles_donnes WHERE guild_id = ?", [guild.id])
    const supprimer = l => db.sqlRun("DELETE FROM anniv_roles_donnes WHERE guild_id = ? AND user_id = ? AND role_id = ?", [guild.id, l.user_id, l.role_id])
    const config = lireConfig(guild.id)
    for (const l of lignes) {
        if (ids.includes(l.user_id) && l.role_id === config.role_id) continue // encore fêté : le rôle reste
        const role = guild.roles.cache.get(l.role_id)
        const membre = role ? await fetchMember(guild, l.user_id) : null // relu : une erreur réseau relance, le jour n'est pas noté
        if (!membre || !membre.roles?.cache?.has(role.id)) {
            supprimer(l)
            continue
        }
        const retire = await membre.roles.remove(role, "Anniversaire terminé").then(() => true, () => false)
        if (retire) supprimer(l)
    }
}

// Donne le rôle du jour et note que le bot l'a donné. Un membre qui l'avait déjà (obtenu autrement) ne reçoit rien et
// n'est pas noté : le bot ne le lui retirera jamais.
async function donnerRole(guild, membre, role, jour) {
    const deja = db.sqlAll("SELECT 1 AS un FROM anniv_roles_donnes WHERE guild_id = ? AND user_id = ? AND role_id = ?", [guild.id, membre.id, role.id]).length > 0
    if (deja) {
        db.sqlRun("UPDATE anniv_roles_donnes SET day = ? WHERE guild_id = ? AND user_id = ? AND role_id = ?", [jour, guild.id, membre.id, role.id])
        if (membre.roles?.cache?.has(role.id)) return
    } else if (membre.roles?.cache?.has(role.id)) return
    // Noté avant l'ajout : si le bot s'arrête entre les deux, le rôle sera quand même retiré le lendemain
    db.sqlRun("INSERT OR REPLACE INTO anniv_roles_donnes (guild_id, user_id, role_id, day) VALUES (?, ?, ?, ?)", [guild.id, membre.id, role.id, jour])
    const donne = await membre.roles.add(role, "Anniversaire du jour").then(() => true, () => false)
    if (!donne) db.sqlRun("DELETE FROM anniv_roles_donnes WHERE guild_id = ? AND user_id = ? AND role_id = ?", [guild.id, membre.id, role.id])
}

async function traiterServeur(guild, instant = Date.now()) {
    const config = lireConfig(guild.id)
    if (!moduleActif(guild.id, "communaute.social")) return
    if (!config.channel_id && !config.role_id) {
        // Annonces désactivées : on retire quand même les rôles que le bot avait donnés
        await retirerRoles(guild, [])
        return
    }
    const aujourdhui = jourParis(instant)
    if (config.last_run_day === aujourdhui) return

    const ids = fetesDuJour(guild.id, instant)
    const role = config.role_id ? guild.roles.cache.get(config.role_id) : null
    const moi = guild.members.me
    // Contrôle du bot seulement (le configurateur n'est pas connu ici), revérifié à chaque jour traité
    const roleUtilisable = Boolean(role && !refusRoleCommunaute(guild, role))
    // Les rôles de la veille d'abord : si cette étape lève une erreur, le jour n'est pas noté et le passage suivant réessaie
    await retirerRoles(guild, ids)

    // Jour noté avant l'annonce : un échec ou un redémarrage ne provoque jamais une seconde annonce
    const reserve = db.sqlRun("UPDATE anniv_config SET last_run_day = ? WHERE guild_id = ? AND (last_run_day IS NULL OR last_run_day != ?)",
        [aujourdhui, guild.id, aujourdhui])
    if (!reserve) return

    const membres = []
    for (const id of ids) {
        const membre = await trouverMembre(guild, id)
        if (membre && !membre.user.bot) membres.push(membre)
    }
    if (roleUtilisable) for (const membre of membres) await donnerRole(guild, membre, role, aujourdhui)

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
    definir, retirer, lire, lireConfig, ecrireConfig, refusRoleAnniv, fetesDuJour
}
