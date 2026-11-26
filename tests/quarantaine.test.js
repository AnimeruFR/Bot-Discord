process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const q = require('../Fonctions/quarantaine')
const { controler } = require('../Fonctions/garde')
const { onClicRole } = require('../Fonctions/rolesBoutons')
const { setSalonFamille } = require('../Fonctions/logs')
const evenementMiseAJour = require('../Events/guildMemberUpdate')
const { erreurDiscord, chargerCommandes } = require('./aides')

const { Flags } = Discord.PermissionsBitField
const BOT = "900000000000000001", MOD = "800000000000000001", OWNER = "800000000000000099"
let compteur = 0
const nouvelId = () => String(600000000000000000n + BigInt(++compteur))

// Faux rôle : position, permissions, intégration (managed)
function faussRole(id, position, { managed = false, perms = 0n } = {}) {
    return { id, name: `role-${id.slice(-3)}`, position, managed, permissions: new Discord.PermissionsBitField(perms), comparePositionTo: autre => position - autre.position }
}
const plusHaut = roles => roles.reduce((a, b) => (b.position > a.position ? b : a))

// Faux serveur avec @everyone, des rôles et le bot (position 10). Le bot a « Gérer les rôles ».
function fauxServeur(rolesDefs) {
    const G = nouvelId()
    const roles = new Discord.Collection([[G, faussRole(G, 0)]])
    for (const [nom, position, opts] of rolesDefs) roles.set(nom, faussRole(nom, position, opts))
    const guild = {
        id: G, ownerId: OWNER, name: "Serveur", roles: { cache: roles }, channels: { cache: new Discord.Collection() },
        members: {
            cache: new Discord.Collection(), me: { id: BOT, roles: { highest: faussRole("bot", 10) }, permissions: new Discord.PermissionsBitField(Flags.ManageRoles) },
            fetch: async ({ user }) => {
                const m = guild.membres.get(user)
                if (!m) throw erreurDiscord(Discord.RESTJSONErrorCodes.UnknownMember)
                return m
            }
        },
        membres: new Map()
    }
    for (const role of [...roles.values(), guild.members.me.roles.highest]) role.guild = guild
    guild.members.me.guild = guild
    return guild
}

// Faux membre : roles.set applique le changement, ou échoue (echec = nombre d'appels qui échouent)
function fauxMembre(guild, roleIds, { echec = 0, manageable = true } = {}) {
    const membre = {
        id: nouvelId(), manageable, appels: [], retraits: [], user: null,
        roles: {
            cache: new Discord.Collection([guild.id, ...roleIds].map(r => [r, guild.roles.cache.get(r)])),
            get highest() { return plusHaut([...membre.roles.cache.values()]) },
            set: async (ids, raison) => {
                // Au moment du retrait, la sauvegarde doit déjà être en base
                membre.appels.push({ ids: [...ids], enBase: db.sqlAll("SELECT * FROM quarantines WHERE guild_id = ? AND user_id = ?", [guild.id, membre.id]).length === 1, raison })
                if (membre.appels.length <= echec) throw new Error("Missing Permissions")
                membre.roles.cache = new Discord.Collection([[guild.id, guild.roles.cache.get(guild.id)], ...ids.map(r => [r, guild.roles.cache.get(r)])])
                return membre
            },
            add: async id => { membre.roles.cache.set(id, guild.roles.cache.get(id)) },
            remove: async ids => {
                membre.retraits.push([].concat(ids))
                for (const id of [].concat(ids)) membre.roles.cache.delete(id)
            }
        }
    }
    membre.guild = guild
    membre.user = { id: membre.id, tag: "membre#0", send: async texte => { membre.mps.push(texte) }, toString: () => `<@${membre.id}>` }
    membre.mps = []
    guild.membres.set(membre.id, membre)
    return membre
}

// Faux modérateur : rôle le plus haut et permissions
function interaction(guild, { position = 20, perms = Flags.ModerateMembers | Flags.ManageRoles, id = MOD } = {}) {
    const moi = faussRole(`mod${id}`, position)
    return {
        guild, guildId: guild.id, channelId: "333333333333333333", user: { id, tag: "mod#0" }, locale: "fr", client: { user: { id: BOT } },
        inGuild: () => true, memberPermissions: new Discord.PermissionsBitField(perms),
        member: { id, guild, permissions: new Discord.PermissionsBitField(perms), roles: { highest: moi, cache: new Set() } }
    }
}

const ROLES = [["iso", 2], ["a", 3], ["b", 4], ["c", 5], ["booster", 6, { managed: true }], ["hautbot", 12], ["suppr", 7]]
// Les identifiants de rôle doivent ressembler à des identifiants Discord
const R = Object.fromEntries(["iso", "a", "b", "c", "booster", "hautbot", "suppr"].map(n => [n, nouvelId()]))
const defs = () => ROLES.map(([n, pos, opts]) => [R[n], pos, opts])

function serveurConfigure() {
    const guild = fauxServeur(defs())
    db.sqlRun("INSERT INTO quarantine_config (guild_id, role_id) VALUES (?, ?)", [guild.id, R.iso])
    return guild
}

test("/quarantaine : refusé sans ModerateMembers ET ManageRoles (garde commune)", async () => {
    const commande = chargerCommandes().commands.get("quarantaine")
    assert.strictEqual(commande.module, "moderation")
    const faire = perms => ({
        guildId: "700000000000000001", channelId: "333333333333333333", user: { id: MOD }, locale: "fr", inGuild: () => true,
        memberPermissions: new Discord.PermissionsBitField(perms), member: { roles: { cache: new Set() } }
    })
    assert.ok(await controler(faire(Flags.KickMembers | Flags.BanMembers), commande), "sans droit : refusé")
    assert.ok(await controler(faire(Flags.ModerateMembers), commande), "sans « Gérer les rôles » : refusé")
    assert.ok(await controler(faire(Flags.ManageRoles), commande), "sans « Exclure temporairement » : refusé")
    assert.strictEqual(await controler(faire(Flags.ModerateMembers | Flags.ManageRoles), commande), null)
})

test("config : rôle dangereux, supérieur, @everyone, intégration ou hors de portée du bot refusés", async () => {
    const guild = fauxServeur([
        [R.iso, 2], [R.a, 30], ["admin", 3, { perms: Flags.Administrator }], ["modo", 3, { perms: Flags.BanMembers }],
        ["invite", 3, { perms: Flags.CreateInstantInvite }], ["integration", 3, { managed: true }], ["hautbot", 12], ["parle", 3, { perms: Flags.SendMessages | Flags.ViewChannel }]
    ])
    const refus = (role, opts) => q.refusRoleIsole(interaction(guild, opts), guild.roles.cache.get(role))
    assert.strictEqual(refus("parle"), null, "rôle sans pouvoir : accepté")
    assert.ok(refus(guild.id), "@everyone refusé")
    assert.ok(refus("integration"), "rôle d'intégration refusé")
    assert.ok(refus("admin"), "administrateur refusé")
    assert.ok(refus("modo"), "permission de modération refusée")
    assert.ok(refus("invite"), "créer des invitations refusé")
    assert.ok(refus(R.a), "rôle plus haut que celui qui configure refusé")
    assert.ok(refus("hautbot"), "rôle au-dessus du bot refusé")
    assert.ok(refus("parle", { perms: Flags.ModerateMembers }), "configurateur sans « Gérer les rôles » refusé")
    assert.strictEqual(refus("parle", { perms: Flags.ModerateMembers, id: OWNER }), null, "le propriétaire configure toujours (il a tous les droits)")
    guild.members.me.permissions = new Discord.PermissionsBitField(0n)
    assert.ok(refus("parle"), "bot sans « Gérer les rôles » : refusé")
    assert.strictEqual(db.sqlAll("SELECT * FROM quarantine_config WHERE guild_id = ?", [guild.id]).length, 0, "rien n'est enregistré par un refus")
})

test("config : enregistrée, puis changement refusé tant que des membres sont en quarantaine", async () => {
    const guild = fauxServeur([...defs(), ["autre", 2]])
    const i = interaction(guild)
    assert.deepStrictEqual(await q.changerRoleIsole(i, guild.roles.cache.get(R.iso)), { ok: true })
    assert.strictEqual(q.getRoleIsole(guild.id), R.iso)
    assert.deepStrictEqual(await q.changerRoleIsole(i, guild.roles.cache.get(R.iso)), { inchange: true })
    const membre = fauxMembre(guild, [R.a])
    assert.ok(!(await q.mettre(i, membre.user, "test")).erreur)
    assert.ok((await q.changerRoleIsole(i, guild.roles.cache.get("autre"))).erreur, "changement refusé")
    assert.strictEqual(q.getRoleIsole(guild.id), R.iso)
})

test("mettre : rôles sauvegardés AVANT le retrait, rôles non retirables conservés", async () => {
    const guild = serveurConfigure()
    const membre = fauxMembre(guild, [R.a, R.b, R.booster, R.hautbot])
    const r = await q.mettre(interaction(guild), membre.user, "  spam de liens ")
    assert.ok(!r.erreur, r.erreur)
    assert.strictEqual(membre.appels.length, 1)
    assert.ok(membre.appels[0].enBase, "la ligne existe déjà quand les rôles sont retirés")
    // Reste : rôle isolé + rôle d'intégration (booster) + rôle au-dessus du bot
    assert.deepStrictEqual(membre.appels[0].ids.sort(), [R.iso, R.booster, R.hautbot].sort())
    const ligne = q.getQuarantine(guild.id, membre.id)
    assert.deepStrictEqual(ligne.roles.sort(), [R.a, R.b].sort(), "seuls les rôles retirables sont sauvegardés (pas @everyone)")
    assert.strictEqual(ligne.moderator_id, MOD)
    assert.strictEqual(ligne.reason, "spam de liens")
    assert.strictEqual(r.retires, 2)
    assert.strictEqual(r.gardes, 2)
    assert.strictEqual(r.prevenu, true)
    assert.strictEqual(membre.mps.length, 1)
    const cas = db.listCases(guild.id, membre.id)
    assert.strictEqual(cas.length, 1)
    assert.strictEqual(cas[0].type, "quarantaine")
})

test("mettre : déjà en quarantaine, hiérarchie, bot, rôle non configuré, membre absent", async () => {
    const guild = serveurConfigure()
    const membre = fauxMembre(guild, [R.a])
    const i = interaction(guild)
    assert.ok(!(await q.mettre(i, membre.user, null)).erreur)
    const deuxieme = await q.mettre(i, membre.user, null)
    assert.match(deuxieme.erreur, /déjà en quarantaine/)
    assert.strictEqual(membre.appels.length, 1, "aucun nouveau retrait de rôles")
    assert.strictEqual(db.listCases(guild.id, membre.id).length, 1, "un seul dossier")

    const egal = fauxMembre(guild, [R.a])
    assert.ok((await q.mettre(interaction(guild, { position: 3 }), egal.user, null)).erreur, "rôle supérieur ou égal : refusé")
    assert.strictEqual(q.getQuarantine(guild.id, egal.id), null)
    for (const [cible, motif] of [[MOD, "soi-même"], [BOT, "le bot"], [OWNER, "le propriétaire"]]) {
        const m = fauxMembre(guild, [R.a])
        guild.membres.delete(m.id)
        m.id = m.user.id = cible
        guild.membres.set(cible, m)
        assert.ok((await q.mettre(i, m.user, null)).erreur, `${motif} : refusé`)
        assert.strictEqual(m.appels.length, 0)
    }
    assert.match((await q.mettre(i, { id: nouvelId() }, null)).erreur, /pas sur le serveur/)
    const intouchable = fauxMembre(guild, [R.a], { manageable: false })
    assert.ok((await q.mettre(i, intouchable.user, null)).erreur)
    assert.strictEqual(intouchable.appels.length, 0)

    const sansConfig = fauxServeur(defs())
    assert.match((await q.mettre(interaction(sansConfig), fauxMembre(sansConfig, [R.a]).user, null)).erreur, /Aucun rôle isolé/)
})

test("rôle isolé au-dessus du modérateur : refusé à la config et à la mise en quarantaine", async () => {
    const guild = serveurConfigure()
    // Le rôle isolé monte à la position 4 : un modérateur en position 3 ne peut plus le donner
    guild.roles.cache.get(R.iso).position = 4
    guild.roles.cache.get(R.iso).comparePositionTo = autre => 4 - autre.position
    const bas = interaction(guild, { position: 3 })
    assert.match(q.refusRoleIsole(bas, guild.roles.cache.get(R.iso)), /supérieur ou égal à votre rôle/)
    const membre = fauxMembre(guild, [R.a])
    const r = await q.mettre(bas, membre.user, null)
    assert.match(r.erreur, /supérieur ou égal à votre rôle/)
    assert.strictEqual(membre.appels.length, 0, "aucun rôle touché")
    assert.strictEqual(q.getQuarantine(guild.id, membre.id), null, "rien d'enregistré")
    // Sans « Gérer les rôles » : refusé aussi, avec le bon message
    const sansDroit = interaction(guild, { perms: Flags.ModerateMembers })
    assert.match((await q.mettre(sansDroit, membre.user, null)).erreur, /Gérer les rôles/)
    // Un modérateur assez haut peut isoler
    assert.ok(!(await q.mettre(interaction(guild, { position: 20 }), membre.user, null)).erreur)
    // Le bot lui-même doit pouvoir donner le rôle
    const autre = fauxMembre(guild, [R.a])
    guild.members.me.roles.highest = faussRole("bot", 3)
    guild.members.me.roles.highest.guild = guild
    assert.match((await q.mettre(interaction(guild, { position: 20 }), autre.user, null)).erreur, /Je ne peux pas donner ce rôle/)
})

test("surcharge de salon dangereuse sur le rôle isolé : refusée à la config et à la mise en quarantaine", async () => {
    const guild = fauxServeur(defs())
    const salon = { id: nouvelId(), permissionOverwrites: { cache: new Discord.Collection([[R.iso, { allow: new Discord.PermissionsBitField(Flags.ManageMessages) }]]) } }
    guild.channels.cache.set(salon.id, salon)
    const i = interaction(guild)
    const config = await q.changerRoleIsole(i, guild.roles.cache.get(R.iso))
    assert.match(config.erreur, /Refusé/)
    assert.ok(config.erreur.includes(`<#${salon.id}>`), "le salon est nommé")
    assert.strictEqual(q.getRoleIsole(guild.id), null, "rien n'est enregistré")

    // Rôle déjà configuré, surcharge ajoutée depuis : la mise en quarantaine est refusée et rien n'est touché
    db.sqlRun("INSERT INTO quarantine_config (guild_id, role_id) VALUES (?, ?)", [guild.id, R.iso])
    const membre = fauxMembre(guild, [R.a])
    const r = await q.mettre(i, membre.user, null)
    assert.match(r.erreur, /Refusé/)
    assert.strictEqual(membre.appels.length, 0, "aucun rôle touché")
    assert.strictEqual(q.getQuarantine(guild.id, membre.id), null, "rien d'enregistré")

    // Surcharge sans permission dangereuse : acceptée
    salon.permissionOverwrites.cache.set(R.iso, { allow: new Discord.PermissionsBitField(Flags.ViewChannel) })
    assert.ok(!(await q.mettre(i, membre.user, null)).erreur)
})

test("mettre : reprise après un arrêt entre l'écriture et roles.set (ligne sans rôle isolé)", async () => {
    const guild = serveurConfigure()
    const membre = fauxMembre(guild, [R.a, R.b])
    // Crash simulé : la ligne est écrite (avec R.a seulement), roles.set n'a jamais eu lieu
    db.sqlRun("INSERT INTO quarantines (guild_id, user_id, roles, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [guild.id, membre.id, JSON.stringify([R.a]), "800000000000000002", "ancienne raison", Date.now() - 1000])
    assert.ok(!membre.roles.cache.has(R.iso))

    const r = await q.mettre(interaction(guild), membre.user, "reprise")
    assert.ok(!r.erreur, r.erreur)
    assert.strictEqual(membre.appels.length, 1, "l'isolement est repris")
    assert.deepStrictEqual(membre.appels[0].ids, [R.iso])
    assert.ok(membre.roles.cache.has(R.iso))
    const ligne = q.getQuarantine(guild.id, membre.id)
    assert.deepStrictEqual(ligne.roles.sort(), [R.a, R.b].sort(), "sauvegarde complétée avec les rôles du membre")
    assert.strictEqual(ligne.moderator_id, MOD)
    assert.strictEqual(db.listCases(guild.id, membre.id).length, 1, "le dossier est créé maintenant")
    assert.strictEqual(db.sqlAll("SELECT * FROM quarantines WHERE guild_id = ? AND user_id = ?", [guild.id, membre.id]).length, 1, "une seule ligne")
    // Maintenant le rôle isolé est posé : « déjà en quarantaine »
    assert.match((await q.mettre(interaction(guild), membre.user, null)).erreur, /déjà en quarantaine/)

    // Échec de la reprise : la sauvegarde existante est gardée
    const autre = fauxMembre(guild, [R.a], { echec: 1 })
    db.sqlRun("INSERT INTO quarantines (guild_id, user_id, roles, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [guild.id, autre.id, JSON.stringify([R.a]), MOD, "x", Date.now()])
    const log = console.error
    console.error = () => {}
    const echec = await q.mettre(interaction(guild), autre.user, null)
    console.error = log
    assert.match(echec.erreur, /reste enregistrée/)
    assert.ok(q.getQuarantine(guild.id, autre.id), "ligne conservée")
})

test("mettre : rôle isolé devenu dangereux depuis la configuration : refusé", async () => {
    const guild = serveurConfigure()
    guild.roles.cache.get(R.iso).permissions = new Discord.PermissionsBitField(Flags.BanMembers)
    const membre = fauxMembre(guild, [R.a])
    assert.ok((await q.mettre(interaction(guild), membre.user, null)).erreur)
    assert.strictEqual(membre.appels.length, 0)
    assert.strictEqual(q.getQuarantine(guild.id, membre.id), null)
})

test("mettre : échec de roles.set -> rôles restaurés, rien en base, pas de dossier", async () => {
    const guild = serveurConfigure()
    const membre = fauxMembre(guild, [R.a, R.b], { echec: 1 })
    const log = console.error
    console.error = () => {}
    const r = await q.mettre(interaction(guild), membre.user, "test")
    console.error = log
    assert.match(r.erreur, /rien n'a été enregistré/)
    assert.strictEqual(q.getQuarantine(guild.id, membre.id), null, "aucune ligne en base")
    assert.strictEqual(db.listCases(guild.id, membre.id).length, 0, "aucun dossier")
    assert.strictEqual(membre.mps.length, 0, "aucun message privé")
    assert.strictEqual(membre.appels.length, 2, "une restauration est tentée")
    assert.deepStrictEqual(membre.appels[1].ids.sort(), [R.a, R.b].sort(), "avec les rôles d'origine")
    assert.deepStrictEqual([...membre.roles.cache.keys()].sort(), [guild.id, R.a, R.b].sort())
    // Le membre peut être mis en quarantaine ensuite : aucune trace du premier essai
    assert.ok(!(await q.mettre(interaction(guild), membre.user, "test")).erreur)
})

test("mettre : message privé impossible = échec silencieux", async () => {
    const guild = serveurConfigure()
    const membre = fauxMembre(guild, [R.a])
    membre.user.send = async () => { throw new Error("DM fermés") }
    const r = await q.mettre(interaction(guild), membre.user, null)
    assert.ok(!r.erreur)
    assert.strictEqual(r.prevenu, false)
    assert.ok(q.getQuarantine(guild.id, membre.id))
})

test("lever : rôles restaurés, rôle isolé retiré, ligne supprimée, dossier de fin", async () => {
    const guild = serveurConfigure()
    const membre = fauxMembre(guild, [R.a, R.b, R.booster])
    const i = interaction(guild)
    await q.mettre(i, membre.user, "test")
    assert.deepStrictEqual([...membre.roles.cache.keys()].sort(), [guild.id, R.iso, R.booster].sort())

    const r = await q.lever(i, membre.user)
    assert.ok(!r.erreur, r.erreur)
    assert.deepStrictEqual([...membre.roles.cache.keys()].sort(), [guild.id, R.a, R.b, R.booster].sort(), "rôles rendus, rôle isolé retiré")
    assert.strictEqual(r.restaures, 2)
    assert.strictEqual(r.supprimes, 0)
    assert.strictEqual(q.getQuarantine(guild.id, membre.id), null)
    assert.deepStrictEqual(db.listCases(guild.id, membre.id).map(c => c.type).sort(), ["fin_quarantaine", "quarantaine"])
    assert.match((await q.lever(i, membre.user)).erreur, /pas en quarantaine/)
})

test("lever : un rôle supprimé entre-temps est ignoré et signalé", async () => {
    const guild = serveurConfigure()
    const membre = fauxMembre(guild, [R.a, R.suppr])
    const i = interaction(guild)
    await q.mettre(i, membre.user, null)
    guild.roles.cache.delete(R.suppr)
    const r = await q.lever(i, membre.user)
    assert.ok(!r.erreur, r.erreur)
    assert.strictEqual(r.supprimes, 1)
    assert.strictEqual(r.restaures, 1)
    assert.deepStrictEqual([...membre.roles.cache.keys()].sort(), [guild.id, R.a].sort())
    assert.strictEqual(q.getQuarantine(guild.id, membre.id), null)
})

test("lever : jamais plus de pouvoir que celui qui lève (rôle sauvegardé au-dessus du sien)", async () => {
    const guild = serveurConfigure()
    const membre = fauxMembre(guild, [R.a, R.c])
    await q.mettre(interaction(guild, { position: 20 }), membre.user, null)
    // Un modérateur plus bas (position 4) ne peut pas rendre le rôle c (position 5)
    const bas = interaction(guild, { position: 4, id: "800000000000000002" })
    const r = await q.lever(bas, membre.user)
    assert.match(r.erreur, /plus haut placé/)
    assert.ok(q.getQuarantine(guild.id, membre.id), "la quarantaine reste")
    assert.ok(membre.roles.cache.has(R.iso), "aucun rôle n'a été touché")
    // Un modérateur assez haut peut lever
    assert.ok(!(await q.lever(interaction(guild, { position: 20 }), membre.user)).erreur)
    // Le propriétaire lève toujours
    const autre = fauxMembre(guild, [R.c])
    await q.mettre(interaction(guild, { position: 20 }), autre.user, null)
    assert.ok(!(await q.lever(interaction(guild, { position: 1, id: OWNER }), autre.user)).erreur)
})

test("lever : échec de Discord -> la sauvegarde reste, on peut réessayer", async () => {
    const guild = serveurConfigure()
    const membre = fauxMembre(guild, [R.a], { echec: 0 })
    const i = interaction(guild)
    await q.mettre(i, membre.user, null)
    const set = membre.roles.set
    membre.roles.set = async () => { throw new Error("Missing Permissions") }
    const log = console.error
    console.error = () => {}
    const r = await q.lever(i, membre.user)
    console.error = log
    assert.match(r.erreur, /toujours en place/)
    assert.ok(q.getQuarantine(guild.id, membre.id), "ligne conservée")
    membre.roles.set = set
    assert.ok(!(await q.lever(i, membre.user)).erreur)
})

test("lever : membre parti = suppression de la ligne seulement", async () => {
    const guild = serveurConfigure()
    const membre = fauxMembre(guild, [R.a])
    const i = interaction(guild)
    await q.mettre(i, membre.user, null)
    guild.membres.delete(membre.id)
    const appelsAvant = membre.appels.length
    const r = await q.lever(i, membre.user)
    assert.deepStrictEqual(r, { absent: true })
    assert.strictEqual(q.getQuarantine(guild.id, membre.id), null)
    assert.strictEqual(membre.appels.length, appelsAvant, "aucun appel à Discord pour les rôles")
    assert.deepStrictEqual(db.listCases(guild.id, membre.id).map(c => c.type), ["quarantaine"], "pas de dossier de fin")
})

test("retour d'un membre en quarantaine : le rôle isolé est remis, la sauvegarde gardée", async () => {
    const guild = serveurConfigure()
    const membre = fauxMembre(guild, [R.a])
    await q.mettre(interaction(guild), membre.user, null)
    // Il part puis revient sans aucun rôle
    membre.roles.cache = new Discord.Collection([[guild.id, guild.roles.cache.get(guild.id)]])
    assert.strictEqual(await q.reappliquer(membre), true)
    assert.ok(membre.roles.cache.has(R.iso))
    assert.deepStrictEqual(q.getQuarantine(guild.id, membre.id).roles, [R.a])
    assert.strictEqual(await q.reappliquer(fauxMembre(guild, [])), false, "membre normal : rien")
    guild.roles.cache.get(R.iso).permissions = new Discord.PermissionsBitField(Flags.Administrator)
    membre.roles.cache.delete(R.iso)
    assert.strictEqual(await q.reappliquer(membre), false, "rôle isolé devenu dangereux : jamais redonné")
})

test("/quarantaine : mettre, liste et lever par la commande", async () => {
    const commande = chargerCommandes().commands.get("quarantaine")
    const guild = serveurConfigure()
    const membre = fauxMembre(guild, [R.a])
    const textes = []
    const lancer = async options => {
        const i = {
            ...interaction(guild), textes, deferred: false, ephemeral: false,
            deferReply: async (o = {}) => { i.deferred = true; i.ephemeral = Boolean(o.flags) },
            editReply: async r => { textes.push(typeof r === "string" ? r : r.content) },
            reply: async r => { textes.push(r.content) }, followUp: async r => { textes.push(r.content) }, deleteReply: async () => {}
        }
        const args = {
            getString: n => options[n] ?? null, getUser: () => options.membre ?? null, getRole: () => options.role ?? null,
            getChannel: () => null, getBoolean: () => null
        }
        await commande.run({ user: { id: BOT } }, i, args)
        return textes.at(-1)
    }
    assert.match(await lancer({ action: "liste" }), /Aucun membre/)
    assert.match(await lancer({ action: "mettre" }), /option `membre`/)
    assert.match(await lancer({ action: "mettre", membre: membre.user, raison: "test" }), /en quarantaine : 1 rôle/)
    assert.match(await lancer({ action: "liste" }), new RegExp(`<@${membre.id}>`))
    assert.match(await lancer({ action: "config" }), /Le rôle isolé actuel/)
    assert.match(await lancer({ action: "lever", membre: membre.user }), /1 rôle\(s\) rendu/)
    assert.match(await lancer({ action: "lever", membre: membre.user }), /pas en quarantaine/)
})

// Faux salon de logs : garde les messages envoyés dans la famille « sanctions »
function salonDeLogs(guild) {
    const id = nouvelId()
    const envois = []
    guild.channels.cache.set(id, { id, isTextBased: () => true, permissionsFor: () => ({ has: () => true }), send: async m => { envois.push(m) } })
    setSalonFamille(guild.id, "sanctions", id)
    return envois
}
const champs = envois => envois.flatMap(m => m.embeds[0].data.fields).map(f => f.value).join("\n")

test("rôle-bouton : refusé à un membre en quarantaine, donné à un membre normal", async () => {
    const guild = serveurConfigure()
    const message = nouvelId()
    db.addRolePanel(guild.id, { messageId: message, channelId: "c", titre: "Couleurs", mode: "multiple" })
    db.addRoleButton(guild.id, message, R.c, "C")
    const reponses = []
    const clic = membre => ({
        customId: `role:${R.c}`, inCachedGuild: () => true, user: membre.user, guild, locale: "fr", message: { id: message, url: "lien" }, member: membre,
        reply: async r => reponses.push(r.content), deferReply: async () => {}, editReply: async r => reponses.push(r)
    })
    const libre = fauxMembre(guild, [])
    await onClicRole({ user: { id: BOT } }, clic(libre))
    assert.ok(libre.roles.cache.has(R.c), "membre normal : rôle donné")

    const membre = fauxMembre(guild, [R.a])
    await q.mettre(interaction(guild), membre.user, "test")
    reponses.length = 0
    await onClicRole({ user: { id: BOT } }, clic(membre))
    assert.ok(!membre.roles.cache.has(R.c), "en quarantaine : aucun rôle donné")
    assert.match(reponses[0], /en quarantaine/)
})

test("rôle ajouté pendant la quarantaine : retiré, sauvegardé pour la levée, sans boucle", async () => {
    const guild = serveurConfigure()
    const envois = salonDeLogs(guild)
    const membre = fauxMembre(guild, [R.a])
    const i = interaction(guild)
    await q.mettre(i, membre.user, "test")
    // Un autre bot donne un rôle normal, un rôle d'intégration et un rôle plus haut que le bot
    for (const id of [R.b, R.booster, R.hautbot]) membre.roles.cache.set(id, guild.roles.cache.get(id))
    await evenementMiseAJour({ user: { id: BOT } }, { partial: true }, membre)
    assert.deepStrictEqual(membre.retraits, [[R.b]], "seul le rôle retirable est retiré")
    assert.ok(membre.roles.cache.has(R.iso), "le rôle isolé reste")
    assert.deepStrictEqual(q.getQuarantine(guild.id, membre.id).roles.sort(), [R.a, R.b].sort())
    assert.match(champs(envois), new RegExp(R.b))
    // Le retrait redéclenche l'événement : plus rien à retirer
    await evenementMiseAJour({ user: { id: BOT } }, { partial: true }, membre)
    assert.strictEqual(membre.retraits.length, 1, "pas de boucle")
    // La levée rend le rôle ajouté
    const r = await q.lever(i, membre.user)
    assert.strictEqual(r.restaures, 2)
    assert.ok(membre.roles.cache.has(R.b) && membre.roles.cache.has(R.a))
    // Après la levée (plus de rôle isolé, plus de ligne) : rien n'est retiré
    await evenementMiseAJour({ user: { id: BOT } }, { partial: true }, membre)
    assert.strictEqual(membre.retraits.length, 1)
    // Un membre normal n'est jamais touché
    const normal = fauxMembre(guild, [R.a, R.b])
    await evenementMiseAJour({ user: { id: BOT } }, { partial: true }, normal)
    assert.strictEqual(normal.retraits.length, 0)
})

test("lever : les rôles non rendus (supprimé, géré) sont listés dans le log et dans le dossier", async () => {
    const guild = serveurConfigure()
    const envois = salonDeLogs(guild)
    const membre = fauxMembre(guild, [R.a, R.b, R.suppr])
    const i = interaction(guild)
    await q.mettre(i, membre.user, null)
    guild.roles.cache.delete(R.suppr)
    guild.roles.cache.get(R.b).managed = true // devenu rôle d'intégration : le bot ne peut plus le donner
    const r = await q.lever(i, membre.user)
    assert.ok(!r.erreur, r.erreur)
    assert.strictEqual(r.supprimes, 1)
    assert.strictEqual(r.impossibles, 1)
    assert.strictEqual(r.nonRendus.length, 2)
    const dossier = db.listCases(guild.id, membre.id).find(c => c.type === "fin_quarantaine")
    assert.ok(dossier.reason.includes(R.suppr) && dossier.reason.includes(R.b), "ids dans la raison du dossier")
    assert.ok(dossier.reason.includes("role-"), "nom du rôle dans la raison du dossier")
    assert.ok(dossier.reason.length <= 400)
    assert.ok(champs(envois).includes(R.suppr) && champs(envois).includes(R.b), "ids dans le log")
})

test("reappliquer : si le rôle isolé ne peut pas être donné, une alerte part dans les logs", async () => {
    const guild = serveurConfigure()
    const envois = salonDeLogs(guild)
    const membre = fauxMembre(guild, [R.a])
    await q.mettre(interaction(guild), membre.user, null)
    membre.roles.cache = new Discord.Collection([[guild.id, guild.roles.cache.get(guild.id)]])
    membre.roles.add = async () => { throw new Error("Missing Permissions") }
    envois.length = 0
    const log = console.error
    console.error = () => {}
    const ok = await q.reappliquer(membre)
    console.error = log
    assert.strictEqual(ok, false)
    assert.strictEqual(envois.length, 1)
    assert.match(champs(envois), /Alerte/)
    assert.match(champs(envois), /Missing Permissions/)
})
