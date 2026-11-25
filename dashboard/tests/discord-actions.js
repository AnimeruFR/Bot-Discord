// Tests de dashboard/discord.js et dashboard/actions.js : aucun accès réseau (fetch simulé)
const assert = require('assert')
const Discord = require('discord.js')
const db = require('../../Fonctions/db')
const discord = require('../discord')
const actions = require('../actions')

const P = Discord.PermissionFlagsBits
const { ChannelType } = Discord

// Identifiants réservés à ces tests (préfixe 66666666666666)
const id = n => `66666666666666${String(n).padStart(4, "0")}`
const APP = id(9999)
const SKU = id(7001)

// --- Faux serveur Discord ----------------------------------------------------------------------
const role = (rid, name, position, permissions = 0n, managed = false) => ({ id: rid, name, position, managed, permissions: String(permissions), color: position === 3 ? 0x112233 : 0 })
const salonBrut = (cid, name, type, extra = {}) => ({ id: cid, name, type, parent_id: null, position: 0, topic: null, permission_overwrites: [], ...extra })

// Un serveur de test complet. k : 0 serveur, 1 propriétaire, 2 admin, 3 « Gérer le serveur », 4 tickets (3 permissions),
// 5 simple membre, 6 absent ; rôles 10 à 16 ; salons 20 à 27.
function creerServeur(monde, n) {
    const k = i => id(n * 100 + i)
    const G = k(0)
    const tout = P.ViewChannel | P.SendMessages | P.EmbedLinks
    monde.serveurs[G] = {
        guild: { id: G, name: `Serveur ${n}`, icon: null, owner_id: k(1) },
        roles: [
            role(G, "@everyone", 0, tout),
            role(k(10), "Admin", 6, P.Administrator),
            role(k(11), "Modo", 3, P.ManageGuild),
            role(k(12), "Chef tickets", 5, P.ManageGuild | P.ManageChannels | P.ManageRoles),
            role(k(13), "Staff", 2),
            role(k(14), "Haut", 8),
            role(k(15), "Géré", 7, 0n, true),
            role(k(16), "Bot", 4, P.ManageChannels)
        ],
        channels: [
            salonBrut(k(20), "tickets", ChannelType.GuildCategory),
            salonBrut(k(21), "logs", ChannelType.GuildText),
            salonBrut(k(22), "logs-2", ChannelType.GuildText),
            salonBrut(k(23), "ticket-bob", ChannelType.GuildText, { topic: k(5) }),
            salonBrut(k(24), "vocal", ChannelType.GuildVoice),
            salonBrut(k(25), "secret", ChannelType.GuildText, { permission_overwrites: [{ id: G, type: 0, allow: "0", deny: String(P.ViewChannel) }] }),
            salonBrut(k(26), "accueil", ChannelType.GuildText),
            salonBrut(k(27), "cat-secrete", ChannelType.GuildCategory, { permission_overwrites: [{ id: G, type: 0, allow: "0", deny: String(P.ViewChannel) }] })
        ],
        members: {
            [k(1)]: { roles: [] },
            [k(2)]: { roles: [k(10)] },
            [k(3)]: { roles: [k(11)] },
            [k(4)]: { roles: [k(12)] },
            [k(5)]: { roles: [] },
            [APP]: { roles: [k(16)] }
        }
    }
    return { G, k }
}

function creerMonde() {
    return { serveurs: {}, messages: [], appels: [], entitlements: [], limite429: 0 }
}

function simulerFetch(monde) {
    const rep = (corps, status = 200) => new Response(JSON.stringify(corps), { status })
    return async (url, options = {}) => {
        const u = new URL(String(url))
        assert.strictEqual(u.origin, "https://discord.com", "aucun appel hors de l'API Discord")
        const chemin = u.pathname.replace("/api/v10", "")
        const methode = options.method ?? "GET"
        monde.appels.push({ methode, chemin, requete: u.searchParams, headers: options.headers, body: options.body })
        let m

        if (monde.limite429 > 0) {
            monde.limite429--
            return rep({ message: "rate limited", retry_after: 0.01 }, 429)
        }
        if (chemin === "/applications/@me") return rep({ id: APP })
        if ((m = chemin.match(/^\/guilds\/(\d+)$/))) return monde.serveurs[m[1]] ? rep(monde.serveurs[m[1]].guild) : rep({ message: "Missing Access" }, 403)
        if ((m = chemin.match(/^\/guilds\/(\d+)\/channels$/))) return monde.serveurs[m[1]] ? rep(monde.serveurs[m[1]].channels) : rep({ message: "Unknown Guild" }, 500)
        if ((m = chemin.match(/^\/guilds\/(\d+)\/roles$/))) return rep(monde.serveurs[m[1]].roles)
        if ((m = chemin.match(/^\/guilds\/(\d+)\/members\/(\d+)$/))) {
            const membre = monde.serveurs[m[1]].members[m[2]]
            return membre ? rep({ user: { id: m[2] }, roles: membre.roles }) : rep({ message: "Unknown Member", code: 10007 }, 404)
        }
        if ((m = chemin.match(/^\/channels\/(\d+)\/messages$/))) {
            const guildId = Object.keys(monde.serveurs).find(g => monde.serveurs[g].channels.some(c => c.id === m[1]))
            const embed = JSON.parse(options.body).embeds[0]
            // logsEnBase : le salon de logs enregistré au moment de l'envoi (preuve de l'ordre ancien / nouveau)
            monde.messages.push({ salon: m[1], logsEnBase: db.getLogChannel(guildId), embed })
            return rep({ id: "1" })
        }
        if ((m = chemin.match(/^\/applications\/(\d+)\/entitlements$/))) {
            const guildId = u.searchParams.get("guild_id")
            return rep(monde.entitlements.filter(e => e.guild_id === guildId && e.sku_id === u.searchParams.get("sku_ids")))
        }
        if (chemin === "/oauth2/token") return rep({ access_token: "jeton-test", expires_in: 604800 })
        if (chemin === "/users/%40me" || chemin === "/users/@me") return rep({ id: id(1), username: "bob", global_name: "Bob", avatar: "a_abc" })
        if (chemin === "/users/%40me/guilds" || chemin === "/users/@me/guilds") return rep([{ id: id(2), name: "S", icon: "xyz", owner: true, permissions: "32" }])
        return rep({ message: `route inattendue ${methode} ${chemin}` }, 500)
    }
}

// Espionne les écritures de la base (les fonctions sont appelées par db.xxx, donc remplaçables)
function espionnerEcritures() {
    const noms = ["setLangue", "setCouleur", "setPanneauTicket", "setLogChannel", "setTicketConfig", "resetTicketConfig", "setTicketInactivity", "setWelcome"]
    const originaux = {}
    const appels = []
    for (const nom of noms) {
        originaux[nom] = db[nom]
        db[nom] = (...args) => { appels.push(nom); return originaux[nom](...args) }
    }
    return { appels, restaurer: () => { for (const nom of noms) db[nom] = originaux[nom] } }
}

const contient = (liste, morceau) => liste.some(l => l.includes(morceau))

// --- Permissions (fonction pure) ---------------------------------------------------------------
function testerPermissions() {
    const G = id(1), OWNER = id(2), U = id(3), R1 = id(4), R2 = id(5), ADM = id(6)
    const guild = { id: G, ownerId: OWNER }
    const roles = [
        { id: G, permissions: P.ViewChannel | P.SendMessages },
        { id: R1, permissions: P.ManageMessages },
        { id: R2, permissions: 0n },
        { id: ADM, permissions: P.Administrator }
    ]
    const a = (droits, p) => (droits & p) === p
    const salon = permissionOverwrites => ({ permissionOverwrites })
    const sur = (idCible, type, allow, deny) => ({ id: idCible, type, allow, deny })

    assert.strictEqual(discord.permissionsDans(guild, roles, { id: OWNER, roles: [] }), Discord.PermissionsBitField.All, "le propriétaire a tout")
    assert.strictEqual(discord.permissionsDans(guild, roles, { id: U, roles: [ADM] }), Discord.PermissionsBitField.All, "Administrateur : tout")
    // Administrateur ignore même une surcharge qui refuse
    assert.strictEqual(discord.permissionsDans(guild, roles, { id: U, roles: [ADM] }, salon([sur(U, 1, 0n, P.ViewChannel)])), Discord.PermissionsBitField.All)

    const base = discord.permissionsDans(guild, roles, { id: U, roles: [R1] })
    assert.ok(a(base, P.ManageMessages | P.ViewChannel | P.SendMessages), "base = @everyone + rôles")
    assert.ok(!a(base, P.ManageGuild))

    // @everyone refuse : retire la permission de base
    let d = discord.permissionsDans(guild, roles, { id: U, roles: [] }, salon([sur(G, 0, 0n, P.SendMessages)]))
    assert.ok(a(d, P.ViewChannel) && !a(d, P.SendMessages), "refus @everyone")
    // un rôle qui autorise l'emporte sur le refus @everyone
    d = discord.permissionsDans(guild, roles, { id: U, roles: [R1] }, salon([sur(G, 0, 0n, P.SendMessages), sur(R1, 0, P.SendMessages, 0n)]))
    assert.ok(a(d, P.SendMessages), "le rôle l'emporte sur @everyone")
    // un rôle qui refuse retire une permission de base
    d = discord.permissionsDans(guild, roles, { id: U, roles: [R1] }, salon([sur(R1, 0, 0n, P.ManageMessages)]))
    assert.ok(!a(d, P.ManageMessages), "refus de rôle")
    // refus du membre : il l'emporte sur l'autorisation d'un rôle
    d = discord.permissionsDans(guild, roles, { id: U, roles: [R1] }, salon([sur(R1, 0, P.SendMessages, 0n), sur(U, 1, 0n, P.SendMessages)]))
    assert.ok(!a(d, P.SendMessages), "refus du membre > autorisation du rôle")
    // autorisation du membre : elle l'emporte sur le refus d'un rôle
    d = discord.permissionsDans(guild, roles, { id: U, roles: [R1] }, salon([sur(R1, 0, 0n, P.SendMessages), sur(U, 1, P.SendMessages, 0n)]))
    assert.ok(a(d, P.SendMessages), "autorisation du membre > refus du rôle")
    // même niveau (deux rôles) : comme dans Discord, les autorisations sont appliquées après les refus
    d = discord.permissionsDans(guild, roles, { id: U, roles: [R1, R2] }, salon([sur(R1, 0, 0n, P.SendMessages), sur(R2, 0, P.SendMessages, 0n)]))
    assert.ok(a(d, P.SendMessages), "deux rôles : autorisation après refus")
    // la surcharge d'un rôle que le membre n'a pas ne compte pas, ni celle d'un autre membre
    d = discord.permissionsDans(guild, roles, { id: U, roles: [] }, salon([sur(R1, 0, 0n, P.SendMessages), sur(id(50), 1, 0n, P.SendMessages)]))
    assert.ok(a(d, P.SendMessages), "surcharges étrangères ignorées")
    // sans « Voir le salon » : plus rien dans ce salon
    d = discord.permissionsDans(guild, roles, { id: U, roles: [R1] }, salon([sur(G, 0, 0n, P.ViewChannel)]))
    assert.strictEqual(d, 0n, "pas de Voir le salon = aucune permission")
    // hors salon : jamais de retrait
    assert.ok(a(discord.permissionsDans(guild, roles, { id: U, roles: [] }, null), P.ViewChannel))
}

// --- Client REST -------------------------------------------------------------------------------
async function testerClient(monde) {
    const G = creerServeur(monde, 50).G
    await discord.init()
    assert.strictEqual(discord.clientId(), APP)

    const url = new URL(discord.urlConnexion("etat-123"))
    assert.strictEqual(url.origin + url.pathname, "https://discord.com/oauth2/authorize")
    assert.strictEqual(url.searchParams.get("client_id"), APP)
    assert.strictEqual(url.searchParams.get("redirect_uri"), "https://tableau.exemple.fr/callback", "barre finale de DASHBOARD_URL retirée")
    assert.strictEqual(url.searchParams.get("response_type"), "code")
    assert.strictEqual(url.searchParams.get("scope"), "identify guilds")
    assert.strictEqual(url.searchParams.get("state"), "etat-123")
    assert.strictEqual(url.searchParams.get("prompt"), "none")

    const jeton = await discord.echangerCode("le-code")
    assert.strictEqual(jeton.accessToken, "jeton-test")
    assert.ok(jeton.expiresAt > Date.now() + 600000 * 1000 - 5000)
    const envoi = monde.appels.at(-1)
    assert.strictEqual(envoi.methode, "POST")
    assert.strictEqual(envoi.headers["Content-Type"], "application/x-www-form-urlencoded")
    assert.strictEqual(envoi.headers.Authorization, undefined, "pas d'en-tête d'autorisation pour l'échange du code")
    const corps = new URLSearchParams(envoi.body)
    assert.strictEqual(corps.get("grant_type"), "authorization_code")
    assert.strictEqual(corps.get("code"), "le-code")
    assert.strictEqual(corps.get("client_secret"), "secret-de-test")

    const u = await discord.utilisateur("jeton-test")
    assert.deepStrictEqual(u, { id: id(1), username: "bob", globalName: "Bob", avatarUrl: `https://cdn.discordapp.com/avatars/${id(1)}/a_abc.gif` })
    assert.strictEqual(monde.appels.at(-1).headers.Authorization, "Bearer jeton-test")
    const serveurs = await discord.serveursUtilisateur("jeton-test")
    assert.strictEqual(serveurs[0].permissions, 32n)
    assert.strictEqual(serveurs[0].owner, true)
    assert.strictEqual(serveurs[0].iconUrl, `https://cdn.discordapp.com/icons/${id(2)}/xyz.png`)

    // serveurBot : null si le bot n'y est pas (403 ou 404), cache de 60 s, BigInt pour les permissions
    assert.strictEqual(await discord.serveurBot(id(8888)), null)
    const avantAbsent = monde.appels.length
    assert.strictEqual(await discord.serveurBot(id(8888)), null)
    assert.strictEqual(monde.appels.length, avantAbsent, "l'absence du bot est aussi gardée en cache")
    const infos = await discord.serveurBot(G)
    assert.deepStrictEqual(infos, { id: G, name: "Serveur 50", iconUrl: null, ownerId: id(5001) })
    const avant = monde.appels.length
    await discord.serveurBot(G)
    assert.strictEqual(monde.appels.length, avant, "serveurBot en cache")

    const r = await discord.roles(G)
    assert.strictEqual(typeof r[0].permissions, "bigint")
    const s = await discord.salons(G)
    assert.strictEqual(typeof s[5].permissionOverwrites[0].deny, "bigint")
    const compte = () => monde.appels.filter(a => a.chemin === `/guilds/${G}/roles`).length
    const avantRoles = compte()
    await discord.roles(G)
    assert.strictEqual(compte(), avantRoles, "rôles en cache")

    // membre : jamais en cache, null si absent
    assert.strictEqual(await discord.membre(G, id(5006)), null)
    assert.deepStrictEqual(await discord.membre(G, id(5002)), { id: id(5002), roles: [id(5010)] })
    const avantMembre = monde.appels.length
    await discord.membre(G, id(5002))
    assert.strictEqual(monde.appels.length, avantMembre + 1, "membre jamais en cache")
    assert.deepStrictEqual(await discord.membreBot(G), { id: APP, roles: [id(5016)] })

    // 429 : une seule nouvelle tentative
    monde.limite429 = 1
    assert.deepStrictEqual(await discord.membre(G, id(5002)), { id: id(5002), roles: [id(5010)] })
    monde.limite429 = 2
    await assert.rejects(discord.membre(G, id(5002)), err => err.status === 429)

    // erreurs : .status, jamais de secret dans le message
    const ancienToken = process.env.DISCORD_TOKEN
    delete process.env.DISCORD_TOKEN
    await assert.rejects(discord.membre(G, id(5002)), /DISCORD_TOKEN/)
    process.env.DISCORD_TOKEN = ancienToken
    await assert.rejects(discord.salons(id(8887)), err => err.status === 500 && !err.message.includes("secret-de-test"))

    // envoyerLog ne lève jamais d'erreur, même si Discord répond mal
    const erreurConsole = console.error
    console.error = () => {}
    try { await discord.envoyerLog(id(8886), { titre: "t", details: "d", auteur: { id: id(1), username: "bob" } }) } finally { console.error = erreurConsole }
}

// --- Enregistrement ----------------------------------------------------------------------------
async function testerEnregistrer(monde) {
    const bob = k => ({ id: k, username: "tester" })

    // 1. Sans « Gérer le serveur » (ou plus membre) : rien n'est écrit
    {
        const { G, k } = creerServeur(monde, 1)
        const espion = espionnerEcritures()
        try {
            let res = await actions.enregistrer(G, bob(k(5)), { langue: "en", logs: k(21) })
            assert.ok(contient(res.erreurs, "Gérer le serveur"), "simple membre refusé")
            assert.deepStrictEqual(res.changements, [])
            res = await actions.enregistrer(G, bob(k(6)), { langue: "en" })
            assert.ok(contient(res.erreurs, "plus membre"), "absent du serveur")
            res = await actions.enregistrer(id(8885), bob(k(2)), { langue: "en" })
            assert.ok(contient(res.erreurs, "pas (ou plus) sur ce serveur"), "bot absent du serveur")
            assert.deepStrictEqual(espion.appels, [])
            assert.strictEqual(monde.messages.length, 0)
        } finally { espion.restaurer() }
        assert.strictEqual(db.getApparence(G).langue, "auto")
    }

    // 2. « Gérer le serveur » seul : langue, couleur acceptées ; tickets refusés sans empêcher le reste
    {
        const { G, k } = creerServeur(monde, 2)
        const res = await actions.enregistrer(G, bob(k(3)), {
            langue: "en", couleur: "#112233", ticketsCategorie: k(20), ticketsStaff: k(13), ticketsInactivite: "7", logs: ""
        })
        assert.strictEqual(res.erreurs.length, 3, "catégorie, rôle et inactivité refusés")
        assert.ok(res.erreurs.every(e => e.includes("Gérer les salons")))
        assert.strictEqual(res.changements.length, 2)
        assert.strictEqual(db.getApparence(G).langue, "en")
        assert.strictEqual(db.getApparence(G).couleur, 0x112233)
        assert.deepStrictEqual(db.getTicketConfig(G), { categoryId: null, staffRoleId: null })
        assert.strictEqual(db.getTicketInactivity(G), 0)
        // un champ invalide n'empêche pas les autres
        const res2 = await actions.enregistrer(G, bob(k(3)), { langue: "de", couleur: "rouge", panneauTitre: "x".repeat(257), ticketsInactivite: "" })
        assert.strictEqual(res2.erreurs.length, 3)
        assert.strictEqual(db.getApparence(G).langue, "en", "langue invalide : inchangée")
        // les champs absents du formulaire (champs désactivés) ne touchent à rien
        const res3 = await actions.enregistrer(G, bob(k(3)), {})
        assert.deepStrictEqual(res3, { erreurs: [], changements: [] })
    }

    // 3. Tickets : rôle staff, catégorie, inactivité, réinitialisation d'un seul champ
    {
        const { G, k } = creerServeur(monde, 3)
        // admin (rôle Admin, position 6) : n'a pas de passe-droit sur la hiérarchie
        let res = await actions.enregistrer(G, bob(k(2)), { ticketsStaff: k(14) })
        assert.ok(contient(res.erreurs, "strictement inférieur"), "rôle supérieur refusé")
        res = await actions.enregistrer(G, bob(k(2)), { ticketsStaff: k(10) })
        assert.ok(contient(res.erreurs, "strictement inférieur"), "rôle égal refusé")
        res = await actions.enregistrer(G, bob(k(2)), { ticketsStaff: k(15) })
        assert.ok(contient(res.erreurs, "rôle invalide"), "rôle géré refusé")
        res = await actions.enregistrer(G, bob(k(2)), { ticketsStaff: G })
        assert.ok(contient(res.erreurs, "rôle invalide"), "@everyone refusé")
        res = await actions.enregistrer(G, bob(k(2)), { ticketsStaff: id(8884) })
        assert.ok(contient(res.erreurs, "rôle invalide"), "rôle inconnu refusé")
        assert.strictEqual(db.getTicketConfig(G).staffRoleId, null)

        res = await actions.enregistrer(G, bob(k(2)), { ticketsStaff: k(13), ticketsCategorie: k(20), ticketsInactivite: "14" })
        assert.deepStrictEqual(res.erreurs, [])
        assert.deepStrictEqual(db.getTicketConfig(G), { categoryId: k(20), staffRoleId: k(13) })
        assert.strictEqual(db.getTicketInactivity(G), 14)

        // vider la catégorie garde le rôle staff
        res = await actions.enregistrer(G, bob(k(2)), { ticketsCategorie: "", ticketsStaff: k(13) })
        assert.deepStrictEqual(res.erreurs, [])
        assert.deepStrictEqual(db.getTicketConfig(G), { categoryId: null, staffRoleId: k(13) })

        // catégorie : introuvable, salon non catégorie, bot sans accès
        res = await actions.enregistrer(G, bob(k(2)), { ticketsCategorie: k(21) })
        assert.ok(contient(res.erreurs, "introuvable"), "un salon n'est pas une catégorie")
        res = await actions.enregistrer(G, bob(k(2)), { ticketsCategorie: k(27) })
        assert.ok(contient(res.erreurs, "le bot doit pouvoir"), "catégorie invisible du bot")

        // le propriétaire peut choisir le rôle le plus haut
        res = await actions.enregistrer(G, bob(k(1)), { ticketsStaff: k(14) })
        assert.deepStrictEqual(res.erreurs, [])
        assert.strictEqual(db.getTicketConfig(G).staffRoleId, k(14))
        // le chef des tickets (3 permissions, position 5) ne peut pas choisir un rôle de position 5 ou plus
        res = await actions.enregistrer(G, bob(k(4)), { ticketsStaff: k(12) })
        assert.ok(contient(res.erreurs, "strictement inférieur"))
        res = await actions.enregistrer(G, bob(k(4)), { ticketsStaff: k(13) })
        assert.deepStrictEqual(res.erreurs, [])
        assert.strictEqual(db.getTicketConfig(G).staffRoleId, k(13))

        // inactivité hors liste
        for (const valeur of ["5", "31", "-1", "abc", "7.5"]) {
            res = await actions.enregistrer(G, bob(k(2)), { ticketsInactivite: valeur })
            assert.ok(contient(res.erreurs, "Inactivité"), `inactivité ${valeur} refusée`)
        }
        assert.strictEqual(db.getTicketInactivity(G), 14)
        res = await actions.enregistrer(G, bob(k(2)), { ticketsInactivite: "" })
        assert.deepStrictEqual(res.erreurs, [])
        assert.strictEqual(db.getTicketInactivity(G), 0, "vide = jamais")
    }

    // 4. Salon de logs : refus, puis journalisation dans l'ancien puis le nouveau
    {
        const { G, k } = creerServeur(monde, 4)
        const admin = bob(k(2))
        let res = await actions.enregistrer(G, admin, { logs: k(23) })
        assert.ok(contient(res.erreurs, "salon de ticket"), "salon de ticket refusé")
        res = await actions.enregistrer(G, admin, { logs: k(24) })
        assert.ok(contient(res.erreurs, "salon textuel"), "salon vocal refusé")
        res = await actions.enregistrer(G, admin, { logs: k(25) })
        assert.ok(contient(res.erreurs, "le bot doit pouvoir"), "salon invisible du bot refusé")
        res = await actions.enregistrer(G, admin, { logs: k(20) })
        assert.ok(contient(res.erreurs, "salon textuel"), "catégorie refusée")
        res = await actions.enregistrer(G, admin, { logs: id(8883) })
        assert.ok(contient(res.erreurs, "introuvable"))
        assert.strictEqual(db.getLogChannel(G), null)
        assert.strictEqual(monde.messages.filter(m => m.salon.startsWith(G.slice(0, 14)) && [k(23), k(24), k(25), k(20)].includes(m.salon)).length, 0)

        // premier réglage : un seul message, dans le nouveau salon
        monde.messages.length = 0
        res = await actions.enregistrer(G, admin, { logs: k(21) })
        assert.deepStrictEqual(res.erreurs, [])
        assert.strictEqual(res.changements.length, 1)
        assert.strictEqual(db.getLogChannel(G), k(21))
        assert.strictEqual(monde.messages.length, 1)
        assert.strictEqual(monde.messages[0].salon, k(21))
        assert.ok(monde.messages[0].embed.title.includes("(tableau de bord)"))
        assert.ok(monde.messages[0].embed.description.includes(`<#${k(21)}>`))
        assert.ok(monde.messages[0].embed.fields[0].value.includes(admin.id), "auteur indiqué")

        // changement : ancien salon (encore en base), puis nouveau (déjà en base)
        monde.messages.length = 0
        res = await actions.enregistrer(G, admin, { logs: k(22), langue: "fr" })
        assert.deepStrictEqual(res.erreurs, [])
        assert.deepStrictEqual(monde.messages.map(m => m.salon), [k(21), k(22)], "ancien puis nouveau")
        assert.strictEqual(monde.messages[1].logsEnBase, k(22), "les messages partent après le COMMIT")
        assert.ok(monde.messages[0].embed.description.includes(`<#${k(21)}> → <#${k(22)}>`))
        assert.ok(monde.messages[0].embed.description.includes("Langue"), "les autres changements sont dans le même message")

        // désactivation : l'ancien salon est prévenu, aucun nouveau message
        monde.messages.length = 0
        await actions.enregistrer(G, admin, { logs: "" })
        assert.strictEqual(db.getLogChannel(G), null)
        assert.deepStrictEqual(monde.messages.map(m => m.salon), [k(22)])
        assert.ok(monde.messages[0].embed.description.includes("logs désactivés"))
    }

    // 5. Rien ne change : aucune écriture, aucun message
    {
        const { G, k } = creerServeur(monde, 5)
        const admin = bob(k(2))
        const formulaire = {
            langue: "en", couleur: "#AABBCC", logs: k(21), ticketsCategorie: k(20), ticketsStaff: k(13), ticketsInactivite: "3",
            panneauTitre: "Titre", panneauTexte: "Texte", bienvenueSalon: k(26), bienvenueMessage: "Salut {membre}", aurevoirSalon: "", aurevoirMessage: ""
        }
        let res = await actions.enregistrer(G, admin, formulaire)
        assert.deepStrictEqual(res.erreurs, [])
        assert.ok(res.changements.length >= 8)

        // la page doit refléter exactement ce qui vient d'être écrit
        const config = await actions.lireConfig(G, k(2))
        assert.strictEqual(config.langue, "en")
        assert.strictEqual(config.couleur, "#AABBCC")
        assert.strictEqual(config.logs, k(21))
        assert.deepStrictEqual(config.tickets, { categorie: k(20), staff: k(13), inactivite: 3 })
        assert.deepStrictEqual(config.panneau, { titre: "Titre", texte: "Texte" })
        assert.deepStrictEqual(config.bienvenue, { salon: k(26), message: "Salut {membre}" })
        assert.strictEqual(config.aurevoir, null)
        assert.deepStrictEqual(config.categories.map(c => c.id), [k(20), k(27)])
        assert.ok(config.salonsTexte.some(s => s.id === k(21)) && !config.salonsTexte.some(s => s.id === k(24)), "salons textuels seulement")
        assert.ok(!config.roles.some(r => r.id === G || r.id === k(15)), "ni @everyone ni rôle géré")
        assert.strictEqual(config.roles.find(r => r.id === k(11)).couleur, "#112233")
        assert.strictEqual(config.roles.find(r => r.id === k(13)).couleur, null)
        assert.strictEqual(config.roles[0].id, k(14), "du plus haut au plus bas")
        assert.strictEqual(config.nbSeuils, 0)
        assert.strictEqual(config.nbTypes, 0)
        assert.strictEqual(config.premium, true, "premium désactivé : tout est permis")
        assert.strictEqual(config.premiumActif, false)

        monde.messages.length = 0
        const espion = espionnerEcritures()
        try {
            res = await actions.enregistrer(G, admin, formulaire)
            assert.deepStrictEqual(res, { erreurs: [], changements: [] })
            // espaces autour des valeurs : toujours aucun changement
            res = await actions.enregistrer(G, admin, { ...formulaire, panneauTitre: "  Titre  ", couleur: "aabbcc" })
            assert.deepStrictEqual(res, { erreurs: [], changements: [] })
            assert.deepStrictEqual(espion.appels, [], "aucune écriture")
            assert.strictEqual(monde.messages.length, 0, "aucun message")

            // un seul champ change : une seule écriture
            res = await actions.enregistrer(G, admin, { ...formulaire, ticketsInactivite: "7" })
            assert.deepStrictEqual(espion.appels, ["setTicketInactivity"])
            assert.strictEqual(res.changements.length, 1)
            assert.strictEqual(monde.messages.length, 1)
            assert.strictEqual(monde.messages[0].salon, k(21))
        } finally { espion.restaurer() }

        // panneau trop long : refusé, le reste passe
        res = await actions.enregistrer(G, admin, { panneauTexte: "x".repeat(2001), panneauTitre: "Nouveau" })
        assert.strictEqual(res.erreurs.length, 1)
        assert.deepStrictEqual(db.getApparence(G).panneauTitre, "Nouveau")
        assert.strictEqual(db.getApparence(G).panneauTexte, "Texte")
        // vider le panneau revient au texte par défaut
        await actions.enregistrer(G, admin, { panneauTitre: "", panneauTexte: "" })
        assert.strictEqual(db.getApparence(G).panneauTitre, null)
        assert.strictEqual(db.getApparence(G).panneauTexte, null)
    }

    // 6. Bienvenue et au revoir
    {
        const { G, k } = creerServeur(monde, 6)
        const admin = bob(k(2))
        let res = await actions.enregistrer(G, admin, { bienvenueSalon: k(26), bienvenueMessage: "", aurevoirSalon: k(24), aurevoirMessage: "x".repeat(1001) })
        assert.strictEqual(res.erreurs.length, 2, "vocal refusé, message trop long")
        assert.strictEqual(db.getWelcome(G).bienvenue.channelId, k(26))
        assert.ok(db.getWelcome(G).bienvenue.message.includes("{membre}"), "message vide : texte par défaut")
        assert.strictEqual(db.getWelcome(G).aurevoir, null)

        res = await actions.enregistrer(G, admin, { aurevoirSalon: k(25), aurevoirMessage: "Salut" })
        assert.ok(contient(res.erreurs, "le bot doit pouvoir"), "salon invisible du bot")
        res = await actions.enregistrer(G, admin, { aurevoirSalon: k(26), aurevoirMessage: "x".repeat(1001) })
        assert.strictEqual(res.erreurs.length, 1)
        assert.strictEqual(db.getWelcome(G).aurevoir.channelId, k(26), "le salon est enregistré malgré le message refusé")

        res = await actions.enregistrer(G, admin, { bienvenueSalon: "", bienvenueMessage: "" })
        assert.strictEqual(db.getWelcome(G).bienvenue, null, "désactivé")
        assert.strictEqual(res.changements.length, 1)

        // message saisi sans salon : erreur claire, rien d'écrit
        res = await actions.enregistrer(G, admin, { aurevoirSalon: "", aurevoirMessage: "Bye" })
        assert.ok(contient(res.erreurs, "Choisis un salon pour le message d'au revoir."))
        res = await actions.enregistrer(G, admin, { bienvenueMessage: "Hello" })
        assert.ok(contient(res.erreurs, "Choisis un salon pour le message de bienvenue."))
        assert.strictEqual(db.getWelcome(G).bienvenue, null)
    }

    // 7. Premium : couleur et texte du panneau réservés quand PREMIUM_SKU_ID est défini
    {
        process.env.PREMIUM_SKU_ID = SKU
        const sansPremium = creerServeur(monde, 7)
        const avecPremium = creerServeur(monde, 8)
        monde.entitlements.push({ sku_id: SKU, guild_id: avecPremium.G, deleted: false, consumed: false, starts_at: "2020-01-01T00:00:00.000000+00:00", ends_at: null })
        monde.entitlements.push({ sku_id: SKU, guild_id: sansPremium.G, deleted: true, consumed: false, starts_at: null, ends_at: null })

        const { G, k } = sansPremium
        const admin = bob(k(2))
        let res = await actions.enregistrer(G, admin, { couleur: "#ABCDEF", panneauTitre: "Mon titre", panneauTexte: "Mon texte", langue: "en" })
        assert.strictEqual(res.erreurs.length, 3, "couleur, titre, texte refusés")
        assert.ok(contient(res.erreurs, "premium"))
        assert.strictEqual(db.getApparence(G).couleur, null)
        assert.strictEqual(db.getApparence(G).panneauTitre, null)
        assert.strictEqual(db.getApparence(G).langue, "en", "la langue reste gratuite")
        const config = await actions.lireConfig(G, k(2))
        assert.strictEqual(config.premium, false)
        assert.strictEqual(config.premiumActif, true)

        // revenir au défaut reste possible sans premium
        db.setCouleur(G, 0x123456)
        res = await actions.enregistrer(G, admin, { couleur: "" })
        assert.deepStrictEqual(res.erreurs, [])
        assert.strictEqual(db.getApparence(G).couleur, null)

        const p = avecPremium
        res = await actions.enregistrer(p.G, bob(p.k(2)), { couleur: "#ABCDEF", panneauTitre: "Mon titre", panneauTexte: "Mon texte" })
        assert.deepStrictEqual(res.erreurs, [])
        assert.strictEqual(db.getApparence(p.G).couleur, 0xABCDEF)
        assert.strictEqual(db.getApparence(p.G).panneauTexte, "Mon texte")
        assert.strictEqual((await actions.lireConfig(p.G, p.k(2))).premium, true)
        const appelEntitlement = monde.appels.find(a => a.chemin === `/applications/${APP}/entitlements`)
        assert.strictEqual(appelEntitlement.requete.get("sku_ids"), SKU)
        delete process.env.PREMIUM_SKU_ID
    }
}

// --- Salons visibles et transaction ------------------------------------------------------------
async function testerVisibiliteTransaction(monde) {
    const bob = k => ({ id: k, username: "tester" })

    // Le « Modo » (Gérer le serveur) ne voit pas #secret (k25) ni cat-secrete (k27) ; l'admin voit tout
    {
        const { G, k } = creerServeur(monde, 9)
        const config = await actions.lireConfig(G, k(3))
        assert.ok(!config.salonsTexte.some(s => s.id === k(25)), "salon invisible non proposé")
        assert.ok(!config.categories.some(c => c.id === k(27)), "catégorie invisible non proposée")
        assert.ok(config.salonsTexte.some(s => s.id === k(21)))
        const admin = await actions.lireConfig(G, k(2))
        assert.ok(admin.salonsTexte.some(s => s.id === k(25)) && admin.categories.some(c => c.id === k(27)))

        // refus à l'écriture
        for (const [champ, valeur, texte] of [["logs", k(25), "vous ne voyez pas"], ["bienvenueSalon", k(25), "vous ne voyez pas"], ["aurevoirSalon", k(25), "vous ne voyez pas"], ["ticketsCategorie", k(27), "vous ne voyez pas"]]) {
            const res = await actions.enregistrer(G, bob(champ === "ticketsCategorie" ? k(4) : k(3)), { [champ]: valeur })
            assert.ok(contient(res.erreurs, texte), `${champ} invisible refusé`)
        }
        assert.strictEqual(db.getLogChannel(G), null)
        assert.strictEqual(db.getWelcome(G).bienvenue, null)

        // salon déjà configuré mais invisible : listé sans nom
        db.setLogChannel(G, k(25))
        const apres = await actions.lireConfig(G, k(3))
        assert.deepStrictEqual(apres.salonsTexte.find(s => s.id === k(25)), { id: k(25), name: null })
    }

    // Transaction : si une écriture échoue au milieu, rien n'est gardé
    {
        const { G, k } = creerServeur(monde, 10)
        const original = db.setCouleur
        db.setCouleur = () => { throw new Error("panne simulée") }
        const erreurConsole = console.error
        console.error = () => {}
        try {
            await assert.rejects(actions.enregistrer(G, bob(k(2)), { langue: "en", couleur: "#112233", logs: k(21) }), /panne simulée/)
        } finally { db.setCouleur = original; console.error = erreurConsole }
        assert.strictEqual(db.getApparence(G).langue, "auto", "langue annulée")
        assert.strictEqual(db.getLogChannel(G), null)
        assert.strictEqual(monde.messages.filter(m => m.salon === k(21)).length, 0, "aucun journal envoyé")
    }
}

async function tester() {
    const ancienFetch = global.fetch
    const ancien = {}
    for (const nom of ["DISCORD_TOKEN", "DISCORD_CLIENT_SECRET", "DASHBOARD_URL", "PREMIUM_SKU_ID"]) ancien[nom] = process.env[nom]
    process.env.DISCORD_TOKEN = "jeton-bot-de-test"
    process.env.DISCORD_CLIENT_SECRET = "secret-de-test"
    process.env.DASHBOARD_URL = "https://tableau.exemple.fr/"
    delete process.env.PREMIUM_SKU_ID

    const monde = creerMonde()
    global.fetch = simulerFetch(monde)
    try {
        testerPermissions()
        console.log("OK : permissions effectives")
        await testerClient(monde)
        console.log("OK : client REST Discord")
        await testerEnregistrer(monde)
        console.log("OK : lecture et enregistrement de la configuration")
        await testerVisibiliteTransaction(monde)
        console.log("OK : salons visibles et transaction")
    } finally {
        global.fetch = ancienFetch
        for (const [nom, valeur] of Object.entries(ancien)) {
            if (valeur === undefined) delete process.env[nom]
            else process.env[nom] = valeur
        }
    }
}

module.exports = { tester }
