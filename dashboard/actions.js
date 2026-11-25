// Lecture et enregistrement de la configuration d'un serveur depuis le tableau de bord.
// Mêmes règles que les commandes (/setlogs, /setticket, /config, /bienvenue) : l'interface web
// ne doit jamais permettre ce que Discord interdit. Tout est revérifié ici, champ par champ.
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const { t } = require('../Fonctions/i18n')
const { estPremium, premiumActif } = require('../Fonctions/premium')
const { lireCouleur, formatCouleur } = require('../Fonctions/apparence')
const { INACTIVITES, LANGUES } = require('../Fonctions/constantes')
const discord = require('./discord')

const { PermissionFlagsBits: P, ChannelType } = Discord

const ID = /^\d{17,20}$/
const PERMISSION_TICKETS = P.ManageGuild | P.ManageChannels | P.ManageRoles
const BOT_LOGS = P.ViewChannel | P.SendMessages | P.EmbedLinks
const BOT_MESSAGES = P.ViewChannel | P.SendMessages
const BOT_CATEGORIE = P.ViewChannel | P.ManageChannels
const TITRE_LOGS = "Modération : config (tableau de bord)"

const possede = (droits, besoin) => (droits & besoin) === besoin

// Faux client pour Fonctions/premium.js : les entitlements viennent de l'API REST
function clientPremium() {
    const versEntitlement = e => ({
        skuId: e.sku_id,
        guildId: e.guild_id,
        deleted: Boolean(e.deleted),
        consumed: Boolean(e.consumed),
        startsTimestamp: e.starts_at ? Date.parse(e.starts_at) : null,
        endsTimestamp: e.ends_at ? Date.parse(e.ends_at) : null
    })
    return {
        application: {
            entitlements: {
                fetch: async ({ guild, skus }) => (await discord.entitlements(guild, skus[0])).map(versEntitlement)
            }
        }
    }
}

const couleurRole = valeur => valeur ? formatCouleur(valeur) : null
const estSalonTicket = salon => (salon.name.startsWith("ticket-") || salon.name.startsWith("ferme-")) && ID.test(salon.topic ?? "")

// --- Lecture -----------------------------------------------------------------------------------
// Seuls les salons que l'utilisateur voit sont proposés
async function lireConfig(guildId, utilisateurId) {
    const [serveur, salons, roles, membre, premium] = await Promise.all([
        discord.serveurBot(guildId),
        discord.salons(guildId),
        discord.roles(guildId),
        discord.membre(guildId, utilisateurId),
        estPremium(clientPremium(), guildId)
    ])
    const voit = s => Boolean(serveur && membre) && possede(discord.permissionsDans(serveur, roles, membre, s), P.ViewChannel)
    const visibles = salons.filter(voit)
    const apparence = db.getApparence(guildId)
    const tickets = db.getTicketConfig(guildId)
    const accueil = db.getWelcome(guildId)
    const message = m => m ? { salon: m.channelId, message: m.message ?? "" } : null
    const trier = (a, b) => a.position - b.position
    const liste = (filtre, configures) => {
        const res = visibles.filter(filtre).sort(trier).map(s => ({ id: s.id, name: s.name }))
        // Un salon déjà configuré mais invisible reste sélectionné, sans révéler son nom
        for (const idSalon of configures) if (idSalon && !res.some(s => s.id === idSalon)) res.push({ id: idSalon, name: null })
        return res
    }
    const texte = s => s.type === ChannelType.GuildText || s.type === ChannelType.GuildAnnouncement
    const logs = db.getLogChannel(guildId)

    return {
        langue: apparence.langue,
        couleur: apparence.couleur === null ? null : formatCouleur(apparence.couleur),
        logs,
        tickets: { categorie: tickets.categoryId, staff: tickets.staffRoleId, inactivite: db.getTicketInactivity(guildId) },
        panneau: { titre: apparence.panneauTitre ?? "", texte: apparence.panneauTexte ?? "" },
        bienvenue: message(accueil.bienvenue),
        aurevoir: message(accueil.aurevoir),
        nbSeuils: db.listThresholds(guildId).length,
        nbTypes: db.listTicketTypes(guildId).length,
        premium,
        premiumActif: premiumActif(),
        salonsTexte: liste(texte, [logs, accueil.bienvenue?.channelId, accueil.aurevoir?.channelId]),
        categories: liste(s => s.type === ChannelType.GuildCategory, [tickets.categoryId]),
        roles: roles
            .filter(r => r.id !== guildId && !r.managed)
            .sort((a, b) => b.position - a.position)
            .map(r => ({ id: r.id, name: r.name, couleur: couleurRole(r.color) }))
    }
}

// --- Enregistrement ----------------------------------------------------------------------------
async function enregistrer(guildId, utilisateur, formulaire = {}) {
    const erreurs = []
    const changements = []

    let serveur, roles, salons, membre, bot
    try {
        serveur = await discord.serveurBot(guildId)
        if (!serveur) return { erreurs: ["Le bot n'est pas (ou plus) sur ce serveur."], changements }
        ;[roles, salons, membre, bot] = await Promise.all([
            discord.roles(guildId), discord.salons(guildId), discord.membre(guildId, utilisateur.id), discord.membreBot(guildId)
        ])
    } catch (err) {
        console.error("Tableau de bord : lecture Discord impossible :", err.message)
        return { erreurs: ["Discord ne répond pas, réessayez dans un instant."], changements }
    }
    if (!membre) return { erreurs: ["Vous n'êtes plus membre de ce serveur."], changements }

    const droits = discord.permissionsDans(serveur, roles, membre)
    if (!possede(droits, P.ManageGuild)) {
        return { erreurs: ["La permission « Gérer le serveur » est nécessaire pour modifier cette configuration."], changements }
    }

    const salon = id => salons.find(s => s.id === id)
    const role = id => roles.find(r => r.id === id)
    const botPeut = (s, besoin) => possede(discord.permissionsDans(serveur, roles, bot, s), besoin)
    const voit = s => possede(discord.permissionsDans(serveur, roles, membre, s), P.ViewChannel)
    const nomSalon = id => salon(id) ? `#${salon(id).name}` : `#${id}`
    const nomRole = id => role(id) ? `@${role(id).name}` : `@${id}`
    const mentionSalon = id => id ? `<#${id}>` : "aucun"
    const mentionRole = id => id ? `<@&${id}>` : "aucun"

    const lire = nom => typeof formulaire[nom] === "string" ? formulaire[nom].trim() : undefined
    const ecritures = []
    const journal = []
    const noter = (texte, pourLog = texte) => { changements.push(texte); journal.push(pourLog) }

    const apparence = db.getApparence(guildId)
    let premium
    const aPremium = async () => premium ??= await estPremium(clientPremium(), guildId)

    // Langue
    const langue = lire("langue")
    if (langue !== undefined) {
        const voulue = langue === "" ? "auto" : langue
        if (!LANGUES.includes(voulue)) erreurs.push("Langue : valeur invalide (auto, fr ou en).")
        else if (voulue !== apparence.langue) {
            ecritures.push(() => db.setLangue(guildId, voulue))
            noter(`Langue : ${apparence.langue} → ${voulue}`)
        }
    }

    // Couleur des embeds (premium pour en choisir une ; revenir au défaut reste libre)
    const couleur = lire("couleur")
    if (couleur !== undefined) {
        const voulue = couleur === "" ? null : lireCouleur(couleur)
        if (couleur !== "" && voulue === null) erreurs.push("Couleur : format attendu #RRGGBB.")
        else if (voulue !== apparence.couleur) {
            if (voulue !== null && !await aPremium()) erreurs.push("Couleur : réservée aux serveurs premium.")
            else {
                ecritures.push(() => db.setCouleur(guildId, voulue))
                noter(`Couleur des embeds : ${apparence.couleur === null ? "par défaut" : formatCouleur(apparence.couleur)} → ${voulue === null ? "par défaut" : formatCouleur(voulue)}`)
            }
        }
    }

    // Panneau des tickets (premium pour écrire un texte ; vider reste libre)
    let titre = apparence.panneauTitre ?? "", texte = apparence.panneauTexte ?? ""
    let panneauModifie = false
    for (const [nom, libelle, max] of [["panneauTitre", "Titre du panneau", 256], ["panneauTexte", "Texte du panneau", 2000]]) {
        const valeur = lire(nom)
        if (valeur === undefined || valeur === (nom === "panneauTitre" ? titre : texte)) continue
        if (valeur.length > max) erreurs.push(`${libelle} : ${max} caractères au plus.`)
        else if (valeur !== "" && !await aPremium()) erreurs.push(`${libelle} : réservé aux serveurs premium.`)
        else {
            if (nom === "panneauTitre") titre = valeur
            else texte = valeur
            panneauModifie = true
        }
    }
    if (panneauModifie) {
        ecritures.push(() => db.setPanneauTicket(guildId, titre, texte))
        noter(`Panneau de tickets : « ${titre || "titre par défaut"} » – ${(texte || "texte par défaut").slice(0, 300)}`)
    }

    // Tickets : catégorie, rôle staff, inactivité (Gérer le serveur + les salons + les rôles)
    const refusTickets = nom => `${nom} : il faut aussi « Gérer les salons » et « Gérer les rôles » pour configurer les tickets.`
    const peutTickets = possede(droits, PERMISSION_TICKETS)
    const actuel = db.getTicketConfig(guildId)
    let categorie = actuel.categoryId, staff = actuel.staffRoleId
    let ticketsModifies = false

    const choixCategorie = lire("ticketsCategorie")
    if (choixCategorie !== undefined && (choixCategorie || null) !== actuel.categoryId) {
        const cible = salon(choixCategorie)
        if (!peutTickets) erreurs.push(refusTickets("Catégorie des tickets"))
        else if (choixCategorie !== "" && (!cible || cible.type !== ChannelType.GuildCategory)) erreurs.push("Catégorie des tickets : catégorie introuvable.")
        else if (choixCategorie !== "" && !voit(cible)) erreurs.push("Catégorie des tickets : vous ne voyez pas cette catégorie.")
        else if (choixCategorie !== "" && !botPeut(cible, BOT_CATEGORIE)) erreurs.push(`Catégorie des tickets : le bot doit pouvoir voir ${nomSalon(cible.id)} et y gérer les salons.`)
        else {
            categorie = choixCategorie || null
            ticketsModifies = true
            noter(`Catégorie des tickets : ${categorie ? nomSalon(categorie) : "aucune"}`, `Catégorie des tickets : ${mentionSalon(categorie)}`)
        }
    }

    const choixStaff = lire("ticketsStaff")
    if (choixStaff !== undefined && (choixStaff || null) !== actuel.staffRoleId) {
        const cible = role(choixStaff)
        const plusHaut = Math.max(0, ...membre.roles.map(id => role(id)?.position ?? 0))
        if (!peutTickets) erreurs.push(refusTickets("Rôle staff des tickets"))
        else if (choixStaff !== "" && (!cible || cible.id === guildId || cible.managed)) erreurs.push("Rôle staff des tickets : rôle invalide (ni @everyone, ni rôle géré par une application).")
        else if (choixStaff !== "" && utilisateur.id !== serveur.ownerId && cible.position >= plusHaut) erreurs.push("Rôle staff des tickets : le rôle doit être strictement inférieur à votre rôle le plus haut.")
        else {
            staff = choixStaff || null
            ticketsModifies = true
            noter(`Rôle staff des tickets : ${staff ? nomRole(staff) : "aucun"}`, `Rôle staff des tickets : ${mentionRole(staff)}`)
        }
    }
    if (ticketsModifies) {
        ecritures.push(() => {
            // setTicketConfig garde la valeur actuelle pour un null : vider passe par la réinitialisation
            if ((actuel.categoryId && !categorie) || (actuel.staffRoleId && !staff)) db.resetTicketConfig(guildId)
            if (categorie || staff) db.setTicketConfig(guildId, categorie, staff)
        })
    }

    const choixInactivite = lire("ticketsInactivite")
    if (choixInactivite !== undefined) {
        const jours = choixInactivite === "" ? 0 : (/^\d{1,3}$/.test(choixInactivite) ? Number(choixInactivite) : NaN)
        if (!INACTIVITES.includes(jours)) erreurs.push(`Inactivité des tickets : choisir parmi ${INACTIVITES.join(", ")} jours.`)
        else if (jours !== db.getTicketInactivity(guildId)) {
            if (!peutTickets) erreurs.push(refusTickets("Inactivité des tickets"))
            else {
                ecritures.push(() => db.setTicketInactivity(guildId, jours))
                noter(jours ? `Tickets fermés après ${jours} jour(s) d'inactivité` : "Fermeture des tickets inactifs désactivée")
            }
        }
    }

    // Messages de bienvenue / d'au revoir
    const accueil = db.getWelcome(guildId)
    const langueServeur = apparence.langue === "en" ? "en" : "fr"
    for (const [type, nom, defaut] of [["bienvenue", "Message de bienvenue", "bienvenue.defaut"], ["aurevoir", "Message d'au revoir", "aurevoir.defaut"]]) {
        const choixSalon = lire(`${type}Salon`)
        let message = lire(`${type}Message`)
        if (choixSalon === undefined && message === undefined) continue
        const avant = accueil[type]
        const idSalon = choixSalon === undefined ? (avant?.channelId ?? null) : (choixSalon || null)

        if (idSalon === null) {
            if (message && (!avant || message !== avant.message)) { erreurs.push(`Choisis un salon pour le message ${type === "bienvenue" ? "de bienvenue" : "d'au revoir"}.`); continue }
            if (avant) {
                ecritures.push(() => db.setWelcome(guildId, type, null, null))
                noter(`${nom} : désactivé`)
            }
            continue
        }
        if (message !== undefined && message.length > 1000) {
            erreurs.push(`${nom} : 1000 caractères au plus.`)
            message = undefined
        }
        if (idSalon !== avant?.channelId) {
            const cible = salon(idSalon)
            if (!cible || (cible.type !== ChannelType.GuildText && cible.type !== ChannelType.GuildAnnouncement)) { erreurs.push(`${nom} : salon introuvable ou non textuel.`); continue }
            if (!voit(cible)) { erreurs.push(`${nom} : vous ne voyez pas ce salon.`); continue }
            if (!botPeut(cible, BOT_MESSAGES)) { erreurs.push(`${nom} : le bot doit pouvoir voir ${nomSalon(idSalon)} et y écrire.`); continue }
        }
        const defautTexte = t(langueServeur, defaut)
        const contenu = message !== undefined ? (message || defautTexte) : (avant?.message || defautTexte)
        if (idSalon === avant?.channelId && contenu === avant.message) continue
        ecritures.push(() => db.setWelcome(guildId, type, idSalon, contenu))
        const texteModifie = contenu !== avant?.message
        noter(`${nom} : ${nomSalon(idSalon)}${texteModifie ? " (texte modifié)" : ""}`, `${nom} : ${mentionSalon(idSalon)}${texteModifie ? " (texte modifié)" : ""}`)
    }

    // Salon de logs : traité en dernier, car il change qui reçoit le journal
    const choixLogs = lire("logs")
    const ancienLogs = db.getLogChannel(guildId)
    let logs = null // { ancien, nouveau } si le salon change
    if (choixLogs !== undefined && (choixLogs || null) !== ancienLogs) {
        const nouveau = choixLogs || null
        const cible = nouveau ? salon(nouveau) : null
        let refus = null
        if (nouveau) {
            if (!cible) refus = "Salon de logs : salon introuvable."
            else if (cible.type !== ChannelType.GuildText) refus = "Salon de logs : choisir un salon textuel."
            else if (estSalonTicket(cible)) refus = "Salon de logs : un salon de ticket ne peut pas servir de salon de logs."
            else if (!voit(cible)) refus = "Salon de logs : vous ne voyez pas ce salon."
            else if (!botPeut(cible, BOT_LOGS)) refus = `Salon de logs : le bot doit pouvoir voir ${nomSalon(nouveau)}, y écrire et y intégrer des liens.`
        }
        if (refus) erreurs.push(refus)
        else {
            logs = { ancien: ancienLogs, nouveau }
            noter(
                `Salon de logs : ${ancienLogs ? nomSalon(ancienLogs) : "aucun"} → ${nouveau ? nomSalon(nouveau) : "aucun (logs désactivés)"}`,
                `Salon de logs : ${mentionSalon(ancienLogs)} → ${nouveau ? mentionSalon(nouveau) : "aucun (logs désactivés)"}`
            )
        }
    }

    if (!journal.length) return { erreurs, changements }

    // Toutes les écritures ensemble : si l'une échoue, aucune n'est gardée
    db.transaction(() => {
        for (const ecrire of ecritures) ecrire()
        if (logs) db.setLogChannel(guildId, logs.nouveau)
    })

    const envoyer = id => discord.envoyerLog(id, { titre: TITRE_LOGS, details: journal.join("\n"), auteur: { id: utilisateur.id, username: utilisateur.username } })
    if (logs) {
        // Après le COMMIT : tracé dans l'ANCIEN salon, puis dans le NOUVEAU : on ne coupe pas les logs discrètement
        if (logs.ancien) await envoyer(logs.ancien)
        if (logs.nouveau) await envoyer(logs.nouveau)
    } else if (ancienLogs) {
        await envoyer(ancienLogs)
    }
    return { erreurs, changements }
}

module.exports = { lireConfig, enregistrer }
