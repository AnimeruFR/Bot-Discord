const db = require('./db')
const { moduleActif } = require('./modules')
const { emettre, jourParis } = require('./evenements')

// Noyau de l'économie (idées #26 à #38). Règles et chiffres : docs/ECONOMIE.md.
//
// Toutes les fonctions sont synchrones (node:sqlite) et chaque écriture passe par db.transaction(), qui fait
// BEGIN IMMEDIATE : le verrou d'écriture est pris avant de lire le solde, donc la vérification et l'écriture
// ne peuvent pas être séparées, même si le tableau de bord écrit dans la base au même moment (autre processus).
// Ne pas appeler ces fonctions depuis une autre db.transaction() : SQLite refuse les transactions imbriquées.
//
// Chaque variation de solde a sa ligne dans eco_journal : la somme des delta d'un compte est égale à son solde.

const PLAFOND_JOUR_DEFAUT = 800
const PLAFOND_JOUR_MIN = 300
const PLAFOND_JOUR_MAX = 2000
const MULTIPLICATEUR_MIN = 0.5
const MULTIPLICATEUR_MAX = 2
const SOLDE_MAX = 1000000
const ENVOI_MAX_JOUR = 2000
const RECEPTION_MAX_JOUR = 5000
const JOURS_NOUVEAU = 7
const DUREE_NOUVEAU = JOURS_NOUVEAU * 24 * 3600 * 1000

// --- Réglages du serveur ---------------------------------------------------------------------------------------

const lireConfig = guildId => db.sqlAll("SELECT * FROM eco_config WHERE guild_id = ?", [guildId])[0] ?? {}

function monnaie(guildId) {
    const config = lireConfig(guildId)
    return { nom: config.currency_name ?? "Éclats", emoji: config.currency_emoji ?? "✦" }
}

// 1234 -> "1 234 ✦"
function formater(guildId, montant) {
    const nombre = String(Math.trunc(montant)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")
    return `${nombre} ${monnaie(guildId).emoji}`
}

function reglages(guildId) {
    const config = lireConfig(guildId)
    return { plafondJour: config.daily_cap ?? PLAFOND_JOUR_DEFAUT, multiplicateur: config.multiplier ?? 1 }
}

// Champ absent : inchangé ; null : retour à la valeur par défaut. Une valeur invalide lève une RangeError.
function definirReglages(guildId, { nom, emoji, plafondJour, multiplicateur } = {}) {
    const texte = (valeur, max, champ) => {
        if (valeur === null) return null
        const propre = typeof valeur === "string" ? valeur.trim() : ""
        if (!propre || propre.length > max) throw new RangeError(`${champ} : 1 à ${max} caractères`)
        return propre
    }
    const valeurs = {}
    if (nom !== undefined) valeurs.currency_name = texte(nom, 32, "nom")
    if (emoji !== undefined) valeurs.currency_emoji = texte(emoji, 64, "emoji")
    if (plafondJour !== undefined) {
        if (plafondJour !== null && (!Number.isInteger(plafondJour) || plafondJour < PLAFOND_JOUR_MIN || plafondJour > PLAFOND_JOUR_MAX)) {
            throw new RangeError(`plafondJour : entier de ${PLAFOND_JOUR_MIN} à ${PLAFOND_JOUR_MAX}`)
        }
        valeurs.daily_cap = plafondJour
    }
    if (multiplicateur !== undefined) {
        if (multiplicateur !== null && (typeof multiplicateur !== "number" || !(multiplicateur >= MULTIPLICATEUR_MIN && multiplicateur <= MULTIPLICATEUR_MAX))) {
            throw new RangeError(`multiplicateur : de ${MULTIPLICATEUR_MIN} à ${MULTIPLICATEUR_MAX}`)
        }
        valeurs.multiplier = multiplicateur
    }
    const colonnes = Object.keys(valeurs)
    if (!colonnes.length) return
    // Les noms de colonnes viennent de la liste ci-dessus, jamais de l'appelant
    db.sqlRun(`INSERT INTO eco_config (guild_id, ${colonnes.join(", ")}) VALUES (?${", ?".repeat(colonnes.length)})
        ON CONFLICT (guild_id) DO UPDATE SET ${colonnes.map(c => `${c} = excluded.${c}`).join(", ")}`,
    [guildId, ...Object.values(valeurs)])
}

// --- Comptes ---------------------------------------------------------------------------------------------------

const lireCompte = (guildId, userId) =>
    db.sqlAll("SELECT * FROM eco_comptes WHERE guild_id = ? AND user_id = ?", [guildId, userId])[0] ?? null

function ligneCompte(guildId, userId) {
    db.sqlRun("INSERT OR IGNORE INTO eco_comptes (guild_id, user_id, created_at) VALUES (?, ?, ?)", [guildId, userId, Date.now()])
    return lireCompte(guildId, userId)
}

function compte(guildId, userId) {
    const ligne = ligneCompte(guildId, userId)
    return { balance: ligne.balance, frozen: ligne.frozen === 1, streak: ligne.streak, lastDailyAt: ligne.last_daily_at }
}

function compteurs(guildId, userId) {
    return db.sqlAll("SELECT * FROM eco_compteurs WHERE guild_id = ? AND user_id = ? AND day = ?", [guildId, userId, jourParis()])[0]
        ?? { active_earned: 0, sent: 0, received: 0, works: 0 }
}

function ajouterCompteurs(guildId, userId, { actif = 0, envoye = 0, recu = 0 }) {
    db.sqlRun(`INSERT INTO eco_compteurs (guild_id, user_id, day, active_earned, sent, received) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (guild_id, user_id, day) DO UPDATE SET active_earned = active_earned + excluded.active_earned,
        sent = sent + excluded.sent, received = received + excluded.received`, [guildId, userId, jourParis(), actif, envoye, recu])
}

// Change le solde et écrit la ligne de journal correspondante (à appeler dans une transaction)
function mouvement(guildId, userId, delta, solde, { source, otherId = null, details = null }) {
    db.sqlRun("UPDATE eco_comptes SET balance = ? WHERE guild_id = ? AND user_id = ?", [solde, guildId, userId])
    const texte = details === null || typeof details === "string" ? details : JSON.stringify(details)
    db.sqlRun(`INSERT INTO eco_journal (guild_id, user_id, delta, balance_after, source, other_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [guildId, userId, delta, solde, source, otherId, texte, Date.now()])
}

function verifierMontant(montant) {
    if (!Number.isSafeInteger(montant) || montant <= 0) throw new RangeError(`Montant invalide : ${montant}`)
}

function verifierSource(source) {
    if (typeof source !== "string" || !source) throw new RangeError("Source manquante")
}

// Moins de 7 jours sur le serveur. Date d'arrivée inconnue : traité comme récent (on ne prend pas de risque).
const estNouveau = member => !member.joinedTimestamp || Date.now() - member.joinedTimestamp < DUREE_NOUVEAU

// --- Droits ----------------------------------------------------------------------------------------------------

// null si le membre peut jouer et recevoir de la monnaie, sinon le motif
function peutJouer(member) {
    const guildId = member.guild.id
    if (!moduleActif(guildId, "communaute.economie")) return "module"
    if (lireCompte(guildId, member.id)?.frozen === 1) return "gele"
    if ((member.communicationDisabledUntilTimestamp ?? 0) > Date.now()) return "sanctionne"
    // Chargé ici pour éviter une dépendance circulaire (quarantaine -> logs, modération...)
    const { getQuarantine } = require('./quarantaine')
    if (getQuarantine(guildId, member.id)) return "sanctionne"
    return null
}

// --- Gains et dépenses -----------------------------------------------------------------------------------------

// actif : gain compté dans le plafond du jour (jeux, travail, messages, drops, vote), après le multiplicateur du serveur.
// Les 7 premiers jours sur le serveur, le gain est divisé par 2 (arrondi bas). sansReduction l'évite : à réserver aux
// gains qu'un compte secondaire ne peut pas farmer (succès uniques difficiles), pas aux quêtes du jour.
// credite peut valoir 0 (plafond du jour atteint) : ok reste vrai, à l'appelant de l'annoncer (clé eco.plafonne).
function crediter(member, montant, { source, actif = false, details = null, otherId = null, sansReduction = false } = {}) {
    verifierMontant(montant)
    verifierSource(source)
    const guildId = member.guild.id, userId = member.id
    return db.transaction(() => {
        const refus = peutJouer(member)
        if (refus) return { ok: false, refus }
        const { balance } = ligneCompte(guildId, userId)
        if (balance >= SOLDE_MAX) return { ok: false, refus: "plafond_solde" }

        const { multiplicateur, plafondJour } = reglages(guildId)
        let gain = montant
        if (actif) gain = Math.floor(gain * multiplicateur)
        if (!sansReduction && estNouveau(member)) gain = Math.floor(gain / 2)
        let plafonne = false
        if (actif) {
            const reste = Math.max(0, plafondJour - compteurs(guildId, userId).active_earned)
            if (gain > reste) {
                gain = reste
                plafonne = true
            }
        }
        // Le solde ne dépasse jamais le maximum : le gain est rogné
        gain = Math.min(gain, SOLDE_MAX - balance)
        if (gain > 0) {
            if (actif) ajouterCompteurs(guildId, userId, { actif: gain })
            mouvement(guildId, userId, gain, balance + gain, { source, otherId, details })
        }
        return { ok: true, credite: gain, solde: balance + gain, plafonne }
    })
}

// Rend une somme prélevée (achat dont la livraison a échoué, changement de métier raté) : aucun contrôle de droits
// (gel, sanction, module), ni plafond du jour, ni réduction « nouveau membre » : le membre retrouve ce qu'il a payé.
// Seul le solde maximum s'applique : au-delà, le crédit est rogné (rogne: true) et le journal ne garde que ce qui est entré.
function rembourser(guildId, userId, montant, { source = "remboursement", details = null, otherId = null } = {}) {
    verifierMontant(montant)
    verifierSource(source)
    return db.transaction(() => {
        const { balance } = ligneCompte(guildId, userId)
        const credite = Math.max(0, Math.min(montant, SOLDE_MAX - balance))
        if (credite > 0) mouvement(guildId, userId, credite, balance + credite, { source, otherId, details })
        return { ok: true, credite, solde: balance + credite, rogne: credite < montant }
    })
}

function debiter(guildId, userId, montant, { source, details = null, otherId = null } = {}) {
    verifierMontant(montant)
    verifierSource(source)
    return db.transaction(() => {
        const ligne = ligneCompte(guildId, userId)
        if (ligne.frozen === 1) return { ok: false, refus: "gele" }
        if (ligne.balance < montant) return { ok: false, refus: "solde" }
        const solde = ligne.balance - montant
        mouvement(guildId, userId, -montant, solde, { source, otherId, details })
        return { ok: true, solde }
    })
}

// Transfert entre deux membres (/payer, marché, échanges...). Les frais sont retenus sur le montant envoyé
// (le destinataire reçoit montant - frais) et détruits : c'est un puits. Plafonds du jour toutes voies confondues.
function transferer(de, vers, montant, { source = "paiement", fraisPourcent = 2 } = {}) {
    verifierMontant(montant)
    verifierSource(source)
    if (typeof fraisPourcent !== "number" || !(fraisPourcent >= 0 && fraisPourcent < 100)) throw new RangeError(`Frais invalides : ${fraisPourcent}`)
    const guildId = de.guild.id
    if (de.id === vers.id) return { ok: false, refus: "soi_meme" }
    if (de.user?.bot || vers.user?.bot) return { ok: false, refus: "bot" }
    const frais = fraisPourcent > 0 ? Math.max(1, Math.floor(montant * fraisPourcent / 100)) : 0
    const recu = montant - frais
    if (recu < 1) return { ok: false, refus: "montant_trop_petit" }

    const resultat = db.transaction(() => {
        const refusDe = peutJouer(de)
        if (refusDe) return { ok: false, refus: refusDe }
        const refusVers = peutJouer(vers)
        // Un seul refus pour le destinataire : on ne dévoile pas un gel ou une sanction décidés par le staff
        if (refusVers) return { ok: false, refus: "destinataire_indisponible" }
        if (estNouveau(de) || estNouveau(vers)) return { ok: false, refus: "compte_recent" }
        if (compteurs(guildId, de.id).sent + montant > ENVOI_MAX_JOUR) return { ok: false, refus: "plafond_envoi" }
        if (compteurs(guildId, vers.id).received + recu > RECEPTION_MAX_JOUR) return { ok: false, refus: "plafond_reception" }
        const compteDe = ligneCompte(guildId, de.id)
        if (compteDe.balance < montant) return { ok: false, refus: "solde" }
        const cible = ligneCompte(guildId, vers.id)
        if (cible.balance + recu > SOLDE_MAX) return { ok: false, refus: "destinataire_plafond_solde" }

        const details = { frais }
        mouvement(guildId, de.id, -montant, compteDe.balance - montant, { source, otherId: vers.id, details })
        mouvement(guildId, vers.id, recu, cible.balance + recu, { source, otherId: de.id, details })
        ajouterCompteurs(guildId, de.id, { envoye: montant })
        ajouterCompteurs(guildId, vers.id, { recu })
        return { ok: true, envoye: montant, frais, recu }
    })
    if (resultat.ok) emettre("paiement", { guildId, userId: de.id, to: vers.id, amount: recu, source })
    return resultat
}

// --- Staff et lecture ------------------------------------------------------------------------------------------

// Lignes du plus récent au plus ancien ; avant : id de ligne pour la page suivante
function journal(guildId, userId, { limite = 20, avant = null } = {}) {
    const n = Math.min(Math.max(Math.trunc(limite) || 20, 1), 100)
    const lignes = avant === null
        ? db.sqlAll("SELECT * FROM eco_journal WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?", [guildId, userId, n])
        : db.sqlAll("SELECT * FROM eco_journal WHERE guild_id = ? AND user_id = ? AND id < ? ORDER BY id DESC LIMIT ?", [guildId, userId, avant, n])
    return lignes.map(l => ({
        id: l.id, delta: l.delta, balanceAfter: l.balance_after, source: l.source, otherId: l.other_id, details: l.details, createdAt: l.created_at
    }))
}

function geler(guildId, userId, gele) {
    ligneCompte(guildId, userId)
    db.sqlRun("UPDATE eco_comptes SET frozen = ? WHERE guild_id = ? AND user_id = ?", [gele ? 1 : 0, guildId, userId])
}

// Remise à zéro par le staff : une ligne de journal (jamais un DELETE), le journal reste cohérent. Renvoie l'ancien solde.
function reinitialiser(guildId, userId, auteurId) {
    return db.transaction(() => {
        const { balance } = ligneCompte(guildId, userId)
        if (balance !== 0) mouvement(guildId, userId, -balance, 0, { source: "reinitialisation", otherId: auteurId })
        return balance
    })
}

// Comptes gelés et soldes nuls exclus du classement
function classement(guildId, { limite = 10, decalage = 0 } = {}) {
    return db.sqlAll(`SELECT user_id, balance FROM eco_comptes WHERE guild_id = ? AND frozen = 0 AND balance > 0
        ORDER BY balance DESC, user_id ASC LIMIT ? OFFSET ?`, [guildId, limite, decalage])
        .map(l => ({ userId: l.user_id, balance: l.balance }))
}

function rang(guildId, userId) {
    const ligne = lireCompte(guildId, userId)
    if (!ligne || ligne.frozen === 1 || ligne.balance <= 0) return null
    const { devant } = db.sqlAll(`SELECT COUNT(*) AS devant FROM eco_comptes WHERE guild_id = ? AND frozen = 0 AND balance > 0
        AND (balance > ? OR (balance = ? AND user_id < ?))`, [guildId, ligne.balance, ligne.balance, userId])[0]
    return devant + 1
}

function verifierCoherence(guildId, userId) {
    const { somme } = db.sqlAll("SELECT COALESCE(SUM(delta), 0) AS somme FROM eco_journal WHERE guild_id = ? AND user_id = ?", [guildId, userId])[0]
    return somme === (lireCompte(guildId, userId)?.balance ?? 0)
}

module.exports = {
    SOLDE_MAX, ENVOI_MAX_JOUR, RECEPTION_MAX_JOUR,
    monnaie, formater, reglages, definirReglages, compte, peutJouer, crediter, rembourser, debiter, transferer,
    journal, geler, reinitialiser, classement, rang, verifierCoherence
}
