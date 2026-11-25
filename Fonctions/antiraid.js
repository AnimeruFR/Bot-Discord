const Discord = require('discord.js')
const db = require('./db')
const { t } = require('./i18n')
const { moduleActif } = require('./modules')
const { envoyerLog, COULEURS } = require('./logs')

const { Flags } = Discord.PermissionsBitField
const JOUR = 86400000

// Filtre des comptes récents (idée #3) : réglage par serveur (table account_filter, migration 009).
// Sans réglage, le filtre est désactivé.
const ACTIONS_FILTRE = ["role", "kick"]
const AGE_MIN_JOURS = 1
const AGE_MAX_JOURS = 365

// Réglage du serveur : { minAgeJours, action, roleId } ou null
function getFiltreComptes(guildId) {
    const ligne = db.sqlAll("SELECT min_age_days, action, role_id FROM account_filter WHERE guild_id = ?", [guildId])[0]
    return ligne ? { minAgeJours: ligne.min_age_days, action: ligne.action, roleId: ligne.role_id } : null
}

// reglage null : désactive le filtre. Lève une erreur si le réglage est invalide (la commande valide avant).
function setFiltreComptes(guildId, reglage) {
    if (!reglage) return db.sqlRun("DELETE FROM account_filter WHERE guild_id = ?", [guildId])
    const { minAgeJours, action, roleId = null } = reglage
    if (!Number.isInteger(minAgeJours) || minAgeJours < AGE_MIN_JOURS || minAgeJours > AGE_MAX_JOURS) throw new RangeError("Âge minimal invalide")
    if (!ACTIONS_FILTRE.includes(action)) throw new RangeError("Action du filtre inconnue")
    if (action === "role" && !roleId) throw new RangeError("Le filtre « rôle en attente » demande un rôle")
    return db.sqlRun(`INSERT INTO account_filter (guild_id, min_age_days, action, role_id) VALUES (?, ?, ?, ?)
        ON CONFLICT (guild_id) DO UPDATE SET min_age_days = excluded.min_age_days, action = excluded.action, role_id = excluded.role_id`,
    [guildId, minAgeJours, action, action === "role" ? roleId : null])
}

// Que faire d'un compte créé à createdTimestamp ? null (rien), "role" ou "kick". Un compte pile à la limite passe.
function decision(reglage, createdTimestamp, maintenant = Date.now()) {
    if (!reglage) return null
    return maintenant - createdTimestamp < reglage.minAgeJours * JOUR ? reglage.action : null
}

// Vérifie qu'on peut donner ce rôle. Renvoie le motif d'échec, ou null si tout va bien.
function problemeRole(guild, roleId) {
    const role = roleId ? guild.roles.cache.get(roleId) : null
    if (!role) return "Le rôle « en attente » n'existe plus"
    const moi = guild.members.me
    if (!moi?.permissions.has(Flags.ManageRoles)) return "Le bot n'a pas la permission « Gérer les rôles »"
    if (role.managed || moi.roles.highest.comparePositionTo(role) <= 0) return "Le rôle « en attente » est au-dessus du rôle du bot (ou géré par une intégration)"
    return null
}

async function logArrivee(member, jours, resultat) {
    const action = resultat.action === "kick" ? "expulsion" : "rôle en attente"
    const embed = new Discord.EmbedBuilder()
        .setColor(resultat.ok ? COULEURS.kick : COULEURS.automod)
        .setTitle(resultat.ok ? `Filtre des comptes récents : ${action}` : `Filtre des comptes récents : échec (${action})`)
        .addFields(
            { name: "Membre", value: `${member} (\`${member.id}\`)`, inline: true },
            { name: "Âge du compte", value: `${jours} jour(s)`, inline: true }
        )
        .setTimestamp()
    if (!resultat.ok) embed.addFields({ name: "Motif", value: String(resultat.motif).slice(0, 1024) })
    await envoyerLog(member.guild, "membres", embed)
}

// Applique le filtre à un nouvel arrivant. Ne lève jamais d'erreur.
// Renvoie { action: null|"role"|"kick", ok, motif? } ; action null = rien à faire.
async function appliquerFiltre(member, maintenant = Date.now()) {
    try {
        if (member.user.bot) return { action: null, ok: true }
        const guild = member.guild
        if (!moduleActif(guild.id, "moderation")) return { action: null, ok: true }
        const reglage = getFiltreComptes(guild.id)
        const action = decision(reglage, member.user.createdTimestamp, maintenant)
        if (!action) return { action: null, ok: true }

        const jours = Math.floor((maintenant - member.user.createdTimestamp) / JOUR)
        const raison = `Filtre des comptes récents (compte de ${jours} jours)`
        let resultat
        if (action === "role") {
            const probleme = problemeRole(guild, reglage.roleId)
            if (probleme) resultat = { action, ok: false, motif: probleme }
            else {
                try {
                    await member.roles.add(reglage.roleId, raison)
                    resultat = { action, ok: true }
                } catch (err) {
                    resultat = { action, ok: false, motif: err.message }
                }
            }
        } else if (!member.kickable) {
            resultat = { action, ok: false, motif: "Le membre ne peut pas être expulsé (permission ou hiérarchie)" }
        } else {
            // MP avant l'expulsion (après, plus de serveur en commun) ; peut échouer sans gravité
            await member.send(t(guild, "ar.mp_kick", { serveur: guild.name, jours: reglage.minAgeJours })).catch(() => {})
            try {
                await member.kick(raison)
                resultat = { action, ok: true }
            } catch (err) {
                resultat = { action, ok: false, motif: err.message }
            }
        }
        await logArrivee(member, jours, resultat)
        return resultat
    } catch (err) {
        console.error("Filtre des comptes récents :", err.message)
        return { action: null, ok: false, motif: err.message }
    }
}

module.exports = { decision, appliquerFiltre, getFiltreComptes, setFiltreComptes, ACTIONS_FILTRE, AGE_MIN_JOURS, AGE_MAX_JOURS }
