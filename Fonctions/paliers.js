const db = require('./db')
const { t } = require('./i18n')
const { refusRole } = require('./rolesBoutons')
const { peutDonnerRole } = require('./moderation')
const economie = require('./economie')

// Paliers de niveau (idée #41) : un niveau atteint donne un rôle et/ou une récompense en monnaie.
// Mode "cumul" : on garde les rôles de tous les paliers atteints. Mode "remplace" : seul le palier le plus haut atteint est gardé.

const MAX_PALIERS = 25
const NIVEAU_PALIER_MAX = 200
const RECOMPENSE_MAX = 5000
const MODES = ["cumul", "remplace"]

const lireMode = guildId => db.sqlAll("SELECT tier_mode FROM xp_config WHERE guild_id = ?", [guildId])[0]?.tier_mode === "remplace" ? "remplace" : "cumul"

function definirMode(guildId, mode) {
    if (!MODES.includes(mode)) throw new RangeError(`mode : ${MODES.join(" ou ")}`)
    db.sqlRun("INSERT INTO xp_config (guild_id, tier_mode) VALUES (?, ?) ON CONFLICT (guild_id) DO UPDATE SET tier_mode = excluded.tier_mode", [guildId, mode])
}

// Du niveau le plus bas au plus haut
const listerPaliers = guildId =>
    db.sqlAll("SELECT level, role_id, reward FROM xp_paliers WHERE guild_id = ? ORDER BY level ASC", [guildId])
        .map(l => ({ niveau: l.level, roleId: l.role_id, recompense: l.reward }))

// Le bot et le configurateur peuvent-ils donner ce rôle, et est-il sans danger ? Renvoie un message d'erreur, ou null.
// Mêmes règles que les rôles à boutons (refusRole) : pas de permission dangereuse, sous le rôle du bot, sous celui du configurateur.
// configurateur : le membre qui règle le palier (null à l'attribution : on revérifie seulement le rôle et le bot).
function refusRolePalier(guild, role, configurateur = null, cible = null) {
    const L = cible ?? "fr"
    const refus = refusRole(guild, role, configurateur, L)
    if (refus) return refus
    const moi = guild.members.me
    if (!moi || !peutDonnerRole(moi, role)) return t(L, "niv.palier_bot")
    if (configurateur && !peutDonnerRole(configurateur, role)) return t(L, "niv.palier_configurateur")
    return null
}

// Ajoute ou remplace le palier d'un niveau. Valeur invalide : RangeError.
function definirPalier(guildId, { niveau, roleId = null, recompense = 0 }) {
    if (!Number.isInteger(niveau) || niveau < 1 || niveau > NIVEAU_PALIER_MAX) throw new RangeError(`niveau : entier de 1 à ${NIVEAU_PALIER_MAX}`)
    if (!Number.isInteger(recompense) || recompense < 0 || recompense > RECOMPENSE_MAX) throw new RangeError(`recompense : entier de 0 à ${RECOMPENSE_MAX}`)
    if (!roleId && recompense === 0) throw new RangeError("un palier a un rôle ou une récompense")
    db.transaction(() => {
        const existe = db.sqlAll("SELECT 1 AS un FROM xp_paliers WHERE guild_id = ? AND level = ?", [guildId, niveau]).length > 0
        const { n } = db.sqlAll("SELECT COUNT(*) AS n FROM xp_paliers WHERE guild_id = ?", [guildId])[0]
        if (!existe && n >= MAX_PALIERS) throw new RangeError(`au plus ${MAX_PALIERS} paliers`)
        db.sqlRun(`INSERT INTO xp_paliers (guild_id, level, role_id, reward) VALUES (?, ?, ?, ?)
            ON CONFLICT (guild_id, level) DO UPDATE SET role_id = excluded.role_id, reward = excluded.reward`, [guildId, niveau, roleId, recompense])
    })
}

const retirerPalier = (guildId, niveau) =>
    db.sqlRun("DELETE FROM xp_paliers WHERE guild_id = ? AND level = ?", [guildId, niveau]) > 0

// Rôle utilisable à l'instant T (existe, sans danger, bot capable de le donner) ou null. Revérifié à chaque attribution.
function roleUtilisable(guild, roleId) {
    const role = roleId ? guild.roles.cache.get(roleId) : null
    return role && !refusRolePalier(guild, role) ? role : null
}

// Applique les paliers franchis quand un membre passe de `ancien` à `nouveau` (plusieurs niveaux d'un coup possible).
// Renvoie { roles: [IDs donnés], retires: [IDs retirés], recompense: total en monnaie }. Une erreur Discord sur un rôle
// n'empêche ni les autres rôles ni la récompense.
async function appliquerPaliers(member, ancien, nouveau) {
    const bilan = { roles: [], retires: [], recompense: 0 }
    if (!(nouveau > ancien)) return bilan
    const guild = member.guild
    const paliers = listerPaliers(guild.id)
    const franchis = paliers.filter(p => p.niveau > ancien && p.niveau <= nouveau)
    if (!franchis.length) return bilan

    // Récompenses : monnaie normale (hors plafond du jour, avec la réduction des comptes récents)
    for (const p of franchis.filter(p => p.recompense > 0)) {
        const r = economie.crediter(member, p.recompense, { source: "palier", actif: false, details: { niveau: p.niveau } })
        if (r.ok) bilan.recompense += r.credite
    }

    const donne = (role, raison) => member.roles.add(role, raison).then(() => bilan.roles.push(role.id))
    const retire = (role, raison) => member.roles.remove(role, raison).then(() => bilan.retires.push(role.id))
    const raison = `Palier de niveau ${nouveau}`

    if (lireMode(guild.id) === "remplace") {
        // Le palier le plus haut atteint (pas seulement parmi les nouveaux : un palier sans rôle ne retire pas le précédent)
        const cible = [...paliers].reverse().find(p => p.niveau <= nouveau && p.roleId)
        const roleCible = cible && franchis.includes(cible) ? roleUtilisable(guild, cible.roleId) : null
        if (!roleCible) return bilan
        // Le nouveau rôle d'abord : s'il échoue, le membre garde l'ancien
        try {
            await donne(roleCible, raison)
        } catch (err) {
            console.error("Palier, rôle non donné :", err.message)
            return bilan
        }
        for (const p of paliers) {
            if (!p.roleId || p.roleId === roleCible.id || !member.roles.cache.has(p.roleId)) continue
            const ancienRole = guild.roles.cache.get(p.roleId)
            // Un rôle qu'on ne peut plus gérer (devenu trop haut) reste : on ne tente pas l'impossible
            if (ancienRole && peutDonnerRole(guild.members.me, ancienRole)) {
                await retire(ancienRole, raison).catch(err => console.error("Palier, rôle non retiré :", err.message))
            }
        }
        return bilan
    }

    for (const p of franchis.filter(p => p.roleId)) {
        const role = roleUtilisable(guild, p.roleId)
        if (role && !member.roles.cache.has(role.id)) await donne(role, raison).catch(err => console.error("Palier, rôle non donné :", err.message))
    }
    return bilan
}

module.exports = {
    MAX_PALIERS, NIVEAU_PALIER_MAX, RECOMPENSE_MAX, MODES,
    lireMode, definirMode, listerPaliers, refusRolePalier, definirPalier, retirerPalier, appliquerPaliers
}
