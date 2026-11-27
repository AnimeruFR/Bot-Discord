const db = require('./db')
const { t } = require('./i18n')
const { moduleActif } = require('./modules')
const { emettre, jourParis } = require('./evenements')
const economie = require('./economie')
const paliers = require('./paliers')

// XP et niveaux (idées #39 et #43). Règles et chiffres : docs/ECONOMIE.md §6.
//
// Écriture directe, sans tampon : un membre ne gagne qu'une fois par minute. Un filtre en mémoire écarte les messages
// suivants sans toucher à la base ; il reste donc au plus une petite transaction par minute et par membre.
// Le filtre retient aussi les refus (salon exclu, module coupé, sanction) : un membre refusé n'est pas réexaminé
// avant la minute suivante. Il est purgé par un minuteur, pas par les messages.
// Les réglages du serveur (config et bonus) sont lus une fois par message et gardés 60 s en mémoire par serveur ;
// toute écriture (definir*, et paliers.definirMode) les invalide aussitôt.
// (Un tampon de 30 s ferait perdre des gains en cas de plantage, pour un gain de performance négligeable ici.)
//
// Le premium ne donne JAMAIS de bonus d'XP : rien dans ce fichier ne le lit.

const XP_MIN = 15
const XP_MAX = 25
const INTERVALLE = 60 * 1000
const PLAFOND_JOUR = 3000
const BONUS_MAX = 2          // multiplicateur d'un salon ou d'un rôle
const TOTAL_MAX = 2.5        // multiplicateur total, tous bonus confondus
const BOOST_MAX = 1.25
const MAX_EXCLUS = 50
const MAX_BONUS = 25         // par type (salons, rôles)
const SANS_ANNONCE = "aucun" // valeur de levelup_channel_id quand les annonces sont coupées
const DUREE_CACHE = 60 * 1000
const TAILLE_FILTRE_MAX = 100000 // garde-fou : au-delà, le filtre est vidé
const ECLATS_JOUR_MAX = 100  // monnaie gagnée par l'activité écrite (1 ✦ par gain d'XP), par jour et par membre
const STAT_ECLATS_JOUR = "xp_eclats_jour" // stats_joueur : AAAAMMJJ * 1000 + monnaie déjà versée ce jour-là

// --- Niveaux ---------------------------------------------------------------------------------------------------

// XP pour passer du niveau L au niveau L+1
const xpPourNiveau = niveau => 100 + 40 * niveau + 4 * niveau * niveau

// XP cumulée nécessaire pour atteindre le niveau L : somme de xpPourNiveau(0) à xpPourNiveau(L-1)
const xpCumulee = niveau => 100 * niveau + 20 * niveau * (niveau - 1) + 4 * (niveau - 1) * niveau * (2 * niveau - 1) / 6

function niveauPourXp(xp) {
    let niveau = 0, seuil = xpPourNiveau(0)
    while (xp >= seuil) {
        niveau++
        seuil += xpPourNiveau(niveau)
    }
    return niveau
}

// { niveau, dansNiveau (XP gagnée dans ce niveau), pourNiveau (XP du niveau) }
function progression(xp) {
    const niveau = niveauPourXp(xp)
    return { niveau, dansNiveau: xp - xpCumulee(niveau), pourNiveau: xpPourNiveau(niveau) }
}

// Barre de progression en texte
function barre(dans, pour, cases = 10) {
    const pleines = Math.max(0, Math.min(cases, Math.floor(dans / pour * cases)))
    return "▰".repeat(pleines) + "▱".repeat(cases - pleines)
}

// --- Réglages du serveur ---------------------------------------------------------------------------------------

function lireConfig(guildId) {
    const l = db.sqlAll("SELECT * FROM xp_config WHERE guild_id = ?", [guildId])[0]
    let exclus = []
    try { exclus = JSON.parse(l?.excluded_channels ?? "[]") } catch { /* liste abîmée : aucun salon exclu */ }
    return {
        exclus: Array.isArray(exclus) ? exclus : [],
        weekend: l?.weekend_double === 1,
        salonAnnonce: l?.levelup_channel_id ?? null, // null : salon du message ; SANS_ANNONCE : coupées
        mode: l?.tier_mode === "remplace" ? "remplace" : "cumul"
    }
}

// Champ de xp_config (liste fermée : jamais un nom venu de l'extérieur)
const COLONNES_CONFIG = ["excluded_channels", "weekend_double", "levelup_channel_id"]
function ecrireConfig(guildId, colonne, valeur) {
    if (!COLONNES_CONFIG.includes(colonne)) throw new RangeError(`colonne inconnue : ${colonne}`)
    db.sqlRun(`INSERT INTO xp_config (guild_id, ${colonne}) VALUES (?, ?) ON CONFLICT (guild_id) DO UPDATE SET ${colonne} = excluded.${colonne}`, [guildId, valeur])
    invaliderReglages(guildId)
}

// --- Cache des réglages (60 s par serveur) ---------------------------------------------------------------------

const cacheReglages = new Map() // guildId -> { jusqua, config, salons, roles }

// Config et bonus du serveur, lus au plus une fois par minute. À appeler après toute écriture dans xp_config ou xp_bonus.
function invaliderReglages(guildId) {
    if (guildId) cacheReglages.delete(guildId)
    else cacheReglages.clear()
}

function reglages(guildId) {
    const maintenant = Date.now()
    let r = cacheReglages.get(guildId)
    if (!r || r.jusqua <= maintenant) {
        r = { jusqua: maintenant + DUREE_CACHE, config: lireConfig(guildId), salons: listerBonus(guildId, "salon"), roles: listerBonus(guildId, "role") }
        cacheReglages.set(guildId, r)
    }
    return r
}

// Exclut ou réinclut un salon (ou une catégorie : ses salons et ses fils sont exclus avec). Renvoie false si rien n'a changé.
function definirExclusion(guildId, channelId, exclu) {
    return db.transaction(() => {
        const { exclus } = lireConfig(guildId)
        if (exclu === exclus.includes(channelId)) return false
        if (exclu && exclus.length >= MAX_EXCLUS) throw new RangeError(`au plus ${MAX_EXCLUS} salons exclus`)
        ecrireConfig(guildId, "excluded_channels", JSON.stringify(exclu ? [...exclus, channelId] : exclus.filter(id => id !== channelId)))
        return true
    })
}

const definirWeekend = (guildId, actif) => ecrireConfig(guildId, "weekend_double", actif ? 1 : 0)

// salonId : un salon ; null : le salon du message ; SANS_ANNONCE : pas d'annonce
const definirSalonAnnonce = (guildId, salonId) => ecrireConfig(guildId, "levelup_channel_id", salonId)

const listerBonus = (guildId, kind) =>
    db.sqlAll("SELECT target, multiplier FROM xp_bonus WHERE guild_id = ? AND kind = ? ORDER BY multiplier DESC, target ASC", [guildId, kind])
        .map(l => ({ cible: l.target, multiplicateur: l.multiplier }))

// kind : "salon" ou "role". Multiplicateur de 1 (ou moins) : le bonus est retiré. Au-delà de 2 : RangeError.
function definirBonus(guildId, kind, cible, multiplicateur) {
    if (!["salon", "role"].includes(kind)) throw new RangeError("kind : salon ou role")
    if (typeof multiplicateur !== "number" || !(multiplicateur <= BONUS_MAX)) throw new RangeError(`multiplicateur : au plus ×${BONUS_MAX}`)
    db.transaction(() => {
        if (multiplicateur <= 1) {
            db.sqlRun("DELETE FROM xp_bonus WHERE guild_id = ? AND kind = ? AND target = ?", [guildId, kind, cible])
            return
        }
        const existe = db.sqlAll("SELECT 1 AS un FROM xp_bonus WHERE guild_id = ? AND kind = ? AND target = ?", [guildId, kind, cible]).length > 0
        if (!existe && listerBonus(guildId, kind).length >= MAX_BONUS) throw new RangeError(`au plus ${MAX_BONUS} bonus par type`)
        db.sqlRun(`INSERT INTO xp_bonus (guild_id, kind, target, multiplier) VALUES (?, ?, ?, ?)
            ON CONFLICT (guild_id, kind, target) DO UPDATE SET multiplier = excluded.multiplier`, [guildId, kind, cible, multiplicateur])
    })
    invaliderReglages(guildId)
}

// --- Bonus -----------------------------------------------------------------------------------------------------

// Samedi et dimanche, heure de Paris
function estWeekend(instant = Date.now()) {
    const jour = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", weekday: "short" }).format(new Date(instant))
    return jour === "Sat" || jour === "Sun"
}

// Boost personnel (boutique) : 1 ou 1,25. Module absent ou en échec : pas de boost.
function boost(guildId, userId, instant) {
    try {
        const valeur = require('./inventaire').boostXp(guildId, userId, instant)
        return Number.isFinite(valeur) && valeur > 1 ? Math.min(valeur, BOOST_MAX) : 1
    } catch {
        return 1
    }
}

// Le plus grand multiplicateur parmi ceux qui s'appliquent (1 s'il n'y en a aucun)
const plusGrand = (liste, concerne) => liste.filter(b => concerne(b.cible)).reduce((max, b) => Math.max(max, Math.min(b.multiplicateur, BONUS_MAX)), 1)

// Identifiants à tester pour un salon : lui-même, son parent (salon d'un fil) et la catégorie
function idsSalon(channel) {
    return [channel?.id, channel?.parentId, channel?.parent?.parentId].filter(Boolean)
}

// Plus grand bonus de salon, plus grand bonus de rôle, week-end ×2, boost perso : multipliés, puis plafonnés à ×2,5
// (réglages : ceux du cache du serveur, ou ceux que l'appelant vient déjà de lire)
function multiplicateur(guildId, member, channel, instant = Date.now(), { config, salons, roles } = reglages(guildId)) {
    const ids = idsSalon(channel)
    const salon = plusGrand(salons, cible => ids.includes(cible))
    const role = plusGrand(roles, cible => member.roles?.cache?.has(cible))
    const weekend = config.weekend && estWeekend(instant) ? 2 : 1
    const perso = boost(guildId, member.id, instant)
    return { salon, role, weekend, boost: perso, total: Math.min(salon * role * weekend * perso, TOTAL_MAX) }
}

// --- Gain d'XP -------------------------------------------------------------------------------------------------

// Filtre en mémoire, la base fait foi. Clé « serveur:membre » -> instant du dernier gain ou du dernier refus (module,
// sanction) ; clé « serveur:membre:salon » -> instant du dernier refus pour salon exclu (le membre peut gagner ailleurs).
const derniersEssais = new Map()
let minuteurPurge = null

function memoriser(cle, instant) {
    if (derniersEssais.size >= TAILLE_FILTRE_MAX) derniersEssais.clear()
    derniersEssais.set(cle, instant)
    if (!minuteurPurge) {
        minuteurPurge = setInterval(() => {
            const limite = Date.now() - INTERVALLE
            for (const [cle, instant] of derniersEssais) if (instant < limite) derniersEssais.delete(cle)
        }, INTERVALLE)
        minuteurPurge.unref()
    }
}

const recent = (cle, maintenant) => maintenant - (derniersEssais.get(cle) ?? 0) < INTERVALLE

// Motif de refus (sanctionné, compte gelé) ou null. Si l'économie est coupée, peutJouer ne vérifie rien : on vérifie ici.
function refusXp(member) {
    const refus = economie.peutJouer(member)
    if (refus !== "module") return refus
    if ((member.communicationDisabledUntilTimestamp ?? 0) > Date.now()) return "sanctionne"
    // Chargé ici pour éviter une dépendance circulaire (comme dans economie.js)
    if (require('./quarantaine').getQuarantine(member.guild.id, member.id)) return "sanctionne"
    return "module"
}

// Donne l'XP d'un message (message.guild et message.member requis ; les bots sont filtrés par l'appelant, et ici aussi).
// Renvoie null si rien n'est gagné, sinon { gain, xp, niveau, ancienNiveau, multiplicateur }.
// maintenant et alea : pour les tests.
async function gagnerXp(message, { maintenant = Date.now(), alea = Math.random } = {}) {
    const guild = message.guild, member = message.member
    if (!guild || !member || message.author?.bot) return null
    const cle = `${guild.id}:${member.id}`
    const salon = message.channel ?? { id: message.channelId }
    const cleSalon = `${cle}:${salon.id}`
    if (recent(cle, maintenant) || recent(cleSalon, maintenant)) return null
    if (!moduleActif(guild.id, "communaute.niveaux")) {
        memoriser(cle, maintenant)
        return null
    }
    const regl = reglages(guild.id) // lus une seule fois pour ce message
    if (regl.config.exclus.some(id => idsSalon(salon).includes(id))) {
        memoriser(cleSalon, maintenant)
        return null
    }
    const refus = refusXp(member)
    if (refus && refus !== "module") {
        memoriser(cle, maintenant)
        return null
    }
    memoriser(cle, maintenant)

    const bonus = multiplicateur(guild.id, member, salon, maintenant, regl)
    const base = XP_MIN + Math.floor(alea() * (XP_MAX - XP_MIN + 1))
    const jour = jourParis(maintenant)
    const resultat = db.transaction(() => {
        const ligne = db.sqlAll("SELECT * FROM xp WHERE guild_id = ? AND user_id = ?", [guild.id, member.id])[0]
        // La base fait foi : un redémarrage du bot ne remet pas le délai à zéro
        if (ligne?.last_gain_at && maintenant - ligne.last_gain_at < INTERVALLE) return null
        const reste = PLAFOND_JOUR - (ligne?.day === jour ? ligne.day_xp : 0)
        if (reste <= 0) return null
        const gain = Math.min(Math.round(base * bonus.total), reste)
        const xp = (ligne?.xp ?? 0) + gain
        const niveau = niveauPourXp(xp)
        db.sqlRun(`INSERT INTO xp (guild_id, user_id, xp, level, last_gain_at, day, day_xp) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (guild_id, user_id) DO UPDATE SET xp = excluded.xp, level = excluded.level, last_gain_at = excluded.last_gain_at,
            day = excluded.day, day_xp = excluded.day_xp`, [guild.id, member.id, xp, niveau, maintenant, jour, PLAFOND_JOUR - reste + gain])
        return { gain, xp, niveau, ancienNiveau: ligne?.level ?? 0 }
    })
    if (!resultat) return null

    // 1 ✦ par gain (100 par jour au plus), seulement si l'économie est active : un refus ou une erreur d'économie ne retire jamais l'XP
    if (refus === null) {
        try {
            crediterActivite(member, jour)
        } catch (err) {
            console.error("XP, crédit de monnaie :", err.message)
        }
    }
    if (resultat.niveau > resultat.ancienNiveau) await passageDeNiveau(message, resultat.ancienNiveau, resultat.niveau, regl.config)
    return { ...resultat, multiplicateur: bonus.total }
}

// 1 ✦ pour un gain d'XP, tant que la monnaie d'activité du jour n'a pas atteint ECLATS_JOUR_MAX. Le compteur est une ligne
// de stats_joueur qui repart de zéro chaque jour (sans ligne par jour). Tout est synchrone : pas de dépassement possible
// entre la lecture du compteur et son écriture. Un gain refusé ou plafonné par l'économie (plafond du jour) n'est pas compté.
function crediterActivite(member, jour) {
    const guildId = member.guild.id, userId = member.id
    const numero = Number(jour.replaceAll("-", ""))
    const ligne = db.sqlAll("SELECT value FROM stats_joueur WHERE guild_id = ? AND user_id = ? AND stat = ?", [guildId, userId, STAT_ECLATS_JOUR])[0]
    const deja = ligne && Math.floor(ligne.value / 1000) === numero ? ligne.value % 1000 : 0
    if (deja >= ECLATS_JOUR_MAX) return
    const credit = economie.crediter(member, 1, { source: "xp", actif: true })
    if (!credit.ok || credit.credite <= 0) return
    db.sqlRun(`INSERT INTO stats_joueur (guild_id, user_id, stat, value) VALUES (?, ?, ?, ?)
        ON CONFLICT (guild_id, user_id, stat) DO UPDATE SET value = excluded.value`, [guildId, userId, STAT_ECLATS_JOUR, numero * 1000 + deja + credit.credite])
}

// Paliers, annonce et événement. Une erreur Discord (rôle, salon) n'annule jamais le niveau déjà écrit.
async function passageDeNiveau(message, ancien, niveau, config) {
    const guild = message.guild, member = message.member
    let bilan = { roles: [], retires: [], recompense: 0 }
    try {
        bilan = await paliers.appliquerPaliers(member, ancien, niveau)
    } catch (err) {
        console.error("XP, paliers :", err.message)
    }
    try {
        await annoncer(message, niveau, bilan, config)
    } catch (err) {
        console.error("XP, annonce de niveau :", err.message)
    }
    emettre("niveau", { guildId: guild.id, userId: member.id, level: niveau })
}

async function annoncer(message, niveau, bilan, config) {
    const guild = message.guild
    const { salonAnnonce } = config
    if (salonAnnonce === SANS_ANNONCE) return
    const canal = (salonAnnonce && guild.channels.cache.get(salonAnnonce)) || message.channel
    if (!canal?.send) return
    const droits = canal.permissionsFor?.(guild.members.me)
    if (droits && !droits.has(["ViewChannel", "SendMessages"])) return
    let texte = t(guild, "niv.monte", { membre: `<@${message.member.id}>`, niveau })
    if (bilan.roles.length) texte += "\n" + t(guild, "niv.monte_roles", { roles: bilan.roles.map(id => `<@&${id}>`).join(" ") })
    if (bilan.recompense > 0) texte += "\n" + t(guild, "niv.monte_recompense", { montant: economie.formater(guild.id, bilan.recompense) })
    await canal.send({ content: texte, allowedMentions: { parse: [] } })
}

// --- Lecture (pour /rang) --------------------------------------------------------------------------------------

// Rang au classement : XP décroissante, puis identifiant (stable). null si le membre n'a aucune XP.
function profilXp(guildId, userId, instant = Date.now()) {
    const ligne = db.sqlAll("SELECT * FROM xp WHERE guild_id = ? AND user_id = ?", [guildId, userId])[0]
    const xp = ligne?.xp ?? 0
    let rang = null
    if (xp > 0) {
        const { devant } = db.sqlAll("SELECT COUNT(*) AS devant FROM xp WHERE guild_id = ? AND (xp > ? OR (xp = ? AND user_id < ?))", [guildId, xp, xp, userId])[0]
        rang = devant + 1
    }
    return { xp, ...progression(xp), rang, xpJour: ligne?.day === jourParis(instant) ? ligne.day_xp : 0 }
}

module.exports = {
    XP_MIN, XP_MAX, INTERVALLE, PLAFOND_JOUR, ECLATS_JOUR_MAX, BONUS_MAX, TOTAL_MAX, MAX_EXCLUS, MAX_BONUS, SANS_ANNONCE,
    xpPourNiveau, xpCumulee, niveauPourXp, progression, barre,
    lireConfig, definirExclusion, definirWeekend, definirSalonAnnonce, listerBonus, definirBonus,
    estWeekend, multiplicateur, gagnerXp, profilXp, invaliderReglages
}
