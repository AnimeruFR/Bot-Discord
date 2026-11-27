process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const db = require('../Fonctions/db')
const donneesMembre = require('../Fonctions/donneesMembre')
const cases = require('../Fonctions/cases')
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

test("compte gelé : le portefeuille (solde, journal) est différé et le gel reste, le reste est effacé", () => {
    const G4 = "777777777777777777"
    const economie = require('../Fonctions/economie')
    db.sqlRun("INSERT INTO eco_comptes (guild_id, user_id, balance, frozen, created_at) VALUES (?, ?, 500, 1, ?)", [G4, U, Date.now()])
    db.sqlRun("INSERT INTO eco_journal (guild_id, user_id, delta, balance_after, source, created_at) VALUES (?, ?, 500, 500, 'test', ?)", [G4, U, Date.now()])
    db.sqlRun("INSERT INTO profils (guild_id, user_id, bio) VALUES (?, ?, 'ma bio')", [G4, U])
    assert.strictEqual(donneesMembre.portefeuilleGele(G4, U), true)

    const resume = donneesMembre.effacer(G4, U)
    assert.deepStrictEqual(resume.eco_comptes, { differees: 1 })
    assert.deepStrictEqual(resume.eco_journal, { differees: 1 })
    assert.ok(donneesMembre.aDesDifferees(resume))
    assert.strictEqual(resume.profils.effacees, 1)
    assert.deepStrictEqual([economie.compte(G4, U).balance, economie.compte(G4, U).frozen], [500, true], "solde et gel intacts")
    assert.ok(economie.verifierCoherence(G4, U))

    // Après le dégel, le portefeuille s'efface (solde à 0, journal vide, cohérent)
    economie.geler(G4, U, false)
    const apres = donneesMembre.effacer(G4, U)
    assert.strictEqual(apres.eco_comptes.reinitialisees, 1)
    assert.strictEqual(apres.eco_journal.effacees, 1)
    assert.strictEqual(economie.compte(G4, U).balance, 0)
    assert.ok(economie.verifierCoherence(G4, U))
    assert.ok(!donneesMembre.aDesDifferees(apres))
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
test("export : les modifications des sanctions du membre (case_edits) y figurent, pas celles des autres", () => {
    const W = "666666666666666601", X = "666666666666666602", EDITEUR = "666666666666666603"
    const casesW = db.addCase(G1, { userId: W, moderatorId: EDITEUR, type: "kick", reason: "avant" })
    const casesX = db.addCase(G1, { userId: X, moderatorId: EDITEUR, type: "kick", reason: "autre membre" })
    const casesAutreServeur = db.addCase(G2, { userId: W, moderatorId: EDITEUR, type: "kick", reason: "serveur 2" })
    cases.modifierRaison(G1, casesW, EDITEUR, "après")
    cases.modifierRaison(G1, casesX, EDITEUR, "modifiée")
    cases.modifierRaison(G2, casesAutreServeur, EDITEUR, "modifiée 2")

    // Le membre sanctionné reçoit les modifications de sa sanction, en entier
    const exportW = donneesMembre.exporter(G1, W)
    assert.strictEqual(exportW.tables.case_edits.lignes.length, 1)
    assert.strictEqual(exportW.tables.case_edits.lignes[0].old_value, "avant")
    assert.strictEqual(exportW.tables.case_edits.lignes[0].new_value, "après")
    assert.ok(exportW.tables.case_edits.traitement_a_l_effacement["case_id (via cases.user_id)"].includes("2 ans"))

    // L'éditeur n'est qu'auteur de l'action : lignes réduites, sans la raison des autres
    const exportEditeur = donneesMembre.exporter(G1, EDITEUR)
    assert.strictEqual(exportEditeur.tables.case_edits.lignes.length, 2)
    assert.ok(exportEditeur.tables.case_edits.lignes.every(l => l.old_value === undefined && l.role_du_membre.includes("editor_id")))
    assert.strictEqual(donneesMembre.exporter(G1, "999999999999999998").tables.case_edits, undefined)

    // Effacement inchangé : la trace est conservée, seul l'éditeur est anonymisé
    donneesMembre.effacer(G1, W)
    assert.strictEqual(compter("SELECT COUNT(*) AS n FROM case_edits WHERE guild_id = ? AND case_id = ?", [G1, casesW]), 1)
})

// --- Empreinte anti-abus (phase 3) -------------------------------------------------------------------------------

const JOUR = 24 * 3600 * 1000

// Faux serveur et faux membre ancien (pas de réduction « nouveau ») pour les modules de jeu
function serveurDeJeu(guildId) {
    const membres = new Map()
    const guild = {
        id: guildId, ownerId: "1", preferredLocale: "fr", roles: { cache: new Map() }, channels: { cache: new Map() },
        members: { me: { id: "bot", roles: { highest: { position: 10 } } }, fetch: async id => membres.get(id) }
    }
    const joueur = id => {
        const m = {
            id, guild, joinedTimestamp: Date.now() - 30 * JOUR, communicationDisabledUntilTimestamp: null, user: { id, bot: false },
            roles: { cache: new Map(), add: async () => {}, remove: async () => {} }
        }
        membres.set(id, m)
        return m
    }
    return { guild, joueur }
}

test("empreinte : après effacement, daily, succès, palier, quête et mot du jour ne rapportent rien de plus ; le gel reste", async () => {
    const G = "121212121212121212", M = "343434343434343434", GELE = "565656565656565656"
    const evenements = require('../Fonctions/evenements')
    const economie = require('../Fonctions/economie')
    const daily = require('../Fonctions/daily')
    const succes = require('../Fonctions/succes')
    const quetes = require('../Fonctions/quetes')
    const xp = require('../Fonctions/xp')
    const paliers = require('../Fonctions/paliers')
    const mots = require('../Fonctions/mots')
    evenements.retirerEcouteurs() // les événements sont rejoués à la main, dans l'ordre
    const { guild, joueur } = serveurDeJeu(G)
    const membre = joueur(M)
    succes.configurerClient({ guilds: { cache: new Map([[G, guild]]) } })
    paliers.definirPalier(G, { niveau: 1, recompense: 30 })
    const salon = { id: "salon", send: async () => {} }
    const message = { guild, member: membre, channel: salon, channelId: salon.id, author: { bot: false } }
    const maintenant = Date.now()
    const gainsHorsXp = () => db.sqlAll("SELECT COALESCE(SUM(delta), 0) AS n FROM eco_journal WHERE guild_id = ? AND user_id = ? AND source != 'xp'", [G, M])[0].n

    const jouerTout = async decalage => {
        const d = daily.reclamer(membre, maintenant)
        await succes.enregistrer("daily", { guildId: G, userId: M, streak: 1 })
        quetes.quetesDuMembre(G, M, { instant: maintenant })
        db.sqlRun("UPDATE quetes SET progress = goal WHERE guild_id = ? AND user_id = ?", [G, M]) // quêtes terminées
        const q = quetes.reclamer(membre, { instant: maintenant })
        const gainXp = await xp.gagnerXp(message, { maintenant: maintenant + decalage, alea: () => 0 })
        const secret = mots.motDuJour(G, evenements.jourParis(), "fr")
        const essai = mots.proposerEssai({ guildId: G, userId: M, essai: secret })
        if (essai.ok) mots.recompenserMot(membre, essai)
        return { d, q, gainXp, essai }
    }

    // 1. Premier passage : tout rapporte
    db.sqlRun("INSERT INTO xp (guild_id, user_id, xp, level) VALUES (?, ?, 99, 0)", [G, M])
    db.sqlRun("INSERT INTO profils (guild_id, user_id, bio) VALUES (?, ?, 'bio')", [G, M])
    db.sqlRun("INSERT INTO anniversaires (guild_id, user_id, day, month) VALUES (?, ?, 3, 4)", [G, M])
    const premier = await jouerTout(0)
    assert.ok(premier.d.ok && premier.q.total > 0 && premier.essai.ok && premier.gainXp.niveau === 1)
    const sources = new Set(db.sqlAll("SELECT source FROM eco_journal WHERE guild_id = ? AND user_id = ?", [G, M]).map(l => l.source))
    for (const s of ["daily", "succes", "quete", "palier", "mot"]) assert.ok(sources.has(s), `gain ${s} versé`)

    // 2. Effacement : solde à 0, journal et profil effacés, empreinte gardée
    const resume = donneesMembre.effacer(G, M, { instant: maintenant })
    assert.strictEqual(economie.compte(G, M).balance, 0)
    assert.ok(economie.verifierCoherence(G, M))
    assert.strictEqual(compter("SELECT COUNT(*) AS n FROM profils WHERE guild_id = ? AND user_id = ?", [G, M]), 0)
    assert.strictEqual(compter("SELECT COUNT(*) AS n FROM anniversaires WHERE guild_id = ? AND user_id = ?", [G, M]), 0)
    assert.ok(resume.succes.conservees >= 1 && resume.xp.reinitialisees === 1 && resume.eco_comptes.reinitialisees === 1)
    const ligneXp = db.sqlAll("SELECT xp, level FROM xp WHERE guild_id = ? AND user_id = ?", [G, M])[0]
    assert.deepStrictEqual({ ...ligneXp }, { xp: xp.xpCumulee(1), level: 1 }, "niveau gardé, XP ramenée au seuil")
    assert.strictEqual(compter("SELECT COUNT(*) AS n FROM stats_joueur WHERE guild_id = ? AND user_id = ? AND stat = 'daily_total'", [G, M]), 0, "statistiques effacées")

    // 3. On rejoue la même journée : aucun gain de plus (seule l'XP d'activité peut rapporter 1 ✦)
    const second = await jouerTout(61 * 1000)
    assert.strictEqual(second.d.refus, "deja", "daily déjà pris aujourd'hui")
    assert.strictEqual(second.q.total, 0, "quêtes déjà réclamées")
    assert.strictEqual(second.essai.refus, "deja_fini", "mot du jour déjà joué")
    assert.strictEqual(second.gainXp.niveau, 1, "pas de nouveau passage de niveau")
    assert.strictEqual(gainsHorsXp(), 0, "ni daily, ni succès, ni quête, ni palier, ni mot")
    assert.ok(economie.compte(G, M).balance <= 1)

    // 4. Compte gelé : le gel survit à l'effacement et bloque toujours les gains
    const gele = joueur(GELE)
    economie.crediter(gele, 200, { source: "test" })
    economie.geler(G, GELE, true)
    donneesMembre.effacer(G, GELE, { instant: maintenant })
    assert.strictEqual(economie.compte(G, GELE).frozen, true)
    assert.strictEqual(economie.compte(G, GELE).balance, 200, "portefeuille différé tant que le gel dure")
    assert.strictEqual(economie.peutJouer(gele), "gele")
    assert.strictEqual(daily.reclamer(gele, maintenant).refus, "gele")
})

test("empreinte : la formule SQL de l'XP gardée suit xpCumulee de Fonctions/xp.js", () => {
    const xp = require('../Fonctions/xp')
    const formule = REGISTRE.xp.colonnes.user_id.valeurs.xp
    for (let niveau = 0; niveau <= 200; niveau++) {
        const [{ v }] = db.sqlAll(`SELECT ${formule.replaceAll("level", "?")} AS v`, Array(formule.split("level").length - 1).fill(niveau))
        assert.strictEqual(v, xp.xpCumulee(niveau), `niveau ${niveau}`)
        assert.strictEqual(xp.niveauPourXp(v), niveau)
    }
})

test("empreinte : seules les périodes en cours et précédentes restent (quêtes, jeux du jour, stats)", () => {
    const G = "131313131313131313", M = "353535353535353535"
    const instant = Date.UTC(2026, 10, 26, 12) // jeudi 26 novembre 2026, semaine 2026-W48
    const p = donneesMembre.periodes(instant)
    assert.deepStrictEqual(p, { jour: "2026-11-26", hier: "2026-11-25", semaine: "2026-W48", semainePrecedente: "2026-W47" })
    for (const periode of ["2026-11-26", "2026-11-25", "2026-11-24", "2026-W48", "2026-W47", "2026-W46"]) {
        db.sqlRun("INSERT INTO quetes (guild_id, user_id, period, quest, progress, goal, claimed) VALUES (?, ?, ?, 'q', 1, 1, 1)", [G, M, periode])
    }
    for (const jour of ["2026-11-26", "2026-11-25", "2026-11-20"]) {
        db.sqlRun("INSERT INTO jeux_quotidiens (guild_id, user_id, game, day, finished) VALUES (?, ?, 'mot', ?, 1)", [G, M, jour])
    }
    for (const stat of ["parties_gagnees", "duels_recompenses_jour", "xp_eclats_jour", "paire:succes:paiement:2026-11-26:999", "duels_contre:999", "mot_serie"]) {
        db.sqlRun("INSERT INTO stats_joueur (guild_id, user_id, stat, value) VALUES (?, ?, ?, 1)", [G, M, stat])
    }
    donneesMembre.effacer(G, M, { instant })
    const restent = (sql, col) => db.sqlAll(sql, [G, M]).map(l => l[col]).sort()
    assert.deepStrictEqual(restent("SELECT period FROM quetes WHERE guild_id = ? AND user_id = ?", "period"), ["2026-11-25", "2026-11-26", "2026-W47", "2026-W48"])
    assert.deepStrictEqual(restent("SELECT day FROM jeux_quotidiens WHERE guild_id = ? AND user_id = ?", "day"), ["2026-11-25", "2026-11-26"])
    assert.deepStrictEqual(restent("SELECT stat FROM stats_joueur WHERE guild_id = ? AND user_id = ?", "stat"),
        ["duels_contre:999", "duels_recompenses_jour", "paire:succes:paiement:2026-11-26:999", "xp_eclats_jour"])
})

test("semaineIso suit semaineParis de Fonctions/quetes.js (changements d'année compris)", () => {
    const { semaineParis } = require('../Fonctions/quetes')
    for (let jour = 0; jour < 800; jour += 3) {
        const instant = Date.UTC(2025, 11, 20, 12) + jour * JOUR
        assert.strictEqual(donneesMembre.periodes(instant).semaine, semaineParis(instant))
    }
})

test("export : l'état d'une partie en cours n'est jamais exporté, il l'est après la fin", () => {
    const G = "141414141414141414", M = "363636363636363636"
    const etat = JSON.stringify({ mot: "MAISON", ordre: [3, 1, 2] })
    db.sqlRun("INSERT INTO parties (guild_id, game, players, state, status, expires_at, created_at, updated_at) VALUES (?, 'pendu', ?, ?, 'en_cours', 1, 1, 1)", [G, JSON.stringify([M]), etat])
    db.sqlRun("INSERT INTO parties (guild_id, game, players, state, status, expires_at, created_at, updated_at) VALUES (?, 'quiz', ?, ?, 'finie', 1, 1, 1)", [G, JSON.stringify([M]), etat])
    const lignes = donneesMembre.exporter(G, M).tables.parties.lignes
    const enCours = lignes.find(l => l.status === "en_cours"), finie = lignes.find(l => l.status === "finie")
    assert.strictEqual(enCours.state, donneesMembre.MASQUE)
    assert.ok(!JSON.stringify(enCours).includes("MAISON"))
    assert.strictEqual(finie.state, etat)
})
