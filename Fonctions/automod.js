const Discord = require('discord.js')
const db = require('./db')
const { t } = require('./i18n')
const { moduleActif } = require('./modules')
const { envoyerLog, COULEURS } = require('./logs')
const { appliquerSeuilBot } = require('./sanctions')

const { TriggerType, ActionType, EventType, PresetType } = {
    TriggerType: Discord.AutoModerationRuleTriggerType,
    ActionType: Discord.AutoModerationActionType,
    EventType: Discord.AutoModerationRuleEventType,
    PresetType: Discord.AutoModerationRuleKeywordPresetType
}

// Limites de Discord par règle
const LIMITES = { roles: 20, salons: 50, regex: 10, longueurRegex: 260, mots: 1000, longueurMot: 60, mentions: 50 }

// Règles que le bot sait créer. Une seule de chaque sorte : on modifie la règle existante au lieu d'en ajouter.
const REGLES = {
    "mots-interdits": { nom: "[Bot] Mots interdits", type: TriggerType.Keyword },
    invitations: { nom: "[Bot] Invitations Discord", type: TriggerType.Keyword },
    regex: { nom: "[Bot] Expressions régulières", type: TriggerType.Keyword },
    listes: { nom: "[Bot] Listes de Discord", type: TriggerType.KeywordPreset },
    mentions: { nom: "[Bot] Mentions en masse", type: TriggerType.MentionSpam },
    spam: { nom: "[Bot] Spam", type: TriggerType.Spam }
}
// Liens d'invitation (syntaxe Rust, sans lookaround, 260 caractères maximum)
const REGEX_INVITATIONS = ["(?i)(discord\\.gg|discord(app)?\\.com/invite|discord\\.me)/[a-z0-9-]+"]

// Préréglages : un clic règle tout. "mentions" = limite par message ; "listes" = listes toutes faites de Discord.
const NIVEAUX = {
    souple: { mentions: 15, invitations: false, listes: [] },
    normal: { mentions: 10, invitations: true, listes: [PresetType.Slurs] },
    strict: { mentions: 5, invitations: true, listes: [PresetType.Profanity, PresetType.SexualContent, PresetType.Slurs] }
}

// Règles d'un préréglage : { regles: [{ cle, nom, type, triggerMetadata }], aDesactiver: [cle] }
function construirePreset(niveau) {
    const n = NIVEAUX[niveau]
    if (!n) return null
    const regle = (cle, triggerMetadata) => ({ cle, ...REGLES[cle], triggerMetadata })
    const regles = [regle("spam"), regle("mentions", { mentionTotalLimit: n.mentions })]
    const aDesactiver = []
    if (n.invitations) regles.push(regle("invitations", { regexPatterns: REGEX_INVITATIONS }))
    else aDesactiver.push("invitations")
    if (n.listes.length) regles.push(regle("listes", { presets: n.listes }))
    else aDesactiver.push("listes")
    return { regles, aDesactiver }
}

// Une règle générée respecte-t-elle les limites de Discord ? Renvoie un texte d'erreur ou null.
function verifierLimites({ triggerMetadata: m }) {
    if (!m) return null
    if (m.keywordFilter && (m.keywordFilter.length > LIMITES.mots || m.keywordFilter.some(x => x.length > LIMITES.longueurMot))) return "keywordFilter"
    if (m.regexPatterns && (m.regexPatterns.length > LIMITES.regex || m.regexPatterns.some(x => x.length > LIMITES.longueurRegex))) return "regexPatterns"
    if (m.mentionTotalLimit !== undefined && !(Number.isInteger(m.mentionTotalLimit) && m.mentionTotalLimit >= 1 && m.mentionTotalLimit <= LIMITES.mentions)) return "mentionTotalLimit"
    return null
}

// Mots séparés par des virgules -> liste validée selon les limites de Discord
function lireMots(valeur, cible = null) {
    const mots = [...new Set((valeur ?? "").split(",").map(m => m.trim()).filter(Boolean))]
    if (mots.length === 0) return { erreur: t(cible ?? "fr", "eng.automod.mots_vides") }
    if (mots.length > LIMITES.mots) return { erreur: t(cible ?? "fr", "eng.automod.mots_max") }
    const tropLong = mots.find(m => m.length > LIMITES.longueurMot)
    if (tropLong) return { erreur: t(cible ?? "fr", "eng.automod.mot_long") }
    return { mots }
}

// Discord utilise la syntaxe Rust : pas de lookahead / lookbehind, pas de référence arrière
const SYNTAXE_NON_RUST = /\(\?<?[=!]|\\[1-9]|\\k</
const DRAPEAUX_RUST = /^(\(\?[a-zA-Z-]+\))+/

// Expressions régulières séparées par ";;" -> liste validée (10 au plus, 260 caractères chacune).
// Le test avec RegExp de JavaScript est approché (la syntaxe n'est pas identique) : Discord a le dernier mot.
function lireRegex(valeur, cible = null) {
    const liste = [...new Set((valeur ?? "").split(";;").map(m => m.trim()).filter(Boolean))]
    if (liste.length === 0) return { erreur: t(cible ?? "fr", "am.regex_vide") }
    if (liste.length > LIMITES.regex) return { erreur: t(cible ?? "fr", "am.regex_max") }
    for (const motif of liste) {
        const affiche = motif.replace(/`/g, "'").slice(0, 60)
        if (motif.length > LIMITES.longueurRegex) return { erreur: t(cible ?? "fr", "am.regex_longue") }
        if (SYNTAXE_NON_RUST.test(motif)) return { erreur: t(cible ?? "fr", "am.regex_rust", { motif: affiche }) }
        const corps = motif.replace(DRAPEAUX_RUST, "")
        let re = null
        for (const drapeaux of ["u", ""]) {
            try { re = new RegExp(corps, drapeaux); break } catch { /* essai suivant */ }
        }
        if (!re) return { erreur: t(cible ?? "fr", "am.regex_invalide", { motif: affiche }) }
        // Une expression qui accepte le texte vide bloquerait tous les messages
        if (re.test("")) return { erreur: t(cible ?? "fr", "am.regex_vide_match", { motif: affiche }) }
    }
    return { regex: liste }
}

// Réglage propre à chaque règle : { triggerMetadata } ou { erreur }
function metadonnees(action, valeur, cible = null) {
    if (action === "mots-interdits") {
        const { mots, erreur } = lireMots(valeur, cible)
        return erreur ? { erreur } : { triggerMetadata: { keywordFilter: mots } }
    }
    if (action === "regex") {
        const { regex, erreur } = lireRegex(valeur, cible)
        return erreur ? { erreur } : { triggerMetadata: { regexPatterns: regex } }
    }
    if (action === "invitations") return { triggerMetadata: { regexPatterns: REGEX_INVITATIONS } }
    if (action === "mentions") {
        const limite = Number(valeur)
        if (!Number.isInteger(limite) || limite < 1 || limite > LIMITES.mentions) return { erreur: t(cible ?? "fr", "eng.automod.mentions_valeur") }
        return { triggerMetadata: { mentionTotalLimit: limite } }
    }
    return { triggerMetadata: undefined } // spam : pas de réglage
}

// --- Exemptions -----------------------------------------------------------------------------------------------

// Identifiants d'une liste d'exemptions : Collection de discord.js, ou simple tableau d'identifiants
const ids = liste => Array.isArray(liste) ? [...liste] : [...(liste?.keys?.() ?? [])]

// Nouvelle liste après ajouts et retraits. Renvoie { liste, change } ou { depasse: true }.
function fusionner(actuelle, ajouts, retraits, limite) {
    const avant = ids(actuelle)
    const apres = [...new Set([...avant.filter(id => !retraits.includes(id)), ...ajouts])]
    if (apres.length > limite) return { depasse: true }
    return { liste: apres, change: apres.length !== avant.length || apres.some(id => !avant.includes(id)) }
}

// Salons de jeux du bot (/config) qui existent encore sur le serveur
function salonsDeJeux(guild) {
    return db.getSalonsJeux(guild.id).filter(id => !guild.channels?.cache || guild.channels.cache.has(id))
}

// Applique des exemptions à toutes les règles données. Tout ou rien : si une règle dépasse la limite, rien n'est modifié.
// Renvoie { modifiees } ou { erreur: "roles"|"salons"|"discord", regle }.
async function modifierExemptions(regles, { ajoutRoles = [], ajoutSalons = [], retraitRoles = [], retraitSalons = [] }, reason) {
    const prevus = []
    for (const regle of regles) {
        const r = fusionner(regle.exemptRoles, ajoutRoles, retraitRoles, LIMITES.roles)
        if (r.depasse) return { erreur: "roles", regle: regle.name }
        const s = fusionner(regle.exemptChannels, ajoutSalons, retraitSalons, LIMITES.salons)
        if (s.depasse) return { erreur: "salons", regle: regle.name }
        if (r.change || s.change) prevus.push({ regle, exemptRoles: r.liste, exemptChannels: s.liste })
    }
    try {
        for (const { regle, exemptRoles, exemptChannels } of prevus) await regle.edit({ exemptRoles, exemptChannels, reason })
    } catch (err) {
        console.error("Échec de l'exemption AutoMod :", err.message)
        return { erreur: "discord" }
    }
    return { modifiees: prevus.length }
}

// Exemptions d'une nouvelle règle : celles déjà en place sur les autres règles du bot (au plus les limites de Discord)
function exemptionsHeritees(reglesBot) {
    const roles = new Set(), salons = new Set()
    for (const r of reglesBot.values()) {
        ids(r.exemptRoles).forEach(id => roles.add(id))
        ids(r.exemptChannels).forEach(id => salons.add(id))
    }
    return { exemptRoles: [...roles].slice(0, LIMITES.roles), exemptChannels: [...salons].slice(0, LIMITES.salons) }
}

// --- Création et mise à jour des règles ------------------------------------------------------------------------

// Règles créées par le bot (jamais celles des admins)
async function reglesDuBot(guild, bot) {
    return (await guild.autoModerationRules.fetch()).filter(r => r.creatorId === bot.user.id)
}

// Bloquer le message, et prévenir dans le salon de logs s'il est utilisable
function actionsPourRegle(guild, logs) {
    const actions = [{ type: ActionType.BlockMessage, metadata: { customMessage: t(guild, "eng.automod.bloque") } }]
    if (logs) actions.push({ type: ActionType.SendAlertMessage, metadata: { channel: logs.id } })
    return actions
}

// Crée la règle ou met à jour celle du bot. Renvoie "creee" ou "maj" (lève l'erreur de Discord sinon).
async function creerOuMettreAJour(guild, reglesBot, { nom, type, triggerMetadata }, logs, reason) {
    const actions = actionsPourRegle(guild, logs)
    const existante = reglesBot.find(r => r.name === nom && r.triggerType === type)
    if (existante) {
        await existante.edit({ triggerMetadata, actions, enabled: true, reason })
        return "maj"
    }
    await guild.autoModerationRules.create({
        name: nom, eventType: EventType.MessageSend, triggerType: type, triggerMetadata, actions, enabled: true,
        ...exemptionsHeritees(reglesBot), reason
    })
    return "creee"
}

// Applique un préréglage. Renvoie [{ nom, etat: "creee"|"maj"|"desactivee"|"echec" }].
// Une règle refusée par Discord (limite de règles…) n'empêche pas les suivantes.
async function appliquerPreset(guild, bot, niveau, logs, reason) {
    const preset = construirePreset(niveau)
    const reglesBot = await reglesDuBot(guild, bot)
    const resultats = []
    for (const regle of preset.regles) {
        try {
            resultats.push({ nom: regle.nom, etat: await creerOuMettreAJour(guild, reglesBot, regle, logs, reason) })
        } catch (err) {
            console.error("Échec AutoMod :", err.message)
            resultats.push({ nom: regle.nom, etat: "echec" })
        }
    }
    // Ce que le niveau n'inclut pas est coupé, pour que le résultat corresponde vraiment au niveau choisi
    for (const cle of preset.aDesactiver) {
        const { nom, type } = REGLES[cle]
        const existante = reglesBot.find(r => r.name === nom && r.triggerType === type && r.enabled)
        if (!existante) continue
        try {
            await existante.edit({ enabled: false, reason })
            resultats.push({ nom, etat: "desactivee" })
        } catch (err) {
            console.error("Échec AutoMod :", err.message)
            resultats.push({ nom, etat: "echec" })
        }
    }
    return resultats
}

// --- Dossiers (lien AutoMod -> historique et avertissements) -----------------------------------------------------

const getCountWarns = guildId => db.sqlAll("SELECT count_warns FROM automod_config WHERE guild_id = ?", [guildId])[0]?.count_warns === 1

function setCountWarns(guildId, actif) {
    db.sqlRun(`INSERT INTO automod_config (guild_id, count_warns) VALUES (?, ?)
        ON CONFLICT (guild_id) DO UPDATE SET count_warns = excluded.count_warns`, [guildId, actif ? 1 : 0])
}

// --- Événement : un message bloqué par AutoMod -------------------------------------------------------------------

const DELAI_REGLE = 5 * 60 * 1000      // une règle modifiée dans Discord est relue au bout de ce délai
const DELAI_VUS = 10 * 60 * 1000
const FENETRE_SANS_ID = 5 * 1000       // faute d'identifiant de message : même membre, même salon, même règle
const DELAI_RAFALE = 60 * 1000         // anti-rafale : un dossier et un log AutoMod par membre et par minute
const TAILLE_MAX = 1000
const RAISON_MAX = 100

const reglesVues = new Map()   // "serveur:règle" -> { nom, aBlocage, compteWarn, ts }
const evenementsVus = new Map() // clé de déclenchement -> ts
const rafales = new Map()       // "serveur:membre" -> { ts, supprimes } (supprimes = blocages comptés sans dossier depuis ts)

// Garde une Map bornée : on retire d'abord les entrées périmées, puis les plus anciennes
function borner(map, maintenant, duree) {
    if (map.size <= TAILLE_MAX) return
    for (const [cle, valeur] of map) if (maintenant - (valeur.ts ?? valeur) > duree) map.delete(cle)
    while (map.size > TAILLE_MAX) map.delete(map.keys().next().value)
}

const reinitialiserEtat = () => { reglesVues.clear(); evenementsVus.clear(); rafales.clear() }

// Nom et actions d'une règle (mémorisés quelques minutes pour ne pas appeler Discord à chaque blocage).
// compteWarn : règle créée par le bot ET qui bloque ou met en sourdine. Une règle d'un humain, ou « alerte seule »,
// n'a pas passé le contrôle de pouvoir fait à l'activation de /automod dossiers : elle ne warn jamais.
async function lireRegle(guild, ruleId, botId, maintenant) {
    const cle = `${guild.id}:${ruleId}`
    const vue = reglesVues.get(cle)
    if (vue && maintenant - vue.ts < DELAI_REGLE) return vue
    const regle = await guild.autoModerationRules.fetch({ autoModerationRule: ruleId, force: true }).catch(() => null)
    if (!regle) return vue ?? null
    const actions = regle.actions ?? []
    const aBlocage = actions.some(a => a.type === ActionType.BlockMessage)
    const compteWarn = regle.creatorId === botId && (aBlocage || actions.some(a => a.type === ActionType.Timeout))
    const info = { nom: regle.name, aBlocage, compteWarn, ts: maintenant }
    reglesVues.set(cle, info)
    borner(reglesVues, maintenant, DELAI_REGLE)
    return info
}

// true si ce déclenchement a déjà été traité (sinon, le note)
function dejaVu(cle, maintenant) {
    const ts = evenementsVus.get(cle)
    if (ts !== undefined && maintenant - ts < DELAI_VUS) return true
    evenementsVus.set(cle, maintenant)
    borner(evenementsVus, maintenant, DELAI_VUS)
    return false
}

// Anti-rafale : un dossier (donc un log et un warn) par membre et par minute, sinon un spam inonderait l'historique
// et déclencherait tous les seuils d'un coup. Renvoie null si le blocage est seulement compté, sinon { depuis } :
// le nombre de blocages comptés sans dossier depuis le précédent.
function rafale(guildId, userId, maintenant) {
    const cle = `${guildId}:${userId}`
    const vue = rafales.get(cle)
    if (vue && maintenant - vue.ts < DELAI_RAFALE) {
        vue.supprimes++
        return null
    }
    rafales.delete(cle) // la Map reste classée de la plus ancienne à la plus récente
    rafales.set(cle, { ts: maintenant, supprimes: 0 })
    borner(rafales, maintenant, DELAI_RAFALE)
    return { depuis: vue?.supprimes ?? 0 }
}

// Raison courte : nom de la règle + mot déclencheur, 100 caractères au plus (le message lui-même n'est jamais gardé)
function construireRaison(nomRegle, motif, depuis = 0) {
    const propre = texte => String(texte).replace(/\s+/g, " ").replace(/`/g, "'").trim()
    const base = `AutoMod (${propre(nomRegle).slice(0, 40)})`
    const suite = depuis > 0 ? ` (+${depuis} blocages depuis)` : ""
    return (motif ? `${base} : ${propre(motif)}` : base).slice(0, RAISON_MAX - suite.length) + suite
}

// Discord émet un événement PAR action de la règle (blocage, alerte, mute) : on n'en retient qu'un par déclenchement.
// Renvoie { numero, warnId, sanction } si un dossier a été créé, sinon null.
async function traiterExecution(bot, ex, { maintenant = Date.now() } = {}) {
    const guild = ex.guild
    if (!guild || !ex.userId || ex.userId === bot.user.id) return null
    if (!moduleActif(guild.id, "moderation")) return null

    // L'identifiant suffit : on ne va chercher l'auteur chez Discord que pour un avertissement
    if (ex.user?.bot) return null

    const regle = await lireRegle(guild, ex.ruleId, bot.user.id, maintenant)
    const blocage = ex.action?.type === ActionType.BlockMessage
    if (!blocage) {
        // Seule une règle sans blocage est traitée via ses autres actions (et celle d'une règle inconnue est ignorée)
        if (!regle || regle.aBlocage) return null
    }
    const idMessage = ex.alertSystemMessageId ?? ex.messageId
    const cleVu = idMessage ? `${ex.ruleId}:${idMessage}` : (blocage ? null : `${ex.ruleId}:${ex.userId}:${ex.channelId}:${Math.floor(maintenant / FENETRE_SANS_ID)}`)
    if (cleVu && dejaVu(cleVu, maintenant)) return null

    const fenetre = rafale(guild.id, ex.userId, maintenant)
    if (!fenetre) return null

    const raison = construireRaison(regle?.nom ?? `#${ex.ruleId}`, ex.matchedKeyword ?? ex.matchedContent, fenetre.depuis)
    const numero = db.addCase(guild.id, { userId: ex.userId, moderatorId: bot.user.id, type: "automod", reason: raison, auto: true })

    let warnId = null, total = null, sanction = null
    // Warn seulement pour une règle du bot qui bloque ou met en sourdine (règle inconnue : on ne compte pas)
    if (regle?.compteWarn && getCountWarns(guild.id)) {
        const user = ex.user ?? await bot.users.fetch(ex.userId).catch(() => null)
        if (!user?.bot) {
            warnId = db.addWarn(guild.id, ex.userId, bot.user.id, raison)
            total = db.countWarns(guild.id, ex.userId)
            try {
                const me = guild.members.me ?? await guild.members.fetchMe()
                sanction = await appliquerSeuilBot(bot, guild, user ?? { id: ex.userId, send: async () => {} }, total, me)
            } catch (err) {
                console.error("Échec de la sanction automatique (AutoMod) :", err.message)
            }
        }
    }

    const champs = [
        { name: t(guild, "am.log_membre"), value: `<@${ex.userId}> (\`${ex.userId}\`)`, inline: true },
        { name: t(guild, "am.log_regle"), value: String(regle?.nom ?? ex.ruleId).slice(0, 200), inline: true },
        { name: t(guild, "am.log_dossier"), value: `#${numero}`, inline: true }
    ]
    if (ex.channelId) champs.push({ name: t(guild, "am.log_salon"), value: `<#${ex.channelId}>`, inline: true })
    champs.push({ name: t(guild, "am.log_raison"), value: Discord.escapeMarkdown(raison).slice(0, 1024) })
    if (fenetre.depuis > 0) champs.push({ name: t(guild, "am.log_rafale_titre"), value: t(guild, "am.log_rafale", { n: fenetre.depuis }) })
    if (warnId) champs.push({ name: t(guild, "am.log_warn_titre"), value: t(guild, "am.log_warn", { id: warnId, total }) })
    if (sanction) champs.push({ name: t(guild, "am.log_sanction"), value: String(sanction).slice(0, 1024) })
    const embed = new Discord.EmbedBuilder().setColor(COULEURS.automod).setTitle(t(guild, "am.log_titre")).addFields(champs).setTimestamp()
    await envoyerLog(guild, "automod", embed)

    return { numero, warnId, sanction }
}

module.exports = {
    LIMITES, REGLES, NIVEAUX, construirePreset, verifierLimites, lireMots, lireRegex, metadonnees,
    fusionner, salonsDeJeux, modifierExemptions, exemptionsHeritees, reglesDuBot, actionsPourRegle,
    creerOuMettreAJour, appliquerPreset, getCountWarns, setCountWarns,
    traiterExecution, construireRaison, reinitialiserEtat
}
