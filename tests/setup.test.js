process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const cfg = require('../Fonctions/config')
const logs = require('../Fonctions/logs')
const { getFiltreComptes } = require('../Fonctions/antiraid')
const { controler } = require('../Fonctions/garde')
const { chargerCommandes } = require('./aides')
const guildCreate = require('../Events/guildCreate')

const { Flags } = Discord.PermissionsBitField
const bot = chargerCommandes()
const G = "666666666666666601", MOD = "444444444444444444"

// Faux salon textuel
const salon = (id, envoyes = []) => ({
    id, type: Discord.ChannelType.GuildText, name: "salon", topic: null,
    isTextBased: () => true, toString: () => `<#${id}>`,
    permissionsFor: () => ({ has: () => true }),
    send: async () => envoyes.push(id)
})
// Faux rôle : seules l'identité, la position et les permissions comptent
const role = (id, position, perms = 0n, managed = false) => ({
    id, position, managed, permissions: new Discord.PermissionsBitField(perms), comparePositionTo: autre => position - autre.position, toString: () => `<@&${id}>`
})

function faux({ perms = [], userId = MOD, roles = [], salons = [] } = {}) {
    const reponses = []
    const guild = {
        id: G, ownerId: "owner",
        roles: { everyone: {}, cache: new Discord.Collection(roles.map(r => [r.id, r])) },
        channels: { cache: new Discord.Collection(salons.map(s => [s.id, s])) },
        members: { me: { permissions: new Discord.PermissionsBitField([Flags.ManageRoles, Flags.KickMembers]), roles: { highest: { position: 10 } } } }
    }
    return {
        reponses, reply: async r => reponses.push(r), guild, guildId: G, channelId: "333333333333333333", locale: "fr",
        user: { id: userId, toString: () => `<@${userId}>` }, inGuild: () => true,
        memberPermissions: new Discord.PermissionsBitField(perms), member: { roles: { cache: new Set(), highest: { position: 5 } } },
        client: { commands: bot.commands }
    }
}

test("/setup et /setlogs refusés à un membre sans « Gérer le serveur »", async () => {
    for (const nom of ["setup", "setlogs"]) {
        const commande = bot.commands.get(nom)
        assert.ok(commande, `/${nom} existe`)
        assert.ok(await controler(faux({ perms: [Flags.SendMessages] }), commande), `/${nom} : refusé sans droit`)
        assert.strictEqual(await controler(faux({ perms: [Flags.ManageGuild] }), commande), null, `/${nom} : autorisé avec « Gérer le serveur »`)
    }
})

test("salon de logs par famille : enregistré, retiré, tracé", async () => {
    const envoyes = []
    const general = salon("111111111111111190", envoyes), sanctions = salon("111111111111111191", envoyes), ticket = salon("111111111111111192")
    ticket.name = "ticket-bob"
    ticket.topic = "123456789012345678"
    const i = faux({ salons: [general, sanctions, ticket] })

    db.setLogChannel(G, general.id)
    assert.ok((await cfg.changerSalonFamille(i, "inconnue", sanctions)).erreur, "famille inconnue refusée")
    assert.ok((await cfg.changerSalonFamille(i, "sanctions", ticket)).erreur, "salon de ticket refusé comme pour le salon général")
    assert.deepStrictEqual(await cfg.changerSalonFamille(i, "sanctions", null), { inchange: true })

    assert.strictEqual((await cfg.changerSalonFamille(i, "sanctions", sanctions)).ok, true)
    assert.strictEqual(logs.salonsFamilles(G).sanctions, sanctions.id)
    assert.strictEqual(logs.getLogChannel(i.guild, "sanctions").id, sanctions.id)
    assert.strictEqual(logs.getLogChannel(i.guild, "automod").id, general.id, "les autres familles restent sur le salon général")
    assert.ok(envoyes.length >= 2, "changement tracé (avant et après)")

    assert.strictEqual((await cfg.changerSalonFamille(i, "sanctions", null)).ok, true)
    assert.strictEqual(logs.salonsFamilles(G).sanctions, undefined)
    assert.strictEqual(logs.getLogChannel(i.guild, "sanctions").id, general.id, "retour au salon général")
})

test("jeux et économie : jamais de repli sur le salon général", async () => {
    const general = salon("111111111111111193"), dedie = salon("111111111111111194")
    const i = faux({ salons: [general, dedie] })
    db.setLogChannel(G, general.id)
    logs.setSalonFamille(G, "jeux", null)
    assert.strictEqual(logs.getLogChannel(i.guild, "jeux"), null)
    assert.strictEqual(logs.getLogChannel(i.guild, "economie"), null)
    assert.strictEqual((await cfg.changerSalonFamille(i, "jeux", dedie)).ok, true)
    assert.strictEqual(logs.getLogChannel(i.guild, "jeux").id, dedie.id)
    assert.strictEqual((await cfg.changerSalonFamille(i, "jeux", null)).ok, true)
    assert.strictEqual(logs.getLogChannel(i.guild, "jeux"), null, "retirer le salon coupe les logs de jeux")
})

test("filtre des comptes récents : rôle dangereux, rôle trop haut et âge hors bornes refusés", async () => {
    const sage = role("111111111111111200", 3), modo = role("111111111111111201", 3, Flags.KickMembers), admin = role("111111111111111202", 3, Flags.Administrator)
    const haut = role("111111111111111203", 20), bot_ = role("111111111111111204", 1, 0n, true)
    const i = faux({ perms: [Flags.ManageGuild, Flags.ManageRoles], roles: [sage, modo, admin, haut, bot_] })

    assert.strictEqual(cfg.refusRoleFiltre(i, sage), null)
    assert.ok(cfg.refusRoleFiltre(i, modo), "permission de modération refusée")
    assert.ok(cfg.refusRoleFiltre(i, admin), "administrateur refusé")
    assert.ok(cfg.refusRoleFiltre(i, haut), "rôle au-dessus du bot refusé")
    assert.ok(cfg.refusRoleFiltre(i, bot_), "rôle géré par une intégration refusé")

    // Le configurateur doit lui-même pouvoir gérer ce rôle
    const mention = role("111111111111111205", 3, Flags.MentionEveryone), webhooks = role("111111111111111206", 3, Flags.ManageWebhooks)
    const auDessus = role("111111111111111207", 5), toutHaut = role("111111111111111208", 8)
    assert.ok(cfg.refusRoleFiltre(i, mention), "@everyone mentionnable refusé")
    assert.ok(cfg.refusRoleFiltre(i, webhooks), "Gérer les webhooks refusé")
    assert.ok(cfg.refusRoleFiltre(i, auDessus), "rôle égal à celui du configurateur refusé")
    assert.ok(cfg.refusRoleFiltre(i, toutHaut), "rôle au-dessus du configurateur refusé")
    const sansRoles = faux({ perms: [Flags.ManageGuild], roles: [sage] })
    assert.ok(cfg.refusRoleFiltre(sansRoles, sage), "configurateur sans « Gérer les rôles » refusé")
    assert.ok((await cfg.changerFiltreComptes(sansRoles, { minAgeJours: 7, action: "role", roleId: sage.id })).erreur)
    const proprio = faux({ userId: "owner", roles: [sage, toutHaut] })
    assert.strictEqual(cfg.refusRoleFiltre(proprio, toutHaut), null, "propriétaire accepté même sans permission ni rang")

    for (const minAgeJours of [0, -1, 366, 1.5, NaN]) {
        assert.ok((await cfg.changerFiltreComptes(i, { minAgeJours, action: "role", roleId: sage.id })).erreur, `âge ${minAgeJours} refusé`)
    }
    assert.ok((await cfg.changerFiltreComptes(i, { minAgeJours: 7, action: "role", roleId: null })).erreur, "rôle manquant refusé")
    assert.ok((await cfg.changerFiltreComptes(i, { minAgeJours: 7, action: "role", roleId: modo.id })).erreur, "rôle de modération refusé")
    assert.ok((await cfg.changerFiltreComptes(i, { minAgeJours: 7, action: "ban" })).erreur, "action inconnue refusée")
    assert.strictEqual(getFiltreComptes(G), null, "rien n'est enregistré après un refus")

    assert.strictEqual((await cfg.changerFiltreComptes(i, { minAgeJours: 7, action: "role", roleId: sage.id })).ok, true)
    assert.deepStrictEqual(getFiltreComptes(G), { minAgeJours: 7, action: "role", roleId: sage.id })
    assert.deepStrictEqual(await cfg.changerFiltreComptes(i, { minAgeJours: 7, action: "role", roleId: sage.id }), { inchange: true })
    assert.ok((await cfg.changerFiltreComptes(i, { minAgeJours: 3, action: "kick" })).erreur, "expulsion refusée à qui ne peut pas expulser lui-même")
    i.memberPermissions = new Discord.PermissionsBitField([Flags.ManageGuild, Flags.KickMembers])
    assert.strictEqual((await cfg.changerFiltreComptes(i, { minAgeJours: 3, action: "kick" })).ok, true)
    assert.strictEqual(getFiltreComptes(G).roleId, null)

    i.guild.members.me.permissions = new Discord.PermissionsBitField(Flags.ManageRoles)
    assert.ok((await cfg.changerFiltreComptes(i, { minAgeJours: 5, action: "kick" })).erreur, "expulsion sans permission du bot refusée")

    assert.strictEqual((await cfg.changerFiltreComptes(i, null)).ok, true)
    assert.strictEqual(getFiltreComptes(G), null)
    assert.deepStrictEqual(await cfg.changerFiltreComptes(i, null), { inchange: true })
})

test("rôle staff, modules et salons de jeux : mêmes droits que /config", async () => {
    const bas = role("111111111111111210", 2), haut = role("111111111111111211", 9)
    const simple = faux({ perms: [Flags.ManageGuild], roles: [bas, haut] })
    assert.ok((await cfg.changerRoleStaff(simple, bas)).erreur, "sans « Exclure temporairement » : refusé")
    const modo = faux({ perms: [Flags.ManageGuild, Flags.ModerateMembers], roles: [bas, haut] })
    assert.ok((await cfg.changerRoleStaff(modo, haut)).erreur, "rôle au-dessus du sien refusé")
    assert.strictEqual((await cfg.changerRoleStaff(modo, bas)).ok, true)
    assert.strictEqual(db.getStaffRole(G), bas.id)

    const connus = ["moderation", "tickets"]
    assert.ok((await cfg.changerModules(simple, connus, ["moderation"])).erreur, "modules réservés aux administrateurs")
    assert.ok((await cfg.changerSalonsJeux(simple, [])).erreur)
    const admin = faux({ perms: [Flags.ManageGuild, Flags.Administrator] })
    assert.strictEqual((await cfg.changerModules(admin, connus, ["moderation"])).ok, true)
    assert.strictEqual(db.getModules(G).tickets, false)
    assert.deepStrictEqual(await cfg.changerModules(admin, connus, ["moderation"]), { inchange: true })
})

test("/setup : chaque étape et le récapitulatif se construisent", () => {
    const setup = bot.commands.get("setup")
    const general = salon("111111111111111220")
    const i = faux({ perms: [Flags.ManageGuild, Flags.Administrator], salons: [general], roles: [role("111111111111111221", 2)] })
    db.setLogChannel(G, general.id)
    db.setSalonsJeux(G, [general.id])
    for (let etape = 0; etape < 5; etape++) {
        const vue = setup.vueEtape(i, etape, new Set(["langue"]))
        vue.embeds.forEach(e => e.toJSON())
        vue.components.forEach(c => c.toJSON())
        assert.ok(vue.components.length <= 5, "5 rangées au plus")
    }
    const dernier = setup.vueEtape(i, 4).components.at(-1).toJSON().components
    assert.ok(dernier[0].disabled === false && dernier.length === 2, "navigation : précédent et terminer")
    assert.ok(setup.vueEtape(i, 0).components.at(-1).toJSON().components[0].disabled, "pas de précédent à la 1re étape")
    const recap = setup.vueRecap(i)
    assert.ok(recap.embeds[0].toJSON().description.includes(general.id), "le récapitulatif reprend les valeurs enregistrées")
    // Sans droit d'administrateur : plus de sélecteur de modules, mais l'étape reste affichable
    const simple = faux({ perms: [Flags.ManageGuild] })
    assert.strictEqual(setup.vueEtape(simple, 3).components.length, 1, "étape modules : navigation seule")
})

test("guildCreate : suggère /setup dans le salon système, seulement pour un serveur tout neuf", async () => {
    const envoyes = []
    const systeme = { permissionsFor: () => ({ has: () => true }), send: async m => envoyes.push(m) }
    const guild = (extra = {}) => ({ id: G, joinedTimestamp: Date.now(), systemChannel: systeme, members: { me: {} }, ...extra })
    assert.strictEqual(await guildCreate.suggererSetup(guild()), true)
    assert.ok(envoyes[0].content.includes("/setup"))
    assert.strictEqual(await guildCreate.suggererSetup(guild({ joinedTimestamp: Date.now() - 3600 * 1000 })), false, "serveur ancien : rien")
    assert.strictEqual(await guildCreate.suggererSetup(guild({ systemChannel: null })), false, "pas de salon système : rien")
    assert.strictEqual(await guildCreate.suggererSetup(guild({ systemChannel: { permissionsFor: () => ({ has: () => false }), send: async () => { throw new Error("non") } } })), false, "bot muet : rien")
    assert.strictEqual(envoyes.length, 1)
})
