process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const eco = require('../Fonctions/economie')
const boutique = require('../Fonctions/boutique')
const inventaire = require('../Fonctions/inventaire')
const catalogue = require('../data-statique/objets.json')
const { ecouter, retirerEcouteurs } = require('../Fonctions/evenements')
const { chargerCommandes, erreurDiscord } = require('./aides')

const { Flags } = Discord.PermissionsBitField
const JOUR = 24 * 3600 * 1000
const HEURE = 3600 * 1000

// Faux rôle : position, couleur et permissions au choix
function faussRole(guild, id, { position = 3, perms = 0n, color = 0x3498db, managed = false } = {}) {
    const role = {
        id, guild, name: `role-${id}`, managed, color, position, permissions: new Discord.PermissionsBitField(perms),
        comparePositionTo: autre => role.position - autre.position
    }
    guild.roles.cache.set(id, role)
    return role
}

// Faux membre : peut donner des rôles (échec forcé avec echecAjout)
function fauxMembre(guild, id, { perms = 0n, position = 1, jours = 30 } = {}) {
    const roles = new Discord.Collection()
    const membre = {
        id, guild, joinedTimestamp: Date.now() - jours * JOUR, communicationDisabledUntilTimestamp: null, user: { id, bot: false },
        permissions: new Discord.PermissionsBitField(perms), echecAjout: false,
        roles: {
            cache: roles, highest: { position, comparePositionTo: autre => position - autre.position },
            async add(role) {
                if (membre.echecAjout) throw new Error("Missing Permissions")
                roles.set(role.id ?? role, role)
            },
            async remove(id) { roles.delete(id) }
        }
    }
    guild.membres.set(id, membre)
    return membre
}

// Faux serveur : bot (Gérer les rôles, rôle en position 10), administrateur (position 5, Gérer les rôles)
function fauxServeur(id) {
    const guild = { id, ownerId: "1", available: true, roles: { cache: new Discord.Collection() }, channels: { cache: new Discord.Collection() }, membres: new Map() }
    guild.members = {
        async fetch({ user }) {
            const m = guild.membres.get(user)
            if (!m) throw erreurDiscord(Discord.RESTJSONErrorCodes.UnknownMember)
            return m
        }
    }
    guild.members.me = fauxMembre(guild, "bot", { perms: Flags.ManageRoles, position: 10 })
    const admin = fauxMembre(guild, "admin", { perms: Flags.ManageRoles | Flags.ManageGuild, position: 5 })
    return { guild, admin }
}

const donner = (m, montant) => eco.crediter(m, montant, { source: "test", sansReduction: true })
const solde = m => eco.compte(m.guild.id, m.id).balance
const ligneArticle = (guildId, id) => db.sqlAll("SELECT * FROM shop_items WHERE guild_id = ? AND id = ?", [guildId, id])[0]

test("catalogue des objets : cohérent et complet", () => {
    const ids = new Set()
    for (const o of catalogue.objets) {
        assert.ok(!ids.has(o.id), `id en double : ${o.id}`)
        ids.add(o.id)
        assert.ok(["consommable", "cosmetique"].includes(o.type), `type de ${o.id}`)
        for (const champ of ["nom", "description"]) assert.ok(o[champ].fr && o[champ].en, `${champ} fr/en de ${o.id}`)
        assert.ok(o.effet?.type, `effet de ${o.id}`)
    }
    assert.ok(ids.has("boost_xp") && ids.has("ticket_tirage"))
    assert.strictEqual(inventaire.objet("boost_xp").prix, 500)
    assert.strictEqual(inventaire.objet("boost_xp").effet.duree_s, 3600)
    assert.strictEqual(inventaire.objet("boost_xp").effet.multiplicateur, 1.25)
    assert.strictEqual(inventaire.nomObjet("boost_xp", "en"), "XP boost")
    assert.strictEqual(inventaire.nomObjet("inconnu", "fr"), "inconnu")
})

test("ajout : rôle dangereux, surcharge de salon, admin ou bot sous le rôle", () => {
    const { guild, admin } = fauxServeur("910000000000000001")
    for (const [nom, perms] of [["modération", Flags.ManageMessages], ["administrateur", Flags.Administrator], ["bannir", Flags.BanMembers],
        ["gérer les rôles", Flags.ManageRoles], ["@everyone", Flags.MentionEveryone], ["déplacer", Flags.MoveMembers]]) {
        const role = faussRole(guild, `r-${nom}`, { perms })
        assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role", role, prix: 100 }).refus, "dangereux", nom)
    }
    assert.strictEqual(boutique.articles(guild.id).length, 0, "rien n'a été ajouté")

    const surcharge = faussRole(guild, "r-surcharge")
    guild.channels.cache.set("c1", { permissionOverwrites: { cache: new Discord.Collection([[surcharge.id, { allow: new Discord.PermissionsBitField(Flags.ManageMessages) }]]) } })
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role", role: surcharge, prix: 100 }).refus, "dangereux_salon")
    guild.channels.cache.set("c2", { permissionOverwrites: { cache: new Discord.Collection([["r-autre", { allow: new Discord.PermissionsBitField(Flags.ViewChannel) }]]) } })

    // L'admin doit pouvoir donner le rôle lui-même, et le bot aussi
    const auDessusAdmin = faussRole(guild, "r-haut", { position: 7 })
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role", role: auDessusAdmin, prix: 100 }).refus, "admin_sous_role")
    const egalAdmin = faussRole(guild, "r-egal", { position: 5 })
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role", role: egalAdmin, prix: 100 }).refus, "admin_sous_role")
    const auDessusBot = faussRole(guild, "r-tres-haut", { position: 10 })
    const proprio = fauxMembre(guild, "1", { position: 99 })
    assert.strictEqual(boutique.ajouterArticle(guild, proprio, { type: "role", role: auDessusBot, prix: 100 }).refus, "bot_sous_role", "même le propriétaire : le bot doit pouvoir donner le rôle")
    const sansDroit = fauxMembre(guild, "simple", { position: 9 })
    assert.strictEqual(boutique.ajouterArticle(guild, sansDroit, { type: "role", role: faussRole(guild, "r-bas", { position: 1 }), prix: 100 }).refus, "admin_sous_role", "sans « Gérer les rôles »")
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role", role: faussRole(guild, "r-geree", { managed: true }), prix: 100 }).refus, "gere")
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role", role: { ...faussRole(guild, guild.id), id: guild.id }, prix: 100 }).refus, "everyone")

    // Couleur : aucune permission du tout, et une vraie couleur
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "couleur", role: faussRole(guild, "r-c1", { perms: Flags.SendMessages }), prix: 100 }).refus, "couleur_permissions")
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "couleur", role: faussRole(guild, "r-c2", { color: 0 }), prix: 100 }).refus, "couleur_sans_couleur")
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "couleur", role: faussRole(guild, "r-c3"), prix: 100 }).ok, true)
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role", role: faussRole(guild, "r-ok", { perms: Flags.SendMessages | Flags.AttachFiles }), prix: 100 }).ok, true)
})

test("ajout : prix, stock, durée, doublon, limite de 25, objets du catalogue", () => {
    const { guild, admin } = fauxServeur("910000000000000002")
    const role = faussRole(guild, "r1")
    for (const prix of [0, -1, 1000001, 1.5, NaN, "100", null]) {
        assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role", role, prix }).refus, "prix", String(prix))
    }
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role", role, prix: 100, stock: 0 }).refus, "stock")
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role", role, prix: 100, stock: 2.5 }).refus, "stock")
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role", role, prix: 100, nom: "   " }).refus, "nom")
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role", role, prix: 100, nom: "x".repeat(51) }).refus, "nom")
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "inconnu", role, prix: 100 }).refus, "type")
    for (const dureeS of [null, 3599, 90 * 24 * 3600 + 1, 1.5]) {
        assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role_temp", role, prix: 100, dureeS }).refus, "duree", String(dureeS))
    }

    const premier = boutique.ajouterArticle(guild, admin, { type: "role", role, prix: 5350, stock: 3 })
    assert.strictEqual(premier.ok, true)
    assert.strictEqual(premier.jours, 5, "5 350 ✦ = 5 jours de jeu actif (1 070 par jour)")
    assert.strictEqual(premier.article.nom, "role-r1", "nom du rôle par défaut")
    assert.strictEqual(boutique.joursDeJeu(2000), 1.9)
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role", role, prix: 100 }).refus, "doublon")
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role_temp", role: faussRole(guild, "r2"), prix: 2000, dureeS: 7 * 24 * 3600 }).article.dureeS, 7 * 24 * 3600)

    // Objets : le boost est vendu au prix indicatif du catalogue, le ticket de tirage (phase 4) pas encore
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "objet", objet: "inconnu" }).refus, "objet_inconnu")
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "objet", objet: "ticket_tirage" }).refus, "objet_non_vendable")
    const boost = boutique.ajouterArticle(guild, admin, { type: "objet", objet: "boost_xp" })
    assert.strictEqual(boost.article.prix, 500)
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "objet", objet: "boost_xp" }).refus, "doublon")

    for (let i = 4; i <= boutique.ARTICLES_MAX; i++) assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role", role: faussRole(guild, `plus-${i}`), prix: 10 }).ok, true)
    assert.strictEqual(boutique.articles(guild.id).length, 25)
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role", role: faussRole(guild, "de-trop"), prix: 10 }).refus, "plein")
    // Retirer un article libère une place, et il n'est plus achetable
    assert.strictEqual(boutique.retirerArticle(guild.id, premier.article.id), true)
    assert.strictEqual(boutique.retirerArticle(guild.id, premier.article.id), false)
    assert.strictEqual(boutique.lireArticle(guild.id, premier.article.id), null)
    assert.strictEqual(boutique.ajouterArticle(guild, admin, { type: "role", role: faussRole(guild, "de-trop"), prix: 10 }).ok, true)

    // Modifier
    const id = boost.article.id
    assert.strictEqual(boutique.modifierArticle(guild.id, id, { prix: 900, stock: 4, nom: " Super boost " }).article.nom, "Super boost")
    assert.strictEqual(boutique.lireArticle(guild.id, id).stock, 4)
    assert.strictEqual(boutique.modifierArticle(guild.id, id, { stock: null }).article.stock, null, "null : illimité")
    assert.strictEqual(boutique.modifierArticle(guild.id, id, { stock: 0 }).article.stock, 0, "0 : épuisé")
    assert.strictEqual(boutique.modifierArticle(guild.id, id, { prix: 0 }).refus, "prix")
    assert.strictEqual(boutique.modifierArticle(guild.id, id, {}).refus, "rien")
    assert.strictEqual(boutique.modifierArticle(guild.id, 99999, { prix: 5 }).refus, "inconnu")
    assert.strictEqual(boutique.modifierArticle("autre-serveur", id, { prix: 5 }).refus, "inconnu", "un autre serveur ne touche pas à l'article")
})

test("achat : rôle, solde, déjà possédé, événement, cohérence du journal", async () => {
    const { guild, admin } = fauxServeur("910000000000000003")
    const role = faussRole(guild, "vip")
    const a = boutique.ajouterArticle(guild, admin, { type: "role", role, prix: 700, stock: 5 }).article
    const joueur = fauxMembre(guild, "j1")
    const evenements = []
    ecouter("achat", e => evenements.push(e))

    assert.strictEqual((await boutique.acheter(joueur, 999)).refus, "inconnu")
    assert.strictEqual((await boutique.acheter(joueur, a.id)).refus, "solde")
    assert.strictEqual(ligneArticle(guild.id, a.id).stock, 5, "stock rendu quand le débit est refusé")

    donner(joueur, 1500)
    const r = await boutique.acheter(joueur, a.id)
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.solde, 800)
    assert.ok(joueur.roles.cache.has("vip"))
    assert.strictEqual(ligneArticle(guild.id, a.id).stock, 4)
    assert.deepStrictEqual(evenements, [{ guildId: guild.id, userId: "j1", itemId: a.id, type: "role", price: 700 }])

    assert.strictEqual((await boutique.acheter(joueur, a.id)).refus, "deja_possede")
    assert.strictEqual(solde(joueur), 800, "rien n'est débité pour un rôle déjà possédé")
    assert.strictEqual(ligneArticle(guild.id, a.id).stock, 4)
    assert.ok(eco.verifierCoherence(guild.id, "j1"))

    // Compte gelé ou sanctionné : refusé avant tout
    const gele = fauxMembre(guild, "gele")
    donner(gele, 1000)
    eco.geler(guild.id, "gele", true)
    assert.strictEqual((await boutique.acheter(gele, a.id)).refus, "gele")
    const exclu = fauxMembre(guild, "exclu")
    donner(exclu, 1000)
    exclu.communicationDisabledUntilTimestamp = Date.now() + HEURE
    assert.strictEqual((await boutique.acheter(exclu, a.id)).refus, "sanctionne")
    assert.strictEqual(ligneArticle(guild.id, a.id).stock, 4)

    // Un prix modifié après la lecture n'est pas facturé à l'ancien tarif
    boutique.modifierArticle(guild.id, a.id, { prix: 900 })
    const autre = fauxMembre(guild, "j2")
    donner(autre, 1000)
    assert.strictEqual((await boutique.acheter(autre, a.id)).solde, 100, "débité au prix actuel")
    retirerEcouteurs()
})

test("achat : rôle devenu dangereux ou placé trop haut, revérifié à l'achat", async () => {
    const { guild, admin } = fauxServeur("910000000000000004")
    const role = faussRole(guild, "vip")
    const a = boutique.ajouterArticle(guild, admin, { type: "role", role, prix: 100, stock: 2 }).article
    const joueur = fauxMembre(guild, "j1")
    donner(joueur, 1000)

    role.permissions = new Discord.PermissionsBitField(Flags.ManageMessages)
    const r = await boutique.acheter(joueur, a.id)
    assert.deepStrictEqual([r.ok, r.refus], [false, "dangereux"])
    role.permissions = new Discord.PermissionsBitField(0n)

    guild.channels.cache.set("c1", { permissionOverwrites: { cache: new Discord.Collection([[role.id, { allow: new Discord.PermissionsBitField(Flags.KickMembers) }]]) } })
    assert.strictEqual((await boutique.acheter(joueur, a.id)).refus, "dangereux_salon")
    guild.channels.cache.clear()

    role.position = 10
    assert.strictEqual((await boutique.acheter(joueur, a.id)).refus, "bot_sous_role")
    role.position = 3
    guild.roles.cache.delete(role.id)
    assert.strictEqual((await boutique.acheter(joueur, a.id)).refus, "inexistant")
    guild.roles.cache.set(role.id, role)

    assert.strictEqual(solde(joueur), 1000, "aucun débit pour un rôle refusé")
    assert.strictEqual(ligneArticle(guild.id, a.id).stock, 2)
    assert.strictEqual(joueur.roles.cache.size, 0)
    assert.strictEqual((await boutique.acheter(joueur, a.id)).ok, true, "redevenu valide : l'achat passe")
})

test("stock concurrent : deux achats, un seul exemplaire, un seul succès", async () => {
    const { guild, admin } = fauxServeur("910000000000000005")
    const a = boutique.ajouterArticle(guild, admin, { type: "role", role: faussRole(guild, "rare"), prix: 400, stock: 1 }).article
    const m1 = fauxMembre(guild, "j1"), m2 = fauxMembre(guild, "j2")
    donner(m1, 1000)
    donner(m2, 1000)
    const [r1, r2] = await Promise.all([boutique.acheter(m1, a.id), boutique.acheter(m2, a.id)])
    assert.deepStrictEqual([r1.ok, r2.ok].sort(), [false, true])
    const perdant = r1.ok ? r2 : r1
    assert.strictEqual(perdant.refus, "rupture")
    assert.strictEqual(ligneArticle(guild.id, a.id).stock, 0)
    assert.strictEqual(solde(m1) + solde(m2), 1600, "un seul des deux a payé")
    assert.strictEqual(m1.roles.cache.size + m2.roles.cache.size, 1)
    assert.strictEqual((await boutique.acheter(fauxMembre(guild, "j3"), a.id)).refus, "rupture")

    // Double clic du même membre : un seul achat
    const b = boutique.ajouterArticle(guild, admin, { type: "role", role: faussRole(guild, "double"), prix: 100 }).article
    const joueur = fauxMembre(guild, "j4")
    donner(joueur, 1000)
    const doubles = await Promise.all([boutique.acheter(joueur, b.id), boutique.acheter(joueur, b.id)])
    assert.strictEqual(doubles.filter(r => r.ok).length, 1)
    assert.strictEqual(solde(joueur), 900)
})

test("remboursement si le rôle ne peut pas être donné", async () => {
    const { guild, admin } = fauxServeur("910000000000000006")
    const a = boutique.ajouterArticle(guild, admin, { type: "role", role: faussRole(guild, "vip"), prix: 300, stock: 2 }).article
    const temp = boutique.ajouterArticle(guild, admin, { type: "role_temp", role: faussRole(guild, "temp"), prix: 200, dureeS: 3600 }).article
    // Membre arrivé il y a 1 jour : le remboursement ne doit pas être divisé par 2 (réduction « nouveau »)
    const joueur = fauxMembre(guild, "j1", { jours: 1 })
    donner(joueur, 1000)
    joueur.echecAjout = true
    const erreurs = console.error
    console.error = () => {}
    try {
        const r = await boutique.acheter(joueur, a.id)
        assert.deepStrictEqual([r.ok, r.refus, r.rembourse], [false, "role_impossible", true])
        const rt = await boutique.acheter(joueur, temp.id)
        assert.deepStrictEqual([rt.ok, rt.refus, rt.rembourse], [false, "role_impossible", true])
    } finally {
        console.error = erreurs
    }
    assert.strictEqual(solde(joueur), 1000, "monnaie intégralement rendue")
    assert.strictEqual(ligneArticle(guild.id, a.id).stock, 2, "stock rendu")
    assert.strictEqual(db.sqlAll("SELECT * FROM shop_roles_temp WHERE guild_id = ?", [guild.id]).length, 0, "pas de ligne de rôle temporaire orpheline")
    assert.ok(eco.verifierCoherence(guild.id, "j1"))
    const journal = eco.journal(guild.id, "j1")
    assert.ok(journal.some(l => l.source === "remboursement" && l.delta === 300))
    // Hors plafond du jour : le remboursement ne consomme pas le plafond des gains actifs
    assert.strictEqual(db.sqlAll("SELECT COALESCE(SUM(active_earned), 0) AS s FROM eco_compteurs WHERE guild_id = ? AND user_id = ?", [guild.id, "j1"])[0].s, 0)

    joueur.echecAjout = false
    assert.strictEqual((await boutique.acheter(joueur, a.id)).ok, true, "l'article reste achetable ensuite")
})

test("rôle temporaire : retiré à l'échéance, pas avant", async () => {
    const { guild, admin } = fauxServeur("910000000000000007")
    const bot = { guilds: { cache: new Discord.Collection([[guild.id, guild]]) } }
    const a = boutique.ajouterArticle(guild, admin, { type: "role_temp", role: faussRole(guild, "temp"), prix: 200, dureeS: 7 * 24 * 3600 }).article
    const joueur = fauxMembre(guild, "j1")
    donner(joueur, 1000)
    const r = await boutique.acheter(joueur, a.id)
    assert.strictEqual(r.ok, true)
    assert.ok(joueur.roles.cache.has("temp"))
    assert.ok(Math.abs(r.expireA - (Date.now() + 7 * JOUR)) < 5000)
    assert.strictEqual(db.sqlAll("SELECT * FROM shop_roles_temp WHERE guild_id = ?", [guild.id])[0].expires_at, r.expireA)

    assert.strictEqual(await boutique.retirerExpires(bot, Date.now() + 6 * JOUR), 0, "pas encore échu")
    assert.ok(joueur.roles.cache.has("temp"))
    assert.strictEqual(await boutique.retirerExpires(bot, r.expireA + 1000), 1)
    assert.ok(!joueur.roles.cache.has("temp"), "rôle retiré")
    assert.strictEqual(db.sqlAll("SELECT * FROM shop_roles_temp WHERE guild_id = ?", [guild.id]).length, 0)

    // Membre parti : la ligne disparaît sans erreur. Serveur inconnu du bot : idem. Échec de retrait : la ligne reste.
    const parti = fauxMembre(guild, "j2")
    db.sqlRun("INSERT INTO shop_roles_temp (guild_id, user_id, role_id, expires_at) VALUES (?, ?, ?, ?)", [guild.id, "j2", "temp", 1])
    guild.membres.delete("j2")
    db.sqlRun("INSERT INTO shop_roles_temp (guild_id, user_id, role_id, expires_at) VALUES (?, ?, ?, ?)", ["serveur-inconnu", "j3", "temp", 1])
    const tenace = fauxMembre(guild, "j4")
    tenace.roles.cache.set("temp", {})
    tenace.roles.remove = async () => { throw new Error("Missing Permissions") }
    db.sqlRun("INSERT INTO shop_roles_temp (guild_id, user_id, role_id, expires_at) VALUES (?, ?, ?, ?)", [guild.id, "j4", "temp", 1])
    const erreurs = console.error
    console.error = () => {}
    try {
        assert.strictEqual(await boutique.retirerExpires(bot), 2)
    } finally {
        console.error = erreurs
    }
    assert.deepStrictEqual(db.sqlAll("SELECT user_id FROM shop_roles_temp").map(l => l.user_id), ["j4"], "seul le retrait en échec sera retenté")
    assert.ok(parti)
    // Rôle supprimé du serveur : la ligne disparaît
    tenace.roles.remove = async () => { throw erreurDiscord(Discord.RESTJSONErrorCodes.UnknownRole) }
    assert.strictEqual(await boutique.retirerExpires(bot), 1)
    assert.strictEqual(db.sqlAll("SELECT * FROM shop_roles_temp").length, 0)
})

test("objet acheté : dans l'inventaire, 99 au plus", async () => {
    const { guild, admin } = fauxServeur("910000000000000008")
    const a = boutique.ajouterArticle(guild, admin, { type: "objet", objet: "boost_xp", prix: 10 }).article
    const joueur = fauxMembre(guild, "j1")
    donner(joueur, 1000)
    assert.strictEqual((await boutique.acheter(joueur, a.id)).ok, true)
    assert.strictEqual((await boutique.acheter(joueur, a.id)).ok, true, "un objet s'achète plusieurs fois")
    assert.deepStrictEqual(inventaire.lister(guild.id, "j1"), [{ id: "boost_xp", quantite: 2 }])
    assert.strictEqual(solde(joueur), 980)
    assert.deepStrictEqual(inventaire.lister(guild.id, "autre"), [])

    assert.strictEqual(inventaire.ajouterObjet(guild.id, "j1", "boost_xp", 97).ok, true)
    assert.strictEqual(inventaire.quantite(guild.id, "j1", "boost_xp"), 99)
    assert.strictEqual(inventaire.ajouterObjet(guild.id, "j1", "boost_xp", 1).ok, false)
    assert.strictEqual(inventaire.quantite(guild.id, "j1", "boost_xp"), 99, "le plafond de 99 tient")
    assert.strictEqual((await boutique.acheter(joueur, a.id)).refus, "inventaire_plein")
    assert.strictEqual(solde(joueur), 980)
})

test("inventaire : quantités jamais négatives, objets inconnus refusés", () => {
    const G = "910000000000000009"
    assert.deepStrictEqual(inventaire.retirerObjet(G, "j1", "boost_xp"), { ok: false, quantite: 0 })
    inventaire.ajouterObjet(G, "j1", "boost_xp", 2)
    assert.deepStrictEqual(inventaire.retirerObjet(G, "j1", "boost_xp", 3), { ok: false, quantite: 2 }, "pas assez : rien n'est retiré")
    assert.deepStrictEqual(inventaire.retirerObjet(G, "j1", "boost_xp", 2), { ok: true, quantite: 0 })
    assert.strictEqual(db.sqlAll("SELECT * FROM inventaire WHERE guild_id = ?", [G]).length, 0, "ligne vide supprimée")
    for (const faux of [0, -1, 1.5, 100, NaN, "2"]) {
        assert.throws(() => inventaire.ajouterObjet(G, "j1", "boost_xp", faux), RangeError, String(faux))
        assert.throws(() => inventaire.retirerObjet(G, "j1", "boost_xp", faux), RangeError, String(faux))
    }
    assert.throws(() => inventaire.ajouterObjet(G, "j1", "inconnu"), RangeError)
    assert.strictEqual(db.sqlAll("SELECT COUNT(*) AS n FROM inventaire WHERE quantity < 0")[0].n, 0)
})

test("boost d'XP : actif puis expiré, non cumulable, objet consommé une seule fois", () => {
    const { guild } = fauxServeur("910000000000000010")
    const joueur = fauxMembre(guild, "j1")
    const t0 = Date.now()
    assert.strictEqual(inventaire.boostXp(guild.id, "j1", t0), 1, "pas de boost : ×1")
    assert.deepStrictEqual(inventaire.utiliser(joueur, "boost_xp", t0), { ok: false, refus: "absent" })

    inventaire.ajouterObjet(guild.id, "j1", "boost_xp", 2)
    const evenements = []
    ecouter("objet:utilise", e => evenements.push(e))
    const r = inventaire.utiliser(joueur, "boost_xp", t0)
    assert.deepStrictEqual(r, { ok: true, objet: "boost_xp", jusqua: t0 + HEURE })
    assert.deepStrictEqual(evenements, [{ guildId: guild.id, userId: "j1", itemId: "boost_xp" }])
    assert.strictEqual(inventaire.quantite(guild.id, "j1", "boost_xp"), 1)
    assert.strictEqual(inventaire.boostXp(guild.id, "j1", t0 + 1000), 1.25)
    assert.strictEqual(inventaire.boostXp(guild.id, "j1", t0 + HEURE - 1), 1.25)
    assert.strictEqual(inventaire.boostXp(guild.id, "j1", t0 + HEURE), 1, "expiré pile à l'heure")
    assert.strictEqual(inventaire.boostXp(guild.id, "j1", t0 + 2 * HEURE), 1)
    assert.strictEqual(inventaire.boostXp(guild.id, "autre", t0 + 1000), 1, "le boost est personnel")
    assert.strictEqual(inventaire.boostXp("autre-serveur", "j1", t0 + 1000), 1, "et propre au serveur")
    assert.strictEqual(inventaire.boostRestant(guild.id, "j1", t0 + 1000), HEURE - 1000)

    // Non cumulable : refusé sans consommer l'exemplaire restant
    assert.deepStrictEqual(inventaire.utiliser(joueur, "boost_xp", t0 + 1000), { ok: false, refus: "boost_actif" })
    assert.strictEqual(inventaire.quantite(guild.id, "j1", "boost_xp"), 1)
    assert.strictEqual(inventaire.boostXp(guild.id, "j1", t0 + HEURE - 1), 1.25, "la fin n'a pas été prolongée")

    // Après l'expiration, le second exemplaire s'utilise, puis plus rien
    assert.strictEqual(inventaire.utiliser(joueur, "boost_xp", t0 + 2 * HEURE).ok, true)
    assert.strictEqual(inventaire.quantite(guild.id, "j1", "boost_xp"), 0)
    assert.strictEqual(inventaire.utiliser(joueur, "boost_xp", t0 + 4 * HEURE).refus, "absent", "consommé une seule fois")
    assert.strictEqual(inventaire.boostXp(guild.id, "j1", t0 + 4 * HEURE), 1)
    assert.strictEqual(evenements.length, 2)
    assert.strictEqual(db.sqlAll("SELECT value FROM stats_joueur WHERE guild_id = ? AND user_id = ? AND stat = 'boost_xp_jusqua'", [guild.id, "j1"])[0].value, t0 + 3 * HEURE)

    // Objet réservé, inconnu, compte gelé : rien n'est consommé
    inventaire.ajouterObjet(guild.id, "j1", "ticket_tirage", 1)
    assert.strictEqual(inventaire.utiliser(joueur, "ticket_tirage", t0).refus, "inutilisable")
    assert.strictEqual(inventaire.quantite(guild.id, "j1", "ticket_tirage"), 1)
    assert.strictEqual(inventaire.utiliser(joueur, "inconnu", t0).refus, "inconnu")
    inventaire.ajouterObjet(guild.id, "j1", "boost_xp", 1)
    eco.geler(guild.id, "j1", true)
    assert.strictEqual(inventaire.utiliser(joueur, "boost_xp", t0 + 10 * HEURE).refus, "gele")
    assert.strictEqual(inventaire.quantite(guild.id, "j1", "boost_xp"), 1)
    retirerEcouteurs()
})

test("commandes /boutique et /inventaire : droits, vitrine, achat par la commande", async () => {
    const bot = chargerCommandes()
    const commande = bot.commands.get("boutique")
    assert.strictEqual(commande.module, "communaute")
    assert.strictEqual(commande.sousModule, "economie")
    assert.ok(bot.commands.get("inventaire"))

    const { guild, admin } = fauxServeur("910000000000000011")
    const role = faussRole(guild, "vip")
    const joueur = fauxMembre(guild, "j1")
    donner(joueur, 5000)

    // Interaction factice : options au choix
    function interaction(membre, options, perms = 0n) {
        const reponses = []
        return {
            reponses, guild, guildId: guild.id, user: { id: membre.id }, member: membre, locale: "fr", deferred: false, replied: false, ephemeral: false,
            memberPermissions: new Discord.PermissionsBitField(perms),
            options: {
                getString: n => options[n] ?? null, getInteger: n => options[n] ?? null, getRole: n => options[n] ?? null, getBoolean: n => options[n] ?? null
            },
            async reply(r) { this.replied = true; reponses.push(r) },
            async deferReply() { this.deferred = true },
            async editReply(r) { reponses.push(typeof r === "string" ? { content: r } : r) },
            async followUp(r) { reponses.push(r) }
        }
    }

    // Un joueur ne peut pas gérer la boutique, même si la commande est ouverte à tous
    const refus = interaction(joueur, { action: "ajouter", type: "role", role, prix: 100 })
    await commande.run(bot, refus, refus.options)
    assert.ok(refus.reponses[0].flags, "refus éphémère")
    assert.strictEqual(boutique.articles(guild.id).length, 0)

    const ajout = interaction(admin, { action: "ajouter", type: "role", role, prix: 2140, nom: "VIP" }, Flags.ManageGuild)
    await commande.run(bot, ajout, ajout.options)
    assert.match(ajout.reponses[0].content, /VIP/)
    assert.match(ajout.reponses[0].content, /2 jours/, "≈ 2 jours de jeu actif")
    assert.strictEqual(boutique.articles(guild.id).length, 1)

    const vue = interaction(joueur, { action: "voir" })
    await commande.run(bot, vue, vue.options)
    assert.strictEqual(vue.reponses[0].components.length, 1, "menu d'achat")
    assert.match(vue.reponses[0].embeds[0].data.description, /VIP/)

    const achat = interaction(joueur, { action: "acheter", article: "VIP" })
    await commande.run(bot, achat, achat.options)
    assert.match(achat.reponses[0].content, /Achat effectué/)
    assert.ok(joueur.roles.cache.has("vip"))
    assert.strictEqual(solde(joueur), 5000 - 2140)

    const inv = bot.commands.get("inventaire")
    const vide = interaction(joueur, { action: "voir" })
    await inv.run(bot, vide, vide.options)
    assert.match(vide.reponses[0].embeds[0].data.description, /vide/)
})
