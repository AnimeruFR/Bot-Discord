process.env.DATABASE_PATH = ":memory:"

const { test, mock } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const raid = require('../Fonctions/raid')
const { controler } = require('../Fonctions/garde')
const { creerRouteur } = require('../Fonctions/routeur')
const { setSalonFamille } = require('../Fonctions/logs')
const { role, chargerCommandes } = require('./aides')

const { Flags } = Discord.PermissionsBitField
const bot = chargerCommandes()
const cmdRaid = bot.commands.get("raid")
const cmdMassban = bot.commands.get("massban")
const MOD = "444444444444444444", BOT = "555555555555555555", PROPRIO = "666666666666666666"
let compteur = 0

// Faux serveur : seuls le niveau, les invitations, les permissions du bot et le salon antiraid comptent
function serveur({ niveau = 1, permsBot = Flags.ManageGuild, features = [], echecNiveau = false, sansInvitations = false } = {}) {
    const n = ++compteur
    const envois = [], appels = { niveaux: [], invitations: [] }
    const canal = {
        id: "c" + n, isTextBased: () => true, permissionsFor: () => ({ has: () => true }),
        send: async message => { envois.push(message) }
    }
    const guild = {
        id: `70000000000000${String(n).padStart(4, "0")}`, ownerId: PROPRIO, verificationLevel: niveau, features,
        channels: { cache: new Discord.Collection([[canal.id, canal]]) },
        members: { me: { permissions: new Discord.PermissionsBitField(permsBot) } },
        setVerificationLevel: async valeur => {
            if (echecNiveau) throw new Error("refusé")
            appels.niveaux.push(valeur)
            guild.verificationLevel = valeur
        },
        disableInvites: async pause => { appels.invitations.push(pause) }
    }
    if (sansInvitations) delete guild.disableInvites
    setSalonFamille(guild.id, "antiraid", canal.id)
    return { guild, envois, appels }
}

const arrivee = guild => ({ guild, user: { bot: false } })
// Arrivée dont on attend aussi le verrouillage et l'alerte (noterArrivee ne les attend pas)
async function arriver(guild, maintenant) {
    const r = await raid.noterArrivee(arrivee(guild), maintenant)
    if (r.suite) Object.assign(r, await r.suite)
    return r
}
const lireRaids = guildId => db.sqlAll("SELECT * FROM raid_events WHERE guild_id = ? ORDER BY id", [guildId])

// Faux composant ou fausse commande : permissions du membre au choix
function interaction({ perms = [], guild = null, customId = "raid:lever:1" } = {}) {
    const envois = []
    const i = {
        envois, customId, guildId: guild?.id ?? "111111111111111111", guild, channelId: "333333333333333333", id: "inter1",
        user: { id: MOD, tag: "mod#0" }, member: { roles: { cache: new Set(), highest: role(10) } }, locale: "fr", client: { user: { id: BOT } },
        deferred: false, replied: false, ephemeral: false,
        inGuild: () => true, isButton: () => true, isAnySelectMenu: () => false, isModalSubmit: () => false,
        memberPermissions: new Discord.PermissionsBitField(perms),
        message: { retraits: 0, edit: async function () { this.retraits++ } },
        reply: async r => { i.replied = true; envois.push(r) },
        deferReply: async () => { i.deferred = true; i.ephemeral = true },
        editReply: async r => { envois.push(r); return i.reponse },
        followUp: async r => { envois.push(r) }
    }
    return i
}

test("/raid et /massban sont refusés à un non-staff (garde commune)", async () => {
    assert.strictEqual(cmdRaid.module, "moderation")
    for (const [cmd, ok] of [[cmdRaid, Flags.ManageGuild], [cmdMassban, Flags.BanMembers | Flags.ManageGuild]]) {
        const refus = await controler(interaction({ perms: [] }), cmd)
        assert.ok(refus, `/${cmd.name} refusé sans permission`)
        assert.strictEqual(await controler(interaction({ perms: [ok] }), cmd), null, `/${cmd.name} autorisé avec sa permission`)
    }
    // Un membre avec seulement « Bannir » ne peut pas utiliser /raid, et inversement
    assert.ok(await controler(interaction({ perms: [Flags.BanMembers] }), cmdRaid))
    assert.ok(await controler(interaction({ perms: [Flags.ManageGuild] }), cmdMassban))
    assert.ok(await controler(interaction({ perms: [Flags.BanMembers] }), cmdMassban), "Bannir seul ne suffit pas pour /massban")
    assert.strictEqual(cmdMassban.permission, Flags.BanMembers | Flags.ManageGuild)
})

test("sans réglage, bot, ou module modération coupé : rien n'est compté", async () => {
    const { guild } = serveur()
    for (let i = 0; i < 20; i++) assert.strictEqual((await arriver(guild)).declenche, false)
    assert.strictEqual(lireRaids(guild.id).length, 0)

    raid.setReglage(guild.id, { arrivees: 3, secondes: 30 })
    for (let i = 0; i < 10; i++) await raid.noterArrivee({ guild, user: { bot: true } })
    assert.strictEqual(lireRaids(guild.id).length, 0, "les bots ne comptent pas")

    db.setModule(guild.id, "moderation", false)
    for (let i = 0; i < 10; i++) await arriver(guild)
    assert.strictEqual(lireRaids(guild.id).length, 0, "module désactivé")
    db.setModule(guild.id, "moderation", true)
})

test("sous le seuil ou hors fenêtre : pas de raid ; noterArrivee ne lève jamais", async () => {
    const { guild } = serveur()
    raid.setReglage(guild.id, { arrivees: 5, secondes: 10 })
    const t0 = 1_800_000_000_000
    // 4 arrivées, puis 4 de plus 11 s plus tard : jamais 5 dans la fenêtre
    for (let i = 0; i < 4; i++) await arriver(guild, t0 + i * 100)
    for (let i = 0; i < 4; i++) await arriver(guild, t0 + 11_000 + i * 100)
    assert.strictEqual(lireRaids(guild.id).length, 0)
    assert.deepStrictEqual(await raid.noterArrivee(null), { declenche: false }, "membre invalide : aucune exception")
    assert.deepStrictEqual(await raid.noterArrivee({ guild: null }), { declenche: false })
})

test("50 arrivées simultanées : un seul raid, serveur verrouillé, alerte avec bouton", async () => {
    const { guild, envois, appels } = serveur({ niveau: 1 })
    raid.setReglage(guild.id, { arrivees: 5, secondes: 30 })
    const resultats = await Promise.all(Array.from({ length: 50 }, () => arriver(guild)))
    assert.strictEqual(resultats.filter(r => r.declenche).length, 1)
    const lignes = lireRaids(guild.id)
    assert.strictEqual(lignes.length, 1)
    assert.strictEqual(lignes[0].previous_level, 1, "niveau précédent sauvegardé")
    assert.strictEqual(lignes[0].invites_paused, 1)
    assert.strictEqual(lignes[0].ended_at, null)
    assert.deepStrictEqual(appels.niveaux, [raid.NIVEAU_RAID], "niveau relevé une seule fois")
    assert.deepStrictEqual(appels.invitations, [true])
    assert.strictEqual(envois.length, 1, "une seule alerte")
    assert.strictEqual(envois[0].components[0].components[0].data.custom_id, `raid:lever:${lignes[0].id}`)

    // Encore des arrivées pendant le raid : toujours un seul raid
    await Promise.all(Array.from({ length: 20 }, () => arriver(guild)))
    assert.strictEqual(lireRaids(guild.id).length, 1)
    assert.strictEqual(envois.length, 1)
})

test("levée : restaure le niveau et les invitations, trace lifted_by, une seule fois", async () => {
    const { guild, appels } = serveur({ niveau: 2 })
    raid.setReglage(guild.id, { arrivees: 3, secondes: 30 })
    for (let i = 0; i < 3; i++) await arriver(guild)
    assert.strictEqual(guild.verificationLevel, raid.NIVEAU_RAID)
    assert.ok(raid.raidEnCours(guild.id))

    const [a, b] = await Promise.all([raid.lever(guild, { par: MOD }), raid.lever(guild, { par: "999999999999999999" })])
    const [bon, refus] = a.erreur ? [b, a] : [a, b]
    assert.ok(["aucun", "deja"].includes(refus.erreur), "deux levées simultanées : une seule effective")
    assert.strictEqual(bon.niveau, 2)
    assert.strictEqual(guild.verificationLevel, 2, "niveau restauré")
    assert.deepStrictEqual(appels.invitations, [true, false], "invitations rétablies une fois")
    const ligne = lireRaids(guild.id)[0]
    assert.ok(ligne.ended_at)
    assert.ok([MOD, "999999999999999999"].includes(ligne.lifted_by))
    assert.strictEqual(raid.raidEnCours(guild.id), null)
    assert.strictEqual((await raid.lever(guild, { par: MOD })).erreur, "aucun")

    // Un nouveau raid est possible une fois le premier levé
    for (let i = 0; i < 3; i++) await arriver(guild)
    assert.strictEqual(lireRaids(guild.id).length, 2)
})

test("levée : un niveau changé à la main pendant le raid n'est pas écrasé ; invitations déjà suspendues laissées", async () => {
    const a = serveur({ niveau: 1 })
    raid.setReglage(a.guild.id, { arrivees: 3, secondes: 30 })
    for (let i = 0; i < 3; i++) await arriver(a.guild)
    a.guild.verificationLevel = 3
    const r = await raid.lever(a.guild, { par: MOD })
    assert.strictEqual(r.niveauModifie, true)
    assert.strictEqual(a.guild.verificationLevel, 3)

    const b = serveur({ niveau: 4, features: ["INVITES_DISABLED"] })
    raid.setReglage(b.guild.id, { arrivees: 3, secondes: 30 })
    for (let i = 0; i < 3; i++) await arriver(b.guild)
    assert.deepStrictEqual(b.appels, { niveaux: [], invitations: [] }, "déjà au maximum et invitations déjà coupées : rien à faire")
    await raid.lever(b.guild, { par: MOD })
    assert.deepStrictEqual(b.appels.invitations, [], "on ne rétablit pas ce qu'on n'a pas suspendu")
})

test("après un redémarrage, un raid en cours reste levable et bloque un second déclenchement", async () => {
    const { guild, appels } = serveur({ niveau: 4 })
    raid.setReglage(guild.id, { arrivees: 3, secondes: 30 })
    db.sqlRun("INSERT INTO raid_events (guild_id, started_at, arrivals, previous_level, invites_paused) VALUES (?, ?, 5, 1, 1)", [guild.id, Date.now()])
    for (let i = 0; i < 10; i++) await arriver(guild)
    assert.strictEqual(lireRaids(guild.id).length, 1, "pas de second raid pendant celui qui est en base")
    const r = await raid.lever(guild, { par: MOD })
    assert.strictEqual(r.niveau, 1)
    assert.strictEqual(guild.verificationLevel, 1)
    assert.deepStrictEqual(appels.invitations, [false])
})

test("alert_only : alerte au staff, le serveur n'est pas touché", async () => {
    const { guild, envois, appels } = serveur({ niveau: 1 })
    raid.setReglage(guild.id, { arrivees: 3, secondes: 30, alerteSeule: true })
    await Promise.all(Array.from({ length: 10 }, () => arriver(guild)))
    assert.deepStrictEqual(appels, { niveaux: [], invitations: [] })
    assert.strictEqual(guild.verificationLevel, 1)
    const [ligne] = lireRaids(guild.id)
    assert.strictEqual(lireRaids(guild.id).length, 1)
    assert.strictEqual(ligne.previous_level, null)
    assert.strictEqual(ligne.invites_paused, 0)
    assert.strictEqual(envois.length, 1)
    const r = await raid.lever(guild, { par: MOD })
    assert.strictEqual(r.niveau, null)
    assert.deepStrictEqual(appels, { niveaux: [], invitations: [] }, "la levée ne touche à rien non plus")
})

test("bot sans « Gérer le serveur » : alerte seulement, avec le motif", async () => {
    const { guild, envois, appels } = serveur({ permsBot: 0n })
    raid.setReglage(guild.id, { arrivees: 3, secondes: 30 })
    for (let i = 0; i < 3; i++) await arriver(guild)
    assert.deepStrictEqual(appels, { niveaux: [], invitations: [] })
    assert.strictEqual(lireRaids(guild.id)[0].previous_level, null)
    assert.strictEqual(envois.length, 1)
    assert.ok(envois[0].embeds[0].data.fields[0].value.includes("Gérer le serveur"))
})

test("échecs de verrouillage : notés, non bloquants, rien à restaurer à tort", async () => {
    const a = serveur({ echecNiveau: true, sansInvitations: true })
    raid.setReglage(a.guild.id, { arrivees: 3, secondes: 30 })
    let r
    for (let i = 0; i < 3; i++) r = await arriver(a.guild)
    assert.strictEqual(r.declenche, true)
    assert.strictEqual(r.mesures.echecs.length, 2)
    assert.strictEqual(a.envois.length, 1, "l'alerte part malgré les échecs")
    const ligne = lireRaids(a.guild.id)[0]
    assert.strictEqual(ligne.previous_level, null)
    assert.strictEqual(ligne.invites_paused, 0)
    a.guild.verificationLevel = 3 // réglé à la main : la levée n'y touche pas
    const levee = await raid.lever(a.guild, { par: MOD })
    assert.strictEqual(levee.niveau, null)
    assert.strictEqual(a.guild.verificationLevel, 3)
})

test("levée : une restauration qui échoue laisse le raid ouvert et relevable, sans refaire ce qui est restauré", async () => {
    const { guild, appels } = serveur({ niveau: 2 })
    raid.setReglage(guild.id, { arrivees: 3, secondes: 30 })
    for (let i = 0; i < 3; i++) await arriver(guild)
    let panne = true
    const disable = guild.disableInvites
    guild.disableInvites = async pause => { if (panne) throw new Error("API en panne"); return disable(pause) }

    const [a, b] = await Promise.all([raid.lever(guild, { par: MOD }), raid.lever(guild, { par: MOD })])
    const [reel, refus] = a.erreur ? [b, a] : [a, b]
    assert.strictEqual(refus.erreur, "deja", "clic simultané refusé pendant la levée")
    assert.strictEqual(reel.leve, false)
    assert.strictEqual(reel.niveau, 2, "le niveau a été restauré")
    assert.ok(reel.echecs[0].includes("invitations"))
    assert.ok(raid.raidEnCours(guild.id), "le raid reste ouvert")
    assert.strictEqual(lireRaids(guild.id)[0].ended_at, null)

    panne = false
    const r = await raid.lever(guild, { par: MOD })
    assert.strictEqual(r.leve, true)
    assert.strictEqual(r.invites, true)
    assert.deepStrictEqual(appels.niveaux, [raid.NIVEAU_RAID, 2], "niveau restauré une seule fois")
    assert.strictEqual(raid.raidEnCours(guild.id), null)
    assert.strictEqual(lireRaids(guild.id)[0].lifted_by, MOD)
})

test("noterArrivee n'attend pas le verrouillage ni l'alerte", async () => {
    const { guild, envois } = serveur({ niveau: 1 })
    raid.setReglage(guild.id, { arrivees: 3, secondes: 30 })
    let debloquer
    const porte = new Promise(r => { debloquer = r })
    guild.setVerificationLevel = async () => { await porte }
    await raid.noterArrivee(arrivee(guild))
    await raid.noterArrivee(arrivee(guild))
    const r = await raid.noterArrivee(arrivee(guild)) // se résout alors que le verrouillage est bloqué
    assert.strictEqual(r.declenche, true)
    assert.strictEqual(lireRaids(guild.id).length, 1, "raid enregistré avant")
    assert.strictEqual(envois.length, 0, "alerte pas encore partie")
    debloquer()
    await r.suite
    assert.strictEqual(envois.length, 1)
})

test("réglage : bornes, désactivation", () => {
    const g = "800000000000000001"
    assert.throws(() => raid.setReglage(g, { arrivees: 2, secondes: 10 }), RangeError)
    assert.throws(() => raid.setReglage(g, { arrivees: 101, secondes: 10 }), RangeError)
    assert.throws(() => raid.setReglage(g, { arrivees: 5, secondes: 4 }), RangeError)
    assert.throws(() => raid.setReglage(g, { arrivees: 5, secondes: 301 }), RangeError)
    assert.throws(() => raid.setReglage(g, { arrivees: 5.5, secondes: 10 }), RangeError)
    assert.strictEqual(raid.getReglage(g), null)
    raid.setReglage(g, { arrivees: 3, secondes: 5 })
    raid.setReglage(g, { arrivees: 100, secondes: 300, alerteSeule: true })
    assert.deepStrictEqual(raid.getReglage(g), { arrivees: 100, secondes: 300, alerteSeule: true })
    assert.strictEqual(raid.supprimerReglage(g), true)
    assert.strictEqual(raid.supprimerReglage(g), false)
})

test("/raid : config, statut, lever, désactiver", async () => {
    const { guild } = serveur({ niveau: 1 })
    const args = (valeurs = {}) => ({
        getString: n => valeurs[n] ?? null, getInteger: n => valeurs[n] ?? null, getBoolean: n => valeurs[n] ?? null
    })
    const lancer = async valeurs => {
        const i = interaction({ perms: [Flags.ManageGuild], guild })
        await cmdRaid.run(bot, i, args(valeurs))
        return i.envois.at(-1).content
    }
    assert.ok((await lancer({ action: "statut" })).includes("pas configuré"))
    assert.ok((await lancer({ action: "config", arrivees: 4, secondes: 20, alerte_seule: false })).includes("**4**"))
    assert.deepStrictEqual(raid.getReglage(guild.id), { arrivees: 4, secondes: 20, alerteSeule: false })
    await lancer({ action: "config", alerte_seule: true })
    assert.deepStrictEqual(raid.getReglage(guild.id), { arrivees: 4, secondes: 20, alerteSeule: true }, "les valeurs omises sont conservées")
    assert.ok((await lancer({ action: "config", arrivees: 1000 })).includes("hors limites"))
    assert.ok((await lancer({ action: "lever" })).includes("Aucun mode raid"))
    await lancer({ action: "config", alerte_seule: false })
    for (let i = 0; i < 4; i++) await arriver(guild)
    assert.ok((await lancer({ action: "statut" })).includes("en cours"))
    assert.ok((await lancer({ action: "lever" })).includes("levé"))
    assert.strictEqual(guild.verificationLevel, 1)
    assert.ok((await lancer({ action: "desactiver" })).includes("désactivé"))
    assert.strictEqual(raid.getReglage(guild.id), null)
    assert.ok((await lancer({ action: "desactiver" })).includes("pas configuré"))
})

test("bouton « Lever le mode raid » : refusé à un non-staff, effectif pour le staff", async () => {
    const { guild } = serveur({ niveau: 2 })
    raid.setReglage(guild.id, { arrivees: 3, secondes: 30 })
    for (let i = 0; i < 3; i++) await arriver(guild)
    const id = raid.raidEnCours(guild.id).id
    const routeur = creerRouteur()
    routeur.enregistrerCommande(cmdRaid)

    const intrus = interaction({ perms: [Flags.BanMembers, Flags.ModerateMembers], guild, customId: `raid:lever:${id}` })
    assert.strictEqual(await routeur.router(bot, intrus), true)
    assert.ok(intrus.envois[0].flags, "refus éphémère")
    assert.ok(raid.raidEnCours(guild.id), "raid toujours en cours")
    assert.strictEqual(guild.verificationLevel, raid.NIVEAU_RAID)

    // Le gestionnaire revérifie lui-même la permission, même si la garde était contournée
    const direct = interaction({ perms: [], guild, customId: `raid:lever:${id}` })
    await cmdRaid.composants[0].gestionnaire(bot, direct)
    assert.ok(raid.raidEnCours(guild.id))

    // Le bouton d'un autre serveur ne lève pas ce raid
    const autre = serveur()
    const etranger = interaction({ perms: [Flags.ManageGuild], guild: autre.guild, customId: `raid:lever:${id}` })
    await routeur.router(bot, etranger)
    assert.ok(raid.raidEnCours(guild.id))

    const staff = interaction({ perms: [Flags.ManageGuild], guild, customId: `raid:lever:${id}` })
    await routeur.router(bot, staff)
    assert.strictEqual(raid.raidEnCours(guild.id), null)
    assert.strictEqual(guild.verificationLevel, 2)
    assert.strictEqual(lireRaids(guild.id)[0].lifted_by, MOD)
    assert.strictEqual(staff.message.retraits, 1, "le bouton disparaît de l'alerte")

    const second = interaction({ perms: [Flags.ManageGuild], guild, customId: `raid:lever:${id}` })
    await routeur.router(bot, second)
    assert.ok(second.envois.at(-1).content.includes("déjà"))
})

test("A2 : sans salon d'alerte valide, pas de verrouillage : raid enregistré et MP au propriétaire", async () => {
    const { guild, envois, appels } = serveur({ niveau: 1 })
    const mp = []
    guild.name = "Serveur test"
    guild.fetchOwner = async () => ({ send: async m => { mp.push(m) } })
    guild.channels.cache.clear() // le salon antiraid a été supprimé
    raid.setReglage(guild.id, { arrivees: 3, secondes: 30 })
    let dernier
    for (let i = 0; i < 3; i++) dernier = await arriver(guild)
    assert.strictEqual(dernier.alerteImpossible, true)
    assert.deepStrictEqual(appels, { niveaux: [], invitations: [] }, "le serveur n'est pas verrouillé")
    assert.strictEqual(guild.verificationLevel, 1)
    const [ligne] = lireRaids(guild.id)
    assert.ok(ligne, "raid enregistré")
    assert.strictEqual(ligne.previous_level, null)
    assert.strictEqual(ligne.invites_paused, 0)
    assert.strictEqual(envois.length, 0)
    assert.strictEqual(mp.length, 1)
    assert.ok(mp[0].includes("PAS été verrouillé"))
    assert.strictEqual(dernier.mp, true)
    assert.ok(raid.raidEnCours(guild.id), "levable ensuite avec /raid lever")
})

test("A2 : /raid config prévient quand aucun salon d'alerte n'est configuré", async () => {
    const args = valeurs => ({ getString: n => valeurs[n] ?? null, getInteger: n => valeurs[n] ?? null, getBoolean: n => valeurs[n] ?? null })
    const avec = serveur()
    const i1 = interaction({ perms: [Flags.ManageGuild], guild: avec.guild })
    await cmdRaid.run(bot, i1, args({ action: "config", arrivees: 5, secondes: 20 }))
    assert.ok(!i1.envois.at(-1).content.includes("Aucun salon d'alerte"))

    const sans = serveur()
    sans.guild.channels.cache.clear()
    const i2 = interaction({ perms: [Flags.ManageGuild], guild: sans.guild })
    await cmdRaid.run(bot, i2, args({ action: "config", arrivees: 5, secondes: 20 }))
    assert.ok(i2.envois.at(-1).content.includes("Aucun salon d'alerte"))
})

test("A2 : levée automatique d'un raid ouvert depuis plus de 60 minutes (même fonction que le bouton)", async () => {
    const { guild, envois, appels } = serveur({ niveau: 2 })
    guild.client = { user: { id: BOT } }
    raid.setReglage(guild.id, { arrivees: 3, secondes: 30 })
    const debut = Date.now()
    for (let i = 0; i < 3; i++) await arriver(guild, debut + i)
    assert.deepStrictEqual(appels.niveaux, [raid.NIVEAU_RAID])
    assert.strictEqual(envois.length, 1)

    assert.strictEqual(raid.leverSiExpire(guild, debut + raid.DUREE_RAID_MAX_MS - 1000), null, "pas encore ancien")
    assert.ok(raid.raidEnCours(guild.id))

    const r = await raid.leverSiExpire(guild, debut + raid.DUREE_RAID_MAX_MS + 1000)
    assert.strictEqual(r.leve, true)
    assert.strictEqual(raid.raidEnCours(guild.id), null)
    assert.strictEqual(guild.verificationLevel, 2, "niveau restauré")
    assert.deepStrictEqual(appels.invitations, [true, false])
    assert.strictEqual(lireRaids(guild.id)[0].lifted_by, BOT)
    assert.strictEqual(envois.length, 2)
    assert.ok(envois[1].embeds[0].data.title.includes("levée automatique"), "trace dans le salon antiraid")
    assert.strictEqual(raid.leverSiExpire(guild, debut + raid.DUREE_RAID_MAX_MS + 2000), null, "plus rien à lever")
})

test("A2 : l'arrivée d'un membre lève aussi un raid expiré, sans relancer la levée à chaque arrivée si elle échoue", async () => {
    const { guild, appels } = serveur({ niveau: 1 })
    guild.client = { user: { id: BOT } }
    raid.setReglage(guild.id, { arrivees: 50, secondes: 30 })
    const debut = Date.now()
    db.sqlRun("INSERT INTO raid_events (guild_id, started_at, arrivals, previous_level) VALUES (?, ?, 5, 1)", [guild.id, debut - raid.DUREE_RAID_MAX_MS - 5000])
    guild.verificationLevel = raid.NIVEAU_RAID
    const r = await arriver(guild, debut)
    assert.strictEqual(r.leve, true)
    assert.deepStrictEqual(appels.niveaux, [1])
    assert.strictEqual(raid.raidEnCours(guild.id), null)

    // Restauration impossible : une seule tentative par minute
    const autre = serveur({ niveau: 1 })
    autre.guild.client = { user: { id: BOT } }
    autre.guild.verificationLevel = raid.NIVEAU_RAID
    let essais = 0
    autre.guild.setVerificationLevel = async () => { essais++; throw new Error("refusé") }
    raid.setReglage(autre.guild.id, { arrivees: 50, secondes: 30 })
    db.sqlRun("INSERT INTO raid_events (guild_id, started_at, arrivals, previous_level) VALUES (?, ?, 5, 1)", [autre.guild.id, debut - raid.DUREE_RAID_MAX_MS - 5000])
    const erreurs = console.error, logs = console.log
    console.error = () => {}
    console.log = () => {}
    try {
        const premier = await arriver(autre.guild, debut)
        assert.strictEqual(premier.leve, false)
        await arriver(autre.guild, debut + 1000)
        await arriver(autre.guild, debut + 2000)
    } finally {
        console.error = erreurs
        console.log = logs
    }
    assert.strictEqual(essais, 1, "pas de nouvelle tentative avant une minute")
    assert.ok(raid.raidEnCours(autre.guild.id), "raid toujours ouvert, relevable")
})

test("A3 : N arrivées dans la fenêtre -> raid créé et niveau relevé en moins de 5 s simulées, puis levée par le bouton", async () => {
    const t0 = 1_800_000_000_000
    mock.timers.enable({ apis: ["Date"], now: t0 })
    try {
        const { guild, envois, appels } = serveur({ niveau: 1 })
        let niveauRelevePar = null
        const original = guild.setVerificationLevel
        guild.setVerificationLevel = async (valeur, raison) => {
            if (valeur === raid.NIVEAU_RAID) niveauRelevePar = Date.now() - t0
            return original(valeur, raison)
        }
        raid.setReglage(guild.id, { arrivees: 8, secondes: 10 })
        const suites = []
        for (let i = 0; i < 8; i++) {
            const r = await raid.noterArrivee(arrivee(guild)) // horloge simulée : Date.now() par défaut
            if (r.suite) suites.push(r.suite)
            mock.timers.tick(400) // 8 arrivées en 2,8 s simulées
        }
        await Promise.all(suites)
        const [ligne] = lireRaids(guild.id)
        assert.ok(ligne, "raid_events créé")
        assert.ok(ligne.started_at - t0 < 5000, "raid créé en moins de 5 s simulées")
        assert.deepStrictEqual(appels.niveaux, [raid.NIVEAU_RAID])
        assert.ok(niveauRelevePar !== null && niveauRelevePar < 5000, `setVerificationLevel appelé à +${niveauRelevePar} ms`)
        assert.strictEqual(envois.length, 1)

        // Levée par le bouton de l'alerte
        const routeur = creerRouteur()
        routeur.enregistrerCommande(cmdRaid)
        const clic = interaction({ perms: [Flags.ManageGuild], guild, customId: envois[0].components[0].components[0].data.custom_id })
        await routeur.router(bot, clic)
        assert.strictEqual(raid.raidEnCours(guild.id), null)
        assert.strictEqual(guild.verificationLevel, 1)
        assert.strictEqual(lireRaids(guild.id)[0].lifted_by, MOD)
    } finally {
        mock.timers.reset()
    }
})

// ---------- /massban ----------

const U = n => String(100000000000000000n + BigInt(n)) // identifiant de 18 chiffres

test("massban : analyse des identifiants", () => {
    const { parserIds } = cmdMassban
    assert.deepStrictEqual(parserIds(`${U(1)} ${U(2)},${U(3)}\n${U(1)}`), { ids: [U(1), U(2), U(3)], invalides: [] }, "séparateurs variés, doublons retirés")
    assert.deepStrictEqual(parserIds(`<@${U(4)}> <@!${U(5)}>`).ids, [U(4), U(5)], "mentions acceptées")
    const { ids, invalides } = parserIds(`${U(1)} 12345 abc ${"9".repeat(21)} ${"9".repeat(16)}`)
    assert.deepStrictEqual(ids, [U(1)])
    assert.strictEqual(invalides.length, 4, "trop court, texte, trop long")
    assert.ok(parserIds("9".repeat(17)).ids.length && parserIds("9".repeat(20)).ids.length, "17 et 20 chiffres valides")
    assert.deepStrictEqual(parserIds(""), { ids: [], invalides: [] })
    assert.deepStrictEqual(parserIds(null), { ids: [], invalides: [] })
})

// Faux serveur de ban : membres présents (id -> { roles, bannable })
function serveurBan({ presents = {}, bulk = true, echoue = [], recents = [] } = {}) {
    const n = ++compteur
    const membres = new Discord.Collection(Object.entries(presents).map(([id, p]) => [id, {
        id, user: { bot: p.bot ?? false }, roles: { highest: role(p.role ?? 1) }, bannable: p.bannable ?? true, joinedTimestamp: p.arrive ?? 0
    }]))
    const bans = { groupes: [], uns: [] }
    const guild = {
        id: `71000000000000${String(n).padStart(4, "0")}`, ownerId: PROPRIO, bans,
        members: {
            me: { permissions: new Discord.PermissionsBitField(Flags.BanMembers | Flags.ManageGuild) },
            fetch: async opts => opts?.user ? membres.filter((_, id) => opts.user.includes(id)) : membres
        },
        channels: { cache: new Discord.Collection() }
    }
    bans.bulkCreate = async (ids, options) => {
        bans.groupes.push({ ids, options })
        return { bannedUsers: ids.filter(id => !echoue.includes(id)), failedUsers: echoue.filter(id => ids.includes(id)) }
    }
    bans.create = async (id, options) => {
        if (echoue.includes(id)) throw new Error("refus")
        bans.uns.push({ id, options })
    }
    if (!bulk) delete bans.bulkCreate
    return guild
}

// Fausse commande /massban : `clic` vaut "oui", "non" ou null (délai écoulé)
function lancerMassban(guild, valeurs, { clic = "oui", perms = Flags.BanMembers | Flags.ManageGuild } = {}) {
    const i = interaction({ perms: [perms], guild })
    i.reponse = {
        awaitMessageComponent: async ({ filter }) => {
            if (!clic) throw new Error("délai")
            const bouton = {
                customId: `massban-${clic}-${i.id}`, user: i.user, guild, client: i.client, member: i.member, memberPermissions: i.memberPermissions,
                update: async r => { i.envois.push(r) }
            }
            assert.ok(filter(bouton), "le filtre accepte l'auteur")
            assert.ok(!filter({ ...bouton, user: { id: "999999999999999999" } }), "le filtre refuse un autre membre")
            return bouton
        }
    }
    const args = { getString: n => valeurs[n] ?? null, getInteger: n => valeurs[n] ?? null }
    return cmdMassban.run(bot, i, args).then(() => i)
}
const casDe = (guildId, userId) => db.listCases(guildId, userId)

test("massban : permissions exigées (Bannir ET Gérer le serveur, côté modérateur et bot)", async () => {
    const guild = serveurBan()
    let i = await lancerMassban(guild, { ids: U(1) }, { perms: Flags.BanMembers })
    assert.ok(i.envois[0].content.includes("Gérer le serveur"))
    assert.strictEqual(guild.bans.groupes.length, 0)
    i = await lancerMassban(guild, { ids: U(1) }, { perms: Flags.ManageGuild })
    assert.ok(i.envois[0].content.includes("Bannir"))

    guild.members.me.permissions = new Discord.PermissionsBitField(Flags.BanMembers)
    i = await lancerMassban(guild, { ids: U(1) })
    assert.ok(i.envois[0].content.includes("Le bot n'a pas"))
    assert.strictEqual(guild.bans.groupes.length, 0)
})

test("massban : cible obligatoire, identifiants invalides refusés, limite de 200", async () => {
    const guild = serveurBan()
    let i = await lancerMassban(guild, {})
    assert.ok(i.envois[0].content.includes("Indiquez"))
    i = await lancerMassban(guild, { ids: `${U(1)} pasunid` })
    assert.ok(i.envois[0].content.includes("pasunid"), "un identifiant faux fait tout refuser")

    const deuxCents = Array.from({ length: 200 }, (_, n) => U(n + 10)).join(" ")
    i = await lancerMassban(guild, { ids: deuxCents }, { clic: "non" })
    assert.ok(i.envois.at(-1).content.includes("annulé"), "200 cibles : accepté (aperçu puis annulation)")
    i = await lancerMassban(guild, { ids: deuxCents + " " + U(500) })
    assert.ok(i.envois[0].content.includes("Trop de cibles"), "201 cibles : refusé")
    assert.strictEqual(guild.bans.groupes.length, 0)
})

test("massban : exclusions (soi, bot, propriétaire, rôles au-dessus ou égaux, non bannissables)", async () => {
    const guild = serveurBan({ presents: {
        [U(1)]: { role: 5 }, [U(2)]: { role: 10 }, [U(3)]: { role: 20 }, [U(4)]: { role: 1, bannable: false }, [U(5)]: { role: 9 }
    } })
    const i = interaction({ perms: [Flags.BanMembers | Flags.ManageGuild], guild })
    const ids = [MOD, BOT, PROPRIO, U(1), U(2), U(3), U(4), U(5), U(6)]
    const { cibles, exclus } = await cmdMassban.evaluer(i, ids)
    assert.deepStrictEqual(cibles, [U(1), U(5), U(6)], "U(6) absent du serveur : banni par identifiant")
    assert.deepStrictEqual(exclus, { soi: 1, bot: 1, proprietaire: 1, hierarchie: 3 })
})

test("massban : tout est exclu -> rien n'est banni", async () => {
    const guild = serveurBan()
    const i = await lancerMassban(guild, { ids: `${MOD} ${BOT} ${PROPRIO}` })
    assert.ok(i.envois.at(-1).content.includes("Aucune cible valide"))
    assert.strictEqual(guild.bans.groupes.length, 0)
})

test("massban : aperçu, confirmation, ban groupé et une sanction par membre banni", async () => {
    const guild = serveurBan({ presents: { [U(1)]: { role: 1 }, [U(2)]: { role: 50 } }, echoue: [U(3)] })
    db.setTempban(guild.id, U(1), Date.now() + 100000)
    const i = await lancerMassban(guild, { ids: `${U(1)} ${U(2)} ${U(3)} ${U(4)}`, raison: "raid du soir" })

    const apercu = i.envois[0]
    assert.ok(apercu.content.includes("3 membre(s)"), "U(2) exclu : 3 cibles")
    assert.ok(apercu.content.includes("Exclus (1)"))
    assert.strictEqual(apercu.components[0].components.length, 2, "boutons Confirmer et Annuler")
    assert.deepStrictEqual(guild.bans.groupes.length, 1)
    assert.deepStrictEqual(guild.bans.groupes[0].ids, [U(1), U(3), U(4)])
    assert.strictEqual(guild.bans.groupes[0].options.deleteMessageSeconds, 0)
    assert.ok(guild.bans.groupes[0].options.reason.includes("Ban en masse : raid du soir"))

    assert.strictEqual(casDe(guild.id, U(1)).length, 1)
    assert.strictEqual(casDe(guild.id, U(1))[0].type, "ban")
    assert.strictEqual(casDe(guild.id, U(1))[0].reason, "Ban en masse : raid du soir")
    assert.strictEqual(casDe(guild.id, U(4)).length, 1)
    assert.strictEqual(casDe(guild.id, U(3)).length, 0, "pas de sanction pour un échec")
    assert.strictEqual(casDe(guild.id, U(2)).length, 0, "pas de sanction pour un exclu")
    assert.strictEqual(db.getTempban(guild.id, U(1)), null, "le ban définitif remplace le ban temporaire")
    assert.ok(i.envois.at(-1).content.includes("2 membre(s) banni(s), 1 échec(s)"))
})

test("massban : sans API de ban groupé, une boucle ; annulation et délai ne bannissent personne", async () => {
    const guild = serveurBan({ bulk: false, echoue: [U(2)] })
    await lancerMassban(guild, { ids: `${U(1)} ${U(2)}` })
    assert.deepStrictEqual(guild.bans.uns.map(b => b.id), [U(1)])
    assert.strictEqual(casDe(guild.id, U(1)).length, 1)
    assert.strictEqual(casDe(guild.id, U(2)).length, 0)

    for (const clic of ["non", null]) {
        const g = serveurBan()
        const i = await lancerMassban(g, { ids: U(7) }, { clic })
        assert.strictEqual(g.bans.groupes.length, 0)
        assert.strictEqual(casDe(g.id, U(7)).length, 0)
        assert.ok(i.envois.at(-1).content.includes(clic ? "annulé" : "Temps écoulé"))
    }
})

test("massban : si le ban en masse échoue globalement, repli un par un sur les mêmes cibles", async () => {
    const guild = serveurBan({ echoue: [U(2)] })
    guild.bans.bulkCreate = async () => { throw new Error("API indisponible") }
    const erreurs = console.error
    console.error = () => {}
    let i
    try {
        i = await lancerMassban(guild, { ids: `${U(1)} ${U(2)} ${U(3)}` })
    } finally {
        console.error = erreurs
    }
    assert.deepStrictEqual(guild.bans.uns.map(b => b.id), [U(1), U(3)])
    assert.strictEqual(casDe(guild.id, U(1)).length, 1)
    assert.strictEqual(casDe(guild.id, U(2)).length, 0)
    assert.ok(i.envois.at(-1).content.includes("2 membre(s) banni(s), 1 échec(s)"))
})

test("massban : depuis_minutes ne prend que les arrivées récentes humaines, avec les identifiants", async () => {
    const maintenant = Date.now()
    const guild = serveurBan({ presents: {
        [U(1)]: { arrive: maintenant - 60_000 }, [U(2)]: { arrive: maintenant - 3 * 3600_000 },
        [U(3)]: { arrive: maintenant - 30_000, bot: true }, [U(4)]: { arrive: maintenant - 10 * 60_000 }
    } })
    await lancerMassban(guild, { depuis_minutes: 15, ids: U(9) })
    assert.deepStrictEqual(guild.bans.groupes[0].ids.sort(), [U(1), U(4), U(9)].sort())
})

test("A8 : une sanction par ban réussi, écrite au fil de l'eau (repli un par un)", async () => {
    const guild = serveurBan({ bulk: false, echoue: [U(2)] })
    const ordre = []
    const create = guild.bans.create
    guild.bans.create = async (id, options) => {
        // Au moment de chaque ban, on note combien de sanctions sont déjà écrites
        ordre.push(`${id}:${[U(1), U(2), U(3)].filter(u => casDe(guild.id, u).length).length}`)
        return create(id, options)
    }
    await lancerMassban(guild, { ids: `${U(1)} ${U(2)} ${U(3)}` })
    assert.deepStrictEqual(ordre, [`${U(1)}:0`, `${U(2)}:1`, `${U(3)}:1`])
    assert.strictEqual(casDe(guild.id, U(1)).length, 1)
    assert.strictEqual(casDe(guild.id, U(2)).length, 0, "échec : pas de sanction")
    assert.strictEqual(casDe(guild.id, U(3)).length, 1)
})

test("A8 : ban groupé, une sanction par ban réussi, écrite dès la réponse de l'API ; une erreur d'écriture n'arrête pas les autres", async () => {
    const { bannirEnMasse } = cmdMassban
    const guild = serveurBan({ echoue: [U(2)] })
    const surBanni = []
    const r = await bannirEnMasse(guild, [U(1), U(2), U(3)], "raison", id => surBanni.push(id))
    assert.deepStrictEqual(surBanni, [U(1), U(3)], "appelé pour chaque ban réussi, pas pour l'échec")
    assert.deepStrictEqual(r, { bannis: [U(1), U(3)], echecs: [U(2)] })

    // Identifiant renvoyé deux fois, ou étranger à la liste : une seule sanction, seulement pour une cible
    const g2 = serveurBan()
    g2.bans.bulkCreate = async () => ({ bannedUsers: [U(5), U(5), U(6), U(99)] })
    const vus = []
    const erreurs = console.error
    console.error = () => {}
    try {
        await bannirEnMasse(g2, [U(5), U(6)], "raison", id => { vus.push(id); if (id === U(5)) throw new Error("base verrouillée") })
    } finally {
        console.error = erreurs
    }
    assert.deepStrictEqual(vus, [U(5), U(6)])

    // Via la commande : une case par membre banni
    const g3 = serveurBan()
    await lancerMassban(g3, { ids: `${U(1)} ${U(2)}` })
    assert.strictEqual(casDe(g3.id, U(1)).length, 1)
    assert.strictEqual(casDe(g3.id, U(2)).length, 1)
})
