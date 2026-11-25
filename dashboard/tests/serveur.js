const assert = require('assert')
const { once } = require('node:events')
const { creerServeur } = require('../serveur')

const ORIGINE = "http://localhost:3000"
const CSP = "default-src 'none'; style-src 'self'; img-src https://cdn.discordapp.com; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
const U = "555555555555555555"
// G1 géré + bot présent, G2 sans « Gérer le serveur », G3 sans le bot, G4 absent de la liste, G5 propriétaire
const G1 = "111111111111111111", G2 = "222222222222222222", G3 = "333333333333333333", G4 = "444444444444444444", G5 = "666666666666666666"

function fauxModules() {
    const etat = { enregistrer: [], lireConfig: [], panne: false }
    const discord = {
        clientId: () => "123456789012345678",
        urlConnexion: state => `https://discord.com/oauth2/authorize?state=${encodeURIComponent(state)}`,
        async echangerCode(code) {
            assert.strictEqual(code, "bon-code")
            return { accessToken: "jeton-secret", expiresAt: Date.now() + 3600 * 1000 }
        },
        async utilisateur(jeton) {
            assert.strictEqual(jeton, "jeton-secret")
            return { id: U, username: "alice", globalName: "Alice", avatarUrl: null }
        },
        async serveursUtilisateur() {
            return [
                { id: G1, name: "Un", iconUrl: null, owner: false, permissions: 1n << 5n },
                { id: G2, name: "Deux", iconUrl: null, owner: false, permissions: 1n << 10n },
                { id: G3, name: "Trois", iconUrl: null, owner: false, permissions: 1n << 5n },
                { id: G5, name: "Cinq", iconUrl: null, owner: true, permissions: 0n }
            ]
        },
        serveurBot: async id => [G1, G2, G4, G5].includes(id) ? { id, name: `Serveur ${id}`, iconUrl: null, ownerId: "1" } : null
    }
    const actions = {
        async lireConfig(guildId, utilisateurId) {
            etat.lireConfig.push([guildId, utilisateurId])
            if (etat.panne) throw new Error("panne simulée de la base")
            return { langue: "auto" }
        },
        async enregistrer(guildId, utilisateur, formulaire) {
            etat.enregistrer.push({ guildId, utilisateur, formulaire })
            return { erreurs: [], changements: ["Langue : fr"] }
        }
    }
    const pages = {
        pageAccueil: ({ utilisateur }) => `accueil:${utilisateur ? utilisateur.username : "anonyme"}`,
        pageServeurs: a => `serveurs:${a.serveurs.map(s => `${s.id}=${s.botPresent}`).join(",")}|invitation:${a.lienInvitation}|csrf:${a.csrf}`,
        pageServeur: a => `serveur:${a.serveur.id}|csrf:${a.csrf}|message:${a.message ? a.message.lignes.join(",") : "aucun"}`,
        pageErreur: e => `erreur:${e.code}:${e.titre}`
    }
    return { etat, discord, actions, pages }
}

// Attributs d'un en-tête Set-Cookie, en minuscules
function attributs(cookie) {
    return cookie.split(";").slice(1).map(a => a.trim().toLowerCase())
}

async function tester() {
    const ancienEnv = { url: process.env.DASHBOARD_URL, proxy: process.env.DASHBOARD_TRUST_PROXY }
    process.env.DASHBOARD_URL = ORIGINE
    delete process.env.DASHBOARD_TRUST_PROXY

    const { etat, discord, actions, pages } = fauxModules()
    const serveur = creerServeur({ discord, actions, pages })
    serveur.listen(0, "127.0.0.1")
    await once(serveur, "listening")
    const base = `http://127.0.0.1:${serveur.address().port}`

    async function requete(chemin, { methode = "GET", cookie = null, origine = ORIGINE, corps = null, type = "application/x-www-form-urlencoded" } = {}) {
        const headers = {}
        if (cookie) headers.cookie = cookie
        if (methode === "POST") {
            if (origine) headers.origin = origine
            headers["content-type"] = type
        }
        const res = await fetch(base + chemin, { method: methode, headers, body: corps, redirect: "manual" })
        return { status: res.status, headers: res.headers, cookies: res.headers.getSetCookie(), texte: await res.text() }
    }

    try {
        // 1. En-têtes de sécurité
        let r = await requete("/")
        assert.strictEqual(r.status, 200)
        assert.strictEqual(r.texte, "accueil:anonyme")
        assert.strictEqual(r.headers.get("content-security-policy"), CSP)
        assert.strictEqual(r.headers.get("x-content-type-options"), "nosniff")
        assert.strictEqual(r.headers.get("referrer-policy"), "same-origin")
        assert.strictEqual(r.headers.get("x-frame-options"), "DENY")
        assert.strictEqual(r.headers.get("cache-control"), "no-store")
        assert.match(r.headers.get("content-type"), /^text\/html; charset=utf-8$/)

        // 2. Page inconnue
        const inconnu = await requete("/inconnu")
        assert.strictEqual(inconnu.status, 404)
        assert.strictEqual(inconnu.texte, "erreur:404:Page introuvable")
        assert.strictEqual((await requete("/", { methode: "PUT" })).status, 404)

        // 3. Pages connectées sans session
        r = await requete("/serveurs")
        assert.strictEqual(r.status, 302)
        assert.strictEqual(r.headers.get("location"), "/connexion")
        r = await requete(`/serveur/${G1}`)
        assert.strictEqual(r.status, 302)
        assert.strictEqual(r.headers.get("location"), "/connexion")

        // 4. Début de connexion : state aléatoire dans un cookie court
        r = await requete("/connexion")
        assert.strictEqual(r.status, 302)
        const state = new URL(r.headers.get("location")).searchParams.get("state")
        assert.match(state, /^[A-Za-z0-9_-]{43}$/)
        const cookieEtat = r.cookies.find(c => c.startsWith("__Host-etat="))
        assert.ok(cookieEtat, "cookie d'état posé")
        assert.strictEqual(cookieEtat.split(";")[0], `__Host-etat=${state}`)
        for (const a of ["httponly", "secure", "samesite=lax", "path=/", "max-age=600"]) assert.ok(attributs(cookieEtat).includes(a), `cookie d'état : ${a}`)
        const etatOk = `__Host-etat=${state}`

        // 5. Callback avec un mauvais state, ou sans cookie : refusé, aucune session
        r = await requete("/callback?code=bon-code&state=mauvais", { cookie: etatOk })
        assert.strictEqual(r.status, 400)
        assert.ok(!r.cookies.some(c => c.startsWith("__Host-tdb=")), "pas de session")
        assert.ok(r.cookies.some(c => c.startsWith("__Host-etat=;") && attributs(c).includes("max-age=0")), "cookie d'état supprimé")
        r = await requete(`/callback?code=bon-code&state=${state}`)
        assert.strictEqual(r.status, 400)
        r = await requete(`/callback?error=access_denied&state=${state}`, { cookie: etatOk })
        assert.strictEqual(r.status, 400)

        // 6. Connexion complète, avec un ancien cookie de session (fixation : il doit être remplacé)
        const fixe = "A".repeat(43)
        r = await requete(`/callback?code=bon-code&state=${state}`, { cookie: `${etatOk}; __Host-tdb=${fixe}` })
        assert.strictEqual(r.status, 303)
        assert.strictEqual(r.headers.get("location"), "/serveurs")
        const cookieSession = r.cookies.find(c => c.startsWith("__Host-tdb="))
        assert.ok(cookieSession, "cookie de session posé")
        const idSession = cookieSession.split(";")[0].slice("__Host-tdb=".length)
        assert.match(idSession, /^[A-Za-z0-9_-]{43}$/)
        assert.notStrictEqual(idSession, fixe)
        const attr = attributs(cookieSession)
        for (const a of ["httponly", "secure", "samesite=lax", "path=/", `max-age=${7 * 24 * 3600}`]) assert.ok(attr.includes(a), `cookie de session : ${a}`)
        assert.ok(!attr.some(a => a.startsWith("domain=")), "pas de Domain (préfixe __Host-)")
        assert.ok(r.cookies.some(c => c.startsWith("__Host-etat=;")), "cookie d'état supprimé après usage")
        const session = `__Host-tdb=${idSession}`
        assert.strictEqual((await requete("/serveurs", { cookie: `__Host-tdb=${fixe}` })).status, 302, "l'ancien ID ne donne rien")

        // 7. Liste des serveurs : seulement ceux gérables, présence du bot, lien d'invitation, CSRF
        r = await requete("/serveurs", { cookie: session })
        assert.strictEqual(r.status, 200)
        assert.strictEqual(r.headers.get("cache-control"), "no-store")
        assert.ok(r.texte.startsWith(`serveurs:${G1}=true,${G3}=false,${G5}=true|`), r.texte)
        assert.ok(r.texte.includes("|invitation:https://discord.com/oauth2/authorize?client_id=123456789012345678"))
        const csrf = /\|csrf:([A-Za-z0-9_-]{43})$/.exec(r.texte)[1]

        // 8. Page d'un serveur autorisé (géré ou propriétaire)
        r = await requete(`/serveur/${G1}`, { cookie: session })
        assert.strictEqual(r.status, 200)
        assert.strictEqual(r.texte, `serveur:${G1}|csrf:${csrf}|message:aucun`)
        assert.deepStrictEqual(etat.lireConfig.at(-1), [G1, U], "lireConfig reçoit l'utilisateur connecté")
        assert.strictEqual((await requete(`/serveur/${G5}`, { cookie: session })).status, 200)

        // 9. IDOR : même 404 que pour une page inconnue, quelle que soit la raison du refus
        for (const id of [G2, G3, G4, "abc", "1".repeat(25), "1%2F1"]) {
            r = await requete(`/serveur/${id}`, { cookie: session })
            assert.strictEqual(r.status, 404, `GET ${id}`)
            assert.strictEqual(r.texte, inconnu.texte, `GET ${id} : même réponse`)
        }

        // 10. POST refusés : sans CSRF, mauvais CSRF, mauvaise ou aucune origine, mauvais type, sans session
        const formulaire = `_csrf=${csrf}&langue=fr&inconnu=x&__proto__=y`
        const refus = [
            ["sans CSRF", { cookie: session, corps: "langue=fr" }, 403],
            ["mauvais CSRF", { cookie: session, corps: `_csrf=${"B".repeat(43)}&langue=fr` }, 403],
            ["mauvaise origine", { cookie: session, corps: formulaire, origine: "https://pirate.exemple" }, 403],
            ["sans origine", { cookie: session, corps: formulaire, origine: null }, 403],
            ["origine null", { cookie: session, corps: formulaire, origine: "null" }, 403],
            ["session inconnue", { cookie: `__Host-tdb=${"C".repeat(43)}`, corps: formulaire }, 303],
            ["sans session", { corps: formulaire }, 303],
            ["mauvais type", { cookie: session, corps: formulaire, type: "text/plain" }, 415]
        ]
        for (const [nom, options, code] of refus) {
            r = await requete(`/serveur/${G1}`, { methode: "POST", ...options })
            assert.strictEqual(r.status, code, nom)
            if (code === 303) assert.strictEqual(r.headers.get("location"), "/connexion", nom)
        }
        assert.strictEqual(etat.enregistrer.length, 0, "aucun enregistrement sur un POST refusé")

        // 11. POST valide : seuls les champs connus sont transmis, message affiché une seule fois
        r = await requete(`/serveur/${G1}`, { methode: "POST", cookie: session, corps: formulaire })
        assert.strictEqual(r.status, 303)
        assert.strictEqual(r.headers.get("location"), `/serveur/${G1}`)
        assert.strictEqual(etat.enregistrer.length, 1)
        assert.deepStrictEqual(etat.enregistrer[0], { guildId: G1, utilisateur: { id: U, username: "alice" }, formulaire: { langue: "fr" } })
        assert.ok((await requete(`/serveur/${G1}`, { cookie: session })).texte.endsWith("|message:Langue : fr"))
        assert.ok((await requete(`/serveur/${G1}`, { cookie: session })).texte.endsWith("|message:aucun"))

        // 11 bis. Cases « Rétablir le défaut » : transmises en valeurs vides, jamais telles quelles
        r = await requete(`/serveur/${G1}`, { methode: "POST", cookie: session, corps: `_csrf=${csrf}&couleurDefaut=1&panneauDefaut=1&couleur=%23ffffff` })
        assert.strictEqual(r.status, 303)
        assert.deepStrictEqual(etat.enregistrer.pop().formulaire, { couleur: "", panneauTitre: "", panneauTexte: "" })
        await requete(`/serveur/${G1}`, { cookie: session })
        await requete(`/serveur/${G1}`, { methode: "POST", cookie: session, corps: `_csrf=${csrf}&couleurDefaut=0&panneauDefaut=oui` })
        assert.deepStrictEqual(etat.enregistrer.pop().formulaire, {})
        await requete(`/serveur/${G1}`, { cookie: session })
        assert.strictEqual(etat.enregistrer.length, 1)

        // 12. POST valide sur un serveur interdit : 404, rien d'enregistré
        for (const id of [G2, G3, G4]) {
            r = await requete(`/serveur/${id}`, { methode: "POST", cookie: session, corps: formulaire })
            assert.strictEqual(r.status, 404, `POST ${id}`)
            assert.strictEqual(r.texte, inconnu.texte)
        }
        assert.strictEqual(etat.enregistrer.length, 1)

        // 13. Corps trop gros
        r = await requete(`/serveur/${G1}`, { methode: "POST", cookie: session, corps: `_csrf=${csrf}&panneauTexte=${"x".repeat(17 * 1024)}` })
        assert.strictEqual(r.status, 413)
        assert.strictEqual(etat.enregistrer.length, 1)

        // 14. Erreur interne : page générique, aucun détail
        etat.panne = true
        const consoleError = console.error
        const journal = []
        console.error = (...args) => journal.push(args.join(" "))
        try {
            r = await requete(`/serveur/${G1}`, { cookie: session })
        } finally {
            console.error = consoleError
            etat.panne = false
        }
        assert.strictEqual(r.status, 500)
        assert.strictEqual(r.texte, "erreur:500:Erreur interne")
        assert.ok(journal.some(l => l.includes("panne simulée")), "erreur journalisée en console")

        // 15. Feuille de style (peut ne pas encore exister)
        r = await requete("/style.css")
        assert.ok([200, 404].includes(r.status))
        if (r.status === 200) assert.match(r.headers.get("content-type"), /^text\/css/)

        // 16. Déconnexion : refusée sans CSRF, puis la session est détruite
        assert.strictEqual((await requete("/deconnexion", { methode: "POST", cookie: session, corps: "" })).status, 403)
        assert.strictEqual((await requete("/serveurs", { cookie: session })).status, 200, "session toujours valide")
        r = await requete("/deconnexion", { methode: "POST", cookie: session, corps: `_csrf=${csrf}` })
        assert.strictEqual(r.status, 303)
        assert.strictEqual(r.headers.get("location"), "/")
        assert.ok(r.cookies.some(c => c.startsWith("__Host-tdb=;") && attributs(c).includes("max-age=0")), "cookie de session effacé")
        r = await requete("/serveurs", { cookie: session })
        assert.strictEqual(r.status, 302)
        assert.strictEqual(r.headers.get("location"), "/connexion")

        // 17. Limite de débit sur les connexions (10 par minute et par IP)
        let limite = null
        for (let i = 0; i < 12 && !limite; i++) {
            r = await requete("/connexion")
            if (r.status === 429) limite = r
        }
        assert.ok(limite, "limite de connexions atteinte")
        assert.strictEqual(limite.headers.get("retry-after"), "60")
    } finally {
        serveur.closeAllConnections()
        await new Promise(resolve => serveur.close(resolve))
        if (ancienEnv.url === undefined) delete process.env.DASHBOARD_URL
        else process.env.DASHBOARD_URL = ancienEnv.url
        if (ancienEnv.proxy !== undefined) process.env.DASHBOARD_TRUST_PROXY = ancienEnv.proxy
    }
    await testerLimites()
    console.log("OK : tableau de bord – serveur HTTP")
}

// Serveur à part (proxy de confiance, table de débit minuscule) pour le plafond de vérifications et l'éviction
async function testerLimites() {
    const ancien = { url: process.env.DASHBOARD_URL, proxy: process.env.DASHBOARD_TRUST_PROXY }
    process.env.DASHBOARD_URL = ORIGINE
    process.env.DASHBOARD_TRUST_PROXY = "1"
    const { discord, actions, pages } = fauxModules()
    const gerables = Array.from({ length: 60 }, (_, i) => ({ id: String(100000000000000000 + i), name: `S${i}`, iconUrl: null, owner: true, permissions: 0n }))
    let appels = 0
    discord.serveursUtilisateur = async () => gerables
    discord.serveurBot = async id => {
        appels++
        return { id, name: id, iconUrl: null }
    }
    const serveur = creerServeur({ discord, actions, pages, maxIps: 3 })
    serveur.listen(0, "127.0.0.1")
    await once(serveur, "listening")
    const base = `http://127.0.0.1:${serveur.address().port}`
    const get = async (chemin, ip, cookie) => {
        const headers = { "x-forwarded-for": ip }
        if (cookie) headers.cookie = cookie
        const res = await fetch(base + chemin, { headers, redirect: "manual" })
        return { status: res.status, cookies: res.headers.getSetCookie(), texte: await res.text() }
    }
    try {
        // Connexion, puis liste de 60 serveurs : le bot n'est vérifié que pour 50 d'entre eux
        let r = await get("/connexion", "10.0.0.1")
        const etat = r.cookies.find(c => c.startsWith("__Host-etat=")).split(";")[0]
        r = await get(`/callback?code=bon-code&state=${etat.slice("__Host-etat=".length)}`, "10.0.0.1", etat)
        assert.strictEqual(r.status, 303)
        const session = r.cookies.find(c => c.startsWith("__Host-tdb=")).split(";")[0]
        r = await get("/serveurs", "10.0.0.1", session)
        assert.strictEqual(r.status, 200)
        assert.strictEqual(appels, 50, "50 vérifications au plus")
        const entrees = r.texte.split("|")[0].slice("serveurs:".length).split(",")
        assert.strictEqual(entrees.length, 60)
        assert.strictEqual(entrees.filter(x => x.endsWith("=true")).length, 50)
        assert.ok(entrees.slice(50).every(x => x.endsWith("=false")), "les suivants : bot absent")

        // Éviction : A et B (60 requêtes chacune), C ; l'arrivée de D évince A seulement
        for (const ip of ["20.0.0.1", "20.0.0.2"]) for (let i = 0; i < 60; i++) assert.strictEqual((await get("/", ip)).status, 200)
        await get("/", "20.0.0.3")
        assert.strictEqual((await get("/", "20.0.0.4")).status, 200)
        assert.strictEqual((await get("/", "20.0.0.2")).status, 429, "B reste limitée : la table n'est pas vidée d'un coup")
        assert.strictEqual((await get("/", "20.0.0.1")).status, 200, "A, la plus ancienne, a été évincée")
    } finally {
        serveur.closeAllConnections()
        await new Promise(resolve => serveur.close(resolve))
        if (ancien.url === undefined) delete process.env.DASHBOARD_URL
        else process.env.DASHBOARD_URL = ancien.url
        if (ancien.proxy === undefined) delete process.env.DASHBOARD_TRUST_PROXY
        else process.env.DASHBOARD_TRUST_PROXY = ancien.proxy
    }
}

module.exports = { tester }
