process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const i18n = require('../Fonctions/i18n')
const tickets = require('../Fonctions/tickets')
const { traiterSla } = require('../Fonctions/ticketsInactifs')
const { setSalonFamille } = require('../Fonctions/logs')
const { calculerStats } = require('../Commandes/Tickets/stats')
const tickettype = require('../Commandes/Tickets/tickettype')

const { Flags } = Discord.PermissionsBitField
const tous = new Discord.PermissionsBitField(Flags.ViewChannel | Flags.ManageChannels | Flags.ManageRoles | Flags.SendMessages | Flags.EmbedLinks)
const texte = cle => i18n.t("fr", cle)
const evenements = (guildId, kind) => db.sqlAll("SELECT * FROM ticket_events WHERE guild_id = ? AND kind = ?", [guildId, kind])

// --- Transfert (#21) ---

const TG = "555555555555555581", OLD = "222222222222222281", NEW = "222222222222222282"
const CAT_A = "111111111111111181", CAT_B = "111111111111111182", LOGS = "111111111111111183"
const OWN = "777777777777777781", ADDED = "777777777777777782", STAFFU = "777777777777777783", BOT = "777777777777777700"

// Un monde factice : serveur, catégories, salon de ticket avec ses permissions, membre du staff
function monde({ nom = "ticket-bob", topic = OWN, rolesMembre = [OLD], permsMembre = 0n, permsBot = tous } = {}) {
    const actions = [], logs = []
    const roles = new Discord.Collection([OLD, NEW].map(id => [id, { id, managed: false }]))
    const guild = {
        id: TG, ownerId: "999999999999999999", available: true, roles: { cache: roles, everyone: { id: TG } },
        channels: { cache: new Discord.Collection() }, members: { me: { id: BOT } }
    }
    const categorie = id => ({ id, guild, type: Discord.ChannelType.GuildCategory, permissionsFor: () => tous, children: { cache: new Discord.Collection() } })
    for (const id of [CAT_A, CAT_B]) guild.channels.cache.set(id, categorie(id))
    guild.channels.cache.set(LOGS, { id: LOGS, isTextBased: () => true, permissionsFor: () => tous, send: async m => logs.push(m) })

    const droits = (id, type) => ({ id, type })
    const salon = {
        id: "666666666666666681", name: nom, topic, type: Discord.ChannelType.GuildText, parentId: CAT_A, guild, createdTimestamp: Date.now(),
        permissionsFor: () => permsBot,
        setParent: async (id, options) => { actions.push(["parent", id, options]); salon.parentId = id },
        permissionOverwrites: {
            cache: new Discord.Collection([
                [TG, droits(TG, Discord.OverwriteType.Role)], [OWN, droits(OWN, Discord.OverwriteType.Member)],
                [ADDED, droits(ADDED, Discord.OverwriteType.Member)], [OLD, droits(OLD, Discord.OverwriteType.Role)], [BOT, droits(BOT, Discord.OverwriteType.Member)]
            ]),
            edit: async (id, perms, options) => { actions.push(["edit", id, options.type]); salon.permissionOverwrites.cache.set(id, droits(id, options.type)) },
            delete: async id => { actions.push(["delete", id]); salon.permissionOverwrites.cache.delete(id) }
        }
    }
    guild.channels.cache.set(salon.id, salon)

    const reponses = []
    const interaction = {
        guild, guildId: TG, channel: salon, locale: "fr", user: { id: STAFFU, tag: "staff#0", toString: () => `<@${STAFFU}>` },
        memberPermissions: new Discord.PermissionsBitField(permsMembre),
        member: { roles: { cache: new Discord.Collection(rolesMembre.map(id => [id, {}])) } },
        deferred: false, replied: false, ephemeral: false,
        inCachedGuild: () => true,
        reply: async r => { interaction.replied = true; reponses.push(r) },
        deferReply: async () => { interaction.deferred = true },
        editReply: async r => reponses.push(r)
    }
    return { guild, salon, interaction, actions, logs, reponses }
}

test("transfert : refusé hors ticket, pour un non-staff, ticket fermé, type inconnu ou identique, bot sans permission", async () => {
    const type1 = db.addTicketType(TG, { nom: "Support", description: null, categoryId: CAT_A, staffRoleId: OLD })
    db.addTicketType(TG, { nom: "Signalement", description: null, categoryId: CAT_B, staffRoleId: NEW })
    const ajouter = salon => db.addTicket(TG, salon.id, OWN, type1, { staffRoleId: OLD })

    const cas = [
        ["hors d'un ticket", { nom: "general", topic: "" }, "Signalement", "tk.gm_hors_ticket"],
        ["non-staff", { rolesMembre: [] }, "Signalement", "tk.tr_staff"],
        ["auteur du ticket (sans droit staff)", { rolesMembre: [] }, "Signalement", "tk.tr_staff"],
        ["ticket fermé", { nom: "ferme-bob" }, "Signalement", "tk.ferme"],
        ["bot sans permission", { permsBot: new Discord.PermissionsBitField(Flags.ViewChannel) }, "Signalement", "tk.tr_perms"],
        ["type inconnu", {}, "N'existe pas", "tk.tr_type_inconnu"],
        ["sans type", {}, null, "tk.tr_type_inconnu"],
        ["même type", {}, "support", "tk.tr_meme_type"]
    ]
    for (const [nom, options, saisie, cle] of cas) {
        const m = monde(options)
        db.sqlRun("DELETE FROM tickets WHERE channel_id = ?", [m.salon.id])
        if (nom !== "hors d'un ticket") ajouter(m.salon)
        await tickets.transfererTicket(m.interaction, saisie)
        assert.strictEqual(m.reponses.length, 1, `${nom} : une seule réponse`)
        assert.strictEqual(m.reponses[0].content, texte(cle), nom)
        assert.deepStrictEqual(m.actions, [], `${nom} : aucun changement sur le salon`)
        assert.strictEqual(db.getTicket(m.salon.id)?.type_id ?? type1, type1, `${nom} : type inchangé`)
    }
    assert.strictEqual(evenements(TG, "transfert").length, 0)
})

test("transfert : rôle staff remplacé, catégorie changée, auteur et membres ajoutés gardés, trace et log", async () => {
    setSalonFamille(TG, "tickets", LOGS)
    const type1 = db.listTicketTypes(TG).find(ty => ty.nom === "Support").id
    const type2 = db.listTicketTypes(TG).find(ty => ty.nom === "Signalement").id
    const m = monde()
    db.sqlRun("DELETE FROM tickets WHERE channel_id = ?", [m.salon.id])
    db.addTicket(TG, m.salon.id, OWN, type1, { staffRoleId: OLD })

    await tickets.transfererTicket(m.interaction, "signalement")

    assert.deepStrictEqual(m.actions, [
        ["parent", CAT_B, { lockPermissions: false, reason: "staff#0 : /ticket transferer" }],
        ["edit", NEW, Discord.OverwriteType.Role],
        ["delete", OLD]
    ], "catégorie sans synchroniser les permissions, nouveau rôle ajouté, ancien retiré")
    const cache = m.salon.permissionOverwrites.cache
    assert.ok(cache.has(OWN) && cache.has(ADDED) && cache.has(BOT), "l'auteur, le membre ajouté et le bot gardent leur accès")
    assert.ok(cache.has(NEW) && !cache.has(OLD), "le rôle de l'ancien type est remplacé par celui du nouveau")
    assert.ok(cache.has(TG), "@everyone n'est pas touché")

    const ticket = db.getTicket(m.salon.id)
    assert.deepStrictEqual([ticket.type_id, ticket.staff_role_id, ticket.owner_id], [type2, NEW, OWN], "type et rôle figé mis à jour")
    const trace = evenements(TG, "transfert")
    assert.deepStrictEqual([trace.length, trace[0].actor_id, trace[0].channel_id, trace[0].details], [1, STAFFU, m.salon.id, "Support -> Signalement"])
    assert.deepStrictEqual(m.reponses[0].allowedMentions, { parse: [], roles: [NEW] }, "seul le rôle du nouveau type peut être mentionné")
    assert.ok(m.reponses[0].content.includes(`<@&${NEW}>`))
    assert.strictEqual(m.logs.length, 1, "un log dans la famille tickets")

    // Le nouveau rôle voit le ticket : le staff de l'ancien type n'en est plus
    const guildNouveau = m.guild
    const membre = roles => ({ memberPermissions: new Discord.PermissionsBitField(0n), guild: guildNouveau, member: { roles: { cache: new Discord.Collection(roles.map(r => [r, {}])) } } })
    assert.strictEqual(tickets.isStaff(membre([NEW]), m.salon), true)
    assert.strictEqual(tickets.isStaff(membre([OLD]), m.salon), false)
})

test("transfert : sans rôle ni catégorie pour le nouveau type, le salon reste en place", async () => {
    const type1 = db.listTicketTypes(TG).find(ty => ty.nom === "Support").id
    const nu = db.addTicketType(TG, { nom: "Autre", description: null, categoryId: null, staffRoleId: null })
    const m = monde()
    db.sqlRun("DELETE FROM tickets WHERE channel_id = ?", [m.salon.id])
    db.addTicket(TG, m.salon.id, OWN, type1, { staffRoleId: OLD })
    await tickets.transfererTicket(m.interaction, String(nu))
    assert.deepStrictEqual(m.actions, [["delete", OLD]], "ni déplacement ni nouveau rôle : seul l'ancien rôle est retiré")
    assert.strictEqual(db.getTicket(m.salon.id).staff_role_id, null)
    assert.deepStrictEqual(m.reponses[0].allowedMentions, { parse: [], roles: [] }, "aucune mention")
})

// --- Champs personnalisés (#19) ---

const FG = "555555555555555584"

test("champs : 5 au plus, dans l'ordre, retrait renumérote", async () => {
    const type = db.addTicketType(FG, { nom: "Candidature", description: null, categoryId: null, staffRoleId: null })
    for (let i = 1; i <= tickets.MAX_CHAMPS; i++) {
        assert.strictEqual(tickets.ajouterChamp(FG, type, { label: `Champ ${i}`, style: i === 2 ? "long" : "court", required: i !== 3 }), true)
    }
    assert.strictEqual(tickets.ajouterChamp(FG, type, { label: "Un de trop", style: "court", required: true }), false, "6e champ refusé")
    assert.strictEqual(tickets.champsDuType(FG, type).length, 5)

    const retire = tickets.retirerChamp(FG, type, 2)
    assert.strictEqual(retire.label, "Champ 2")
    assert.deepStrictEqual(tickets.champsDuType(FG, type).map(c => [c.label, c.position]), [["Champ 1", 1], ["Champ 3", 2], ["Champ 4", 3], ["Champ 5", 4]])
    assert.strictEqual(tickets.retirerChamp(FG, type, 9), null)
    assert.strictEqual(tickets.ajouterChamp(FG, type, { label: "Nouveau", style: "inconnu", required: true }), true, "une place s'est libérée")
    assert.strictEqual(tickets.champsDuType(FG, type).at(-1).style, "court", "style inconnu : court")
    assert.deepStrictEqual(tickets.champsDuType("555555555555555599", type), [], "un autre serveur ne voit pas ces champs")
})

test("formulaire : sans champ le formulaire actuel, sinon les champs du type", async () => {
    const guild = { id: FG, roles: { everyone: { id: FG } } }
    const interaction = { guild, guildId: FG, locale: "fr" }
    const sans = db.addTicketType(FG, { nom: "Simple", description: null, categoryId: null, staffRoleId: null })
    const avec = db.listTicketTypes(FG).find(ty => ty.nom === "Candidature")

    const lire = modal => modal.toJSON().components.map(r => r.components[0])
    const actuel = lire(tickets.construireFormulaire(interaction, null))
    assert.deepStrictEqual(actuel.map(c => [c.custom_id, c.style, c.required]), [["sujet", 1, true], ["details", 2, false]])
    assert.deepStrictEqual(lire(tickets.construireFormulaire(interaction, db.getTicketType(FG, sans))).map(c => c.custom_id), ["sujet", "details"], "type sans champ")

    const modal = tickets.construireFormulaire(interaction, avec)
    assert.strictEqual(modal.toJSON().custom_id, `ticket-form:${avec.id}`)
    const champs = tickets.champsDuType(FG, avec.id)
    assert.deepStrictEqual(lire(modal).map(c => [c.custom_id, c.label, c.style, c.required]),
        champs.map(c => [`champ_${c.id}`, c.label, c.style === "long" ? 2 : 1, Boolean(c.required)]))
    assert.ok(lire(modal).length <= 5)
    assert.ok(modal.toJSON().title.length <= 45)
})

test("formulaire : les réponses sont postées dans le ticket et jamais stockées", async () => {
    const type = db.listTicketTypes(FG).find(ty => ty.nom === "Candidature")
    const champs = tickets.champsDuType(FG, type.id)
    const reponsesMembre = ["Réponse un", "", "Réponse *longue*", "Quatre", "Cinq"]
    const valeurs = new Map(champs.map((c, i) => [`champ_${c.id}`, reponsesMembre[i]]))
    const U = "777777777777777790", NOUVEAU = "666666666666666690"
    const envoyes = []
    const salon = { id: NOUVEAU, send: async m => envoyes.push(m) }
    const guild = {
        id: FG, roles: { everyone: { id: FG }, cache: new Discord.Collection() },
        channels: { cache: new Discord.Collection(), create: async options => { assert.strictEqual(options.topic, U); return salon } }, members: { me: { id: BOT } }
    }
    const bot = { user: { id: BOT, username: "Bot", displayAvatarURL: () => "https://exemple.test/a.png" } }
    const reponses = []
    const interaction = {
        guild, guildId: FG, locale: "fr", customId: `ticket-form:${type.id}`, user: { id: U, username: "alice", tag: "alice#0" },
        inCachedGuild: () => true, channel: null,
        fields: { fields: new Discord.Collection([...valeurs].map(([id, value]) => [id, { value }])), getTextInputValue: id => valeurs.get(id) },
        reply: async r => reponses.push(r), deferReply: async () => {}, editReply: async r => reponses.push(r)
    }

    await tickets.onFormulaire(bot, interaction)
    // Le 2e champ (facultatif) est vide : seuls les champs remplis sont postés
    const embed = envoyes[0].embeds[0].toJSON()
    assert.deepStrictEqual(embed.fields.map(f => f.name), champs.filter((c, i) => reponsesMembre[i]).map(c => c.label))
    assert.strictEqual(embed.fields[1].value, "Réponse \\*longue\\*", "texte du membre échappé")
    const tout = JSON.stringify([db.sqlAll("SELECT * FROM tickets"), db.sqlAll("SELECT * FROM ticket_events"), db.sqlAll("SELECT * FROM ticket_fields")])
    assert.ok(!tout.includes("Réponse un") && !tout.includes("Quatre"), "aucune réponse en base")
    assert.strictEqual(db.getTicket(NOUVEAU).type_id, type.id)

    // Un champ obligatoire vide (espaces) : refusé, aucun salon créé
    const U2 = "777777777777777791"
    const vides = new Map(champs.map(c => [`champ_${c.id}`, "   "]))
    const refus = []
    await tickets.onFormulaire(bot, { ...interaction, user: { id: U2, username: "bob", tag: "bob#0" }, reply: async r => refus.push(r),
        fields: { fields: new Discord.Collection([...vides].map(([id, value]) => [id, { value }])), getTextInputValue: id => vides.get(id) } })
    assert.strictEqual(refus[0].content, i18n.t("fr", "tk.fo_vide", { champ: champs[0].label }))
    assert.strictEqual(envoyes.length, 1, "pas de nouveau ticket")

    // Formulaire ouvert avant un changement de champs : refusé proprement
    const ancien = new Map([["sujet", "Bonjour"], ["details", ""]])
    const obsolete = []
    await tickets.onFormulaire(bot, { ...interaction, user: { id: U2, username: "bob", tag: "bob#0" }, reply: async r => obsolete.push(r),
        fields: { fields: new Discord.Collection([...ancien].map(([id, value]) => [id, { value }])), getTextInputValue: id => ancien.get(id) } })
    assert.strictEqual(obsolete[0].content, texte("tk.fo_modifie"))
    assert.strictEqual(envoyes.length, 1)
})

// --- Délai cible (#18) ---

const SG = "555555555555555585", ROLE_SLA = "222222222222222285", ROLE_AUTRE = "222222222222222286"
const T0 = Date.now()
const MIN = 60000

test("SLA : une seule alerte, pas si pris en charge, sans délai ou trop récent, mention limitée au rôle", async () => {
    const avec = db.addTicketType(SG, { nom: "Support", description: null, categoryId: null, staffRoleId: null })
    const sans = db.addTicketType(SG, { nom: "Libre", description: null, categoryId: null, staffRoleId: null })
    assert.strictEqual(tickets.definirDelai(SG, avec, 30), true)
    assert.strictEqual(tickets.definirDelai(SG, avec, 4), false, "moins de 5 minutes refusé")
    assert.strictEqual(tickets.definirDelai(SG, avec, 10081), false, "plus de 10 080 minutes refusé")
    assert.strictEqual(tickets.definirDelai(SG, avec, 2.5), false)
    assert.strictEqual(tickets.definirDelai("555555555555555598", avec, 30), false, "autre serveur : refusé")
    assert.strictEqual(db.getTicketType(SG, avec).sla_minutes, 30)

    const envoyes = {}
    const salon = (id, nom = "ticket-bob") => ({
        id, name: nom, topic: OWN, type: Discord.ChannelType.GuildText,
        send: async m => { (envoyes[id] ??= []).push(m); return { id: "1" } }
    })
    const ids = { en_retard: "666666666666666651", pris: "666666666666666652", sans_delai: "666666666666666653", recent: "666666666666666654", ferme: "666666666666666655", plante: "666666666666666656" }
    const guild = {
        id: SG, available: true, roles: { cache: new Discord.Collection([ROLE_SLA, ROLE_AUTRE].map(id => [id, { id, managed: false }])) },
        channels: { cache: new Discord.Collection(Object.values(ids).map(id => [id, salon(id, id === ids.ferme ? "ferme-bob" : "ticket-bob")])) }
    }
    const bot = { user: { id: BOT }, guilds: { cache: new Discord.Collection([[SG, guild]]) } }
    const creer = (id, type, ageMin) => db.addTicket(SG, id, OWN, type, { staffRoleId: ROLE_SLA, createdAt: T0 - ageMin * MIN })
    creer(ids.en_retard, avec, 31)
    creer(ids.pris, avec, 120)
    db.claimTicket(ids.pris, STAFFU)
    creer(ids.sans_delai, sans, 5000)
    creer(ids.recent, avec, 10)
    creer(ids.ferme, avec, 120)
    creer(ids.plante, avec, 90)
    guild.channels.cache.get(ids.plante).send = async () => { throw new Error("Missing Permissions") }

    const erreurs = console.error
    console.error = () => {}
    let premier
    try {
        premier = await traiterSla(bot, T0)
    } finally {
        console.error = erreurs
    }
    assert.strictEqual(premier, 1, "une seule alerte : le ticket en retard (celui dont l'envoi échoue n'est pas compté)")
    assert.strictEqual(envoyes[ids.en_retard].length, 1)
    assert.deepStrictEqual(envoyes[ids.en_retard][0].allowedMentions, { parse: [], roles: [ROLE_SLA] })
    assert.ok(envoyes[ids.en_retard][0].content.includes(`<@&${ROLE_SLA}>`))
    for (const id of [ids.pris, ids.sans_delai, ids.recent, ids.ferme]) assert.strictEqual(envoyes[id], undefined, `pas d'alerte pour ${id}`)

    assert.ok(db.getTicket(ids.en_retard).sla_alerted_at, "date de l'alerte écrite")
    assert.ok(db.getTicket(ids.plante).sla_alerted_at, "écrite avant l'envoi : l'échec de l'envoi n'entraîne pas de doublon")
    assert.strictEqual(db.getTicket(ids.pris).sla_alerted_at, null)
    assert.strictEqual(await traiterSla(bot, T0 + 5 * MIN), 0, "2e passage : rien de plus")
    assert.strictEqual(envoyes[ids.en_retard].length, 1)

    // Le ticket récent finit par dépasser le délai : alerte à ce moment-là, une fois
    assert.strictEqual(await traiterSla(bot, T0 + 25 * MIN), 1)
    assert.strictEqual(await traiterSla(bot, T0 + 50 * MIN), 0)
    const trace = evenements(SG, "sla_alerte")
    assert.deepStrictEqual(trace.map(e => e.channel_id).sort(), [ids.en_retard, ids.plante, ids.recent].sort())
    assert.strictEqual(trace[0].actor_id, BOT)
    assert.strictEqual(trace.find(e => e.channel_id === ids.en_retard).details, "Support : 30 min")

    // Délai retiré : plus aucune alerte, même pour un ticket très ancien
    tickets.definirDelai(SG, avec, null)
    creer("666666666666666657", avec, 9000)
    guild.channels.cache.set("666666666666666657", salon("666666666666666657"))
    assert.strictEqual(await traiterSla(bot, T0 + 60 * MIN), 0)
})

test("statistiques : taux de tickets pris en charge dans le délai", async () => {
    const types = [{ id: 1, nom: "Support", sla_minutes: 10 }, { id: 2, nom: "Libre", sla_minutes: null }]
    const now = 100 * MIN
    const ligne = (type, creation, prise) => ({ status: "ouvert", type_id: type, created_at: creation, claimed_at: prise, claimed_by: prise ? "a" : null, rating: null })
    const s = calculerStats([
        ligne(1, 0, 5 * MIN),            // à temps
        ligne(1, 0, 10 * MIN),           // pile dans le délai
        ligne(1, 0, 30 * MIN),           // en retard
        ligne(1, 0, null),               // jamais pris, délai dépassé : en retard
        ligne(1, 95 * MIN, null),        // pas encore pris, encore dans le délai : pas compté
        ligne(2, 0, 50 * MIN),           // type sans délai : pas compté
        ligne(null, 0, null)             // sans type : pas compté
    ], types, "Sans type", now)
    assert.deepStrictEqual(s.dansLeDelai, { dans: 2, total: 4 })
    assert.strictEqual(calculerStats([ligne(2, 0, MIN)], types, "Sans type", now).dansLeDelai, null, "aucun délai : pas de taux")
    assert.strictEqual(s.total, 7, "les autres statistiques sont inchangées")
})

// --- /tickettype : délai et champs, premium ---

function commande(guildId, options, { premium = false } = {}) {
    const reponses = []
    const interaction = {
        guild: { id: guildId, ownerId: "999999999999999999", channels: { cache: new Discord.Collection() }, members: { me: { id: BOT } } },
        guildId, locale: "fr", user: { id: STAFFU }, reponses,
        client: { application: { entitlements: { fetch: async () => new Discord.Collection() } } },
        entitlements: new Discord.Collection(),
        reply: async r => reponses.push(r), followUp: async r => reponses.push(r)
    }
    const args = {
        getString: nom => options[nom] ?? null, getInteger: nom => options[nom] ?? null,
        getBoolean: nom => options[nom] ?? null, getChannel: () => null, getRole: () => null
    }
    return { interaction, args, reponses, lancer: () => tickettype.run({}, interaction, args) }
}

test("/tickettype : délai et champs, réservés au premium comme la modification d'un type", async () => {
    const PG = "555555555555555587", PG2 = "555555555555555588"
    const sku = process.env.PREMIUM_SKU_ID, offerts = process.env.PREMIUM_GUILD_IDS
    process.env.PREMIUM_SKU_ID = "999999999999999987"
    delete process.env.PREMIUM_GUILD_IDS
    const erreurs = console.error
    console.error = () => {}
    try {
        const type = db.addTicketType(PG, { nom: "Support", description: null, categoryId: null, staffRoleId: null })

        // Sans premium : refus, rien n'est écrit
        for (const options of [{ action: "delai", numero: type, minutes: 30 }, { action: "champ_ajouter", numero: type, libelle: "Pseudo" }]) {
            const c = commande(PG, options)
            await c.lancer()
            assert.match(c.reponses[0].content, /premium|Premium/i, options.action)
            assert.ok(c.reponses[0].components.length > 0, "bouton d'achat")
        }
        assert.strictEqual(db.getTicketType(PG, type).sla_minutes, null)
        assert.strictEqual(tickets.champsDuType(PG, type).length, 0)

        // Sans premium, on peut toujours lister, retirer un délai
        const liste = commande(PG, { action: "champs", numero: type })
        await liste.lancer()
        assert.strictEqual(liste.reponses[0].content, i18n.t("fr", "tk.ch_aucun", { type: "Support" }))

        // Avec premium
        process.env.PREMIUM_GUILD_IDS = PG
        const regler = commande(PG, { action: "delai", numero: type, minutes: 45 })
        await regler.lancer()
        assert.strictEqual(db.getTicketType(PG, type).sla_minutes, 45)
        const trop = commande(PG, { action: "delai", numero: type, minutes: 3 })
        await trop.lancer()
        assert.strictEqual(trop.reponses[0].content, i18n.t("fr", "tk.dl_limites", { min: 5, max: 10080 }), "hors limites")
        assert.strictEqual(db.getTicketType(PG, type).sla_minutes, 45)

        for (let i = 1; i <= 5; i++) await commande(PG, { action: "champ_ajouter", numero: type, libelle: `Question ${i}`, style: "long", requis: false }).lancer()
        const sixieme = commande(PG, { action: "champ_ajouter", numero: type, libelle: "Une de trop" })
        await sixieme.lancer()
        assert.strictEqual(sixieme.reponses[0].content, i18n.t("fr", "tk.ch_max", { max: 5 }))
        const champs = tickets.champsDuType(PG, type)
        assert.deepStrictEqual([champs.length, champs[0].style, champs[0].required], [5, "long", 0])
        const long = commande(PG, { action: "champ_ajouter", numero: type, libelle: "x".repeat(46) })
        await long.lancer()
        assert.strictEqual(long.reponses[0].content, texte("tk.ch_libelle_long"))

        const voir = commande(PG, { action: "champs", numero: type })
        await voir.lancer()
        assert.ok(voir.reponses[0].content.includes("1. Question 1 (long, facultatif)"))

        // Retirer : gratuit, même quand le premium a pris fin
        delete process.env.PREMIUM_GUILD_IDS
        await commande(PG2, { action: "champ_retirer", numero: 1, champ: 1 }).lancer()
        const retire = commande(PG, { action: "champ_retirer", numero: type, champ: 2 })
        await retire.lancer()
        assert.strictEqual(tickets.champsDuType(PG, type).length, 4)
        const delai = commande(PG, { action: "delai", numero: type })
        await delai.lancer()
        assert.strictEqual(db.getTicketType(PG, type).sla_minutes, null, "sans minutes : délai retiré")

        // Supprimer le type supprime ses champs
        await commande(PG, { action: "retirer", numero: type }).lancer()
        assert.strictEqual(tickets.champsDuType(PG, type).length, 0)
    } finally {
        console.error = erreurs
        for (const [cle, valeur] of [["PREMIUM_SKU_ID", sku], ["PREMIUM_GUILD_IDS", offerts]]) {
            if (valeur === undefined) delete process.env[cle]
            else process.env[cle] = valeur
        }
    }
})
