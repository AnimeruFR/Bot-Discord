const Discord = require('discord.js')
const db = require('./db')
const { moduleActif } = require('./modules')
const { getLogChannel, COULEURS } = require('./logs')

const { Flags } = Discord.PermissionsBitField

// Anti-raid (idée #2) : réglage par serveur (table raid_config), raids détectés dans raid_events (migration 010).
// Contrat : noterArrivee(member) compte l'arrivée et déclenche le mode raid au-delà du seuil. Elle ne lève jamais d'erreur.
const BORNES = { arrivees: { min: 3, max: 100 }, secondes: { min: 5, max: 300 } }
const NIVEAU_RAID = Discord.GuildVerificationLevel.VeryHigh
const NOMS_NIVEAUX = ["Aucun", "Faible", "Moyen", "Élevé", "Très élevé"]
const INVITES_SUSPENDUES = Discord.GuildFeature?.InvitesDisabled ?? "INVITES_DISABLED"
const MAX_SERVEURS_SUIVIS = 5000

// Fenêtre glissante en mémoire : serveur -> dates (ms) des dernières arrivées. Bornée : au plus MAX_SERVEURS_SUIVIS
// serveurs, et au plus « arrivees » dates par serveur (on déclenche dès qu'on les atteint).
const fenetres = new Map()

const nomNiveau = niveau => NOMS_NIVEAUX[niveau] ?? String(niveau)

// Réglage du serveur : { arrivees, secondes, alerteSeule } ou null (anti-raid désactivé)
function getReglage(guildId) {
    const l = db.sqlAll("SELECT arrivals, window_s, alert_only FROM raid_config WHERE guild_id = ?", [guildId])[0]
    return l ? { arrivees: l.arrivals, secondes: l.window_s, alerteSeule: l.alert_only === 1 } : null
}

// Enregistre le réglage. Lève une RangeError s'il sort des bornes (la commande valide avant).
function setReglage(guildId, { arrivees, secondes, alerteSeule = false }) {
    for (const [nom, valeur] of [["arrivees", arrivees], ["secondes", secondes]]) {
        const { min, max } = BORNES[nom]
        if (!Number.isInteger(valeur) || valeur < min || valeur > max) throw new RangeError(`${nom} doit être entre ${min} et ${max}`)
    }
    db.sqlRun(`INSERT INTO raid_config (guild_id, arrivals, window_s, alert_only) VALUES (?, ?, ?, ?)
        ON CONFLICT (guild_id) DO UPDATE SET arrivals = excluded.arrivals, window_s = excluded.window_s, alert_only = excluded.alert_only`,
    [guildId, arrivees, secondes, alerteSeule ? 1 : 0])
    fenetres.delete(guildId)
}

// Désactive l'anti-raid (un raid déjà en cours reste levable). Renvoie false s'il n'y avait aucun réglage.
function supprimerReglage(guildId) {
    fenetres.delete(guildId)
    return db.sqlRun("DELETE FROM raid_config WHERE guild_id = ?", [guildId]) > 0
}

// Raid en cours (non levé) ou null
const raidEnCours = guildId => db.sqlAll("SELECT * FROM raid_events WHERE guild_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1", [guildId])[0] ?? null
const dernierRaid = guildId => db.sqlAll("SELECT * FROM raid_events WHERE guild_id = ? ORDER BY id DESC LIMIT 1", [guildId])[0] ?? null

// Ajoute une arrivée à la fenêtre du serveur et renvoie le nombre d'arrivées dans la fenêtre
function compter(guildId, reglage, maintenant) {
    let dates = fenetres.get(guildId)
    if (!dates) {
        if (fenetres.size >= MAX_SERVEURS_SUIVIS) fenetres.delete(fenetres.keys().next().value)
        dates = []
        fenetres.set(guildId, dates)
    }
    const debut = maintenant - reglage.secondes * 1000
    while (dates.length && dates[0] <= debut) dates.shift()
    dates.push(maintenant)
    if (dates.length > reglage.arrivees) dates.splice(0, dates.length - reglage.arrivees)
    return dates.length
}

// Verrouille le serveur (niveau de vérification, invitations). Ne lève jamais : un échec est noté dans `echecs`.
// previous_level n'est renseigné qu'une fois la valeur lue et AVANT le changement ; il repasse à NULL si le changement échoue.
async function verrouiller(guild, id, raison) {
    const mesures = { niveau: null, invites: false, invitesDeja: false, echecs: [], refus: null }
    const moi = guild.members?.me
    if (!moi?.permissions.has(Flags.ManageGuild)) {
        mesures.refus = "Le bot n'a pas la permission « Gérer le serveur » : alerte seulement"
        return mesures
    }

    const avant = guild.verificationLevel
    if (avant < NIVEAU_RAID) {
        db.sqlRun("UPDATE raid_events SET previous_level = ? WHERE id = ?", [avant, id])
        try {
            await guild.setVerificationLevel(NIVEAU_RAID, raison)
            mesures.niveau = { avant, apres: NIVEAU_RAID }
        } catch (err) {
            db.sqlRun("UPDATE raid_events SET previous_level = NULL WHERE id = ?", [id])
            mesures.echecs.push(`niveau de vérification : ${err.message}`)
        }
    }

    if (guild.features?.includes(INVITES_SUSPENDUES)) {
        mesures.invitesDeja = true // pas à nous de les rétablir plus tard
    } else if (typeof guild.disableInvites !== "function") {
        mesures.echecs.push("suspension des invitations indisponible avec cette version de discord.js")
    } else {
        db.sqlRun("UPDATE raid_events SET invites_paused = 1 WHERE id = ?", [id])
        try {
            await guild.disableInvites(true)
            mesures.invites = true
        } catch (err) {
            db.sqlRun("UPDATE raid_events SET invites_paused = 0 WHERE id = ?", [id])
            mesures.echecs.push(`suspension des invitations : ${err.message}`)
        }
    }
    return mesures
}

// Alerte au staff (famille antiraid) avec le bouton de levée. Renvoie true si elle est partie.
async function alerter(guild, id, reglage, nb, mesures) {
    try {
        const channel = getLogChannel(guild, "antiraid")
        if (!channel) return false
        const lignes = []
        if (reglage.alerteSeule) lignes.push("Mode alerte seule : le serveur n'a pas été verrouillé.")
        if (mesures.refus) lignes.push(mesures.refus + ".")
        if (mesures.niveau) lignes.push(`Niveau de vérification relevé : ${nomNiveau(mesures.niveau.avant)} → ${nomNiveau(mesures.niveau.apres)}.`)
        if (mesures.invites) lignes.push("Invitations suspendues.")
        if (mesures.invitesDeja) lignes.push("Les invitations étaient déjà suspendues (laissées telles quelles à la levée).")
        for (const echec of mesures.echecs) lignes.push(`Échec : ${echec}.`)

        const embed = new Discord.EmbedBuilder()
            .setColor(COULEURS.ban)
            .setTitle(reglage.alerteSeule ? "Anti-raid : alerte" : "Anti-raid : mode raid déclenché")
            .setDescription(`${nb} arrivée(s) en ${reglage.secondes} seconde(s) (seuil : ${reglage.arrivees}).`)
            .addFields({ name: "Mesures", value: lignes.join("\n").slice(0, 1024) || "Aucune" })
            .setTimestamp()
        const bouton = new Discord.ButtonBuilder()
            .setCustomId(`raid:lever:${id}`)
            .setLabel(reglage.alerteSeule ? "Clore l'alerte" : "Lever le mode raid")
            .setStyle(Discord.ButtonStyle.Danger)
        await channel.send({ embeds: [embed], components: [new Discord.ActionRowBuilder().addComponents(bouton)] })
        return true
    } catch (err) {
        console.error("Impossible d'envoyer l'alerte anti-raid :", err.message)
        return false
    }
}

// Compte l'arrivée d'un membre et déclenche le mode raid au-delà du seuil. Ne lève jamais d'erreur.
// Renvoie { declenche, id?, suite? } ; suite est la promesse du verrouillage et de l'alerte (utile aux tests ; l'événement l'ignore).
// Tout ce qui décide du déclenchement est synchrone (aucun await avant l'enregistrement du raid) :
// 50 arrivées simultanées ne produisent donc qu'un seul raid.
async function noterArrivee(member, maintenant = Date.now()) {
    try {
        const guild = member.guild
        if (member.user?.bot || !moduleActif(guild.id, "moderation")) return { declenche: false }
        const reglage = getReglage(guild.id)
        if (!reglage) return { declenche: false }

        const nb = compter(guild.id, reglage, maintenant)
        if (nb < reglage.arrivees) return { declenche: false }

        // Pas de second déclenchement tant qu'un raid est en cours (même après un redémarrage : l'état est en base)
        const id = db.transaction(() => {
            if (raidEnCours(guild.id)) return null
            return db.sqlAll(`INSERT INTO raid_events (guild_id, started_at, arrivals) VALUES (?, ?, ?) RETURNING id`, [guild.id, maintenant, nb])[0].id
        })
        if (id === null) return { declenche: false }
        fenetres.delete(guild.id)

        // Verrouillage et alerte (appels REST) partent sans être attendus : la ligne raid_events est déjà écrite,
        // et le filtre des comptes / la bienvenue du membre ne doivent pas attendre l'API. `suite` sert aux tests.
        const suite = (async () => {
            const mesures = reglage.alerteSeule
                ? { niveau: null, invites: false, invitesDeja: false, echecs: [], refus: null }
                : await verrouiller(guild, id, `Mode raid automatique : ${nb} arrivées en ${reglage.secondes} s`)
            const alerte = await alerter(guild, id, reglage, nb, mesures)
            return { mesures, alerte }
        })().catch(err => {
            console.error("Anti-raid (verrouillage) :", err.message)
            return { mesures: null, alerte: false }
        })
        return { declenche: true, id, suite }
    } catch (err) {
        console.error("Anti-raid :", err.message)
        return { declenche: false }
    }
}

// Raids dont la levée est en cours (verrou en mémoire : deux clics simultanés ne restaurent qu'une fois)
const leveesEnCours = new Set()

// Lève le mode raid : restaure le niveau de vérification et les invitations, et trace qui l'a levé.
// id : un raid précis (bouton), sinon le raid en cours du serveur. par : identifiant du modérateur.
// Renvoie { erreur: "aucun" | "deja" } ou { id, niveau, niveauModifie, invites, echecs, leve }.
// Le raid n'est marqué terminé qu'après une restauration réussie : sinon leve vaut false, echecs dit ce qui a échoué
// et le raid reste ouvert (on peut relever). Ce qui est déjà restauré n'est pas refait.
async function lever(guild, { id = null, par }) {
    const ligne = id === null ? raidEnCours(guild.id) : db.sqlAll("SELECT * FROM raid_events WHERE id = ? AND guild_id = ?", [id, guild.id])[0]
    if (!ligne) return { erreur: "aucun" }
    if (ligne.ended_at !== null || leveesEnCours.has(ligne.id)) return { erreur: "deja" }
    leveesEnCours.add(ligne.id)
    try {
        const resultat = { id: ligne.id, niveau: null, niveauModifie: false, invites: false, echecs: [], leve: false }
        if (ligne.previous_level !== null) {
            // Un niveau changé à la main pendant le raid n'est pas écrasé
            if (guild.verificationLevel !== NIVEAU_RAID) resultat.niveauModifie = true
            else {
                try {
                    await guild.setVerificationLevel(ligne.previous_level, "Fin du mode raid")
                    resultat.niveau = ligne.previous_level
                    db.sqlRun("UPDATE raid_events SET previous_level = NULL WHERE id = ?", [ligne.id])
                } catch (err) {
                    resultat.echecs.push(`niveau de vérification : ${err.message}`)
                }
            }
        }
        if (ligne.invites_paused === 1) {
            try {
                await guild.disableInvites(false)
                resultat.invites = true
                db.sqlRun("UPDATE raid_events SET invites_paused = 0 WHERE id = ?", [ligne.id])
            } catch (err) {
                resultat.echecs.push(`invitations : ${err.message}`)
            }
        }
        if (resultat.echecs.length) return resultat

        if (!db.sqlRun("UPDATE raid_events SET ended_at = ?, lifted_by = ? WHERE id = ? AND ended_at IS NULL", [Date.now(), par, ligne.id])) return { erreur: "deja" }
        fenetres.delete(guild.id)
        resultat.leve = true
        return resultat
    } finally {
        leveesEnCours.delete(ligne.id)
    }
}

module.exports = {
    noterArrivee, getReglage, setReglage, supprimerReglage, raidEnCours, dernierRaid, lever, nomNiveau,
    BORNES, NIVEAU_RAID
}
