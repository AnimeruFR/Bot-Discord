const Discord = require('discord.js')
const db = require('./db')
const { t } = require('./i18n')
const { checkHierarchy, fetchMember, formatReason, auditReason, peutDonnerRole } = require('./moderation')
const { sendModLog } = require('./logs')
const { PERMISSIONS_MODERATION } = require('./config')
const { roleValide } = require('./tickets')

const { Flags } = Discord.PermissionsBitField
const P = Discord.PermissionFlagsBits

// Quarantaine (idée #14) : un membre perd ses rôles (sauvegardés en base) et reçoit un rôle isolé, jusqu'à la levée.

// Permissions qu'un rôle isolé ne doit jamais avoir : celles de modération (comme le filtre des comptes récents)
// et quelques autres qui permettent d'agir sur le serveur ou d'inviter du monde.
const PERMISSIONS_DANGEREUSES = PERMISSIONS_MODERATION | P.ManageGuildExpressions | P.ManageEvents | P.MuteMembers
    | P.DeafenMembers | P.MoveMembers | P.CreateInstantInvite

// --- Base ------------------------------------------------------------------------------------------------------

const getRoleIsole = guildId => db.sqlAll("SELECT role_id FROM quarantine_config WHERE guild_id = ?", [guildId])[0]?.role_id ?? null

const setRoleIsole = (guildId, roleId) => db.sqlRun(`INSERT INTO quarantine_config (guild_id, role_id) VALUES (?, ?)
    ON CONFLICT (guild_id) DO UPDATE SET role_id = excluded.role_id`, [guildId, roleId])

// La liste JSON est relue avec prudence : une valeur abîmée ne doit pas empêcher de lever la quarantaine
function lireRoles(texte) {
    try {
        const liste = JSON.parse(texte)
        return Array.isArray(liste) ? liste.filter(id => typeof id === "string") : []
    } catch {
        return []
    }
}

function getQuarantine(guildId, userId) {
    const ligne = db.sqlAll("SELECT * FROM quarantines WHERE guild_id = ? AND user_id = ?", [guildId, userId])[0]
    return ligne ? { ...ligne, roles: lireRoles(ligne.roles) } : null
}

const listerQuarantaines = guildId => db.sqlAll("SELECT * FROM quarantines WHERE guild_id = ? ORDER BY created_at", [guildId])
    .map(l => ({ ...l, roles: lireRoles(l.roles) }))

const supprimerLigne = (guildId, userId) => db.sqlRun("DELETE FROM quarantines WHERE guild_id = ? AND user_id = ?", [guildId, userId])

// --- Rôle isolé ------------------------------------------------------------------------------------------------

// Le bot peut-il donner ce rôle ? Il lui faut « Gérer les rôles » et un rôle plus haut.
const botPeutDonner = (guild, role) => Boolean(guild.members.me) && peutDonnerRole(guild.members.me, role)

// Le modérateur peut-il donner ce rôle ? Même règle que pour le bot : jamais plus de pouvoir par le bot que lui n'en a.
// Renvoie un message d'erreur, ou null.
function refusModerateur(interaction, role) {
    const moderateur = interaction.member
    if (peutDonnerRole(moderateur, role)) return null
    const aLesDroits = moderateur.id === interaction.guild.ownerId || moderateur.permissions?.has(Flags.ManageRoles)
    return t(interaction, aLesDroits ? "quar.role_superieur" : "quar.config_roles_membre")
}

// Salon dont une surcharge donne au rôle une permission dangereuse (le rôle serait alors dangereux dans ce salon), ou null.
// Même idée que salonDangereux de rolesBoutons.js (non exportée, et ses permissions sont celles des rôles-boutons).
function salonDangereux(guild, role) {
    return guild.channels.cache.find(c => c.permissionOverwrites?.cache.get(role.id)?.allow.any(PERMISSIONS_DANGEREUSES)) ?? null
}

// Message de refus si une surcharge de salon donne un pouvoir dangereux au rôle isolé, ou null
function refusSalon(interaction, role) {
    const salon = salonDangereux(interaction.guild, role)
    return salon ? t(interaction, "quar.salon_dangereux", { salon: `<#${salon.id}>` }) : null
}

// Rôle isolé acceptable pour ce membre qui configure ? Renvoie un message d'erreur, ou null.
function refusRoleIsole(interaction, role) {
    const guild = interaction.guild
    if (!roleValide(guild, role.id)) return t(interaction, "quar.role_invalide")
    if (role.permissions.any(PERMISSIONS_DANGEREUSES)) return t(interaction, "quar.role_pouvoir")
    const refus = refusModerateur(interaction, role)
    if (refus) return refus
    if (!botPeutDonner(guild, role)) return t(interaction, "quar.role_bot")
    return refusSalon(interaction, role)
}

// Choisit le rôle isolé. Renvoie { erreur } ou { inchange } ou { ok }.
async function changerRoleIsole(interaction, role) {
    const guild = interaction.guild
    const refus = refusRoleIsole(interaction, role)
    if (refus) return { erreur: refus }
    const ancien = getRoleIsole(guild.id)
    if (ancien === role.id) return { inchange: true }
    // Des membres portent peut-être l'ancien rôle : le changer maintenant l'abandonnerait sur eux
    if (ancien && listerQuarantaines(guild.id).length) return { erreur: t(interaction, "quar.config_en_cours") }
    setRoleIsole(guild.id, role.id)
    await sendModLog(interaction, { action: "config", details: `Rôle de quarantaine : ${ancien ? `<@&${ancien}>` : "aucun"} → ${role}` })
    return { ok: true }
}

// --- Mettre en quarantaine -------------------------------------------------------------------------------------

// Renvoie { erreur } (rien n'est enregistré) ou { numero, retires, gardes, prevenu }.
// Si la ligne existe déjà mais que le membre n'a pas le rôle isolé (arrêt du bot entre l'écriture et roles.set,
// ou rôle retiré à la main), l'isolement est repris au lieu d'être refusé.
async function mettre(interaction, user, raisonSaisie) {
    const guild = interaction.guild
    const roleId = getRoleIsole(guild.id)
    const iso = roleId ? roleValide(guild, roleId) : null
    if (!iso) return { erreur: t(interaction, "quar.pas_configure") }
    // Le rôle a pu changer depuis /quarantaine config : on revérifie ce que le bot va donner
    if (iso.permissions.any(PERMISSIONS_DANGEREUSES)) return { erreur: t(interaction, "quar.role_pouvoir") }
    const refusMod = refusModerateur(interaction, iso)
    if (refusMod) return { erreur: refusMod }
    if (!botPeutDonner(guild, iso)) return { erreur: t(interaction, "quar.role_bot") }
    const refusDuSalon = refusSalon(interaction, iso)
    if (refusDuSalon) return { erreur: refusDuSalon }

    const member = await fetchMember(guild, user.id)
    if (!member) return { erreur: t(interaction, "mod.absent") }
    const erreur = checkHierarchy(interaction, member, "quarantaine")
    if (erreur) return { erreur }
    if (!member.manageable) return { erreur: t(interaction, "quar.pas_gerable") }
    if (getQuarantine(guild.id, user.id) && member.roles.cache.has(iso.id)) return { erreur: t(interaction, "quar.deja") }

    // Retirables : ni @everyone, ni rôle d'intégration (booster, bot…), ni rôle au-dessus de celui du bot. Les autres restent.
    const plusHaut = guild.members.me.roles.highest
    const retirables = [], gardes = []
    for (const role of member.roles.cache.values()) {
        if (role.id === guild.id || role.id === iso.id) continue
        if (role.managed || role.comparePositionTo(plusHaut) >= 0) gardes.push(role.id)
        else retirables.push(role.id)
    }
    const avant = [...member.roles.cache.keys()].filter(id => id !== guild.id)

    // Sauvegarde AVANT le retrait : si le bot s'arrête entre les deux, les rôles ne sont pas perdus
    const raisonBrute = raisonSaisie?.trim() || "Aucune raison fournie"
    let aSauver = retirables
    const etat = db.transaction(() => {
        const ligne = getQuarantine(guild.id, user.id)
        if (ligne && member.roles.cache.has(iso.id)) return "deja"
        if (ligne) {
            // Reprise : on garde les rôles déjà sauvegardés (certains ont pu être retirés) et on ajoute ceux du membre
            aSauver = [...new Set([...ligne.roles, ...retirables])]
            db.sqlRun("UPDATE quarantines SET roles = ?, moderator_id = ?, reason = ? WHERE guild_id = ? AND user_id = ?",
                [JSON.stringify(aSauver), interaction.user.id, raisonBrute, guild.id, user.id])
            return "reprise"
        }
        db.sqlRun("INSERT INTO quarantines (guild_id, user_id, roles, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            [guild.id, user.id, JSON.stringify(retirables), interaction.user.id, raisonBrute, Date.now()])
        return "neuf"
    })
    if (etat === "deja") return { erreur: t(interaction, "quar.deja") }

    try {
        await member.roles.set([iso.id, ...gardes], auditReason(interaction, raisonSaisie))
    } catch (err) {
        console.error("Échec de la mise en quarantaine :", err.message)
        // Le changement a pu partir à moitié : on tente de rendre les rôles
        await member.roles.set(avant, auditReason(interaction, "Quarantaine annulée (échec)")).catch(() => {})
        // Une reprise garde sa sauvegarde (elle existait déjà) ; un enregistrement neuf est oublié
        if (etat === "neuf") {
            supprimerLigne(guild.id, user.id)
            return { erreur: t(interaction, "quar.echec") }
        }
        return { erreur: t(interaction, "quar.echec_reprise") }
    }

    const numero = db.addCase(guild.id, { userId: user.id, moderatorId: interaction.user.id, type: "quarantaine", reason: raisonSaisie })
    await sendModLog(interaction, { action: "quarantaine", cible: user, raison: raisonSaisie, details: `${aSauver.length} rôle(s) sauvegardé(s), ${gardes.length} conservé(s)${etat === "reprise" ? " (isolement repris : la sauvegarde existait déjà)" : ""}` })
    const prevenu = await user.send(t(guild, "quar.mp", { serveur: guild.name, reason: formatReason(raisonSaisie) })).then(() => true).catch(() => false)
    return { numero, retires: aSauver.length, gardes: gardes.length, prevenu }
}

const MAX_RAISON = 400
// Nom lisible d'un rôle pour un log (sans mention ni mise en forme)
const nomRole = role => `${String(role.name ?? "?").replace(/[@`*_~|<>]/g, "").slice(0, 40)} (${role.id})`

// --- Lever la quarantaine --------------------------------------------------------------------------------------

// Renvoie { erreur } ou { absent: true } (membre parti : sauvegarde supprimée) ou { numero, restaures, supprimes, impossibles, nonRendus }.
async function lever(interaction, user) {
    const guild = interaction.guild
    const ligne = getQuarantine(guild.id, user.id)
    if (!ligne) return { erreur: t(interaction, "quar.pas_en_quarantaine") }

    const member = await fetchMember(guild, user.id)
    if (!member) {
        supprimerLigne(guild.id, user.id)
        await sendModLog(interaction, { action: "quarantaine", cible: user, details: "Membre absent du serveur : sauvegarde de ses rôles supprimée" })
        return { absent: true }
    }
    const erreur = checkHierarchy(interaction, member, "quarantaine")
    if (erreur) return { erreur }

    // Jamais plus de pouvoir par le bot que celui qui lève : on ne rend que des rôles sous le sien.
    // Un rôle plus haut est refusé en bloc (la quarantaine reste), un rôle supprimé ou hors de portée du bot est ignoré.
    const proprietaire = interaction.user.id === guild.ownerId
    const plusHautBot = guild.members.me.roles.highest
    const supprimes = [], impossibles = [] // "nom (id)" : le staff doit pouvoir les rendre à la main
    const aRendre = []
    for (const id of ligne.roles) {
        const role = guild.roles.cache.get(id)
        if (!role) { supprimes.push(id); continue }
        if (role.id === guild.id || role.managed || role.comparePositionTo(plusHautBot) >= 0) { impossibles.push(nomRole(role)); continue }
        if (!proprietaire && role.comparePositionTo(interaction.member.roles.highest) >= 0) {
            return { erreur: t(interaction, "quar.lever_superieur", { role: `<@&${role.id}>` }) }
        }
        aRendre.push(id)
    }

    const isoId = getRoleIsole(guild.id)
    const garder = [...member.roles.cache.keys()].filter(id => id !== guild.id && id !== isoId)
    try {
        await member.roles.set([...new Set([...garder, ...aRendre])], auditReason(interaction, "Fin de quarantaine"))
    } catch (err) {
        console.error("Échec de la levée de quarantaine :", err.message)
        return { erreur: t(interaction, "quar.echec_lever") } // la sauvegarde reste : on peut réessayer
    }

    supprimerLigne(guild.id, user.id)
    const nonRendus = [...supprimes.map(id => `${id} (supprimé)`), ...impossibles]
    const aMain = nonRendus.length ? `rôles à rendre à la main : ${nonRendus.join(", ")}` : ""
    const numero = db.addCase(guild.id, {
        userId: user.id, moderatorId: interaction.user.id, type: "fin_quarantaine",
        reason: ("Fin de quarantaine" + (aMain ? ` (${aMain})` : "")).slice(0, MAX_RAISON)
    })
    await sendModLog(interaction, {
        action: "quarantaine", cible: user,
        details: `Fin de quarantaine : ${aRendre.length} rôle(s) rendu(s), ${supprimes.length} supprimé(s), ${impossibles.length} impossible(s) à rendre${aMain ? "\n" + aMain : ""}`
    })
    return { numero, restaures: aRendre.length, supprimes: supprimes.length, impossibles: impossibles.length, nonRendus }
}

// À appeler quand un membre arrive (Events/guildMemberAdd.js) : un membre en quarantaine qui est parti puis revenu
// n'a plus de rôle. On lui remet le rôle isolé ; la sauvegarde est gardée pour la levée. Renvoie true si le rôle est posé.
async function reappliquer(member) {
    const guild = member.guild
    if (!getQuarantine(guild.id, member.id)) return false
    const roleId = getRoleIsole(guild.id)
    const iso = roleId ? roleValide(guild, roleId) : null
    if (!iso || iso.permissions.any(PERMISSIONS_DANGEREUSES) || !botPeutDonner(guild, iso)) return false
    try {
        await member.roles.add(iso.id, "Quarantaine : retour d'un membre en quarantaine")
    } catch (err) {
        console.error("Échec du rôle isolé au retour d'un membre :", err.message)
        // Le membre est revenu libre : le staff doit le savoir tout de suite
        await sendModLog({ guild, user: member.client?.user ?? guild.members.me ?? member.user }, {
            action: "quarantaine", cible: member.user,
            details: `Alerte : ce membre en quarantaine est revenu sur le serveur et je n'ai pas pu lui redonner le rôle isolé (${err.message}). Isolez-le à la main.`
        })
        return false
    }
    return true
}

// Rôle ajouté à un membre en quarantaine (autre bot, humain) : on le retire et on le garde pour la levée.
// À appeler à chaque mise à jour de membre. Le retrait redéclenche l'événement, mais il ne reste alors plus rien à retirer.
// Sans le rôle isolé sur le membre, on ne fait rien : c'est le cas pendant la levée (les rôles rendus ne sont pas retirés).
async function retirerRolesAjoutes(bot, member) {
    const guild = member.guild
    const ligne = getQuarantine(guild.id, member.id)
    if (!ligne) return []
    const isoId = getRoleIsole(guild.id)
    if (!isoId || !member.roles.cache.has(isoId)) return []
    const moi = guild.members.me
    if (!moi) return []
    // Même règle qu'à la mise en quarantaine : ni @everyone, ni rôle isolé, ni rôle d'intégration, ni rôle au-dessus du bot
    const extras = [...member.roles.cache.values()].filter(r => r.id !== guild.id && r.id !== isoId && !r.managed && r.comparePositionTo(moi.roles.highest) < 0)
    if (!extras.length) return []

    // Sauvegarde AVANT le retrait, comme à la mise en quarantaine
    const ids = extras.map(r => r.id)
    db.sqlRun("UPDATE quarantines SET roles = ? WHERE guild_id = ? AND user_id = ?",
        [JSON.stringify([...new Set([...ligne.roles, ...ids])]), guild.id, member.id])
    const liste = extras.map(nomRole).join(", ")
    const acteur = { guild, user: bot?.user ?? moi }
    try {
        await member.roles.remove(ids, "Quarantaine : rôle ajouté pendant la quarantaine")
    } catch (err) {
        console.error("Échec du retrait d'un rôle ajouté en quarantaine :", err.message)
        await sendModLog(acteur, { action: "quarantaine", cible: member.user, details: `Alerte : rôle(s) ajouté(s) à un membre en quarantaine, retrait impossible (${err.message}) : ${liste}` })
        return []
    }
    await sendModLog(acteur, { action: "quarantaine", cible: member.user, details: `Rôle(s) ajouté(s) pendant la quarantaine, retiré(s) et sauvegardé(s) : ${liste}` })
    return ids
}

module.exports = {
    PERMISSIONS_DANGEREUSES, getRoleIsole, getQuarantine, listerQuarantaines, refusRoleIsole, changerRoleIsole,
    mettre, lever, reappliquer, retirerRolesAjoutes
}
