process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('node:events')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const { controler } = require('../Fonctions/garde')
const notes = require('../Fonctions/notes')
const appels = require('../Fonctions/appels')
const { construirePages, notesVisibles } = require('../Fonctions/dossier')
const { role, chargerCommandes } = require('./aides')

const { Flags } = Discord.PermissionsBitField
const G = "111111111111111201", PROPRIO = "888888888888888888"
const CIBLE = "333333333333333501", MOD = "444444444444444501"
const bot = chargerCommandes()

// Faux membre consulté (rôle au choix) et faux utilisateur Discord
const membre = position => ({ id: CIBLE, roles: { highest: role(position) }, joinedTimestamp: Date.now() - 5 * 86400000 })
const cible = { id: CIBLE, tag: "cible#0001", displayAvatarURL: () => null, createdTimestamp: Date.now() - 400 * 86400000 }

// Fausse interaction : le consultant a le rôle 10, la cible est renvoyée par guild.members.fetch
function interaction({ perms = [Flags.ModerateMembers], user = MOD, cibleMembre = membre(1), cibleUser = cible } = {}) {
    const i = {
        reponses: [], id: "42", guildId: G, channelId: "333333333333333399", locale: "fr", user: { id: user, tag: "mod#0001" }, deferred: false, ephemeral: true,
        client: { user: { id: "999999999999999999" } },
        guild: { id: G, ownerId: PROPRIO, members: { fetch: async () => cibleMembre } },
        member: { roles: { highest: role(10), cache: new Set() } },
        memberPermissions: new Discord.PermissionsBitField(perms), inGuild: () => true,
        options: { getUser: () => cibleUser },
        reply: async r => { i.reponses.push(r) }, editReply: async r => { i.reponses.push(r); return i.message }, followUp: async r => { i.reponses.push(r) },
        deleteReply: async () => {}, deferReply: async () => { i.deferred = true }
    }
    return i
}
const lancer = (nom, i) => bot.commands.get(nom).run(null, i, i.options)
const texte = i => { const r = i.reponses.at(-1); return typeof r === "string" ? r : r?.content ?? "" }
const tout = pages => pages.map(p => p.data.description).join("\n")

test("/dossier : refusé à un non-staff, accepté avec ModerateMembers ou le rôle staff", async () => {
    const commande = bot.commands.get("dossier")
    assert.strictEqual(commande.module, "moderation")
    assert.ok(await controler(interaction({ perms: [] }), commande), "sans permission : refusé")
    assert.strictEqual(await controler(interaction({ perms: [Flags.ModerateMembers] }), commande), null)

    db.setStaffRole(G, "123456789012345678")
    const staff = interaction({ perms: [] })
    staff.member = { roles: { cache: new Set(["123456789012345678"]) } }
    assert.strictEqual(await controler(staff, commande), null, "le rôle staff suffit (lecture seule)")
})

test("/dossier : son propre dossier est toujours refusé, même pour un admin", async () => {
    const i = interaction({ user: CIBLE, perms: [Flags.Administrator, Flags.ManageGuild, Flags.ModerateMembers] })
    await lancer("dossier", i)
    assert.ok(texte(i).includes("propre dossier"), texte(i))
    assert.strictEqual(i.deferred, false, "refusé avant tout travail")
    assert.ok(i.reponses[0].flags, "refus éphémère")

    const historique = interaction({ user: CIBLE })
    await lancer("historique", historique)
    assert.ok(texte(historique).includes("propre dossier"), "/historique suit les mêmes règles")
})

test("notes masquées si la cible a un rôle plus haut ou égal, sauf ManageGuild ou propriétaire", async () => {
    notes.ajouterNote(G, CIBLE, MOD, "note secrète du staff")

    const bas = construirePages(interaction(), cible, membre(1))
    assert.ok(tout(bas.pages).includes("note secrète du staff"), "cible plus basse : notes visibles")
    assert.ok(bas.debuts.notes > 0)

    for (const position of [10, 50]) {
        const haut = construirePages(interaction(), cible, membre(position))
        const texteTotal = tout(haut.pages)
        assert.ok(!texteTotal.includes("note secrète"), `rôle ${position} : texte des notes masqué`)
        assert.ok(texteTotal.includes("masquées"), "le résumé le dit")
        assert.strictEqual(haut.debuts.notes, undefined, "pas de page de notes")
    }

    const gestionnaire = interaction({ perms: [Flags.ModerateMembers, Flags.ManageGuild] })
    assert.ok(tout(construirePages(gestionnaire, cible, membre(50)).pages).includes("note secrète"), "ManageGuild voit tout")
    const proprio = interaction({ user: PROPRIO })
    assert.strictEqual(notesVisibles(proprio, membre(50)), true, "le propriétaire aussi")

    // Membre parti du serveur : ni rôle staff seul ni ModerateMembers, seulement ManageGuild ou le propriétaire
    const staffSeul = interaction({ perms: [] })
    staffSeul.member = { roles: { cache: new Set(["123456789012345678"]), highest: role(10) } }
    assert.strictEqual(notesVisibles(staffSeul, null), false, "rôle staff seul : notes masquées")
    assert.strictEqual(notesVisibles(interaction(), null), false, "ModerateMembers seul : notes masquées")
    const parti = construirePages(interaction(), cible, null)
    assert.ok(!tout(parti.pages).includes("note secrète"), "texte masqué")
    assert.strictEqual(parti.debuts.notes, undefined)
    assert.ok(tout(construirePages(gestionnaire, cible, null).pages).includes("note secrète"), "ManageGuild voit les notes d'un membre parti")
    assert.strictEqual(notesVisibles(proprio, null), true, "le propriétaire aussi")

    // Ni le texte ni le nombre des notes dans l'ouverture « sanctions » de /historique
    db.addCase(G, { userId: CIBLE, moderatorId: MOD, type: "kick", reason: "raison visible" })
    const i = interaction({ cibleMembre: membre(50) })
    await lancer("historique", i)
    const description = i.reponses.at(-1).embeds[0].data.description
    assert.ok(description.includes("raison visible"))
    assert.ok(!description.includes("note(s) du staff"), "le nombre de notes est masqué aussi")
})

test("résumé : âge du compte, arrivée, warns, sanctions actives et annulées, notes, tickets, appels", () => {
    const U = "333333333333333502"
    const idWarn = db.addWarn(G, U, MOD, "spam")
    db.addWarn(G, U, MOD, "spam 2")
    const kick = db.addCase(G, { userId: U, moderatorId: MOD, type: "kick", reason: "ancien" })
    require('../Fonctions/cases').annulerCase(G, kick, MOD)
    notes.ajouterNote(G, U, MOD, "une note")
    db.sqlRun("INSERT INTO tickets (channel_id, guild_id, owner_id, created_at, status) VALUES (?, ?, ?, ?, ?)", ["900000000000000001", G, U, Date.now(), "ouvert"])
    db.sqlRun("INSERT INTO tickets (channel_id, guild_id, owner_id, created_at, status) VALUES (?, ?, ?, ?, ?)", ["900000000000000002", G, U, Date.now(), "ferme"])
    db.sqlRun("INSERT INTO tickets (channel_id, guild_id, owner_id, created_at, status) VALUES (?, ?, ?, ?, ?)", ["900000000000000003", "autre", U, Date.now(), "ouvert"])
    appels.creerAppel(G, U, db.listCases(G, U).find(c => c.warn_id === idWarn).id, "mon appel est sincère")

    const { pages, debuts } = construirePages(interaction(), { ...cible, id: U }, membre(1))
    const resume = pages[0].data.description
    assert.ok(resume.includes("**2** warn(s)"), resume)
    assert.ok(resume.includes("**2** sanction(s) active(s)") && resume.includes("**1** annulée"), "warns actifs comptés comme sanctions, kick annulé à part")
    assert.ok(resume.includes("**1** note(s)"))
    assert.ok(resume.includes("**1** ouvert(s) sur **2**"), "tickets de ce serveur seulement")
    assert.ok(resume.includes("**1** dont **1** en attente"))
    assert.ok(resume.includes("<t:"), "dates relatives")
    assert.ok(debuts.sanctions > 0 && debuts.notes > 0 && debuts.appels > 0)
    assert.ok(pages[debuts.appels].data.description.includes("mon appel est sincère"))
    assert.ok(pages[debuts.sanctions].data.description.includes("~~ancien~~"), "sanction annulée barrée")
    assert.ok(pages.every((p, i) => p.data.footer.text.includes(`${i + 1}/${pages.length}`)))
})

test("pagination : boutons Précédent / Suivant limités à l'auteur", async () => {
    const U = "333333333333333503"
    for (let n = 1; n <= 12; n++) db.addCase(G, { userId: U, moderatorId: MOD, type: "kick", reason: `sanction ${n}` })
    const i = interaction()
    const collecteur = new EventEmitter()
    i.message = { createMessageComponentCollector: options => { collecteur.options = options; return collecteur } }

    await lancer("dossier", Object.assign(i, { options: { getUser: () => ({ ...cible, id: U }) } }))
    const premiere = i.reponses.at(-1)
    assert.ok(premiere.embeds[0].data.title.includes("cible#0001"))
    const boutons = premiere.components[0].components
    assert.strictEqual(boutons[0].data.disabled, true, "pas de page avant la première")
    assert.strictEqual(boutons[1].data.disabled, false)
    assert.strictEqual(collecteur.options.time, 5 * 60 * 1000)

    const { filter } = collecteur.options
    assert.strictEqual(filter({ user: { id: MOD }, customId: `dossier-suiv-${i.id}` }), true)
    assert.strictEqual(filter({ user: { id: "autre" }, customId: `dossier-suiv-${i.id}` }), false, "un autre membre ne navigue pas")
    assert.strictEqual(filter({ user: { id: MOD }, customId: "dossier-suiv-autre" }), false, "bouton d'un autre dossier")

    const mises = []
    collecteur.emit("collect", { customId: `dossier-suiv-${i.id}`, update: async r => { mises.push(r) } })
    collecteur.emit("collect", { customId: `dossier-suiv-${i.id}`, update: async r => { mises.push(r) } })
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(mises[0].embeds[0].data.footer.text.includes("2/"), "page suivante")
    assert.ok(mises[1].embeds[0].data.footer.text.includes("3/"))
    collecteur.emit("collect", { customId: `dossier-prec-${i.id}`, update: async r => { mises.push(r) } })
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(mises[2].embeds[0].data.footer.text.includes("2/"), "page précédente")

    collecteur.emit("end")
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(i.reponses.at(-1).components[0].components.every(b => b.data.disabled), "boutons désactivés au bout de 5 minutes")
})

test("/historique ouvre le dossier sur les sanctions, avec le nombre de notes visibles", async () => {
    const U = "333333333333333504"
    const numero = db.addCase(G, { userId: U, moderatorId: MOD, type: "kick", reason: "raison visible" })
    notes.ajouterNote(G, U, MOD, "secret")
    require('../Fonctions/cases').annulerCase(G, numero, MOD)
    const i = interaction()
    Object.assign(i, { options: { getUser: () => ({ ...cible, id: U }) } })
    await lancer("historique", i)
    const description = i.reponses.at(-1).embeds[0].data.description
    assert.ok(description.includes("~~raison visible~~") && description.includes("Annulée"))
    assert.ok(description.includes("1 note"))
    assert.ok(!description.includes("secret"), "le texte des notes reste dans la page des notes")
})
