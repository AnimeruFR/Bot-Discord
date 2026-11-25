const Discord = require('discord.js')
const db = require('./db')
const { moduleActif } = require('./modules')
const { envoyerLog } = require('./logs')

// Filtre de pseudos (idée #25) : corrige à l'arrivée et au changement de pseudo
//   - les caractères « hoist » en tête (!, ., -, ', ", *, (, [… ou invisibles) qui placent le membre tout en haut de la liste ;
//   - le zalgo (pile de diacritiques combinants) ;
//   - les mots interdits du serveur (nick_filter), sans tenir compte de la casse ni des accents.
// Actif seulement si le serveur l'a activé (une ligne dans nick_filter).

const MAX_MOTS = 50
const MAX_LONGUEUR_MOT = 32
const MIN_LONGUEUR_MOT = 2
const LONGUEUR_PSEUDO = 32

// Garde-fou contre une dispute avec un autre bot ou un membre qui remet son pseudo : 3 renommages par membre et 10 minutes
const MAX_RENOMMAGES = 3
const FENETRE_RENOMMAGES = 10 * 60 * 1000
const MAX_SUIVIS = 2000
const renommages = new Map() // "serveur:membre" -> { debut, n }

// Caractères qui placent un pseudo en haut de la liste : espaces, ponctuation ASCII et caractères invisibles
const estInvisible = point => (point >= 0x200B && point <= 0x200F) || point === 0x2060 || point === 0xFEFF
const estHoist = c => /^[\s!-/:-@[-`{-~]$/.test(c) || estInvisible(c.codePointAt(0))
function retirerDebut(texte) {
    let debut = 0
    for (const c of texte) {
        if (!estHoist(c)) break
        debut += c.length
    }
    return texte.slice(debut)
}

const sansMarques = texte => texte.normalize("NFD").replace(/\p{M}/gu, "")
// Forme de comparaison : sans accents, sans casse
const normaliser = texte => sansMarques(sansMarques(texte).toLowerCase())

// Beaucoup de diacritiques : une pile de 3 ou plus sur une lettre, ou davantage de marques que de lettres
function estZalgo(texte) {
    const nfd = texte.normalize("NFD")
    const marques = nfd.match(/\p{M}/gu)?.length ?? 0
    return /\p{M}{3,}/u.test(nfd) || (marques >= 6 && marques > nfd.length - marques)
}

// Retire les mots interdits. La recherche se fait sur la forme normalisée, la suppression sur le texte d'origine :
// chaque lettre (avec ses accents) garde le lien avec sa forme normalisée.
function retirerMots(texte, mots) {
    if (!mots.length) return texte
    const lettres = []
    for (const c of texte) {
        if (/^\p{M}$/u.test(c) && lettres.length) lettres[lettres.length - 1].brut += c
        else lettres.push({ brut: c })
    }
    let norme = ""
    const proprietaire = []
    lettres.forEach((l, i) => {
        l.norme = normaliser(l.brut)
        for (let k = 0; k < l.norme.length; k++) proprietaire.push(i)
        norme += l.norme
    })
    const retirees = new Set()
    for (const mot of mots) {
        for (let pos = norme.indexOf(mot); pos !== -1; pos = norme.indexOf(mot, pos + 1)) {
            for (let k = pos; k < pos + mot.length; k++) retirees.add(proprietaire[k])
        }
    }
    return lettres.filter((_, i) => !retirees.has(i)).map(l => l.brut).join("")
}

function passe(texte, mots) {
    let r = texte
    if (estZalgo(r)) r = sansMarques(r).normalize("NFC")
    r = retirerDebut(retirerMots(r, mots))
    return r === texte ? r : r.replace(/\s{2,}/g, " ").trim()
}

// Pseudo corrigé (le même s'il n'y a rien à corriger). Rien ne reste : « Membre » et les 4 derniers chiffres de l'identifiant.
function nettoyer(pseudo, mots = [], id = "0000") {
    const interdits = mots.map(normaliser).filter(Boolean)
    let r = pseudo
    for (let i = 0; i < 5; i++) {
        const suivant = passe(r, interdits)
        if (suivant === r) break
        r = suivant
    }
    if (r === pseudo) return r
    if (r.length > LONGUEUR_PSEUDO) r = [...r].slice(0, LONGUEUR_PSEUDO).join("").trim()
    return r || `Membre ${String(id).slice(-4)}`
}

// --- Réglage du serveur (table nick_filter) ---

// null : filtre inactif sur ce serveur
function lireFiltre(guildId) {
    const ligne = db.sqlAll("SELECT banned_words FROM nick_filter WHERE guild_id = ?", [guildId])[0]
    if (!ligne) return null
    let mots = []
    try { mots = JSON.parse(ligne.banned_words) } catch { /* liste illisible : filtre actif sans mot */ }
    return { mots: Array.isArray(mots) ? mots.filter(m => typeof m === "string") : [] }
}

// Renvoie false s'il était déjà actif
function activerFiltre(guildId) {
    return db.sqlRun("INSERT OR IGNORE INTO nick_filter (guild_id, banned_words) VALUES (?, '[]')", [guildId]) > 0
}

// Renvoie false s'il était déjà coupé. La liste de mots est effacée avec lui.
function desactiverFiltre(guildId) {
    return db.sqlRun("DELETE FROM nick_filter WHERE guild_id = ?", [guildId]) > 0
}

// Mot saisi : sans espaces en trop ni apostrophes inversées (il est affiché entre « ` »)
const nettoyerMot = mot => String(mot ?? "").replace(/`/g, "").replace(/\s+/g, " ").trim()

// Ajoute un mot. Renvoie "ok", "inactif", "invalide", "doublon" ou "limite".
function ajouterMot(guildId, saisie) {
    const mot = nettoyerMot(saisie)
    const norme = normaliser(mot)
    if (norme.length < MIN_LONGUEUR_MOT || mot.length > MAX_LONGUEUR_MOT) return "invalide"
    return db.transaction(() => {
        const filtre = lireFiltre(guildId)
        if (!filtre) return "inactif"
        if (filtre.mots.some(m => normaliser(m) === norme)) return "doublon"
        if (filtre.mots.length >= MAX_MOTS) return "limite"
        db.sqlRun("UPDATE nick_filter SET banned_words = ? WHERE guild_id = ?", [JSON.stringify([...filtre.mots, mot]), guildId])
        return "ok"
    })
}

// Retire un mot. Renvoie "ok", "inactif" ou "absent".
function retirerMot(guildId, saisie) {
    const norme = normaliser(nettoyerMot(saisie))
    return db.transaction(() => {
        const filtre = lireFiltre(guildId)
        if (!filtre) return "inactif"
        const restants = filtre.mots.filter(m => normaliser(m) !== norme)
        if (restants.length === filtre.mots.length) return "absent"
        db.sqlRun("UPDATE nick_filter SET banned_words = ? WHERE guild_id = ?", [JSON.stringify(restants), guildId])
        return "ok"
    })
}

// --- Correction d'un membre ---

function renommageAutorise(cle) {
    const maintenant = Date.now()
    const suivi = renommages.get(cle)
    if (!suivi || maintenant - suivi.debut > FENETRE_RENOMMAGES) {
        renommages.delete(cle)
        renommages.set(cle, { debut: maintenant, n: 1 })
        if (renommages.size > MAX_SUIVIS) renommages.delete(renommages.keys().next().value)
        return true
    }
    if (suivi.n >= MAX_RENOMMAGES) return false
    suivi.n++
    return true
}

// Corrige le pseudo affiché d'un membre. Renvoie { avant, apres } si le membre a été renommé, sinon null.
// Appelée à l'arrivée et à chaque changement de pseudo : le renommage du bot redéclenche guildMemberUpdate,
// mais le pseudo corrigé est déjà propre, donc il n'y a rien à refaire (et le garde-fou ci-dessus coupe toute dispute).
async function corrigerPseudo(member) {
    const guild = member?.guild
    if (!guild || member.user?.bot || member.id === guild.ownerId) return null
    if (!moduleActif(guild.id, "moderation")) return null
    const filtre = lireFiltre(guild.id)
    if (!filtre) return null
    // « manageable » ne regarde que la hiérarchie : il faut aussi la permission de changer les pseudos
    if (!member.manageable || !guild.members.me?.permissions.has(Discord.PermissionsBitField.Flags.ManageNicknames)) return null

    const avant = member.displayName
    const apres = nettoyer(avant, filtre.mots, member.id)
    if (apres === avant) return null
    if (!renommageAutorise(`${guild.id}:${member.id}`)) return null

    try {
        await member.setNickname(apres, "Filtre de pseudos")
    } catch {
        return null // permission retirée, membre parti, hiérarchie changée : le prochain changement de pseudo retentera
    }
    const embed = new Discord.EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle("Pseudo corrigé")
        .addFields(
            { name: "Membre", value: `${member} (\`${member.id}\`)` },
            { name: "Avant", value: Discord.escapeMarkdown(avant).slice(0, 1024) || "(vide)", inline: true },
            { name: "Après", value: Discord.escapeMarkdown(apres).slice(0, 1024), inline: true }
        )
        .setTimestamp()
    await envoyerLog(guild, "membres", embed)
    return { avant, apres }
}

module.exports = {
    corrigerPseudo, nettoyer, normaliser, lireFiltre, activerFiltre, desactiverFiltre, ajouterMot, retirerMot,
    MAX_MOTS, MAX_LONGUEUR_MOT
}
