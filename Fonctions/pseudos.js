const Discord = require('discord.js')
const db = require('./db')
const { moduleActif } = require('./modules')
const { envoyerLog } = require('./logs')
const { estAuDessus, fetchMember } = require('./moderation')

// Filtre de pseudos (idée #25) : corrige à l'arrivée et au changement de pseudo
//   - les caractères « hoist » en tête (!, ., -, ', ", *, (, [… ou invisibles) qui placent le membre tout en haut de la liste ;
//   - le zalgo (pile de diacritiques combinants) ;
//   - les mots interdits du serveur (nick_filter), sans tenir compte de la casse ni des accents.
// Actif seulement si le serveur l'a activé (une ligne dans nick_filter).
//
// Limite de pouvoir (tribunal phase 2, S1) : le filtre garde qui l'a réglé en dernier (nick_filter.configured_by).
// Le bot ne renomme que des membres SANS permission de modération, strictement sous son propre rôle ET strictement
// sous le rôle de cet auteur (le propriétaire n'a pas de limite). Si l'auteur n'est plus sur le serveur, ou s'il est
// inconnu (filtre créé avant la migration 018), personne n'est renommé. /pseudos demande « Gérer le serveur »
// en plus de « Gérer les pseudos » pour activer le filtre et changer ses mots.

const MAX_MOTS = 50
const MAX_LONGUEUR_MOT = 32
const MIN_LONGUEUR_MOT = 2
const LONGUEUR_PSEUDO = 32
const pseudoNeutre = id => `Membre ${String(id).slice(-4)}`

// Un membre avec une de ces permissions n'est jamais renommé
const { Flags } = Discord.PermissionsBitField
const PERMS_STAFF = Flags.ManageNicknames | Flags.ModerateMembers | Flags.KickMembers | Flags.BanMembers | Flags.ManageGuild | Flags.Administrator

// Détecte une dispute avec un autre bot (ou un membre qui remet son pseudo) : au plus 3 renommages par membre en 10 minutes.
// Passé ce plafond, le bot ne renomme plus ce membre jusqu'à la fin de la fenêtre et écrit un seul log : pas de boucle.
const MAX_RENOMMAGES = 3
const FENETRE_RENOMMAGES = 10 * 60 * 1000
const MAX_SUIVIS = 2000
const renommages = new Map() // "serveur:membre" -> { debut, n, signale }

// Auteur du filtre introuvable : un seul log par jour et par serveur, et pas de nouvelle recherche pendant 5 minutes
const JOUR = 24 * 60 * 60 * 1000
const RECHERCHE_AUTEUR = 5 * 60 * 1000
const auteursAbsents = new Map() // serveur -> { vu, logue, auteur }

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
    return r || pseudoNeutre(id)
}

// --- Réglage du serveur (table nick_filter) ---

// null : filtre inactif sur ce serveur
function lireFiltre(guildId) {
    const ligne = db.sqlAll("SELECT banned_words, configured_by FROM nick_filter WHERE guild_id = ?", [guildId])[0]
    if (!ligne) return null
    let mots = []
    try { mots = JSON.parse(ligne.banned_words) } catch { /* liste illisible : filtre actif sans mot */ }
    return { mots: Array.isArray(mots) ? mots.filter(m => typeof m === "string") : [], configuredBy: ligne.configured_by ?? null }
}

// Renvoie false s'il était déjà actif. auteurId : qui active (le bot ne renommera que sous son rôle).
// Un filtre déjà actif prend aussi le nouvel auteur : c'est ainsi qu'un filtre d'avant la migration 018 en reçoit un.
function activerFiltre(guildId, auteurId = null) {
    const neuf = db.sqlRun("INSERT OR IGNORE INTO nick_filter (guild_id, banned_words, configured_by) VALUES (?, '[]', ?)", [guildId, auteurId]) > 0
    if (!neuf && auteurId) db.sqlRun("UPDATE nick_filter SET configured_by = ? WHERE guild_id = ?", [auteurId, guildId])
    return neuf
}

// Renvoie false s'il était déjà coupé. La liste de mots est effacée avec lui.
function desactiverFiltre(guildId) {
    return db.sqlRun("DELETE FROM nick_filter WHERE guild_id = ?", [guildId]) > 0
}

// Mot saisi : sans espaces en trop ni apostrophes inversées (il est affiché entre « ` »)
const nettoyerMot = mot => String(mot ?? "").replace(/`/g, "").replace(/\s+/g, " ").trim()

// Ajoute un mot (auteurId devient l'auteur du filtre). Renvoie "ok", "inactif", "invalide", "doublon" ou "limite".
function ajouterMot(guildId, saisie, auteurId = null) {
    const mot = nettoyerMot(saisie)
    const norme = normaliser(mot)
    if (norme.length < MIN_LONGUEUR_MOT || mot.length > MAX_LONGUEUR_MOT) return "invalide"
    return db.transaction(() => {
        const filtre = lireFiltre(guildId)
        if (!filtre) return "inactif"
        if (filtre.mots.some(m => normaliser(m) === norme)) return "doublon"
        if (filtre.mots.length >= MAX_MOTS) return "limite"
        db.sqlRun("UPDATE nick_filter SET banned_words = ?, configured_by = COALESCE(?, configured_by) WHERE guild_id = ?", [JSON.stringify([...filtre.mots, mot]), auteurId, guildId])
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

// Compte un renommage. Renvoie "ok", "plafond" (premier refus de la fenêtre : un log) ou "plafond-signale" (déjà signalé).
// Au plafond, rien n'est compté de plus et le membre n'est plus renommé jusqu'à la fin de la fenêtre.
function compterRenommage(cle) {
    const maintenant = Date.now()
    const suivi = renommages.get(cle)
    if (!suivi || maintenant - suivi.debut > FENETRE_RENOMMAGES) {
        renommages.delete(cle)
        renommages.set(cle, { debut: maintenant, n: 1, signale: false })
        if (renommages.size > MAX_SUIVIS) renommages.delete(renommages.keys().next().value)
        return "ok"
    }
    if (suivi.n < MAX_RENOMMAGES) {
        suivi.n++
        return "ok"
    }
    if (suivi.signale) return "plafond-signale"
    suivi.signale = true
    return "plafond"
}

// Pourquoi le pseudo est corrigé, sans jamais citer le pseudo lui-même (texte écrit par le membre)
function motifs(pseudo, mots) {
    const interdits = mots.map(normaliser).filter(Boolean)
    const liste = []
    if (retirerDebut(pseudo) !== pseudo) liste.push("hoist")
    if (estZalgo(pseudo)) liste.push("zalgo")
    if (retirerMots(pseudo, interdits) !== pseudo) liste.push("mot interdit")
    return liste.length ? liste : ["hoist"]
}

// Peut-on renommer ce membre ? Ni staff, ni bot, ni propriétaire, et strictement sous le bot (« manageable » ne suffit pas).
function renommable(member) {
    const guild = member.guild
    const moi = guild.members.me
    if (!moi?.permissions.has(Flags.ManageNicknames)) return false
    if (!member.permissions || member.permissions.any(PERMS_STAFF)) return false // permissions inconnues : par prudence, on ne touche pas
    return estAuDessus(moi, member)
}

// Membre qui a réglé le filtre. Renvoie le membre, null s'il n'est plus sur le serveur (ou inconnu), undefined si Discord
// n'a pas répondu (rien à signaler : on réessaiera au prochain pseudo).
async function auteurDuFiltre(guild, filtre) {
    if (!filtre.configuredBy) return null
    const connu = guild.members.cache?.get(filtre.configuredBy)
    if (connu) return connu
    const suivi = auteursAbsents.get(guild.id)
    if (suivi?.auteur === filtre.configuredBy && Date.now() - suivi.vu < RECHERCHE_AUTEUR) return null
    try {
        return await fetchMember(guild, filtre.configuredBy)
    } catch {
        return undefined
    }
}

// Pas d'auteur utilisable : personne n'est renommé, et le staff est prévenu au plus une fois par jour et par serveur
async function signalerAuteurAbsent(guild, filtre) {
    const maintenant = Date.now()
    const suivi = auteursAbsents.get(guild.id) ?? { vu: 0, logue: 0 }
    suivi.vu = maintenant
    suivi.auteur = filtre.configuredBy
    const doitLoguer = maintenant - suivi.logue >= JOUR
    if (doitLoguer) suivi.logue = maintenant
    auteursAbsents.delete(guild.id)
    auteursAbsents.set(guild.id, suivi)
    if (auteursAbsents.size > MAX_SUIVIS) auteursAbsents.delete(auteursAbsents.keys().next().value)
    if (!doitLoguer) return
    const qui = filtre.configuredBy ? `<@${filtre.configuredBy}> n'est plus sur le serveur` : "l'auteur du filtre est inconnu (filtre créé avant la mise à jour)"
    const embed = new Discord.EmbedBuilder()
        .setColor(0xE67E22)
        .setTitle("Filtre de pseudos en pause")
        .setDescription(`Aucun pseudo n'est corrigé : ${qui}. Réactivez le filtre avec \`/pseudos action:activer\` (ou ajoutez un mot) pour désigner un nouvel auteur.`)
        .setTimestamp()
    await envoyerLog(guild, "membres", embed)
}

// Corrige le pseudo affiché d'un membre. Renvoie { avant, apres } si le membre a été renommé, sinon null.
// Appelée à l'arrivée et à chaque changement de pseudo : le renommage du bot redéclenche guildMemberUpdate,
// mais le pseudo corrigé est déjà propre, donc il n'y a rien à refaire.
async function corrigerPseudo(member) {
    const guild = member?.guild
    if (!guild || member.user?.bot || member.id === guild.ownerId) return null
    if (!moduleActif(guild.id, "moderation")) return null
    const filtre = lireFiltre(guild.id)
    if (!filtre || !renommable(member)) return null

    const avant = member.displayName
    const apres = nettoyer(avant, filtre.mots, member.id)
    if (apres === avant) return null

    // Jamais plus de pouvoir par le bot que celui qui a réglé le filtre
    const auteur = await auteurDuFiltre(guild, filtre)
    if (auteur === undefined) return null
    if (!auteur) {
        await signalerAuteurAbsent(guild, filtre)
        return null
    }
    if (!estAuDessus(auteur, member)) return null

    const compte = compterRenommage(`${guild.id}:${member.id}`)
    if (compte !== "ok") {
        if (compte === "plafond") {
            const embed = new Discord.EmbedBuilder()
                .setColor(0xE67E22)
                .setTitle("Pseudo non corrigé (dispute détectée)")
                .addFields({ name: "Membre", value: `${member} (\`${member.id}\`)` })
                .setDescription(`Plus de ${MAX_RENOMMAGES} corrections en ${FENETRE_RENOMMAGES / 60000} minutes : un autre bot ou le membre remet un pseudo interdit. Le bot ne le renomme plus pendant cette fenêtre.`)
                .setTimestamp()
            await envoyerLog(guild, "membres", embed)
        }
        return null
    }

    try {
        await member.setNickname(apres, "Filtre de pseudos")
    } catch {
        return null // permission retirée, membre parti, hiérarchie changée : le prochain changement de pseudo retentera
    }
    // Jamais l'ancien pseudo dans le log : c'est un texte écrit par le membre
    const embed = new Discord.EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle("Pseudo corrigé")
        .addFields({ name: "Membre", value: `${member} (\`${member.id}\`)` })
        .setDescription(`Pseudo corrigé (motif : ${motifs(avant, filtre.mots).join(", ")}).`)
        .setTimestamp()
    await envoyerLog(guild, "membres", embed)
    return { avant, apres }
}

module.exports = {
    corrigerPseudo, nettoyer, pseudoNeutre, normaliser, lireFiltre, activerFiltre, desactiverFiltre, ajouterMot, retirerMot,
    MAX_MOTS, MAX_LONGUEUR_MOT
}
