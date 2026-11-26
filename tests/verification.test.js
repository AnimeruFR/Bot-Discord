process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const { controler } = require('../Fonctions/garde')
const { creerRouteur } = require('../Fonctions/routeur')
const { chargerCommandes } = require('./aides')
const verification = require('../Fonctions/verification')
const pseudos = require('../Fonctions/pseudos')
const evenementMiseAJour = require('../Events/guildMemberUpdate')
const { setSalonFamille } = require('../Fonctions/logs')

const { Flags } = Discord.PermissionsBitField
const bot = chargerCommandes()
const attendre = () => new Promise(resolve => setImmediate(resolve))

const PROPRIETAIRE = "100000000000000000"
const ID_ROLE = "900000000000000001"
const EMOJIS = { pomme: "🍎", chat: "🐱", voiture: "🚗", etoile: "⭐", cactus: "🌵", de: "🎲", cle: "🔑", lune: "🌙", pizza: "🍕", poisson: "🐟" }
const NOMS = Object.fromEntries(Object.entries(EMOJIS).map(([id, emoji]) => [require('../Fonctions/i18n').t("fr", `verif.emoji.${id}`), emoji]))

const mkRole = (id, position, perms = 0n) => ({ id, position, managed: false, permissions: new Discord.PermissionsBitField(perms), comparePositionTo: autre => position - autre.position })

// Faux serveur : un rôle « vérifié » (position 5) sous le rôle du bot (position 10)
function mkGuild(id, { botPerms = Flags.ManageRoles | Flags.ManageNicknames } = {}) {
    const verifie = mkRole(ID_ROLE, 5)
    const guild = {
        id, ownerId: PROPRIETAIRE, verifie, name: "Serveur test",
        roles: { cache: new Discord.Collection([[verifie.id, verifie]]), everyone: { id } },
        channels: { cache: new Discord.Collection() },
        members: { me: { id: "900000000000000099", permissions: new Discord.PermissionsBitField(botPerms), roles: { highest: mkRole("900000000000000009", 10) } } }
    }
    guild.members.me.guild = guild
    verifie.guild = guild
    guild.members.me.roles.highest.guild = guild
    return guild
}

// Faux membre : ses rôles se modifient vraiment (roles.add est compté)
// position : position de son rôle le plus haut (le bot est en 10) ; perms : ses permissions de serveur
function mkMembre(guild, id, { roles = [], displayName = "Bob", position = 1, perms = 0n, bot: estBot = false } = {}) {
    const cache = new Set(roles)
    const membre = {
        id, guild, user: { id, bot: estBot }, displayName, ajouts: 0, envoyes: [], surnoms: [],
        permissions: new Discord.PermissionsBitField(perms),
        roles: { cache, highest: mkRole(`9000000000000${id.slice(-5)}`, position), add: async roleId => { membre.ajouts++; cache.add(roleId) } },
        setNickname: async nom => { membre.surnoms.push(nom); membre.displayName = nom },
        send: async texte => { membre.envoyes.push(texte) },
        toString: () => `<@${id}>`
    }
    return membre
}

// Faux clic de bouton d'un membre sur le serveur
function clic(guild, membre, customId, { perms = [] } = {}) {
    const i = {
        reponses: [], mises: [], editions: [], differes: 0,
        customId, guild, guildId: guild.id, member: membre, user: membre.user, channelId: "333333333333333333", locale: "fr",
        reply: async r => { i.reponses.push(r) },
        update: async r => { i.mises.push(r) },
        deferUpdate: async () => { i.differes++ },
        editReply: async r => { i.editions.push(r) },
        isButton: () => true, isAnySelectMenu: () => false, isModalSubmit: () => false, inGuild: () => true,
        memberPermissions: new Discord.PermissionsBitField(perms)
    }
    return i
}

const idsBoutons = payload => payload.components[0].components.map(b => b.data.custom_id)
const texte = r => (typeof r === "string" ? r : r.content)
// Défi affiché : le nom de l'emoji demandé, et les boutons (customId + emoji)
function lireDefi(payload) {
    const nom = payload.content.match(/\*\*(.+)\*\*/)[1]
    const boutons = payload.components.flatMap(ligne => ligne.components).map(b => ({ id: b.data.custom_id, emoji: b.data.emoji.name }))
    return { demande: NOMS[nom], boutons, bon: boutons.find(b => b.emoji === NOMS[nom]), faux: boutons.filter(b => b.emoji !== NOMS[nom]) }
}

function configurerServeur(guild) {
    db.sqlRun("INSERT OR REPLACE INTO verification_config (guild_id, role_id, channel_id, message_id) VALUES (?, ?, ?, ?)", [guild.id, ID_ROLE, "300000000000000001", "400000000000000001"])
}

// Ouvre un défi pour ce membre et le renvoie lu
async function ouvrirDefi(guild, membre) {
    const ouverture = clic(guild, membre, "verif:ouvrir")
    await verification.onClicVerification(bot, ouverture)
    assert.strictEqual(ouverture.reponses.length, 1, "une réponse")
    return { ouverture, defi: lireDefi(ouverture.reponses[0]) }
}

// --- Commandes réservées au staff ---

test("/verification et /pseudos sont refusés à un non-staff, ouverts au staff (garde commune)", async () => {
    const G = "111111111111111101"
    const guild = mkGuild(G)
    const membre = mkMembre(guild, "700000000000000001")
    const verif = bot.commands.get("verification"), pseudo = bot.commands.get("pseudos")
    assert.ok(verif && pseudo, "les deux commandes sont chargées")

    for (const commande of [verif, pseudo]) {
        const refus = await controler(clic(guild, membre, commande.name), commande)
        assert.ok(typeof refus === "string" && refus.length, `/${commande.name} refusé sans droit`)
    }
    // /verification demande Gérer le serveur ET Gérer les rôles
    assert.ok(await controler(clic(guild, membre, "x", { perms: Flags.ManageGuild }), verif), "Gérer le serveur seul ne suffit pas")
    assert.ok(await controler(clic(guild, membre, "x", { perms: Flags.ManageRoles }), verif), "Gérer les rôles seul ne suffit pas")
    assert.strictEqual(await controler(clic(guild, membre, "x", { perms: Flags.ManageGuild | Flags.ManageRoles }), verif), null)
    assert.ok(await controler(clic(guild, membre, "x", { perms: Flags.ManageGuild }), pseudo), "Gérer le serveur ne donne pas /pseudos")
    assert.strictEqual(await controler(clic(guild, membre, "x", { perms: Flags.ManageNicknames }), pseudo), null)
})

test("les boutons de la vérification sont publics : un nouveau membre sans droit y accède", async () => {
    const G = "111111111111111102"
    const guild = mkGuild(G)
    const routeur = creerRouteur()
    routeur.enregistrerCommande(bot.commands.get("verification"))
    const i = clic(guild, mkMembre(guild, "700000000000000002"), "verif:ouvrir")
    assert.strictEqual(await routeur.router(bot, i), true)
    assert.strictEqual(i.reponses.length, 1)
    assert.ok(texte(i.reponses[0]).includes("pas activée"), "traité par le gestionnaire (vérification non configurée), pas refusé par la garde staff")
})

// --- Défi ---

test("un bon choix donne le rôle, un mauvais choix compte une erreur et renouvelle le défi", async () => {
    const G = "111111111111111103"
    const guild = mkGuild(G)
    configurerServeur(guild)
    const membre = mkMembre(guild, "700000000000000003")
    const { defi } = await ouvrirDefi(guild, membre)
    assert.strictEqual(defi.boutons.length, 8)
    assert.strictEqual(new Set(defi.boutons.map(b => b.emoji)).size, 8, "8 emojis différents")
    assert.ok(defi.bon, "l'emoji demandé est bien parmi les boutons")

    const faux = clic(guild, membre, defi.faux[0].id)
    await verification.onClicVerification(bot, faux)
    assert.strictEqual(membre.ajouts, 0)
    assert.ok(faux.mises[0].content.includes("1/3"))
    const nouveau = lireDefi(faux.mises[0])
    assert.notStrictEqual(nouveau.boutons[0].id.split(":")[3], defi.boutons[0].id.split(":")[3], "nouveau jeton")

    // L'ancien défi n'est plus valable, le nouveau l'est
    const ancien = clic(guild, membre, defi.bon.id)
    await verification.onClicVerification(bot, ancien)
    assert.strictEqual(membre.ajouts, 0, "ancien jeton refusé")
    assert.ok(texte(ancien.reponses[0]).includes("plus valable"))

    const bon = clic(guild, membre, nouveau.bon.id)
    await verification.onClicVerification(bot, bon)
    assert.strictEqual(membre.ajouts, 1)
    assert.ok(membre.roles.cache.has(ID_ROLE))
    assert.ok(bon.editions[0].content.includes("Vérification réussie"))
})

const mettreEnQuarantaine = (guild, membre) => db.sqlRun("INSERT OR REPLACE INTO quarantines (guild_id, user_id, roles, moderator_id, reason, created_at) VALUES (?, ?, '[]', ?, ?, ?)",
    [guild.id, membre.id, "800000000000000001", "test", Date.now()])

test("un membre en quarantaine ne peut pas se vérifier (ouverture et réponse)", async () => {
    const guild = mkGuild("111111111111111110")
    configurerServeur(guild)
    const membre = mkMembre(guild, "700000000000000010")
    mettreEnQuarantaine(guild, membre)
    const ouverture = clic(guild, membre, "verif:ouvrir")
    await verification.onClicVerification(bot, ouverture)
    assert.ok(texte(ouverture.reponses[0]).includes("quarantaine"), "ouverture refusée")
    assert.ok(!ouverture.reponses[0].components, "aucun défi")

    // Défi ouvert avant la quarantaine : la bonne réponse est refusée aussi
    const autre = mkMembre(guild, "700000000000000011")
    const { defi } = await ouvrirDefi(guild, autre)
    mettreEnQuarantaine(guild, autre)
    const reponse = clic(guild, autre, defi.bon.id)
    await verification.onClicVerification(bot, reponse)
    assert.strictEqual(autre.ajouts, 0, "aucun rôle donné")
    assert.ok(texte(reponse.reponses[0]).includes("quarantaine"))
    // Quarantaine levée : le même défi fonctionne (il n'a pas été détruit)
    db.sqlRun("DELETE FROM quarantines WHERE guild_id = ? AND user_id = ?", [guild.id, autre.id])
    await verification.onClicVerification(bot, clic(guild, autre, defi.bon.id))
    assert.strictEqual(autre.ajouts, 1)
})

test("échec de roles.add : le membre reçoit une réponse et le défi est conservé", async () => {
    const guild = mkGuild("111111111111111111")
    configurerServeur(guild)
    const membre = mkMembre(guild, "700000000000000012")
    const { defi } = await ouvrirDefi(guild, membre)
    const ajouter = membre.roles.add
    membre.roles.add = async () => { throw new Error("Missing Permissions") }
    const log = console.error
    console.error = () => {}
    const echec = clic(guild, membre, defi.bon.id)
    await verification.onClicVerification(bot, echec)
    console.error = log
    assert.strictEqual(echec.editions.length, 1, "le membre reçoit une réponse")
    assert.ok(texte(echec.editions[0]).includes("indisponible"))
    assert.strictEqual(echec.editions[0].components, undefined, "les boutons du défi restent")
    // Discord est rétabli : le même défi peut être retenté
    membre.roles.add = ajouter
    const retente = clic(guild, membre, defi.bon.id)
    await verification.onClicVerification(bot, retente)
    assert.strictEqual(membre.ajouts, 1)
    assert.ok(retente.editions[0].content.includes("Vérification réussie"))
})

test("3 erreurs bloquent le défi 10 minutes", async () => {
    const G = "111111111111111104"
    const guild = mkGuild(G)
    configurerServeur(guild)
    const membre = mkMembre(guild, "700000000000000004")
    let { defi } = await ouvrirDefi(guild, membre)
    let derniere
    for (let essai = 1; essai <= 3; essai++) {
        derniere = clic(guild, membre, defi.faux[0].id)
        await verification.onClicVerification(bot, derniere)
        if (essai < 3) defi = lireDefi(derniere.mises[0])
    }
    assert.ok(derniere.mises[0].content.includes("Trop d'erreurs"))
    assert.deepStrictEqual(derniere.mises[0].components, [], "plus de boutons")

    // Réouvrir ne contourne pas le blocage, ni répondre avec un ancien bouton
    const reouverture = clic(guild, membre, "verif:ouvrir")
    await verification.onClicVerification(bot, reouverture)
    assert.ok(texte(reouverture.reponses[0]).includes("Trop d'erreurs"))
    assert.ok(!reouverture.reponses[0].components, "aucun nouveau défi")
    const ancien = clic(guild, membre, defi.bon.id)
    await verification.onClicVerification(bot, ancien)
    assert.strictEqual(membre.ajouts, 0)
    assert.strictEqual(membre.roles.cache.has(ID_ROLE), false)
})

test("un autre membre ne peut pas répondre à la place du membre", async () => {
    const G = "111111111111111105"
    const guild = mkGuild(G)
    configurerServeur(guild)
    const victime = mkMembre(guild, "700000000000000005")
    const intrus = mkMembre(guild, "700000000000000006")
    const { defi } = await ouvrirDefi(guild, victime)

    const usurpation = clic(guild, intrus, defi.bon.id)
    await verification.onClicVerification(bot, usurpation)
    assert.ok(texte(usurpation.reponses[0]).includes("autre membre"))
    assert.strictEqual(intrus.ajouts + victime.ajouts, 0, "personne ne reçoit le rôle")

    // Même avec son propre identifiant dans le bouton, l'intrus n'a pas de défi à son nom
    const forge = clic(guild, intrus, `verif:r:${intrus.id}:${defi.bon.id.split(":")[3]}:${defi.bon.id.split(":")[4]}`)
    await verification.onClicVerification(bot, forge)
    assert.strictEqual(intrus.ajouts, 0)
})

test("double clic ou deux défis ouverts : un seul rôle donné, sans erreur", async () => {
    const G = "111111111111111106"
    const guild = mkGuild(G)
    configurerServeur(guild)
    const membre = mkMembre(guild, "700000000000000007")
    const premier = (await ouvrirDefi(guild, membre)).defi
    // Deuxième défi ouvert : il remplace le premier
    const second = (await ouvrirDefi(guild, membre)).defi
    const perime = clic(guild, membre, premier.bon.id)
    await verification.onClicVerification(bot, perime)
    assert.strictEqual(membre.ajouts, 0, "le premier défi n'est plus valable")

    const a = clic(guild, membre, second.bon.id), b = clic(guild, membre, second.bon.id)
    await Promise.all([verification.onClicVerification(bot, a), verification.onClicVerification(bot, b)])
    assert.strictEqual(membre.ajouts, 1, "un seul rôle donné")
    // Un clic de plus après coup : message clair, toujours un seul ajout
    const apres = clic(guild, membre, second.bon.id)
    await verification.onClicVerification(bot, apres)
    assert.strictEqual(membre.ajouts, 1)
    assert.ok(texte(apres.reponses[0]).includes("déjà vérifié"))
})

test("un membre déjà vérifié reçoit un message clair, sans défi", async () => {
    const G = "111111111111111107"
    const guild = mkGuild(G)
    configurerServeur(guild)
    const membre = mkMembre(guild, "700000000000000008", { roles: [ID_ROLE] })
    const ouverture = clic(guild, membre, "verif:ouvrir")
    await verification.onClicVerification(bot, ouverture)
    assert.ok(texte(ouverture.reponses[0]).includes("déjà vérifié"))
    assert.ok(!ouverture.reponses[0].components)
})

// --- Rôle « vérifié » ---

test("un rôle à permissions dangereuses n'est jamais donné, même s'il l'est devenu depuis la configuration", async () => {
    const G = "111111111111111108"
    const guild = mkGuild(G)
    configurerServeur(guild)

    // Rôle dangereux dès l'ouverture : pas de défi
    guild.verifie.permissions = new Discord.PermissionsBitField(Flags.ManageMessages)
    const ouverture = clic(guild, mkMembre(guild, "700000000000000009"), "verif:ouvrir")
    await verification.onClicVerification(bot, ouverture)
    assert.ok(texte(ouverture.reponses[0]).includes("indisponible"))
    assert.ok(!ouverture.reponses[0].components)

    // Rôle devenu dangereux entre l'ouverture du défi et la bonne réponse
    guild.verifie.permissions = new Discord.PermissionsBitField(0n)
    const membre = mkMembre(guild, "700000000000000010")
    const { defi } = await ouvrirDefi(guild, membre)
    guild.verifie.permissions = new Discord.PermissionsBitField(Flags.Administrator)
    const bon = clic(guild, membre, defi.bon.id)
    await verification.onClicVerification(bot, bon)
    assert.strictEqual(membre.ajouts, 0, "rôle revérifié au clic")
    assert.ok(bon.editions[0].content.includes("indisponible"))

    // Rôle monté au-dessus du bot
    guild.verifie.permissions = new Discord.PermissionsBitField(0n)
    guild.verifie.position = 20
    guild.verifie.comparePositionTo = autre => 20 - autre.position
    const haut = clic(guild, mkMembre(guild, "700000000000000011"), "verif:ouvrir")
    await verification.onClicVerification(bot, haut)
    assert.ok(texte(haut.reponses[0]).includes("indisponible"))
})

test("la configuration refuse un rôle dangereux, trop haut, ou un configurateur sans « Gérer les rôles »", async () => {
    const G = "111111111111111109"
    const guild = mkGuild(G)
    const configurateur = mkMembre(guild, "700000000000000012")
    configurateur.roles.highest = mkRole("900000000000000008", 8)
    const interaction = perms => {
        configurateur.permissions = new Discord.PermissionsBitField(perms)
        return Object.assign(clic(guild, configurateur, "x", { perms }), { member: configurateur })
    }
    const droits = Flags.ManageGuild | Flags.ManageRoles

    const dangereux = mkRole("900000000000000002", 3, Flags.ManageMessages)
    assert.ok((await verification.configurer(interaction(droits), dangereux, null)).erreur, "permissions de modération")
    const administrateur = mkRole("900000000000000003", 3, Flags.Administrator)
    assert.ok((await verification.configurer(interaction(droits), administrateur, null)).erreur)
    const auDessus = Object.assign(mkRole("900000000000000004", 9), { guild })
    assert.ok((await verification.configurer(interaction(droits), auDessus, null)).erreur, "au-dessus du configurateur")
    assert.ok((await verification.configurer(interaction(Flags.ManageGuild), guild.verifie, null)).erreur, "configurateur sans Gérer les rôles")
    assert.ok((await verification.configurer(interaction(droits), null, null)).erreur, "rôle manquant")
    assert.strictEqual(db.sqlAll("SELECT * FROM verification_config WHERE guild_id = ?", [G]).length, 0, "rien d'enregistré après les refus")

    // Le bot ne peut pas donner un rôle sans « Gérer les rôles »
    const sansPermission = mkGuild("111111111111111110", { botPerms: Flags.ManageNicknames })
    configurateur.permissions = new Discord.PermissionsBitField(droits)
    const i = Object.assign(clic(sansPermission, configurateur, "x", { perms: droits }), { member: configurateur })
    assert.ok((await verification.configurer(i, sansPermission.verifie, null)).erreur, "le bot ne peut pas donner ce rôle")
    // Le propriétaire configure toujours, même sans « Gérer les rôles » ni rôle plus haut
    const proprietaire = mkMembre(guild, PROPRIETAIRE)
    const iProprietaire = Object.assign(clic(guild, proprietaire, "x", { perms: Flags.ManageGuild }), { member: proprietaire })
    assert.deepStrictEqual(await verification.configurer(iProprietaire, auDessus, null), { ok: true }, "le propriétaire configure")
    db.sqlRun("DELETE FROM verification_config WHERE guild_id = ?", [G])

    assert.deepStrictEqual(await verification.configurer(interaction(droits), guild.verifie, null), { ok: true })
    assert.strictEqual(verification.lireConfig(G).role_id, ID_ROLE)
})

test("le panneau est posté dans le salon, remplace l'ancien et enregistre son message", async () => {
    const G = "111111111111111111"
    const guild = mkGuild(G)
    const configurateur = mkMembre(guild, "700000000000000013", { perms: Flags.ManageGuild | Flags.ManageRoles })
    configurateur.roles.highest = mkRole("900000000000000008", 8)
    const i = Object.assign(clic(guild, configurateur, "x", { perms: Flags.ManageGuild | Flags.ManageRoles }), { member: configurateur })
    assert.ok((await verification.poserPanneau(i, null)).erreur, "rien de configuré : refusé")
    await verification.configurer(i, guild.verifie, null)

    const supprimes = []
    const salon = {
        id: "300000000000000009", name: "verification", type: Discord.ChannelType.GuildText, envoyes: [],
        permissionsFor: () => new Discord.PermissionsBitField(Flags.ViewChannel | Flags.SendMessages | Flags.EmbedLinks),
        send: async contenu => { salon.envoyes.push(contenu); return { id: `40000000000000010${salon.envoyes.length}` } },
        messages: { delete: async id => { supprimes.push(id) } }
    }
    guild.channels.cache.set(salon.id, salon)
    const premier = await verification.poserPanneau(i, salon)
    assert.strictEqual(premier.ok, true)
    assert.strictEqual(idsBoutons(salon.envoyes[0])[0], "verif:ouvrir")
    assert.strictEqual(verification.lireConfig(G).message_id, "400000000000000101")
    await verification.poserPanneau(i, salon)
    assert.deepStrictEqual(supprimes, ["400000000000000101"], "l'ancien panneau est retiré")
    assert.strictEqual(verification.lireConfig(G).message_id, "400000000000000102")
    assert.deepStrictEqual(await verification.desactiver(i), { ok: true })
    assert.strictEqual(verification.lireConfig(G), null)
    assert.deepStrictEqual(await verification.desactiver(i), { inchange: true })
})

test("accueillir : rien sans vérification configurée, un MP discret quand le panneau existe", async () => {
    const G = "111111111111111112"
    const guild = mkGuild(G)
    const membre = mkMembre(guild, "700000000000000014")
    assert.strictEqual(await verification.accueillir(membre), null)
    assert.strictEqual(membre.envoyes.length, 0)

    configurerServeur(guild)
    assert.deepStrictEqual(await verification.accueillir(membre), { mp: true })
    await attendre()
    assert.strictEqual(membre.envoyes.length, 1)
    assert.ok(membre.envoyes[0].includes("/400000000000000001"), "le MP pointe vers le panneau")

    assert.strictEqual(await verification.accueillir(mkMembre(guild, "700000000000000015", { bot: true })), null, "un bot est ignoré")
    assert.strictEqual(await verification.accueillir(mkMembre(guild, "700000000000000016", { roles: [ID_ROLE] })), null, "déjà vérifié")
    // MP fermé : aucune erreur
    const ferme = mkMembre(guild, "700000000000000017")
    ferme.send = async () => { throw new Error("Cannot send messages to this user") }
    assert.deepStrictEqual(await verification.accueillir(ferme), { mp: true })
    await attendre()
})

// --- Filtre de pseudos ---

test("nettoyer : caractères de tête, zalgo, mots interdits (casse et accents), pseudo vide", () => {
    const marque = n => String.fromCharCode(0x300 + n)
    // hoist
    assert.strictEqual(pseudos.nettoyer("!!Bob"), "Bob")
    assert.strictEqual(pseudos.nettoyer("(*[.-'\"Alice"), "Alice")
    assert.strictEqual(pseudos.nettoyer("​﻿ Chloé"), "Chloé", "caractères invisibles")
    assert.strictEqual(pseudos.nettoyer("Bob!"), "Bob!", "seul le début compte")
    assert.strictEqual(pseudos.nettoyer("Émilie-Rose"), "Émilie-Rose", "un pseudo normal n'est pas touché")
    assert.strictEqual(pseudos.nettoyer("Nguyễn Thị"), "Nguyễn Thị", "accents légitimes conservés")
    // zalgo
    const zalgo = [..."Hello"].map(c => c + marque(0) + marque(1) + marque(2) + marque(3) + marque(4)).join("")
    assert.strictEqual(pseudos.nettoyer(zalgo), "Hello")
    // mots interdits : insensible à la casse et aux accents, le reste garde ses accents
    assert.strictEqual(pseudos.nettoyer("MECHANT Bob", ["méchant"]), "Bob")
    assert.strictEqual(pseudos.nettoyer("Un Méchant garçon", ["mechant"]), "Un garçon")
    assert.strictEqual(pseudos.nettoyer("xX_Bad_Xx", ["BAD"]), "xX__Xx")
    assert.strictEqual(pseudos.nettoyer("Bob", ["méchant"]), "Bob")
    // le retrait d'un mot peut laisser un caractère de tête : il part aussi
    assert.strictEqual(pseudos.nettoyer("bad!Bob", ["bad"]), "Bob")
    // plus rien : Membre + 4 derniers chiffres de l'identifiant
    assert.strictEqual(pseudos.nettoyer("!!!", [], "123456789012345678"), "Membre 5678")
    assert.strictEqual(pseudos.nettoyer("Bad", ["bad"], "123456789012349999"), "Membre 9999")
    // idempotent : le résultat est stable
    for (const brut of ["!!Bob", zalgo, "MECHANT Bob", "bad!Bob"]) {
        const propre = pseudos.nettoyer(brut, ["bad", "mechant"], "1234")
        assert.strictEqual(pseudos.nettoyer(propre, ["bad", "mechant"], "1234"), propre)
    }
    assert.ok(pseudos.nettoyer("!" + "x".repeat(40)).length <= 32)
})

test("liste de mots : activation, doublons (accents), 50 mots, 32 caractères", () => {
    const G = "222222222222222201"
    assert.strictEqual(pseudos.lireFiltre(G), null)
    assert.strictEqual(pseudos.ajouterMot(G, "mot"), "inactif")
    assert.strictEqual(pseudos.activerFiltre(G), true)
    assert.strictEqual(pseudos.activerFiltre(G), false, "déjà actif")
    assert.strictEqual(pseudos.ajouterMot(G, "Méchant"), "ok")
    assert.strictEqual(pseudos.ajouterMot(G, "MECHANT"), "doublon")
    assert.strictEqual(pseudos.ajouterMot(G, "a"), "invalide", "trop court")
    assert.strictEqual(pseudos.ajouterMot(G, "x".repeat(33)), "invalide", "plus de 32 caractères")
    assert.strictEqual(pseudos.ajouterMot(G, "x".repeat(32)), "ok")
    for (let n = 0; n < 48; n++) assert.strictEqual(pseudos.ajouterMot(G, `mot${String(n).padStart(3, "0")}`), "ok")
    assert.strictEqual(pseudos.lireFiltre(G).mots.length, pseudos.MAX_MOTS)
    assert.strictEqual(pseudos.ajouterMot(G, "dernier"), "limite")
    assert.strictEqual(pseudos.retirerMot(G, "mechant"), "ok")
    assert.strictEqual(pseudos.retirerMot(G, "mechant"), "absent")
    assert.strictEqual(pseudos.ajouterMot(G, "dernier"), "ok")
    assert.strictEqual(pseudos.desactiverFiltre(G), true)
    assert.strictEqual(pseudos.lireFiltre(G), null)
})

test("corrigerPseudo : renomme une fois, sans boucle avec guildMemberUpdate", async () => {
    const G = "222222222222222202"
    const guild = mkGuild(G)
    const membre = mkMembre(guild, "800000000000000001", { displayName: "!!Bob" })
    assert.strictEqual(await pseudos.corrigerPseudo(membre), null, "filtre non activé : rien")
    assert.strictEqual(membre.surnoms.length, 0)

    pseudos.activerFiltre(G)
    assert.deepStrictEqual(await pseudos.corrigerPseudo(membre), { avant: "!!Bob", apres: "Bob" })
    assert.deepStrictEqual(membre.surnoms, ["Bob"])
    // Le renommage redéclenche guildMemberUpdate : l'ancien pseudo est « !!Bob », le nouveau « Bob »
    await evenementMiseAJour(bot, { partial: false, displayName: "!!Bob" }, membre)
    await evenementMiseAJour(bot, { partial: true }, membre)
    await pseudos.corrigerPseudo(membre)
    assert.deepStrictEqual(membre.surnoms, ["Bob"], "aucun deuxième renommage")
    // Autre changement (rôles) : l'événement ne fait rien
    await evenementMiseAJour(bot, { partial: false, displayName: "Bob" }, membre)
    assert.strictEqual(membre.surnoms.length, 1)

    // Un nouveau pseudo interdit est corrigé via l'événement
    pseudos.ajouterMot(G, "insulte")
    membre.displayName = "Insulte-Bob"
    await evenementMiseAJour(bot, { partial: false, displayName: "Bob" }, membre)
    assert.deepStrictEqual(membre.surnoms, ["Bob", "Bob"], "« Insulte-Bob » devient « -Bob » puis « Bob »")
})

test("corrigerPseudo : pseudo vide, bots, propriétaire, membres non gérables et bot sans permission ignorés", async () => {
    const G = "222222222222222203"
    const guild = mkGuild(G)
    pseudos.activerFiltre(G)

    const vide = mkMembre(guild, "800000000000000002", { displayName: "...." })
    assert.deepStrictEqual(await pseudos.corrigerPseudo(vide), { avant: "....", apres: "Membre 0002" })

    const robot = mkMembre(guild, "800000000000000003", { displayName: "!Bot", bot: true })
    const proprietaire = mkMembre(guild, PROPRIETAIRE, { displayName: "!Chef" })
    const haut = mkMembre(guild, "800000000000000004", { displayName: "!Admin", position: 12 })
    const egal = mkMembre(guild, "800000000000000010", { displayName: "!Egal", position: 10 })
    for (const m of [robot, proprietaire, haut, egal]) {
        assert.strictEqual(await pseudos.corrigerPseudo(m), null)
        assert.strictEqual(m.surnoms.length, 0, "jamais renommé")
    }

    const sansPermission = mkGuild("222222222222222204", { botPerms: Flags.ManageRoles })
    pseudos.activerFiltre(sansPermission.id)
    const m = mkMembre(sansPermission, "800000000000000005", { displayName: "!Eve" })
    assert.strictEqual(await pseudos.corrigerPseudo(m), null)
    assert.strictEqual(m.surnoms.length, 0, "sans « Gérer les pseudos », rien n'est tenté")

    // Renommage refusé par Discord : pas d'erreur
    const refuse = mkMembre(guild, "800000000000000006", { displayName: "!Zoe" })
    refuse.setNickname = async () => { throw new Error("Missing Permissions") }
    assert.strictEqual(await pseudos.corrigerPseudo(refuse), null)

    // Module Modération coupé : le filtre ne fait rien
    const G2 = "222222222222222205"
    const coupe = mkGuild(G2)
    pseudos.activerFiltre(G2)
    db.setModule(G2, "moderation", false)
    const c = mkMembre(coupe, "800000000000000007", { displayName: "!Max" })
    assert.strictEqual(await pseudos.corrigerPseudo(c), null)
})

test("garde-fou : au-delà de 3 renommages en 10 minutes, le pseudo corrigé devient le pseudo neutre", async () => {
    const G = "222222222222222206"
    const guild = mkGuild(G)
    pseudos.activerFiltre(G)
    const membre = mkMembre(guild, "800000000000000008", { displayName: "!A" })
    // Un autre bot ou le membre remet sans cesse un pseudo interdit
    const apres = []
    for (let n = 0; n < 6; n++) {
        membre.displayName = "!Bob"
        apres.push((await pseudos.corrigerPseudo(membre)).apres)
    }
    assert.deepStrictEqual(apres, ["Bob", "Bob", "Bob", "Membre 0008", "Membre 0008", "Membre 0008"])
})

// --- Tribunal phase 2 : pouvoir du bot, persistance, raid ---

test("S1 : un membre staff (permission de modération) n'est jamais renommé, un membre ordinaire l'est", async () => {
    const G = "222222222222222210"
    const guild = mkGuild(G)
    pseudos.activerFiltre(G)
    const droits = [Flags.ManageNicknames, Flags.ModerateMembers, Flags.KickMembers, Flags.BanMembers, Flags.ManageGuild, Flags.Administrator]
    for (const [n, droit] of droits.entries()) {
        const staff = mkMembre(guild, `80000000000000002${n}`, { displayName: "!Staff", perms: droit })
        assert.strictEqual(await pseudos.corrigerPseudo(staff), null, `permission ${droit} : jamais renommé`)
        assert.strictEqual(staff.surnoms.length, 0)
    }
    const ordinaire = mkMembre(guild, "800000000000000030", { displayName: "!Eve", perms: Flags.SendMessages | Flags.ViewChannel })
    assert.deepStrictEqual(await pseudos.corrigerPseudo(ordinaire), { avant: "!Eve", apres: "Eve" })
})

// Faux salon de logs de la famille « membres »
function salonDeLogs(guild) {
    const id = "300000000000000777"
    const envois = []
    guild.channels.cache.set(id, { id, isTextBased: () => true, permissionsFor: () => ({ has: () => true }), send: async m => { envois.push(m) } })
    setSalonFamille(guild.id, "membres", id)
    return envois
}
const texteEmbed = envois => envois.map(m => JSON.stringify(m.embeds[0].toJSON())).join("\n")

test("S8 : le log d'une correction ne recopie jamais l'ancien pseudo, il donne le motif et la mention", async () => {
    const G = "222222222222222211"
    const guild = mkGuild(G)
    const envois = salonDeLogs(guild)
    pseudos.activerFiltre(G)
    pseudos.ajouterMot(G, "insulte")
    const membre = mkMembre(guild, "800000000000000040", { displayName: "!!SecretInsulte" })
    assert.ok(await pseudos.corrigerPseudo(membre))
    assert.strictEqual(envois.length, 1)
    const log = texteEmbed(envois)
    assert.ok(!log.includes("SecretInsulte") && !log.includes("!!Secret"), "aucun fragment de l'ancien pseudo")
    assert.ok(log.includes("<@800000000000000040>"), "mention du membre")
    assert.ok(log.includes("hoist") && log.includes("mot interdit"), "motifs")
})

test("S2 : passé le plafond, le pseudo neutre est posé et signalé, puis la correction continue", async () => {
    const G = "222222222222222212"
    const guild = mkGuild(G)
    const envois = salonDeLogs(guild)
    pseudos.activerFiltre(G)
    const membre = mkMembre(guild, "800000000000000050", { displayName: "!A" })
    // Un autre bot remet sans cesse un pseudo interdit
    for (let n = 0; n < 3; n++) {
        membre.displayName = "!Bob"
        assert.deepStrictEqual(await pseudos.corrigerPseudo(membre), { avant: "!Bob", apres: "Bob" })
    }
    assert.strictEqual(envois.length, 3)
    membre.displayName = "!Bob"
    const r = await pseudos.corrigerPseudo(membre)
    assert.strictEqual(r.apres, "Membre 0050", "pseudo neutre")
    assert.strictEqual(r.plafond, true)
    assert.strictEqual(membre.displayName, "Membre 0050", "le pseudo interdit ne reste pas")
    assert.strictEqual(envois.length, 4, "un log part")
    assert.ok(texteEmbed(envois.slice(3)).includes("neutre"))
    // Il continue : le membre remet un pseudo interdit, il est encore remplacé (un seul log par fenêtre)
    membre.displayName = "!Encore"
    assert.strictEqual((await pseudos.corrigerPseudo(membre)).apres, "Membre 0050")
    assert.strictEqual(membre.displayName, "Membre 0050")
    assert.strictEqual(envois.length, 4, "pas de log en double")
})

test("/pseudos : activer, ajouter et retirer demandent « Gérer le serveur » en plus de « Gérer les pseudos »", async () => {
    const commande = bot.commands.get("pseudos")
    const G = "222222222222222213"
    const guild = mkGuild(G)
    const lancer = async (perms, options) => {
        const reponses = []
        const i = {
            guild, guildId: G, locale: "fr", user: { id: "700000000000000050", tag: "mod#0" }, deferred: false, replied: false,
            memberPermissions: new Discord.PermissionsBitField(perms),
            reply: async r => { reponses.push(r.content) }, followUp: async r => { reponses.push(r.content) }
        }
        const args = { getString: n => options[n] ?? null }
        await commande.run(bot, i, args)
        return reponses.at(-1)
    }
    const seulementPseudos = Flags.ManageNicknames
    const complet = Flags.ManageNicknames | Flags.ManageGuild
    assert.match(await lancer(seulementPseudos, { action: "activer" }), /Gérer le serveur/)
    assert.strictEqual(pseudos.lireFiltre(G), null, "rien d'activé")
    assert.match(await lancer(complet, { action: "activer" }), /activé/)
    assert.match(await lancer(seulementPseudos, { action: "ajouter", mot: "insulte" }), /Gérer le serveur/)
    assert.deepStrictEqual(pseudos.lireFiltre(G).mots, [], "aucun mot ajouté")
    assert.match(await lancer(complet, { action: "ajouter", mot: "insulte" }), /ajouté/)
    assert.match(await lancer(seulementPseudos, { action: "retirer", mot: "insulte" }), /Gérer le serveur/)
    assert.deepStrictEqual(pseudos.lireFiltre(G).mots, ["insulte"], "mot conservé")
    assert.match(await lancer(complet, { action: "retirer", mot: "insulte" }), /retiré/)
    // Lire la liste ne demande que « Gérer les pseudos »
    assert.match(await lancer(seulementPseudos, { action: "liste" }), /Mots interdits/)
})

test("S4 : le blocage est conservé en base après un redémarrage, et remis à zéro par une réussite", async () => {
    const G = "111111111111111120"
    const guild = mkGuild(G)
    configurerServeur(guild)
    const membre = mkMembre(guild, "700000000000000020")
    let { defi } = await ouvrirDefi(guild, membre)
    for (let essai = 1; essai <= 3; essai++) {
        const faux = clic(guild, membre, defi.faux[0].id)
        await verification.onClicVerification(bot, faux)
        if (essai < 3) defi = lireDefi(faux.mises[0])
    }
    const ligne = db.sqlAll("SELECT * FROM verification_attempts WHERE guild_id = ? AND user_id = ?", [G, membre.id])[0]
    assert.ok(ligne.blocked_until > Date.now(), "blocage écrit en base")

    // Redémarrage : toute la mémoire est perdue, la base reste
    verification.reinitialiserMemoire()
    const reouverture = clic(guild, membre, "verif:ouvrir")
    await verification.onClicVerification(bot, reouverture)
    assert.ok(texte(reouverture.reponses[0]).includes("Trop d'erreurs"), "toujours bloqué")
    assert.ok(!reouverture.reponses[0].components, "aucun défi")

    // Fin du blocage : réessayer est possible, et une réussite efface la ligne
    db.sqlRun("UPDATE verification_attempts SET blocked_until = ? WHERE guild_id = ? AND user_id = ?", [Date.now() - 1, G, membre.id])
    const { defi: nouveau } = await ouvrirDefi(guild, membre)
    await verification.onClicVerification(bot, clic(guild, membre, nouveau.bon.id))
    assert.strictEqual(membre.ajouts, 1)
    assert.strictEqual(db.sqlAll("SELECT * FROM verification_attempts WHERE guild_id = ? AND user_id = ?", [G, membre.id]).length, 0, "compteur remis à zéro")
})

test("S4 : les erreurs sont comptées en base et survivent à un redémarrage (2 avant, la 3e bloque)", async () => {
    const G = "111111111111111121"
    const guild = mkGuild(G)
    configurerServeur(guild)
    const membre = mkMembre(guild, "700000000000000021")
    let { defi } = await ouvrirDefi(guild, membre)
    for (let essai = 1; essai <= 2; essai++) {
        const faux = clic(guild, membre, defi.faux[0].id)
        await verification.onClicVerification(bot, faux)
        defi = lireDefi(faux.mises[0])
    }
    assert.strictEqual(db.sqlAll("SELECT errors FROM verification_attempts WHERE guild_id = ? AND user_id = ?", [G, membre.id])[0].errors, 2)
    verification.reinitialiserMemoire()
    const { defi: apresRedemarrage } = await ouvrirDefi(guild, membre)
    const faux = clic(guild, membre, apresRedemarrage.faux[0].id)
    await verification.onClicVerification(bot, faux)
    assert.ok(faux.mises[0].content.includes("Trop d'erreurs"), "la 3e erreur bloque malgré le redémarrage")
})

test("A4 : vérification refusée pendant un raid et quand le module Modération est coupé", async () => {
    const G = "111111111111111122"
    const guild = mkGuild(G)
    configurerServeur(guild)
    const membre = mkMembre(guild, "700000000000000022")
    const { defi } = await ouvrirDefi(guild, membre)

    // Raid en cours : ni ouverture, ni réponse (même à un défi ouvert avant le raid)
    db.sqlRun("INSERT INTO raid_events (guild_id, started_at, arrivals) VALUES (?, ?, ?)", [G, Date.now(), 12])
    const ouverture = clic(guild, membre, "verif:ouvrir")
    await verification.onClicVerification(bot, ouverture)
    assert.ok(texte(ouverture.reponses[0]).includes("suspendue pendant un raid"))
    assert.ok(!ouverture.reponses[0].components, "aucun défi")
    const reponse = clic(guild, membre, defi.bon.id)
    await verification.onClicVerification(bot, reponse)
    assert.strictEqual(membre.ajouts, 0, "aucun rôle pendant le raid")
    assert.ok(texte(reponse.reponses[0]).includes("suspendue pendant un raid"))

    // Raid levé : le même défi fonctionne
    db.sqlRun("UPDATE raid_events SET ended_at = ? WHERE guild_id = ?", [Date.now(), G])
    await verification.onClicVerification(bot, clic(guild, membre, defi.bon.id))
    assert.strictEqual(membre.ajouts, 1)

    // Module Modération coupé : refusé comme si la vérification n'était pas activée
    const G2 = "111111111111111123"
    const coupe = mkGuild(G2)
    configurerServeur(coupe)
    const autre = mkMembre(coupe, "700000000000000023")
    const { defi: defi2 } = await ouvrirDefi(coupe, autre)
    db.setModule(G2, "moderation", false)
    const o2 = clic(coupe, autre, "verif:ouvrir")
    await verification.onClicVerification(bot, o2)
    assert.ok(texte(o2.reponses[0]).includes("pas activée"))
    assert.ok(!o2.reponses[0].components)
    const r2 = clic(coupe, autre, defi2.bon.id)
    await verification.onClicVerification(bot, r2)
    assert.strictEqual(autre.ajouts, 0)
    assert.ok(texte(r2.reponses[0]).includes("pas activée"))
})

test("le défi est une grille de 8 boutons sur 2 lignes, tous distincts", async () => {
    const G = "111111111111111124"
    const guild = mkGuild(G)
    configurerServeur(guild)
    const { ouverture } = await ouvrirDefi(guild, mkMembre(guild, "700000000000000024"))
    const lignes = ouverture.reponses[0].components
    assert.deepStrictEqual(lignes.map(l => l.components.length), [4, 4])
    const numeros = lignes.flatMap(l => l.components).map(b => b.data.custom_id.split(":")[4])
    assert.deepStrictEqual(numeros, ["0", "1", "2", "3", "4", "5", "6", "7"])
})
