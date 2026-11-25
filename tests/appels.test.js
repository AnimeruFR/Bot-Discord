process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const cases = require('../Fonctions/cases')
const appels = require('../Fonctions/appels')
const { setSalonFamille } = require('../Fonctions/logs')
const { creerRouteur } = require('../Fonctions/routeur')
const { avertir, muter } = require('../Fonctions/actionsMod')
const { bannir } = require('../Fonctions/sanctions')
const { role, erreurDiscord } = require('./aides')

const { Flags } = Discord.PermissionsBitField
const U = "333333333333333401", MOD = "444444444444444401", MOD2 = "444444444444444402", SALON = "555555555555555501"
const JOUR = 24 * 60 * 60 * 1000

let compteur = 0

// Faux serveur avec salon d'appels (sauf sans: true), faux membre sanctionné et faux utilisateur qui reçoit les MP
function monde({ sansSalon = false, absent = false } = {}) {
    const G = `7777777777777778${String(++compteur).padStart(2, "0")}`
    const envoyes = [], mp = [], deban = []
    const salon = {
        id: SALON, isTextBased: () => true, permissionsFor: () => ({ has: () => true }),
        send: async m => { if (salon.casse) throw new Error("salon fermé"); envoyes.push(m) }
    }
    const membre = {
        id: U, roles: { highest: role(1) }, moderatable: true, timeouts: [],
        isCommunicationDisabled: () => true, timeout: async d => { membre.timeouts.push(d) }
    }
    const user = { id: U, tag: "membre#0001", send: async m => { mp.push(m) } }
    const guild = {
        id: G, name: "Serveur test", ownerId: "888888888888888888", preferredLocale: "fr",
        channels: { cache: new Discord.Collection([[SALON, salon]]) },
        members: {
            me: { permissions: new Discord.PermissionsBitField(Flags.Administrator) },
            fetch: async () => { if (absent) throw erreurDiscord(Discord.RESTJSONErrorCodes.UnknownMember); return membre }
        },
        bans: {
            create: async () => { if (guild.banCasse) throw new Error("ban refusé") },
            remove: async id => { deban.push(id) }
        }
    }
    const client = {
        user: { id: "999999999999999999" },
        guilds: { cache: new Discord.Collection([[G, guild]]) },
        users: { fetch: async () => user }
    }
    if (!sansSalon) setSalonFamille(G, "appels", SALON)
    return { G, guild, client, salon, envoyes, mp, deban, membre, user }
}

// Interaction commune : bouton ou modal, en serveur (staff) ou en MP (membre)
function composant(m, customId, { type = "bouton", utilisateur = U, perms = [], mpUniquement = false, texte = "Je n'ai rien fait de mal" } = {}) {
    const i = {
        reponses: [], modals: [], edites: [], customId, id: "1", locale: "fr", channelId: "666666666666666601", deferred: false, ephemeral: true,
        guildId: mpUniquement ? null : m.G, guild: mpUniquement ? null : m.guild, client: m.client,
        user: { id: utilisateur, tag: "quelqu'un#0001" },
        member: mpUniquement ? null : { roles: { highest: role(10), cache: new Set() } },
        memberPermissions: mpUniquement ? null : new Discord.PermissionsBitField(perms),
        inGuild: () => !mpUniquement,
        isButton: () => type === "bouton", isAnySelectMenu: () => false, isModalSubmit: () => type === "modal",
        fields: { getTextInputValue: () => texte },
        message: { embeds: [], edit: async r => { i.edites.push(r) } },
        reply: async r => { i.reponses.push(r) }, editReply: async r => { i.reponses.push(r) }, followUp: async r => { i.reponses.push(r) },
        deleteReply: async () => {}, deferReply: async () => { i.deferred = true },
        showModal: async mo => { i.modals.push(mo) }
    }
    return i
}
const texteDe = i => { const r = i.reponses.at(-1); return typeof r === "string" ? r : r?.content ?? "" }

// Routeur avec les composants de /appel, comme le loader les enregistre
function routeurAppel() {
    const r = creerRouteur()
    r.enregistrerCommande({ ...require('../Commandes/Moderation/appel'), module: "moderation" })
    return r
}

const nouveauWarn = (G, moderateur = MOD) => cases.caseDuWarn(G, db.addWarn(G, U, moderateur, "insulte"))
const idBouton = (G, numero) => `appel-ouvrir:${G}:${numero}`
const idModal = (G, numero) => `appel-envoi:${G}:${numero}`

test("bouton « Faire appel » : seulement avec un salon d'appels et une sanction annulable", () => {
    const m = monde({ sansSalon: true })
    const numero = nouveauWarn(m.G)
    assert.deepStrictEqual(appels.composantsAppel(m.guild, numero), [], "pas de salon d'appels : pas de bouton")
    assert.deepStrictEqual(appels.composantsAppel(m.guild, null), [])

    setSalonFamille(m.G, "appels", SALON)
    const [ligne] = appels.composantsAppel(m.guild, numero)
    assert.strictEqual(ligne.components[0].data.custom_id, idBouton(m.G, numero))
    const unwarn = db.addCase(m.G, { userId: U, moderatorId: MOD, type: "unwarn", reason: "x" })
    assert.deepStrictEqual(appels.composantsAppel(m.guild, unwarn), [], "un retrait n'est pas appelable")
    cases.annulerCase(m.G, numero, MOD)
    assert.deepStrictEqual(appels.composantsAppel(m.guild, numero), [], "sanction déjà annulée")
})

test("les MP de warn, mute et ban portent le bouton, avec le numéro de la sanction", async () => {
    const m = monde()
    const interaction = {
        guild: m.guild, user: { id: MOD, tag: "modo#1" }, client: m.client, member: { roles: { highest: role(5) } },
        memberPermissions: new Discord.PermissionsBitField(Flags.ModerateMembers)
    }
    m.membre.isCommunicationDisabled = () => false
    const warn = await avertir(interaction, m.user, "spam")
    const numeroWarn = cases.caseDuWarn(m.G, warn.id)
    assert.strictEqual(m.mp[0].components[0].components[0].data.custom_id, idBouton(m.G, numeroWarn), "MP du warn")

    const mute = await muter(interaction, m.user, 60 * 1000, "bruit")
    assert.strictEqual(m.mp[1].components[0].components[0].data.custom_id, idBouton(m.G, mute.numero), "MP du mute")

    const numeroBan = await bannir(m.guild, m.user, { moderateur: { id: MOD, tag: "modo#1" }, raisonBrute: "raid", member: m.membre })
    assert.strictEqual(m.mp[2].components[0].components[0].data.custom_id, idBouton(m.G, numeroBan), "MP du ban, parti avant le ban")
    assert.strictEqual(cases.lireCase(m.G, numeroBan).type, "ban")
})

test("sans salon d'appels, le MP reste un simple texte ; un ban refusé ne laisse pas de sanction", async () => {
    const m = monde({ sansSalon: true })
    const interaction = {
        guild: m.guild, user: { id: MOD, tag: "modo#1" }, client: m.client, member: { roles: { highest: role(5) } },
        memberPermissions: new Discord.PermissionsBitField(Flags.ModerateMembers)
    }
    await avertir(interaction, m.user, "spam")
    assert.strictEqual(typeof m.mp[0], "string")

    m.guild.banCasse = true
    const avant = db.countCases(m.G, U)
    await assert.rejects(bannir(m.guild, m.user, { moderateur: { id: MOD, tag: "modo#1" }, raisonBrute: "x", member: m.membre }), /ban refusé/)
    assert.strictEqual(db.countCases(m.G, U), avant, "la sanction écrite d'avance est retirée")
})

test("clic sur « Faire appel » (en MP) : sa sanction seulement, moins de 30 jours, non annulée, un seul appel", async () => {
    const m = monde()
    const r = routeurAppel()
    const numero = nouveauWarn(m.G)

    const bon = composant(m, idBouton(m.G, numero), { mpUniquement: true })
    assert.strictEqual(await r.router(null, bon), true, "le bouton d'un MP est public (aucun droit de staff demandé)")
    assert.strictEqual(bon.modals.length, 1, "formulaire ouvert")
    assert.strictEqual(bon.modals[0].data.custom_id, idModal(m.G, numero))

    // Sanction d'un autre membre
    const autre = composant(m, idBouton(m.G, numero), { mpUniquement: true, utilisateur: "333333333333333499" })
    await r.router(null, autre)
    assert.strictEqual(autre.modals.length, 0, "case d'un autre membre refusée")
    assert.ok(autre.reponses[0].content.includes("introuvable"))

    // Plus de 30 jours
    const vieille = nouveauWarn(m.G)
    db.sqlRun("UPDATE cases SET created_at = ? WHERE id = ?", [Date.now() - 31 * JOUR, vieille])
    const trop = composant(m, idBouton(m.G, vieille), { mpUniquement: true })
    await r.router(null, trop)
    assert.strictEqual(trop.modals.length, 0)
    assert.ok(trop.reponses[0].content.includes("30 jours"))

    // Juste avant la limite : accepté
    const limite = nouveauWarn(m.G)
    db.sqlRun("UPDATE cases SET created_at = ? WHERE id = ?", [Date.now() - 29 * JOUR, limite])
    const ok = composant(m, idBouton(m.G, limite), { mpUniquement: true })
    await r.router(null, ok)
    assert.strictEqual(ok.modals.length, 1)

    // Annulée
    const annulee = nouveauWarn(m.G)
    cases.annulerCase(m.G, annulee, MOD)
    const a = composant(m, idBouton(m.G, annulee), { mpUniquement: true })
    await r.router(null, a)
    assert.strictEqual(a.modals.length, 0)

    // Salon d'appels supprimé entre-temps
    setSalonFamille(m.G, "appels", null)
    const ferme = composant(m, idBouton(m.G, numero), { mpUniquement: true })
    await r.router(null, ferme)
    assert.strictEqual(ferme.modals.length, 0)
    assert.ok(ferme.reponses[0].content.includes("plus possibles"))
})

test("formulaire d'appel : un seul appel par sanction, message de staff avec boutons, échec d'envoi annulé", async () => {
    const m = monde()
    const r = routeurAppel()
    const numero = nouveauWarn(m.G)

    const premier = composant(m, idModal(m.G, numero), { type: "modal", mpUniquement: true })
    await r.router(null, premier)
    const ligne = appels.appelDeCase(m.G, numero)
    assert.strictEqual(ligne.status, "en_attente")
    assert.strictEqual(ligne.user_id, U)
    assert.strictEqual(m.envoyes.length, 1, "le staff est prévenu")
    const ids = m.envoyes[0].components[0].components.map(b => b.data.custom_id)
    assert.deepStrictEqual(ids, [`appel-oui:${ligne.id}`, `appel-non:${ligne.id}`])
    assert.ok(premier.reponses[0].content.includes("transmis"))

    const second = composant(m, idModal(m.G, numero), { type: "modal", mpUniquement: true, texte: "encore" })
    await r.router(null, second)
    assert.strictEqual(m.envoyes.length, 1, "un seul appel par sanction")
    assert.ok(second.reponses[0].content.includes("déjà"))
    assert.strictEqual(db.sqlAll("SELECT COUNT(*) AS n FROM appeals WHERE guild_id = ?", [m.G])[0].n, 1)

    // Le texte est limité à 1000 caractères, vide refusé
    const autre = nouveauWarn(m.G)
    const long = composant(m, idModal(m.G, autre), { type: "modal", mpUniquement: true, texte: "x".repeat(1001) })
    await r.router(null, long)
    const vide = composant(m, idModal(m.G, autre), { type: "modal", mpUniquement: true, texte: "   " })
    await r.router(null, vide)
    assert.strictEqual(appels.appelDeCase(m.G, autre), null)

    // Salon qui refuse le message : l'appel est retiré, le membre peut réessayer
    m.salon.casse = true
    const casse = composant(m, idModal(m.G, autre), { type: "modal", mpUniquement: true })
    const silence = console.error
    console.error = () => {}
    await r.router(null, casse)
    console.error = silence
    assert.strictEqual(appels.appelDeCase(m.G, autre), null)
    assert.ok(casse.reponses[0].content.includes("pas pu"))
})

test("deux envois simultanés : un seul appel est créé", () => {
    const m = monde()
    const numero = nouveauWarn(m.G)
    const a = appels.creerAppel(m.G, U, numero, "un")
    const b = appels.creerAppel(m.G, U, numero, "deux")
    assert.ok(a.id)
    assert.strictEqual(b.cle, "deja")
    assert.strictEqual(appels.creerAppel(m.G, "333333333333333499", numero, "intrus").cle, "introuvable")
})

test("Accepter et Refuser : refusés à un non-staff, gestionnaire jamais appelé", async () => {
    const m = monde()
    const r = routeurAppel()
    const numero = nouveauWarn(m.G)
    const { id } = appels.creerAppel(m.G, U, numero, "injuste")

    const sansDroit = composant(m, `appel-oui:${id}`, { utilisateur: "333333333333333498", perms: [] })
    assert.strictEqual(await r.router(null, sansDroit), true)
    assert.strictEqual(appels.lireAppel(m.G, id).status, "en_attente")
    assert.strictEqual(cases.lireCase(m.G, numero).cancelled_at, null)
    assert.ok(sansDroit.reponses[0].flags, "refus éphémère")

    const refuse = composant(m, `appel-non:${id}`, { perms: [] })
    await r.router(null, refuse)
    assert.strictEqual(appels.lireAppel(m.G, id).status, "en_attente")

    // Même le membre sanctionné ne peut pas se donner raison : il n'a pas la permission
    const lui = composant(m, `appel-oui:${id}`, { utilisateur: U, perms: [] })
    await r.router(null, lui)
    assert.strictEqual(appels.lireAppel(m.G, id).status, "en_attente")
})

test("accepter l'appel d'un warn l'annule, prévient le membre ; un double clic n'a qu'un effet", async () => {
    const m = monde()
    const r = routeurAppel()
    db.addWarn(m.G, U, MOD, "autre warn")
    const numero = nouveauWarn(m.G)
    assert.strictEqual(db.countWarns(m.G, U), 2)
    const { id } = appels.creerAppel(m.G, U, numero, "injuste")

    const clic1 = composant(m, `appel-oui:${id}`, { utilisateur: MOD, perms: [Flags.ModerateMembers] })
    const clic2 = composant(m, `appel-oui:${id}`, { utilisateur: MOD, perms: [Flags.ModerateMembers] })
    await Promise.all([r.router(null, clic1), r.router(null, clic2)])

    const ligne = appels.lireAppel(m.G, id)
    assert.strictEqual(ligne.status, "accepte")
    assert.strictEqual(ligne.decided_by, MOD)
    assert.ok(cases.lireCase(m.G, numero).cancelled_at, "sanction annulée")
    assert.strictEqual(db.countWarns(m.G, U), 1, "le warn est supprimé une seule fois")
    assert.strictEqual(cases.listerModifs(m.G, numero).filter(e => e.field === "annulation").length, 1, "une seule annulation tracée")
    assert.strictEqual(m.mp.length, 1, "un seul MP de résultat")
    assert.ok(m.mp[0].includes("accepté"))
    const textes = [clic1, clic2].map(texteDe)
    assert.strictEqual(textes.filter(x => x.includes("déjà été traité")).length, 1, "l'autre clic est refusé")
    assert.strictEqual([clic1, clic2].reduce((n, c) => n + c.edites.length, 0), 1, "message du staff édité une fois")

    // Un clic tardif sur un appel déjà décidé ne change rien
    const tard = composant(m, `appel-non:${id}`, { utilisateur: MOD, perms: [Flags.ModerateMembers] })
    await r.router(null, tard)
    assert.strictEqual(appels.lireAppel(m.G, id).status, "accepte")
    assert.ok(texteDe(tard).includes("déjà"))
})

test("refuser un appel : sanction maintenue, membre prévenu", async () => {
    const m = monde()
    const r = routeurAppel()
    const numero = nouveauWarn(m.G)
    const { id } = appels.creerAppel(m.G, U, numero, "injuste")
    const clic = composant(m, `appel-non:${id}`, { utilisateur: MOD2, perms: [Flags.ModerateMembers] })
    await r.router(null, clic)
    assert.strictEqual(appels.lireAppel(m.G, id).status, "refuse")
    assert.strictEqual(cases.lireCase(m.G, numero).cancelled_at, null)
    assert.strictEqual(db.countWarns(m.G, U), 1)
    assert.ok(m.mp[0].includes("refusé"))
})

test("accepter : l'auteur de la sanction ou ManageGuild seulement, et la hiérarchie est revérifiée", async () => {
    const m = monde()
    const r = routeurAppel()
    const numero = nouveauWarn(m.G, MOD)
    const { id } = appels.creerAppel(m.G, U, numero, "injuste")

    const autre = composant(m, `appel-oui:${id}`, { utilisateur: MOD2, perms: [Flags.ModerateMembers] })
    await r.router(null, autre)
    assert.strictEqual(appels.lireAppel(m.G, id).status, "en_attente", "un autre modérateur ne peut pas accepter")
    assert.ok(texteDe(autre).includes("autre modérateur"))

    m.membre.roles.highest = role(50)
    const haut = composant(m, `appel-oui:${id}`, { utilisateur: MOD, perms: [Flags.ModerateMembers] })
    await r.router(null, haut)
    assert.strictEqual(appels.lireAppel(m.G, id).status, "en_attente", "membre devenu plus haut : refusé, appel toujours en attente")
    m.membre.roles.highest = role(1)

    const gestionnaire = composant(m, `appel-oui:${id}`, { utilisateur: MOD2, perms: [Flags.ModerateMembers, Flags.ManageGuild] })
    await r.router(null, gestionnaire)
    assert.strictEqual(appels.lireAppel(m.G, id).status, "accepte")
    assert.ok(cases.lireCase(m.G, numero).cancelled_at)
})

test("accepter l'appel d'un ban : débanni seulement si le décideur peut bannir", async () => {
    const m = monde({ absent: true })
    const r = routeurAppel()
    const ban = db.addCase(m.G, { userId: U, moderatorId: MOD, type: "ban", reason: "raid" })
    const { id } = appels.creerAppel(m.G, U, ban, "injuste")

    const sansBan = composant(m, `appel-oui:${id}`, { utilisateur: MOD, perms: [Flags.ModerateMembers] })
    await r.router(null, sansBan)
    assert.strictEqual(appels.lireAppel(m.G, id).status, "accepte")
    assert.ok(cases.lireCase(m.G, ban).cancelled_at)
    assert.deepStrictEqual(m.deban, [], "pas la permission de bannir : pas de déban")
    assert.ok(texteDe(sansBan).includes("/unban"), "le décideur est prévenu")

    const ban2 = db.addCase(m.G, { userId: U, moderatorId: MOD, type: "tempban", reason: "spam", durationMs: JOUR })
    db.setTempban(m.G, U, Date.now() + JOUR)
    const { id: id2 } = appels.creerAppel(m.G, U, ban2, "injuste aussi")
    const avecBan = composant(m, `appel-oui:${id2}`, { utilisateur: MOD, perms: [Flags.ModerateMembers, Flags.BanMembers] })
    await r.router(null, avecBan)
    assert.deepStrictEqual(m.deban, [U])
    assert.strictEqual(db.getTempban(m.G, U), null, "échéance du tempban oubliée")
    assert.ok(texteDe(avecBan).includes("débanni"))
})

test("accepter l'appel d'un mute en cours : le mute est levé", async () => {
    const m = monde()
    const r = routeurAppel()
    const mute = db.addCase(m.G, { userId: U, moderatorId: MOD, type: "mute", reason: "bruit", durationMs: JOUR })
    const { id } = appels.creerAppel(m.G, U, mute, "injuste")
    await r.router(null, composant(m, `appel-oui:${id}`, { utilisateur: MOD, perms: [Flags.ModerateMembers] }))
    assert.deepStrictEqual(m.membre.timeouts, [null])
    assert.ok(cases.lireCase(m.G, mute).cancelled_at)
})

test("un appel d'un autre serveur est introuvable pour le staff d'ici", async () => {
    const m = monde()
    const autre = monde()
    const r = routeurAppel()
    const numero = nouveauWarn(autre.G)
    const { id } = appels.creerAppel(autre.G, U, numero, "injuste")
    const clic = composant(m, `appel-oui:${id}`, { utilisateur: MOD, perms: [Flags.ModerateMembers] })
    await r.router(null, clic)
    assert.strictEqual(appels.lireAppel(autre.G, id).status, "en_attente")
    assert.ok(texteDe(clic).includes("n'existe pas"))
})

test("/appel : liste des appels en attente seulement", async () => {
    const m = monde()
    const commande = require('../Commandes/Moderation/appel')
    const n1 = nouveauWarn(m.G), n2 = nouveauWarn(m.G)
    const { id } = appels.creerAppel(m.G, U, n1, "premier")
    const { id: id2 } = appels.creerAppel(m.G, U, n2, "deuxième")
    appels.trancher(m.G, id2, "refuse", MOD)
    const i = composant(m, "x", { perms: [Flags.ModerateMembers] })
    await commande.run(null, i)
    const description = i.reponses[0].embeds[0].data.description
    assert.ok(description.includes(`n°${id}`) && !description.includes(`n°${id2}`))
})
