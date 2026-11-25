process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const db = require('../Fonctions/db')
const donneesMembre = require('../Fonctions/donneesMembre')
const { REGISTRE, verifier } = require('../Fonctions/registreRgpd')

const G1 = "111111111111111111", G2 = "222222222222222222"
const U = "333333333333333333", V = "444444444444444444", MOD = "555555555555555555"

// Une colonne dont le nom ressemble à un identifiant de membre doit être déclarée dans le registre
const RESSEMBLE_A_UN_MEMBRE = /^(user_id|owner_id|author_id|moderator_id|target_id|member_id|host_id|claimed_by|winners|previous_winners)$|_user_id$|_member_id$|_by$|winners$/

// Renvoie la liste des manques du registre par rapport à la base migrée
function manques() {
    const problemes = []
    const tables = db.sqlAll("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map(l => l.name)
    for (const table of tables) {
        const colonnes = db.sqlAll(`PRAGMA table_info(${table})`).map(c => c.name)
        const def = REGISTRE[table]
        if (!def) {
            problemes.push(`table ${table} absente du registre`)
            continue
        }
        for (const colonne of colonnes.filter(c => RESSEMBLE_A_UN_MEMBRE.test(c))) {
            if (!def.colonnes?.[colonne]) problemes.push(`colonne ${table}.${colonne} non déclarée dans le registre`)
        }
        for (const colonne of Object.keys(def.colonnes ?? {})) {
            if (!colonnes.includes(colonne)) problemes.push(`colonne ${table}.${colonne} déclarée mais absente de la base`)
        }
    }
    for (const table of Object.keys(REGISTRE)) {
        if (!tables.includes(table)) problemes.push(`table ${table} du registre absente de la base`)
    }
    return problemes
}

test("garde-fou : toute colonne de membre de la base est déclarée dans le registre", () => {
    assert.deepStrictEqual(verifier(), [], "forme du registre")
    assert.deepStrictEqual(manques(), [])
})

test("garde-fou : une nouvelle table ou colonne de membre non déclarée fait échouer le test", () => {
    db.sqlRun("CREATE TABLE tmp_xp (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, points INTEGER)")
    db.sqlRun("CREATE TABLE tmp_notes (guild_id TEXT NOT NULL, note TEXT)")
    try {
        REGISTRE.tmp_notes = { serveur: "guild_id", aucune: "test" }
        const problemes = manques()
        assert.deepStrictEqual(problemes, ["table tmp_xp absente du registre"])
        REGISTRE.tmp_xp = { serveur: "guild_id", aucune: "oubli de la colonne" }
        assert.deepStrictEqual(manques(), ["colonne tmp_xp.user_id non déclarée dans le registre"])
    } finally {
        delete REGISTRE.tmp_xp
        delete REGISTRE.tmp_notes
        db.sqlRun("DROP TABLE tmp_xp")
        db.sqlRun("DROP TABLE tmp_notes")
    }
})

// Données de plusieurs tables : U est sanctionné, modérateur, auteur de ticket, organisateur et gagnant de giveaway…
function remplir() {
    db.addWarn(G1, U, MOD, "spam")
    db.addWarn(G1, V, U, "insultes")
    db.addWarn(G2, U, MOD, "autre serveur")
    for (const [g, u] of [[G1, U], [G1, V], [G2, U]]) db.setTicketCooldown(g, u)
    db.sqlRun("INSERT INTO tempbans (guild_id, user_id, expires_at) VALUES (?, ?, ?)", [G1, U, Date.now() + 100000])
    for (const [canal, g, proprietaire, staff] of [["c1", G1, U, MOD], ["c2", G1, V, U], ["c3", G2, U, MOD]]) {
        db.sqlRun("INSERT INTO tickets (channel_id, guild_id, owner_id, claimed_by, created_at, rating) VALUES (?, ?, ?, ?, ?, 4)", [canal, g, proprietaire, staff, 1000])
    }
    const giveaway = (g, hote, gagnants, anciens) => Number(db.sqlRun(
        "INSERT INTO giveaways (guild_id, channel_id, prix, gagnants, ends_at, host_id, winners, previous_winners) VALUES (?, 'ch', 'Nitro', 2, 1, ?, ?, ?)",
        [g, hote, JSON.stringify(gagnants), JSON.stringify(anciens)]) && db.sqlAll("SELECT MAX(id) AS id FROM giveaways")[0].id)
    const g1 = giveaway(G1, U, [U, V], [V, U, MOD])
    const g2 = giveaway(G2, U, [U], [])
    const g3 = giveaway(G1, MOD, [V], [])
    for (const [id, u] of [[g1, U], [g1, V], [g2, U], [g3, V]]) db.sqlRun("INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)", [id, u])
    db.sqlRun("INSERT INTO announcements (guild_id, channel_id, author_id, contenu, send_at) VALUES (?, 'ch', ?, 'Salut', 1)", [G1, U])
    db.sqlRun("INSERT INTO announcements (guild_id, channel_id, author_id, contenu, send_at) VALUES (?, 'ch', ?, 'Autre', 1)", [G2, U])
    return { g1, g2, g3 }
}

const compter = (sql, params = []) => db.sqlAll(sql, params)[0].n

test("export puis effacement d'un membre : les autres membres et serveurs restent intacts", () => {
    const { g1, g2, g3 } = remplir()

    // Export : seulement ce qui concerne U sur G1
    const exportU = donneesMembre.exporter(G1, U)
    assert.strictEqual(exportU.membre, U)
    assert.deepStrictEqual(Object.keys(exportU.tables).sort(),
        ["announcements", "cases", "giveaway_entries", "giveaways", "warns", "tempbans", "ticket_cooldowns", "tickets"].sort())
    assert.strictEqual(exportU.tables.warns.lignes.length, 2, "warn reçu et warn donné comme modérateur")
    assert.strictEqual(exportU.tables.tickets.lignes.length, 2, "ticket ouvert et ticket pris en charge")
    assert.strictEqual(exportU.tables.giveaways.lignes.length, 1)
    assert.ok(exportU.tables.warns.traitement_a_l_effacement.user_id.includes("2 ans"))
    assert.strictEqual(donneesMembre.exporter(G1, "999999999999999999").tables.warns, undefined, "membre inconnu : rien")
    JSON.stringify(exportU) // sérialisable

    const resume = donneesMembre.effacer(G1, U)
    assert.strictEqual(resume.ticket_cooldowns.conservees, 1, "délai anti-spam conservé")
    assert.strictEqual(resume.giveaway_entries.effacees, 1)
    assert.strictEqual(resume.warns.conservees, 1)
    assert.strictEqual(resume.warns.anonymisees, 1)
    assert.strictEqual(resume.tickets.anonymisees, 2)
    assert.strictEqual(resume.tempbans.conservees, 1)
    assert.strictEqual(resume.announcements.anonymisees, 1)
    assert.strictEqual(resume.guild_config, undefined)

    // Effacé
    assert.ok(db.getTicketCooldown(G1, U) > 0, "le délai anti-spam reste (10 min)")
    assert.strictEqual(compter("SELECT COUNT(*) AS n FROM giveaway_entries WHERE user_id = ? AND giveaway_id = ?", [U, g1]), 0)

    // Conservé (sanctions reçues, ban en cours)
    assert.strictEqual(db.countWarns(G1, U), 1)
    assert.strictEqual(compter("SELECT COUNT(*) AS n FROM cases WHERE guild_id = ? AND user_id = ?", [G1, U]), 1)
    assert.strictEqual(compter("SELECT COUNT(*) AS n FROM tempbans WHERE guild_id = ? AND user_id = ?", [G1, U]), 1)

    // Anonymisé : le reste de la ligne est gardé
    const warnV = db.sqlAll("SELECT * FROM warns WHERE guild_id = ? AND user_id = ?", [G1, V])[0]
    assert.strictEqual(warnV.moderator_id, "0")
    assert.strictEqual(warnV.reason, "insultes")
    assert.strictEqual(db.sqlAll("SELECT moderator_id FROM cases WHERE guild_id = ? AND user_id = ?", [G1, V])[0].moderator_id, "0")
    const c1 = db.sqlAll("SELECT * FROM tickets WHERE channel_id = 'c1'")[0]
    assert.deepStrictEqual([c1.owner_id, c1.claimed_by, c1.rating, c1.created_at, c1.guild_id, c1.status], ["0", MOD, 4, 1000, G1, "ouvert"])
    const c2 = db.sqlAll("SELECT * FROM tickets WHERE channel_id = 'c2'")[0]
    assert.deepStrictEqual([c2.owner_id, c2.claimed_by, c2.rating], [V, "0", 4])
    const gw1 = db.sqlAll("SELECT * FROM giveaways WHERE id = ?", [g1])[0]
    assert.deepStrictEqual([gw1.host_id, gw1.winners, gw1.previous_winners, gw1.prix, gw1.gagnants], ["0", JSON.stringify(["0", V]), JSON.stringify([V, "0", MOD]), "Nitro", 2])
    const annonce = db.sqlAll("SELECT * FROM announcements WHERE guild_id = ?", [G1])[0]
    assert.deepStrictEqual([annonce.author_id, annonce.contenu], ["0", "Salut"])

    // Autres membres et autres serveurs : rien n'a changé
    assert.strictEqual(db.getTicketCooldown(G1, V) > 0, true)
    assert.strictEqual(db.getTicketCooldown(G2, U) > 0, true)
    assert.strictEqual(db.countWarns(G2, U), 1)
    assert.strictEqual(db.sqlAll("SELECT owner_id FROM tickets WHERE channel_id = 'c3'")[0].owner_id, U)
    const gw2 = db.sqlAll("SELECT * FROM giveaways WHERE id = ?", [g2])[0]
    assert.deepStrictEqual([gw2.host_id, gw2.winners], [U, JSON.stringify([U])])
    const gw3 = db.sqlAll("SELECT * FROM giveaways WHERE id = ?", [g3])[0]
    assert.deepStrictEqual([gw3.host_id, gw3.winners], [MOD, JSON.stringify([V])])
    assert.strictEqual(compter("SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?", [g1, V]), 1)
    assert.strictEqual(compter("SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?", [g2, U]), 1, "participation sur un autre serveur")
    assert.strictEqual(db.sqlAll("SELECT author_id FROM announcements WHERE guild_id = ?", [G2])[0].author_id, U)

    // Rejouer l'effacement ne change plus rien (hors lignes conservées)
    const encore = donneesMembre.effacer(G1, U)
    assert.strictEqual(encore.ticket_cooldowns.effacees, undefined)
    assert.strictEqual(encore.tickets, undefined)
    assert.strictEqual(encore.warns.anonymisees, undefined)
})

test("l'effacement est atomique : une erreur au milieu n'efface rien", () => {
    const G3 = "666666666666666666"
    db.addWarn(G3, V, U, "x")
    db.setTicketCooldown(G3, U)
    db.sqlRun("INSERT INTO announcements (guild_id, channel_id, author_id, contenu, send_at) VALUES (?, 'ch', ?, 'A', 1)", [G3, U])
    const avant = JSON.stringify(donneesMembre.exporter(G3, U).tables)

    // Table inconnue de la base, traitée en dernier : le SQL échoue après les autres tables
    REGISTRE.table_fantome = { serveur: "guild_id", colonnes: { user_id: { traitement: "effacer", motif: "test" } } }
    try {
        assert.throws(() => donneesMembre.effacer(G3, U), /table_fantome/)
    } finally {
        delete REGISTRE.table_fantome
    }
    assert.strictEqual(JSON.stringify(donneesMembre.exporter(G3, U).tables), avant, "rien n'a changé")
    assert.ok(db.getTicketCooldown(G3, U) > 0)
    assert.strictEqual(db.sqlAll("SELECT moderator_id FROM warns WHERE guild_id = ?", [G3])[0].moderator_id, U)

    // La transaction est bien terminée : une écriture suivante marche
    assert.doesNotThrow(() => donneesMembre.effacer(G3, U))
    assert.strictEqual(db.sqlAll("SELECT moderator_id FROM warns WHERE guild_id = ?", [G3])[0].moderator_id, "0")
})

test("refusEffacement : un motif diffère l'effacement sans rien modifier", () => {
    const G4 = "777777777777777777"
    assert.strictEqual(donneesMembre.refusEffacement(G4, U), null)
    db.setTicketCooldown(G4, U)
    const original = donneesMembre.refusEffacement
    donneesMembre.refusEffacement = () => "séquestre en cours"
    try {
        assert.throws(() => donneesMembre.effacer(G4, U), err => err.code === "RGPD_DIFFERE" && err.motif === "séquestre en cours")
    } finally {
        donneesMembre.refusEffacement = original
    }
    assert.ok(db.getTicketCooldown(G4, U) > 0)
    const resume = donneesMembre.effacer(G4, U)
    assert.strictEqual(resume.ticket_cooldowns.conservees, 1)
})

test("export : une ligne trouvée seulement comme auteur sort sous forme réduite, sans tiers", () => {
    const G5 = "888888888888888881"
    const T = "999999999999999991" // sanctionné par U
    db.sqlRun("INSERT INTO warns (guild_id, user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, 'secret', 5)", [G5, T, U])
    db.sqlRun("INSERT INTO warns (guild_id, user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, 'reçu', 6)", [G5, U, MOD])
    db.sqlRun("INSERT INTO cases (guild_id, user_id, moderator_id, type, reason, created_at) VALUES (?, ?, ?, 'ban', 'raison', 7)", [G5, T, U])
    db.sqlRun("INSERT INTO tickets (channel_id, guild_id, owner_id, claimed_by, created_at) VALUES ('cx', ?, ?, ?, 8)", [G5, T, U])
    db.sqlRun("INSERT INTO giveaways (guild_id, channel_id, prix, gagnants, ends_at, host_id, winners, previous_winners) VALUES (?, 'ch', 'Nitro', 1, 9, ?, ?, '[]')", [G5, U, JSON.stringify([T])])
    db.sqlRun("INSERT INTO announcements (guild_id, channel_id, author_id, contenu, send_at) VALUES (?, 'ch', ?, 'texte', 10)", [G5, U])

    const tables = donneesMembre.exporter(G5, U).tables
    const texte = JSON.stringify(tables)
    assert.ok(!texte.includes(T), "aucun identifiant de tiers")
    assert.ok(!texte.includes("secret") && !texte.includes("raison") && !texte.includes("texte") && !texte.includes("Nitro"))

    const donne = tables.warns.lignes.find(l => l.role_du_membre)
    assert.deepStrictEqual(Object.keys(donne).sort(), ["created_at", "id", "role_du_membre"])
    assert.deepStrictEqual(donne.role_du_membre, ["moderator_id"])
    assert.strictEqual(tables.cases.lignes[0].created_at, 7)
    assert.deepStrictEqual(tables.tickets.lignes[0].role_du_membre, ["claimed_by"])
    assert.deepStrictEqual(tables.giveaways.lignes[0].role_du_membre, ["host_id"])
    assert.strictEqual(tables.giveaways.lignes[0].ends_at, 9, "les dates sont gardées")
    assert.deepStrictEqual(tables.announcements.lignes[0].role_du_membre, ["author_id"])

    // Ligne qui le concerne : complète, avec l'identifiant du modérateur
    const recu = tables.warns.lignes.find(l => l.reason === "reçu")
    assert.strictEqual(recu.user_id, U)
    assert.strictEqual(recu.moderator_id, MOD)
})

test("registre : le délai de tickets est conservé 10 min (anti-spam)", () => {
    const c = REGISTRE.ticket_cooldowns.colonnes.user_id
    assert.deepStrictEqual([c.traitement, c.duree], ["conserver", "10 min"])
})

// Interaction minimale pour exécuter /privacy moi effacer sans Discord
function fausseInteraction(guildId, userId, reponseBouton) {
    const id = `i${Math.random()}`
    const reponses = []
    const interaction = {
        id, guildId, locale: "fr", guild: { id: guildId, ownerId: "0" },
        user: { id: userId },
        inCachedGuild: () => true,
        inGuild: () => true,
        reply: async options => {
            reponses.push(options.content)
            return { resource: { message: { awaitMessageComponent: async () => reponseBouton === "temps" ? Promise.reject(new Error("temps")) : ({
                customId: `rgpdmoi-${reponseBouton}-${id}`, update: async () => {}
            }) } } }
        },
        editReply: async options => { reponses.push(options.content) }
    }
    return { interaction, reponses }
}

test("/privacy moi effacer : une fois par heure, libéré si annulé ou si le délai de confirmation expire", async () => {
    const commande = require('../Commandes/General/privacy')
    const cooldowns = require('../Fonctions/cooldowns')
    cooldowns.vider()
    const G6 = "888888888888888882", W = "999999999999999992"
    const lancer = async reponse => {
        const { interaction, reponses } = fausseInteraction(G6, W, reponse)
        await commande.run(null, interaction, { getBoolean: () => null, getString: () => "effacer" })
        return reponses
    }
    await lancer("non")
    await lancer("temps")
    assert.doesNotMatch((await lancer("oui")).join(" "), /moins d.une heure/, "annulation et temps écoulé n'ont pas bloqué")
    const bloquee = await lancer("oui")
    assert.match(bloquee[0], /moins d'une heure/)
    assert.strictEqual(bloquee.length, 1)
    cooldowns.vider()
})