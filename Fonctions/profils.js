const db = require('./db')
const economie = require('./economie')
const { emettre, jourParis } = require('./evenements')
const { textes } = require('./i18n')

// Profils (idée #76) et réputation (idée #77).

const BIO_MAX = 200
const REP_ANCIENNETE_MIN = 7 * 24 * 3600 * 1000

// Thèmes cosmétiques : une couleur d'embed, rien d'autre. Les 3 thèmes sont gratuits pour tout le monde.
// Si des thèmes supplémentaires sont ajoutés un jour (premium), ils resteront purement visuels :
// aucun thème ne se vend en monnaie du bot et aucun ne donne d'avantage (gains, plafonds, droits...).
const THEMES = { bleu: 0x5865F2, vert: 0x57F287, rose: 0xEB459E }
const THEME_DEFAUT = "bleu"

// Neutralise les mentions d'un texte écrit par un membre (@everyone, <@id>, <@&id>) sans changer le texte à l'œil
const ZWSP = String.fromCharCode(0x200b)
const sansMention = texte => texte.replace(/[@<]/g, m => m + ZWSP)

// --- Profil ----------------------------------------------------------------------------------------------------

const lireProfil = (guildId, userId) =>
    db.sqlAll("SELECT bio, theme, featured_badge FROM profils WHERE guild_id = ? AND user_id = ?", [guildId, userId])[0]
        ?? { bio: null, theme: null, featured_badge: null }

function ecrireProfil(guildId, userId, colonne, valeur) {
    // colonne vient des trois appels ci-dessous, jamais de l'extérieur
    db.sqlRun(`INSERT INTO profils (guild_id, user_id, ${colonne}) VALUES (?, ?, ?)
        ON CONFLICT (guild_id, user_id) DO UPDATE SET ${colonne} = excluded.${colonne}`, [guildId, userId, valeur])
}

// Texte vide : bio effacée. Renvoie la bio enregistrée, ou null si elle est trop longue.
function definirBio(guildId, userId, texte) {
    const propre = (texte ?? "").trim()
    if ([...propre].length > BIO_MAX) return null
    ecrireProfil(guildId, userId, "bio", propre || null)
    return propre
}

function definirTheme(guildId, userId, theme) {
    if (!(theme in THEMES)) return false
    ecrireProfil(guildId, userId, "theme", theme)
    return true
}

const succesObtenus = (guildId, userId) =>
    db.sqlAll("SELECT achievement FROM succes WHERE guild_id = ? AND user_id = ? ORDER BY earned_at", [guildId, userId]).map(l => l.achievement)

// Le badge mis en avant doit faire partie des succès obtenus. Sans identifiant : badge retiré.
function definirBadge(guildId, userId, badge) {
    if (badge && !succesObtenus(guildId, userId).includes(badge)) return false
    ecrireProfil(guildId, userId, "featured_badge", badge || null)
    return true
}

// Nom d'un succès : locales "succes.<id>.nom" si elle existe, sinon l'identifiant
const nomSucces = (langue, id) => textes[langue]?.[`succes.${id}.nom`] ?? id

function donneesProfil(guildId, userId) {
    const profil = lireProfil(guildId, userId)
    const xp = db.sqlAll("SELECT xp, level FROM xp WHERE guild_id = ? AND user_id = ?", [guildId, userId])[0] ?? { xp: 0, level: 0 }
    // Lecture seule : afficher un profil ne crée pas de compte d'économie
    const solde = db.sqlAll("SELECT balance FROM eco_comptes WHERE guild_id = ? AND user_id = ?", [guildId, userId])[0]?.balance ?? 0
    const succes = succesObtenus(guildId, userId)
    return {
        bio: profil.bio,
        theme: profil.theme in THEMES ? profil.theme : THEME_DEFAUT,
        couleur: THEMES[profil.theme] ?? THEMES[THEME_DEFAUT],
        niveau: xp.level, xp: xp.xp, solde,
        reputation: reputation(guildId, userId),
        nbSucces: succes.length,
        badge: succes.includes(profil.featured_badge) ? profil.featured_badge : null
    }
}

// --- Réputation ------------------------------------------------------------------------------------------------

const reputation = (guildId, userId) =>
    db.sqlAll("SELECT total FROM reputation WHERE guild_id = ? AND user_id = ?", [guildId, userId])[0]?.total ?? 0

// Une réputation par jour (heure de Paris) et par donneur. Refus : soi_meme, bot, compte_recent, sanctionne, deja.
// L'insertion se fait en transaction avec la clé (serveur, donneur, jour) : deux clics simultanés donnent une seule réputation.
function donnerRep(donneur, receveur) {
    if (donneur.id === receveur.id) return { ok: false, refus: "soi_meme" }
    if (receveur.user?.bot || donneur.user?.bot) return { ok: false, refus: "bot" }
    if (!donneur.joinedTimestamp || Date.now() - donneur.joinedTimestamp < REP_ANCIENNETE_MIN) return { ok: false, refus: "compte_recent" }
    // "module" = économie désactivée : sans rapport avec la réputation
    const motif = economie.peutJouer(donneur)
    if (motif && motif !== "module") return { ok: false, refus: "sanctionne" }

    const guildId = donneur.guild.id
    const resultat = db.transaction(() => {
        const ajoute = db.sqlRun("INSERT OR IGNORE INTO rep_donnees (guild_id, giver_id, receiver_id, day) VALUES (?, ?, ?, ?)",
            [guildId, donneur.id, receveur.id, jourParis()])
        if (!ajoute) return { ok: false, refus: "deja" }
        db.sqlRun(`INSERT INTO reputation (guild_id, user_id, total) VALUES (?, ?, 1)
            ON CONFLICT (guild_id, user_id) DO UPDATE SET total = total + 1`, [guildId, receveur.id])
        return { ok: true, total: reputation(guildId, receveur.id) }
    })
    if (resultat.ok) {
        emettre("rep:donnee", { guildId, userId: donneur.id, to: receveur.id })
        emettre("rep:recue", { guildId, userId: receveur.id, from: donneur.id })
    }
    return resultat
}

module.exports = {
    BIO_MAX, THEMES, THEME_DEFAUT, sansMention, lireProfil, definirBio, definirTheme, definirBadge,
    succesObtenus, nomSucces, donneesProfil, reputation, donnerRep
}
