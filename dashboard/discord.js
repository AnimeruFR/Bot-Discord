// Accès à l'API REST de Discord pour le tableau de bord (aucun client gateway).
// Le token du bot et le secret OAuth2 sont lus à chaque appel et ne sont jamais journalisés.
const Discord = require('discord.js')

const { Routes, RouteBases, PermissionFlagsBits: P, PermissionsBitField } = Discord

const DELAI = 10 * 1000 // par requête
const ATTENTE_MAX = 10 * 1000 // au-delà, une 429 n'est pas attendue
const CDN = "https://cdn.discordapp.com"
const TOUS_LES_DROITS = PermissionsBitField.All

let idApplication = null

// --- Cache en mémoire (les erreurs ne sont jamais gardées) ---------------------------------------------
const cache = new Map() // "guildId:type[:id]" -> { valeur, expire }
const TAILLE_MAX_CACHE = 2000

function purger() {
    const maintenant = Date.now()
    for (const [cle, e] of cache) if (e.expire <= maintenant) cache.delete(cle)
    if (cache.size > TAILLE_MAX_CACHE) cache.clear()
}

async function memo(cle, duree, lire) {
    const e = cache.get(cle)
    if (e && e.expire > Date.now()) return e.valeur
    const valeur = await lire()
    if (cache.size >= TAILLE_MAX_CACHE) purger()
    cache.set(cle, { valeur, expire: Date.now() + duree })
    return valeur
}

// --- Requêtes ----------------------------------------------------------------------------------
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

function erreurHttp(status, corps) {
    // Seulement le message de Discord : jamais la requête (elle peut contenir un secret)
    const detail = corps && typeof corps === "object" ? (corps.message ?? corps.error_description ?? corps.error ?? "") : ""
    const err = new Error(`Discord a répondu ${status}${detail ? ` : ${detail}` : ""}`)
    err.status = status
    return err
}

function entetes(auth, jeton) {
    const base = { "User-Agent": "DiscordBot (tableau-de-bord, 1.0)" }
    if (auth === "bot") {
        const token = process.env.DISCORD_TOKEN
        if (!token) throw new Error("DISCORD_TOKEN manquant")
        base.Authorization = `Bot ${token}`
    } else if (auth === "bearer") {
        base.Authorization = `Bearer ${jeton}`
    }
    return base
}

// auth : "bot" | "bearer" (avec jeton) | null. formulaire : corps application/x-www-form-urlencoded.
async function appel(methode, route, { auth = "bot", jeton, requete, json, formulaire } = {}, dejaReessaye = false) {
    const url = new URL(RouteBases.api + route)
    for (const [cle, valeur] of Object.entries(requete ?? {})) url.searchParams.set(cle, String(valeur))
    const headers = entetes(auth, jeton)
    let body
    if (json !== undefined) {
        headers["Content-Type"] = "application/json"
        body = JSON.stringify(json)
    } else if (formulaire) {
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        body = new URLSearchParams(formulaire).toString()
    }

    let reponse
    try {
        reponse = await fetch(url, { method: methode, headers, body, signal: AbortSignal.timeout(DELAI) })
    } catch (err) {
        const delai = err?.name === "TimeoutError" || err?.name === "AbortError"
        const e = new Error(delai ? "Discord ne répond pas (délai dépassé)" : "Discord est injoignable")
        e.status = delai ? 504 : 502
        throw e
    }

    let corps = null
    const texte = await reponse.text().catch(() => "")
    if (texte) { try { corps = JSON.parse(texte) } catch { corps = null } }

    if (reponse.status === 429 && !dejaReessaye) {
        const secondes = Number(corps?.retry_after ?? reponse.headers.get("retry-after") ?? 1)
        const attente = Math.min(Math.max(Number.isFinite(secondes) ? secondes * 1000 : 1000, 0), ATTENTE_MAX)
        await pause(attente)
        return appel(methode, route, { auth, jeton, requete, json, formulaire }, true)
    }
    if (!reponse.ok) throw erreurHttp(reponse.status, corps)
    return corps
}

const appelBot = (methode, route, options) => appel(methode, route, { ...options, auth: "bot" })
const appelUtilisateur = (jeton, route) => appel("GET", route, { auth: "bearer", jeton })

// --- Application et connexion OAuth2 -----------------------------------------------------------
async function init() {
    const app = await appelBot("GET", Routes.currentApplication())
    idApplication = String(app.id)
    return idApplication
}

function clientId() {
    if (!idApplication) throw new Error("discord.init() n'a pas été appelé")
    return idApplication
}

const urlRedirection = () => `${(process.env.DASHBOARD_URL ?? "").replace(/\/+$/, "")}/callback`

function urlConnexion(state) {
    const parametres = new URLSearchParams({
        client_id: clientId(),
        redirect_uri: urlRedirection(),
        response_type: "code",
        scope: "identify guilds",
        state,
        prompt: "none"
    })
    return `https://discord.com/oauth2/authorize?${parametres}`
}

async function echangerCode(code) {
    const jeton = await appel("POST", Routes.oauth2TokenExchange(), {
        auth: null,
        formulaire: {
            client_id: clientId(),
            client_secret: process.env.DISCORD_CLIENT_SECRET ?? "",
            grant_type: "authorization_code",
            code,
            redirect_uri: urlRedirection()
        }
    })
    return { accessToken: jeton.access_token, expiresAt: Date.now() + Number(jeton.expires_in ?? 0) * 1000 }
}

// --- Images ------------------------------------------------------------------------------------
const imageCdn = (dossier, id, hash) => hash ? `${CDN}/${dossier}/${id}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}` : null

function avatarParDefaut(id) {
    try { return `${CDN}/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png` } catch { return `${CDN}/embed/avatars/0.png` }
}

// --- Utilisateur connecté (jeton OAuth2) -------------------------------------------------------
async function utilisateur(accessToken) {
    const u = await appelUtilisateur(accessToken, Routes.user())
    return {
        id: u.id,
        username: u.username,
        globalName: u.global_name ?? null,
        avatarUrl: imageCdn("avatars", u.id, u.avatar) ?? avatarParDefaut(u.id)
    }
}

async function serveursUtilisateur(accessToken) {
    const liste = await appelUtilisateur(accessToken, Routes.userGuilds())
    return liste.map(g => ({
        id: g.id,
        name: g.name,
        iconUrl: imageCdn("icons", g.id, g.icon),
        owner: Boolean(g.owner),
        permissions: BigInt(g.permissions ?? 0)
    }))
}

// --- Serveur, salons, rôles, membres (jeton du bot) --------------------------------------------
// null si le bot n'est pas sur le serveur (404, ou 403 « Missing Access ») : l'absence est aussi gardée 60 s
async function serveurBot(guildId) {
    return memo(`${guildId}:serveur`, 60 * 1000, async () => {
        try {
            const g = await appelBot("GET", Routes.guild(guildId))
            return { id: g.id, name: g.name, iconUrl: imageCdn("icons", g.id, g.icon), ownerId: g.owner_id }
        } catch (err) {
            if (err.status === 404 || err.status === 403) return null
            throw err
        }
    })
}

function salons(guildId) {
    return memo(`${guildId}:salons`, 30 * 1000, async () => {
        const liste = await appelBot("GET", Routes.guildChannels(guildId))
        return liste.map(c => ({
            id: c.id,
            name: c.name,
            type: c.type,
            parentId: c.parent_id ?? null,
            position: c.position ?? 0,
            topic: c.topic ?? null,
            permissionOverwrites: (c.permission_overwrites ?? []).map(o => ({ id: o.id, type: o.type, allow: BigInt(o.allow ?? 0), deny: BigInt(o.deny ?? 0) }))
        }))
    })
}

function roles(guildId) {
    return memo(`${guildId}:roles`, 30 * 1000, async () => {
        const liste = await appelBot("GET", Routes.guildRoles(guildId))
        return liste.map(r => ({
            id: r.id,
            name: r.name,
            position: r.position,
            managed: Boolean(r.managed),
            permissions: BigInt(r.permissions ?? 0),
            color: r.color ?? 0
        }))
    })
}

// Jamais en cache : sert aux vérifications de permission
async function membre(guildId, userId) {
    try {
        const m = await appelBot("GET", Routes.guildMember(guildId, userId))
        return { id: userId, roles: m.roles ?? [] }
    } catch (err) {
        if (err.status === 404) return null
        throw err
    }
}

function membreBot(guildId) {
    return memo(`${guildId}:bot`, 60 * 1000, async () => {
        const m = await membre(guildId, clientId())
        if (!m) throw erreurHttp(404, { message: "Le bot n'est plus sur ce serveur" })
        return m
    })
}

// Permissions effectives d'un membre (algorithme de la documentation de Discord).
// guild : { id, ownerId } ; roles : liste de roles() ; membre : { id, roles: [ids] } ; salon : élément de salons() ou null.
function permissionsDans(guild, roles, membre, salon = null) {
    if (membre.id === guild.ownerId) return TOUS_LES_DROITS

    const siens = new Set(membre.roles)
    let droits = 0n
    for (const role of roles) if (role.id === guild.id || siens.has(role.id)) droits |= role.permissions
    if (droits & P.Administrator) return TOUS_LES_DROITS
    if (!salon) return droits

    const surcharges = salon.permissionOverwrites ?? []
    const tous = surcharges.find(o => o.id === guild.id && o.type === 0)
    if (tous) droits = (droits & ~tous.deny) | tous.allow

    let refus = 0n, accord = 0n
    for (const o of surcharges) {
        if (o.type === 0 && o.id !== guild.id && siens.has(o.id)) { refus |= o.deny; accord |= o.allow }
    }
    droits = (droits & ~refus) | accord

    const personnelle = surcharges.find(o => o.type === 1 && o.id === membre.id)
    if (personnelle) droits = (droits & ~personnelle.deny) | personnelle.allow

    // Sans « Voir le salon », aucune autre permission n'est utilisable dans ce salon
    return droits & P.ViewChannel ? droits : 0n
}

// --- Journal et premium ------------------------------------------------------------------------
// Ne lève jamais d'erreur : un log raté ne doit pas faire échouer l'enregistrement.
async function envoyerLog(channelId, { titre, details, auteur }) {
    try {
        const embed = {
            color: 0x3498DB,
            title: String(titre).slice(0, 256),
            description: String(details).slice(0, 4000),
            fields: [{ name: "Modérateur", value: `<@${auteur.id}> (\`${auteur.id}\`) – ${Discord.escapeMarkdown(String(auteur.username)).slice(0, 100)}` }],
            timestamp: new Date().toISOString()
        }
        await appelBot("POST", Routes.channelMessages(channelId), { json: { embeds: [embed], allowed_mentions: { parse: [] } } })
    } catch (err) {
        console.error("Impossible d'envoyer le log du tableau de bord :", err.message)
    }
}

async function entitlements(guildId, skuId) {
    if (!idApplication) await init()
    return appelBot("GET", Routes.entitlements(idApplication), {
        requete: { guild_id: guildId, sku_ids: skuId, exclude_ended: true, limit: 100 }
    })
}

module.exports = {
    init, clientId, urlConnexion, echangerCode, utilisateur, serveursUtilisateur, serveurBot,
    salons, roles, membre, membreBot, permissionsDans, envoyerLog, entitlements
}
