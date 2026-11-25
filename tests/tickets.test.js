process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const tickets = require('../Fonctions/tickets')
const { ticketOwnerId, roleValide } = tickets
const { calculerStats } = require('../Commandes/Moderation/stats')
const { traiterInactifs } = require('../Fonctions/ticketsInactifs')

const { Flags } = Discord.PermissionsBitField
const G1 = "111111111111111111"
const G8 = "555555555555555557", G9 = "555555555555555558"
const C1 = "666666666666666601", OWNER = "777777777777777701", STAFF1 = "888888888888888801", STAFF2 = "888888888888888802"
const C3 = "666666666666666603"

test("détection des tickets", async () => {
    const salon = (name, topic, type = Discord.ChannelType.GuildText) => ({ name, topic, type })
    assert.strictEqual(ticketOwnerId(salon("ticket-bob", "123456789012345678")), "123456789012345678")
    assert.strictEqual(ticketOwnerId(salon("general", "123456789012345678")), null)
    assert.strictEqual(ticketOwnerId(salon("ticket-bob", "pas un id")), null)
    assert.strictEqual(ticketOwnerId(salon("ticket-bob", "123456789012345678", Discord.ChannelType.GuildVoice)), null)
    assert.strictEqual(ticketOwnerId(salon("ferme-bob", "123456789012345678")), "123456789012345678")
    assert.strictEqual(ticketOwnerId(null), null)
})

test("rôle staff", async () => {
    const roles = new Discord.Collection([
        [G1, { id: G1, managed: false }],
        ["888888888888888888", { id: "888888888888888888", managed: true }],
        ["999999999999999999", { id: "999999999999999999", managed: false }]
    ])
    const guildFactice = { id: G1, roles: { cache: roles } }
    assert.ok(!roleValide(guildFactice, G1), "@everyone refusé")
    assert.ok(!roleValide(guildFactice, "888888888888888888"), "rôle de bot refusé")
    assert.ok(!roleValide(guildFactice, "123"), "rôle inexistant refusé")
    assert.ok(!roleValide(guildFactice, null))
    assert.ok(roleValide(guildFactice, "999999999999999999"))
})

test("tickets (types, prise en charge, notes, staff du ticket)", async () => {
    const t1 = db.addTicketType(G8, { nom: "Support", description: "Aide", categoryId: "111111111111111110" })
    assert.strictEqual(db.getTicketType(G9, t1), null, "un serveur ne voit pas les types d'un autre")
    assert.strictEqual(db.updateTicketType(G9, t1, { nom: "Piraté" }), false)
    db.updateTicketType(G8, t1, { staffRoleId: "222222222222222220" })
    assert.deepStrictEqual([db.getTicketType(G8, t1).nom, db.getTicketType(G8, t1).category_id, db.getTicketType(G8, t1).staff_role_id],
        ["Support", "111111111111111110", "222222222222222220"], "modifier le rôle garde le nom et la catégorie")

    // Tickets : prise en charge atomique, libération, notes
    db.addTicket(G8, C1, OWNER, t1, { staffRoleId: "222222222222222220" })
    assert.strictEqual(db.claimTicket(C1, STAFF1), true)
    assert.strictEqual(db.claimTicket(C1, STAFF2), false, "déjà pris : le 2e clic échoue")
    const premiereFois = db.getTicket(C1).claimed_at
    assert.strictEqual(db.unclaimTicket(C1, STAFF2), false, "on ne libère pas le ticket d'un autre")
    assert.strictEqual(db.unclaimTicket(C1, STAFF1), true)
    db.claimTicket(C1, STAFF2)
    assert.strictEqual(db.getTicket(C1).claimed_at, premiereFois, "la date de 1re prise en charge est gardée")
    assert.strictEqual(db.rateTicket(C1, OWNER, 5), false, "pas de note tant que le ticket n'est pas supprimé")
    db.setTicketStatus(C1, "supprime")
    assert.strictEqual(db.rateTicket(C1, STAFF1, 1), false, "seul l'auteur note")
    assert.strictEqual(db.rateTicket(C1, OWNER, 4), true)
    assert.strictEqual(db.rateTicket(C1, OWNER, 1), false, "une seule note")
    assert.strictEqual(db.getTicket(C1).rating, 4)

    // Note en MP : tout est revérifié en base, le customId n'est pas cru sur parole
    const C2 = "666666666666666602"
    db.addTicket(G8, C2, OWNER, null)
    db.setTicketStatus(C2, "supprime")
    const reponses = []
    const clicNote = (customId, userId) => ({
        customId, user: { id: userId },
        reply: async r => reponses.push(["reply", r.content]), update: async r => reponses.push(["update", r.content])
    })
    const botNote = { guilds: { cache: new Discord.Collection() } }
    await tickets.noterTicket(botNote, clicNote(`note:${C2}:5`, STAFF1))
    await tickets.noterTicket(botNote, clicNote(`note:${C2}:9`, OWNER))
    await tickets.noterTicket(botNote, clicNote(`note:../../x:5`, OWNER))
    assert.deepStrictEqual(reponses.map(r => r[0]), ["reply", "reply", "reply"], "mauvais membre, note hors limites, ID invalide : refusés")
    assert.strictEqual(db.getTicket(C2).rating, null)
    await tickets.noterTicket(botNote, clicNote(`note:${C2}:3`, OWNER))
    assert.strictEqual(db.getTicket(C2).rating, 3)

    // Ticket fermé il y a 8 jours puis supprimé aujourd'hui : le délai de note part de la suppression
    const C5 = "666666666666666605"
    db.addTicket(G8, C5, OWNER, null)
    db.setTicketStatus(C5, "ferme", Date.now() - 8 * 24 * 3600000)
    db.setTicketStatus(C5, "supprime")
    await tickets.noterTicket(botNote, clicNote(`note:${C5}:5`, OWNER))
    assert.strictEqual(db.getTicket(C5).rating, 5, "note acceptée après une fermeture ancienne")

    // Staff : rôle posé sur le ticket à sa création (et pas le rôle actuel du type)
    const guildStaff = { id: G8, ownerId: "owner", roles: { cache: new Discord.Collection([["222222222222222220", { id: "222222222222222220", managed: false }]]) } }
    const membreAvec = roles => ({ memberPermissions: new Discord.PermissionsBitField(0n), guild: guildStaff, member: { roles: { cache: new Discord.Collection(roles.map(r => [r, {}])) } } })
    assert.strictEqual(tickets.isStaff(membreAvec(["222222222222222220"]), { id: C1 }), true, "rôle du ticket")
    assert.strictEqual(tickets.isStaff(membreAvec([]), { id: C1 }), false)
    db.updateTicketType(G8, t1, { staffRoleId: "333333333333333330" })
    assert.strictEqual(tickets.isStaff(membreAvec(["222222222222222220"]), { id: C1 }), true, "changer le type ne change pas l'accès au ticket existant")
})

test("statistiques des tickets", async () => {
    const s = calculerStats([
        { status: "ouvert", type_id: 1, created_at: 0, claimed_at: 60000, claimed_by: "a", rating: null },
        { status: "supprime", type_id: 1, created_at: 0, claimed_at: 180000, claimed_by: "a", rating: 4 },
        { status: "ferme", type_id: null, created_at: 0, claimed_at: null, claimed_by: null, rating: 2 }
    ], [{ id: 1, nom: "Support" }])
    assert.deepStrictEqual([s.total, s.enCours, s.fermes, s.delaiPriseEnCharge, s.noteMoyenne], [3, 1, 2, 120000, 3])
    assert.deepStrictEqual(s.parType, [["Support", 2], ["Sans type", 1]])
    assert.deepStrictEqual(s.topStaff, [["a", 2]])
})

test("fermeture des tickets inactifs", async () => {
    const G10 = "555555555555555559"
    db.setTicketInactivity(G10, 2)
    db.addTicket(G10, C3, OWNER, null)
    const jour = 24 * 3600000
    const t0 = Date.now()
    let derniers = [{ author: { bot: false }, createdTimestamp: t0 - 3 * jour }]
    const envoyes = [], actions = []
    const salonInactif = {
        id: C3, name: "ticket-bob", topic: OWNER, type: Discord.ChannelType.GuildText, createdTimestamp: t0 - 5 * jour,
        guild: { id: G10 },
        messages: { fetch: async () => new Discord.Collection(derniers.map((m, i) => [String(i), m])) },
        send: async texte => { envoyes.push(texte); return { id: "999" } },
        setName: async nom => { actions.push(["nom", nom]); salonInactif.name = nom },
        permissionOverwrites: {
            cache: new Discord.Collection(),
            edit: async (id, droits, options) => {
                // Comme discord.js : sans type, un utilisateur absent du cache fait échouer l'appel
                assert.strictEqual(options?.type, Discord.OverwriteType.Member, "type Member précisé")
                actions.push(["droits", id, droits])
                salonInactif.permissionOverwrites.cache.set(id, { deny: new Discord.PermissionsBitField(droits.ViewChannel === false ? Flags.ViewChannel : 0n) })
            }
        }
    }
    const guildInactif = { id: G10, available: true, channels: { cache: new Discord.Collection([[C3, salonInactif]]) } }
    const botInactif = { user: { id: "bot" }, guilds: { cache: new Discord.Collection([[G10, guildInactif]]) } }

    assert.deepStrictEqual(await traiterInactifs(botInactif, t0), { avertis: 1, fermes: 0 })
    assert.strictEqual(db.getTicket(C3).warned_at, t0)
    // Le message d'avertissement du bot ne compte pas comme activité
    derniers = [{ author: { bot: true }, createdTimestamp: t0 }, ...derniers]
    assert.deepStrictEqual(await traiterInactifs(botInactif, t0 + 3600000), { avertis: 0, fermes: 0 }, "pas de double avertissement")
    // L'auteur répond : avertissement annulé
    derniers = [{ author: { bot: false }, createdTimestamp: t0 + 7200000 }]
    await traiterInactifs(botInactif, t0 + 3 * 3600000)
    assert.strictEqual(db.getTicket(C3).warned_at, null, "réponse : avertissement annulé")
    // Nouvel avertissement 2 jours plus tard, puis 24 h sans réponse : fermeture
    await traiterInactifs(botInactif, t0 + 3 * jour)
    assert.deepStrictEqual(await traiterInactifs(botInactif, t0 + 4 * jour + 60000), { avertis: 0, fermes: 1 })
    assert.deepStrictEqual(actions[0], ["nom", "ferme-bob"])
    assert.deepStrictEqual(actions[1], ["droits", OWNER, { ViewChannel: false }], "l'auteur perd l'accès")
    assert.strictEqual(db.getTicket(C3).status, "ferme")
    assert.deepStrictEqual(await traiterInactifs(botInactif, t0 + 5 * jour), { avertis: 0, fermes: 0 }, "ticket fermé : plus traité")
    assert.strictEqual(actions.length, 2, "fermeture complète : rien à refaire")

    // Fermeture interrompue (renommé "ferme-" mais l'auteur a encore accès) : terminée au passage suivant
    salonInactif.permissionOverwrites.cache.clear()
    await traiterInactifs(botInactif, t0 + 6 * jour)
    assert.deepStrictEqual(actions[2], ["droits", OWNER, { ViewChannel: false }], "accès de l'auteur retiré au rattrapage")

    // Salon supprimé à la main pendant que le bot était éteint
    const C4 = "666666666666666604"
    db.addTicket(G10, C4, OWNER, null)
    await traiterInactifs(botInactif, t0)
    assert.strictEqual(db.getTicket(C4).status, "supprime")
})

test("RGPD des tickets", async () => {
    assert.ok(db.guildsWithData().includes(G8))
    assert.ok(db.deleteGuildData(G8) >= 3)
    assert.strictEqual(db.listTicketTypes(G8).length, 0)
    assert.strictEqual(db.getTicket(C1), null)
    assert.strictEqual(db.purgeOldTickets(Date.now() + 1), 1, "C4 (supprimé) purgé, C3 (fermé, pas supprimé) gardé")
    assert.ok(db.getTicket(C3))
})
