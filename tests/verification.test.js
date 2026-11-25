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
    return {
        id, ownerId: PROPRIETAIRE, verifie, name: "Serveur test",
        roles: { cache: new Discord.Collection([[verifie.id, verifie]]), everyone: { id } },
        channels: { cache: new Discord.Collection() },
        members: { me: { permissions: new Discord.PermissionsBitField(botPerms), roles: { highest: mkRole("900000000000000009", 10) } } }
    }
}

// Faux membre : ses rôles se modifient vraiment (roles.add est compté)
function mkMembre(guild, id, { roles = [], displayName = "Bob", manageable = true, bot: estBot = false } = {}) {
    const cache = new Set(roles)
    const membre = {
        id, guild, user: { id, bot: estBot }, displayName, manageable, ajouts: 0, envoyes: [], surnoms: [],
        roles: { cache, add: async roleId => { membre.ajouts++; cache.add(roleId) } },
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
    const boutons = payload.components[0].components.map(b => ({ id: b.data.custom_id, emoji: b.data.emoji.name }))
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
    assert.strictEqual(defi.boutons.length, 5)
    assert.strictEqual(new Set(defi.boutons.map(b => b.emoji)).size, 5, "5 emojis différents")
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
    const interaction = perms => Object.assign(clic(guild, configurateur, "x", { perms }), { member: configurateur })
    const droits = Flags.ManageGuild | Flags.ManageRoles

    const dangereux = mkRole("900000000000000002", 3, Flags.ManageMessages)
    assert.ok((await verification.configurer(interaction(droits), dangereux, null)).erreur, "permissions de modération")
    const administrateur = mkRole("900000000000000003", 3, Flags.Administrator)
    assert.ok((await verification.configurer(interaction(droits), administrateur, null)).erreur)
    const auDessus = mkRole("900000000000000004", 9)
    assert.ok((await verification.configurer(interaction(droits), auDessus, null)).erreur, "au-dessus du configurateur")
    assert.ok((await verification.configurer(interaction(Flags.ManageGuild), guild.verifie, null)).erreur, "configurateur sans Gérer les rôles")
    assert.ok((await verification.configurer(interaction(droits), null, null)).erreur, "rôle manquant")
    assert.strictEqual(db.sqlAll("SELECT * FROM verification_config WHERE guild_id = ?", [G]).length, 0, "rien d'enregistré après les refus")

    // Le bot ne peut pas donner un rôle sans « Gérer les rôles »
    const sansPermission = mkGuild("111111111111111110", { botPerms: Flags.ManageNicknames })
    const i = clic(sansPermission, configurateur, "x", { perms: droits })
    assert.ok((await verification.configurer(i, sansPermission.verifie, null)).erreur, "le bot ne peut pas donner ce rôle")

    assert.deepStrictEqual(await verification.configurer(interaction(droits), guild.verifie, null), { ok: true })
    assert.strictEqual(verification.lireConfig(G).role_id, ID_ROLE)
})

test("le panneau est posté dans le salon, remplace l'ancien et enregistre son message", async () => {
    const G = "111111111111111111"
    const guild = mkGuild(G)
    const configurateur = mkMembre(guild, "700000000000000013")
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
    const haut = mkMembre(guild, "800000000000000004", { displayName: "!Admin", manageable: false })
    for (const m of [robot, proprietaire, haut]) {
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

test("garde-fou : pas plus de 3 renommages en 10 minutes pour un même membre", async () => {
    const G = "222222222222222206"
    const guild = mkGuild(G)
    pseudos.activerFiltre(G)
    const membre = mkMembre(guild, "800000000000000008", { displayName: "!A" })
    // Un autre bot ou le membre remet sans cesse un pseudo interdit
    let renommes = 0
    for (let n = 0; n < 6; n++) {
        membre.displayName = "!Bob"
        if (await pseudos.corrigerPseudo(membre)) renommes++
    }
    assert.strictEqual(renommes, 3)
})
