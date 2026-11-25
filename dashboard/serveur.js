const http = require('node:http')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { lienInvitation } = require('../Fonctions/invitation')

const MINUTE = 60 * 1000
const JOUR = 24 * 60 * MINUTE

const DUREE_SESSION = 7 * JOUR
const INACTIVITE_SESSION = JOUR
const DUREE_ETAT = 10 * MINUTE
const RELECTURE_SERVEURS = 5 * MINUTE
const MAX_SESSIONS = 10000
const MAX_CORPS = 16 * 1024
const LIMITE_REQUETES = 60
const LIMITE_CONNEXIONS = 10
const MAX_IPS = 50000
const MAX_VERIFICATIONS_BOT = 50

const ADMINISTRATEUR = 1n << 3n
const GERER_SERVEUR = 1n << 5n

const COOKIE_SESSION = "__Host-tdb"
const COOKIE_ETAT = "__Host-etat"
const ATTRIBUTS_COOKIE = "Path=/; HttpOnly; Secure; SameSite=Lax"
const EFFACER_SESSION = `${COOKIE_SESSION}=; ${ATTRIBUTS_COOKIE}; Max-Age=0`
const EFFACER_ETAT = `${COOKIE_ETAT}=; ${ATTRIBUTS_COOKIE}; Max-Age=0`

const CSP = "default-src 'none'; style-src 'self'; img-src https://cdn.discordapp.com; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
const CHEMIN_CSS = path.join(__dirname, "public", "style.css")

// Champs du formulaire acceptés (les autres sont ignorés). Les deux cases « Rétablir le défaut » ne sont jamais transmises telles quelles :
// elles deviennent des valeurs vides (voir enregistrerServeur)
const CHAMPS = ["langue", "couleur", "logs", "ticketsCategorie", "ticketsStaff", "ticketsInactivite", "panneauTitre", "panneauTexte", "bienvenueSalon", "bienvenueMessage", "aurevoirSalon", "aurevoirMessage", "couleurDefaut", "panneauDefaut"]

// Même réponse pour une page inconnue et pour un serveur refusé : aucune information sur son existence
const ERREUR_404 = { code: 404, titre: "Page introuvable", texte: "Cette page n'existe pas ou tu n'y as pas accès." }

const FORMAT_ALEATOIRE = /^[A-Za-z0-9_-]{43}$/
const FORMAT_ID = /^\d{17,20}$/

const aleatoire = () => crypto.randomBytes(32).toString("base64url")

// Comparaison en temps constant, quelle que soit la longueur des deux textes
function egalConstant(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false
    const ha = crypto.createHash("sha256").update(a).digest()
    const hb = crypto.createHash("sha256").update(b).digest()
    return crypto.timingSafeEqual(ha, hb)
}

// Erreur « prévue » : renvoyée au navigateur avec son code et sa page
function refus(code, titre, texte) {
    const err = new Error(titre)
    err.http = { code, titre, texte }
    return err
}

function lireCookies(req) {
    const cookies = Object.create(null)
    for (const morceau of String(req.headers.cookie || "").split(";")) {
        const egal = morceau.indexOf("=")
        if (egal < 0) continue
        const nom = morceau.slice(0, egal).trim()
        if (!(nom in cookies)) cookies[nom] = morceau.slice(egal + 1).trim()
    }
    return cookies
}

const peutGerer = g => g.owner === true || (typeof g.permissions === "bigint" && (g.permissions & (ADMINISTRATEUR | GERER_SERVEUR)) !== 0n)

function lireCorps(req) {
    const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase()
    if (type !== "application/x-www-form-urlencoded") return Promise.reject(refus(415, "Requête refusée", "Format de formulaire non pris en charge."))
    if (Number(req.headers["content-length"]) > MAX_CORPS) return Promise.reject(refus(413, "Formulaire trop volumineux", "Le formulaire envoyé dépasse la taille autorisée."))
    return new Promise((resolve, reject) => {
        const morceaux = []
        let total = 0
        req.on("data", morceau => {
            total += morceau.length
            if (total > MAX_CORPS) {
                req.removeAllListeners("data")
                req.pause()
                reject(refus(413, "Formulaire trop volumineux", "Le formulaire envoyé dépasse la taille autorisée."))
                return
            }
            morceaux.push(morceau)
        })
        req.on("end", () => resolve(new URLSearchParams(Buffer.concat(morceaux).toString("utf8"))))
        req.on("error", reject)
    })
}

function creerServeur({ discord, actions, pages, maxIps = MAX_IPS }) {
    if (!process.env.DASHBOARD_URL || !URL.canParse(process.env.DASHBOARD_URL)) throw new Error("DASHBOARD_URL manquant ou invalide")
    const urlPublique = new URL(process.env.DASHBOARD_URL)
    const origine = urlPublique.origin
    const https = urlPublique.protocol === "https:"
    const confianceProxy = process.env.DASHBOARD_TRUST_PROXY === "1"

    const sessions = new Map()
    const debits = new Map()
    let css = null

    // ---------- Réponses ----------

    function appliquerEnTetes(res) {
        res.setHeader("Content-Security-Policy", CSP)
        res.setHeader("X-Content-Type-Options", "nosniff")
        // same-origin et non no-referrer : avec no-referrer, le navigateur envoie « Origin: null » sur les POST
        // du site lui-même, et la vérification de l'origine refuserait tous les formulaires
        res.setHeader("Referrer-Policy", "same-origin")
        res.setHeader("X-Frame-Options", "DENY")
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin")
        if (https) res.setHeader("Strict-Transport-Security", "max-age=31536000")
    }

    function pageErreur(erreur) {
        try {
            return pages.pageErreur(erreur)
        } catch {
            return `${erreur.code} ${erreur.titre}`
        }
    }

    function envoyerPage(res, code, html, enTetes = {}) {
        res.writeHead(code, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...enTetes })
        res.end(html)
    }

    function envoyerErreur(res, erreur, enTetes = {}) {
        envoyerPage(res, erreur.code, pageErreur(erreur), enTetes)
    }

    function rediriger(res, code, lieu, enTetes = {}) {
        res.writeHead(code, { Location: lieu, "Cache-Control": "no-store", ...enTetes })
        res.end()
    }

    // ---------- Limite de débit ----------

    function adresseIp(req) {
        if (confianceProxy) {
            // La DERNIÈRE adresse est celle ajoutée par notre proxy ; les précédentes viennent du client
            const liste = String(req.headers["x-forwarded-for"] || "").split(",").map(s => s.trim()).filter(Boolean)
            if (liste.length) return liste[liste.length - 1]
        }
        return req.socket.remoteAddress || "inconnue"
    }

    function debitAutorise(ip, connexion) {
        const maintenant = Date.now()
        let compteur = debits.get(ip)
        if (!compteur || maintenant - compteur.debut >= MINUTE) {
            // Table pleine : on évince l'entrée la plus ancienne (Map = ordre d'insertion), sans remettre les autres à zéro
            if (!compteur && debits.size >= maxIps) debits.delete(debits.keys().next().value)
            compteur = { debut: maintenant, requetes: 0, connexions: 0 }
            debits.set(ip, compteur)
        }
        compteur.requetes++
        if (connexion) compteur.connexions++
        return compteur.requetes <= LIMITE_REQUETES && compteur.connexions <= LIMITE_CONNEXIONS
    }

    // ---------- Sessions ----------

    const expiree = (s, t) => t - s.creee > DUREE_SESSION || t - s.vue > INACTIVITE_SESSION || t >= s.expireJeton

    function lireSession(req) {
        const id = lireCookies(req)[COOKIE_SESSION]
        if (!id || !FORMAT_ALEATOIRE.test(id)) return null
        const session = sessions.get(id)
        if (!session) return null
        const maintenant = Date.now()
        if (expiree(session, maintenant)) {
            sessions.delete(id)
            return null
        }
        session.vue = maintenant
        return session
    }

    function creerSession(utilisateur, jeton) {
        if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value)
        const maintenant = Date.now()
        const expire = Number(jeton.expiresAt)
        const session = {
            id: aleatoire(),
            csrf: aleatoire(),
            utilisateur: { id: utilisateur.id, username: utilisateur.username, globalName: utilisateur.globalName, avatarUrl: utilisateur.avatarUrl },
            accessToken: jeton.accessToken,
            expireJeton: Number.isFinite(expire) ? expire : maintenant + DUREE_SESSION,
            creee: maintenant,
            vue: maintenant,
            serveurs: null,
            serveursLus: 0,
            message: null
        }
        sessions.set(session.id, session)
        return session
    }

    const nettoyage = setInterval(() => {
        const maintenant = Date.now()
        for (const [id, s] of sessions) if (expiree(s, maintenant)) sessions.delete(id)
        for (const [ip, c] of debits) if (maintenant - c.debut >= MINUTE) debits.delete(ip)
    }, MINUTE)
    nettoyage.unref()

    // Liste des serveurs de l'utilisateur, relue si elle a plus de 5 minutes
    async function serveursSession(session) {
        if (!session.serveurs || Date.now() - session.serveursLus > RELECTURE_SERVEURS) {
            try {
                session.serveurs = await discord.serveursUtilisateur(session.accessToken)
            } catch (err) {
                if (err.status === 401) {
                    // Jeton révoqué côté Discord : on oublie la session
                    sessions.delete(session.id)
                    const reconnexion = new Error("Jeton OAuth2 refusé")
                    reconnexion.reconnexion = true
                    throw reconnexion
                }
                throw err
            }
            session.serveursLus = Date.now()
        }
        return session.serveurs
    }

    // Contrôle d'accès à /serveur/:id : null dans TOUS les cas de refus
    async function serveurAutorise(session, id) {
        if (!FORMAT_ID.test(id)) return null
        const entree = (await serveursSession(session)).find(g => g.id === id)
        if (!entree || !peutGerer(entree)) return null
        const bot = await discord.serveurBot(id)
        if (!bot) return null
        return { id: bot.id, name: bot.name, iconUrl: bot.iconUrl }
    }

    function verifierOrigine(req) {
        if (req.headers.origin !== origine) throw refus(403, "Requête refusée", "Origine de la requête non autorisée.")
    }

    function verifierCsrf(params, session) {
        if (!session) {
            // Session absente ou expirée (ex. redémarrage du site) : on renvoie vers la connexion plutôt qu'une page d'erreur
            const reconnexion = new Error("Session absente")
            reconnexion.reconnexion = true
            throw reconnexion
        }
        if (!egalConstant(params.get("_csrf"), session.csrf)) {
            throw refus(403, "Requête refusée", "Jeton de sécurité invalide ou session expirée. Recharge la page et réessaie.")
        }
    }

    // ---------- Routes ----------

    function accueil(req, res) {
        const session = lireSession(req)
        envoyerPage(res, 200, pages.pageAccueil({ utilisateur: session ? session.utilisateur : null }))
    }

    async function style(res) {
        if (css === null) {
            try {
                css = await fs.promises.readFile(CHEMIN_CSS)
            } catch {
                return envoyerErreur(res, ERREUR_404)
            }
        }
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=300" })
        res.end(css)
    }

    function connexion(req, res) {
        if (lireSession(req)) return rediriger(res, 302, "/serveurs")
        const etat = aleatoire()
        rediriger(res, 302, discord.urlConnexion(etat), {
            "Set-Cookie": `${COOKIE_ETAT}=${etat}; ${ATTRIBUTS_COOKIE}; Max-Age=${DUREE_ETAT / 1000}`
        })
    }

    async function callback(req, res, requete) {
        const cookies = lireCookies(req)
        const etatCookie = cookies[COOKIE_ETAT]
        // Le cookie d'état ne sert qu'une fois : il est supprimé quelle que soit l'issue
        const effacer = { "Set-Cookie": EFFACER_ETAT }
        if (!etatCookie || !FORMAT_ALEATOIRE.test(etatCookie) || !egalConstant(requete.get("state"), etatCookie)) {
            return envoyerErreur(res, { code: 400, titre: "Connexion expirée", texte: "La demande de connexion est invalide ou a expiré. Recommence la connexion." }, effacer)
        }
        const code = requete.get("code")
        if (requete.has("error") || !code || code.length > 512) {
            return envoyerErreur(res, { code: 400, titre: "Connexion annulée", texte: "La connexion avec Discord a été annulée ou refusée." }, effacer)
        }
        let jeton, utilisateur
        try {
            jeton = await discord.echangerCode(code)
            utilisateur = await discord.utilisateur(jeton.accessToken)
        } catch (err) {
            // Ni le code ni le jeton dans le journal : seulement le statut
            console.error(`[tableau de bord] échec de la connexion OAuth2 (statut ${err.status ?? "inconnu"})`)
            return envoyerErreur(res, { code: 502, titre: "Connexion impossible", texte: "Discord n'a pas validé la connexion. Réessaie dans un instant." }, effacer)
        }
        // Fixation de session : l'ancienne session (s'il y en a une) est détruite, un nouvel ID est créé
        const ancien = cookies[COOKIE_SESSION]
        if (ancien) sessions.delete(ancien)
        const session = creerSession(utilisateur, jeton)
        rediriger(res, 303, "/serveurs", {
            "Set-Cookie": [`${COOKIE_SESSION}=${session.id}; ${ATTRIBUTS_COOKIE}; Max-Age=${DUREE_SESSION / 1000}`, EFFACER_ETAT]
        })
    }

    async function deconnexion(req, res) {
        verifierOrigine(req)
        const session = lireSession(req)
        const params = await lireCorps(req)
        if (session) {
            verifierCsrf(params, session)
            sessions.delete(session.id)
        }
        rediriger(res, 303, "/", { "Set-Cookie": EFFACER_SESSION })
    }

    async function listeServeurs(req, res) {
        const session = lireSession(req)
        if (!session) return rediriger(res, 302, "/connexion")
        const liste = (await serveursSession(session)).filter(peutGerer)
        const serveurs = []
        // Par petits lots pour ménager la limite de débit de l'API Discord
        // Au-delà de MAX_VERIFICATIONS_BOT serveurs, le bot est considéré absent (lien d'invitation) sans appel à Discord
        const aVerifier = liste.slice(0, MAX_VERIFICATIONS_BOT)
        for (let i = 0; i < aVerifier.length; i += 5) {
            serveurs.push(...await Promise.all(aVerifier.slice(i, i + 5).map(async g => ({
                id: g.id,
                name: g.name,
                iconUrl: g.iconUrl,
                botPresent: await discord.serveurBot(g.id).then(b => b !== null, () => false)
            }))))
        }
        for (const g of liste.slice(MAX_VERIFICATIONS_BOT)) serveurs.push({ id: g.id, name: g.name, iconUrl: g.iconUrl, botPresent: false })
        envoyerPage(res, 200, pages.pageServeurs({
            utilisateur: session.utilisateur,
            serveurs,
            lienInvitation: lienInvitation(discord.clientId()),
            csrf: session.csrf
        }))
    }

    async function pageDuServeur(req, res, id) {
        const session = lireSession(req)
        if (!session) return rediriger(res, 302, "/connexion")
        const serveur = await serveurAutorise(session, id)
        if (!serveur) return envoyerErreur(res, ERREUR_404)
        const config = await actions.lireConfig(id, session.utilisateur.id)
        let message = null
        if (session.message && session.message.guildId === id) {
            message = session.message.message
            session.message = null
        }
        envoyerPage(res, 200, pages.pageServeur({ utilisateur: session.utilisateur, serveur, config, csrf: session.csrf, message }))
    }

    async function enregistrerServeur(req, res, id) {
        verifierOrigine(req)
        const session = lireSession(req)
        const params = await lireCorps(req)
        verifierCsrf(params, session)
        const serveur = await serveurAutorise(session, id)
        if (!serveur) return envoyerErreur(res, ERREUR_404)

        const formulaire = {}
        for (const champ of CHAMPS) if (params.has(champ) && !champ.endsWith("Defaut")) formulaire[champ] = params.get(champ)
        if (params.get("couleurDefaut") === "1") formulaire.couleur = ""
        if (params.get("panneauDefaut") === "1") {
            formulaire.panneauTitre = ""
            formulaire.panneauTexte = ""
        }
        const { id: userId, username } = session.utilisateur
        const resultat = await actions.enregistrer(id, { id: userId, username }, formulaire)
        const erreurs = resultat.erreurs || []
        const changements = resultat.changements || []

        let message
        if (!erreurs.length) message = { type: "ok", lignes: changements.length ? changements : ["Aucun changement."] }
        else if (!changements.length) message = { type: "erreur", lignes: erreurs }
        else message = { type: "erreur", lignes: [...erreurs, `Enregistré quand même : ${changements.join(" ; ")}`] }
        session.message = { guildId: id, message }
        rediriger(res, 303, `/serveur/${id}`)
    }

    async function traiter(req, res) {
        appliquerEnTetes(res)
        const url = String(req.url || "")
        const point = url.indexOf("?")
        const chemin = point < 0 ? url : url.slice(0, point)
        const requete = new URLSearchParams(point < 0 ? "" : url.slice(point + 1))
        const methode = req.method === "HEAD" ? "GET" : req.method

        if (!debitAutorise(adresseIp(req), chemin === "/connexion" || chemin === "/callback")) {
            return envoyerErreur(res, { code: 429, titre: "Trop de requêtes", texte: "Patiente une minute avant de réessayer." }, { "Retry-After": "60" })
        }

        const serveur = /^\/serveur\/([^/]+)$/.exec(chemin)
        if (methode === "GET") {
            if (chemin === "/") return accueil(req, res)
            if (chemin === "/style.css") return style(res)
            if (chemin === "/connexion") return connexion(req, res)
            if (chemin === "/callback") return callback(req, res, requete)
            if (chemin === "/serveurs") return listeServeurs(req, res)
            if (serveur) return pageDuServeur(req, res, serveur[1])
        } else if (methode === "POST") {
            if (chemin === "/deconnexion") return deconnexion(req, res)
            if (serveur) return enregistrerServeur(req, res, serveur[1])
        }
        envoyerErreur(res, ERREUR_404)
    }

    function gererErreur(res, err) {
        if (res.headersSent) {
            res.destroy()
            return
        }
        if (err && err.http) {
            // Corps refusé et pas lu en entier : la connexion est fermée après la réponse
            return envoyerErreur(res, err.http, err.http.code === 413 || err.http.code === 415 ? { Connection: "close" } : {})
        }
        if (err && err.reconnexion) return rediriger(res, 303, "/connexion", { "Set-Cookie": EFFACER_SESSION })
        console.error("[tableau de bord] erreur interne :", err && err.stack ? err.stack : err)
        envoyerErreur(res, { code: 500, titre: "Erreur interne", texte: "Une erreur est survenue. Réessaie dans un instant." })
    }

    const serveurHttp = http.createServer((req, res) => {
        traiter(req, res).catch(err => gererErreur(res, err))
    })
    serveurHttp.headersTimeout = 15 * 1000
    serveurHttp.requestTimeout = 30 * 1000
    serveurHttp.keepAliveTimeout = 5 * 1000
    serveurHttp.on("close", () => clearInterval(nettoyage))
    return serveurHttp
}

module.exports = { creerServeur }
