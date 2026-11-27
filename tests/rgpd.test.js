process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const db = require('../Fonctions/db')
const privacy = require('../Fonctions/privacy')

const G1 = "111111111111111111", G2 = "222222222222222222", U = "333333333333333333", MOD = "444444444444444444"

test("RGPD (panne, retour, purge à 30 jours, isolation)", async () => {
    const G3 = "555555555555555551", G4 = "555555555555555552"
    db.addWarn(G3, U, MOD, "a"); db.setLogChannel(G3, "666666666666666661"); db.setTicketCooldown(G3, U)
    db.addWarn(G4, U, MOD, "b")

    assert.strictEqual(privacy.onGuildDelete({ id: G3, available: false }), false, "panne : rien n'est noté")
    assert.strictEqual(db.guildsLeftBefore(Date.now() + 1).includes(G3), false)

    const ilYa31Jours = Date.now() - 31 * 24 * 3600 * 1000
    db.markGuildLeft(G3, ilYa31Jours)
    db.markGuildLeft(G3) // une 2e notification ne repousse pas la date
    assert.ok(db.guildsLeftBefore(Date.now() - 30 * 24 * 3600 * 1000).includes(G3), "date de départ conservée")

    assert.deepStrictEqual(privacy.purge(new Set([G3])), [], "revenu sur le serveur : rien n'est effacé")
    assert.strictEqual(db.countWarns(G3, U), 1)

    db.markGuildLeft(G3, ilYa31Jours)
    assert.deepStrictEqual(privacy.purge(new Set([G4])), [G3], "parti depuis 31 jours : effacé")
    assert.strictEqual(db.countWarns(G3, U), 0)
    assert.strictEqual(db.getLogChannel(G3), null)
    assert.strictEqual(db.getTicketCooldown(G3, U), 0)
    assert.strictEqual(db.countWarns(G4, U), 1, "les autres serveurs ne sont pas touchés")

    assert.strictEqual(privacy.reconcile(new Set([G1, G2])) >= 1, true, "serveur quitté pendant que le bot était éteint détecté")
    assert.ok(db.guildsLeftBefore(Date.now() + 1).includes(G4))
    assert.deepStrictEqual(privacy.purge(new Set([G1, G2])).includes(G4), false, "pas effacé avant 30 jours")
    privacy.onGuildCreate({ id: G4 })
    assert.ok(!db.guildsLeftBefore(Date.now() + 1).includes(G4), "retour sur le serveur : suppression annulée")
    assert.strictEqual(db.deleteGuildData(G4), 2, "le warn et sa ligne d'historique")
})

test("purgeOldWarns : les avertissements de plus de 2 ans sont effacés, les autres restent", () => {
    const G5 = "555555555555555553", deuxAns = 2 * 365 * 24 * 3600 * 1000
    db.sqlRun("INSERT INTO warns (guild_id, user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, 'vieux', ?)", [G5, U, MOD, Date.now() - deuxAns - 1000])
    db.addWarn(G5, U, MOD, "récent")
    assert.strictEqual(db.purgeOldWarns(Date.now() - deuxAns), 1)
    assert.strictEqual(db.countWarns(G5, U), 1)
    assert.strictEqual(db.purgeOldWarns(Date.now() - deuxAns), 0)
})

const JOUR = 24 * 3600 * 1000

test("purge des jeux : quêtes du jour et de la semaine, traces avec l'identifiant d'un autre membre, parties", () => {
    const G = "555555555555555560", A = "555555555555555561", AUTRE = "555555555555555562"
    const maintenant = Date.UTC(2026, 10, 26, 12) // jeudi 26/11/2026 (2026-W48)
    for (const periode of ["2026-11-26", "2026-10-28", "2026-10-26", "2026-W48", "2026-W44", "2026-W43", "2025-W52"]) {
        db.sqlRun("INSERT INTO quetes (guild_id, user_id, period, quest, goal) VALUES (?, ?, ?, 'q', 1)", [G, A, periode])
    }
    for (const stat of [`paire:succes:paiement:2026-11-26:${AUTRE}`, `paire:succes:paiement:2026-11-23:${AUTRE}`,
        `paire:quete:semaine:rep:donnee:2026-W47:${AUTRE}`, `paire:quete:semaine:rep:donnee:2026-W46:${AUTRE}`, "parties_gagnees"]) {
        db.sqlRun("INSERT INTO stats_joueur (guild_id, user_id, stat, value) VALUES (?, ?, ?, 1)", [G, A, stat])
    }
    db.sqlRun("INSERT INTO stats_joueur (guild_id, user_id, stat, value) VALUES (?, ?, ?, ?)", [G, A, `duels_contre:${AUTRE}`, 2026112602])
    db.sqlRun("INSERT INTO stats_joueur (guild_id, user_id, stat, value) VALUES (?, ?, ?, ?)", [G, A, "duels_contre:777", 2026112001])

    privacy.purgerJeux(maintenant)
    const periodes = db.sqlAll("SELECT period FROM quetes WHERE guild_id = ?", [G]).map(l => l.period).sort()
    assert.deepStrictEqual(periodes, ["2026-10-28", "2026-11-26", "2026-W44", "2026-W48"], "30 jours pour chaque format")
    const stats = db.sqlAll("SELECT stat FROM stats_joueur WHERE guild_id = ?", [G]).map(l => l.stat).sort()
    assert.deepStrictEqual(stats, [`duels_contre:${AUTRE}`, `paire:quete:semaine:rep:donnee:2026-W47:${AUTRE}`,
        `paire:succes:paiement:2026-11-26:${AUTRE}`, "parties_gagnees"].sort())
})

test("purge des jeux : membre sans activité depuis 1 an effacé, sauf compte gelé ou sans date connue", () => {
    const G = "555555555555555570", PARTI = "555555555555555571", ACTIF = "555555555555555572", GELE = "555555555555555573", SANS_DATE = "555555555555555574"
    const maintenant = Date.now(), vieux = maintenant - 400 * JOUR
    for (const [u, date, gele] of [[PARTI, vieux, 0], [ACTIF, vieux, 0], [GELE, vieux, 1]]) {
        db.sqlRun("INSERT INTO eco_comptes (guild_id, user_id, balance, frozen, created_at) VALUES (?, ?, 0, ?, ?)", [G, u, gele, date])
        db.sqlRun("INSERT INTO xp (guild_id, user_id, xp, level, last_gain_at) VALUES (?, ?, 10, 0, ?)", [G, u, date])
        db.sqlRun("INSERT INTO anniversaires (guild_id, user_id, day, month) VALUES (?, ?, 1, 1)", [G, u])
        db.sqlRun("INSERT INTO succes (guild_id, user_id, achievement, earned_at) VALUES (?, ?, 'premier_daily', ?)", [G, u, date])
    }
    db.sqlRun("UPDATE xp SET last_gain_at = ? WHERE guild_id = ? AND user_id = ?", [maintenant - 10 * JOUR, G, ACTIF])
    db.sqlRun("INSERT INTO profils (guild_id, user_id, bio) VALUES (?, ?, 'x')", [G, SANS_DATE])

    assert.strictEqual(privacy.purgerJeux(maintenant), 1)
    const reste = u => db.sqlAll("SELECT COUNT(*) AS n FROM anniversaires WHERE guild_id = ? AND user_id = ?", [G, u])[0].n
    assert.strictEqual(reste(PARTI), 0)
    assert.strictEqual(db.sqlAll("SELECT COUNT(*) AS n FROM eco_comptes WHERE guild_id = ? AND user_id = ?", [G, PARTI])[0].n, 0)
    assert.strictEqual(db.sqlAll("SELECT COUNT(*) AS n FROM succes WHERE guild_id = ? AND user_id = ?", [G, PARTI])[0].n, 0)
    assert.strictEqual(reste(ACTIF), 1, "activité récente : rien n'est effacé")
    assert.strictEqual(reste(GELE), 1, "compte gelé : gardé tant que le gel dure")
    assert.strictEqual(db.sqlAll("SELECT COUNT(*) AS n FROM profils WHERE guild_id = ? AND user_id = ?", [G, SANS_DATE])[0].n, 1, "aucune date connue : gardé")
})
test("purge des jeux : la date de dernier changement d'anniversaire est effacée après 30 jours", () => {
    const G = "555555555555555580", maintenant = Date.now()
    db.sqlRun("INSERT INTO stats_joueur (guild_id, user_id, stat, value) VALUES (?, 'u1', 'anniv_modifie_le', ?)", [G, maintenant - 31 * JOUR])
    db.sqlRun("INSERT INTO stats_joueur (guild_id, user_id, stat, value) VALUES (?, 'u2', 'anniv_modifie_le', ?)", [G, maintenant - 5 * JOUR])
    privacy.purgerJeux(maintenant)
    assert.deepStrictEqual(db.sqlAll("SELECT user_id FROM stats_joueur WHERE guild_id = ?", [G]).map(l => l.user_id), ["u2"])
})

test("purge planifiée : une purge en échec n'empêche pas les suivantes", () => {
    const origine = { cases: db.purgeOldCases, warns: db.purgeOldWarns }
    let warnsAppele = false
    const erreur = console.error
    const messages = []
    console.error = (...args) => messages.push(args.join(" "))
    db.purgeOldCases = () => { throw new Error("panne simulée") }
    db.purgeOldWarns = () => { warnsAppele = true }
    try {
        const minuteur = privacy.startPrivacySchedule({ guilds: { cache: new Map() }, shard: null })
        clearInterval(minuteur)
    } finally {
        console.error = erreur
        db.purgeOldCases = origine.cases
        db.purgeOldWarns = origine.warns
    }
    assert.ok(warnsAppele, "la purge suivante a bien tourné")
    assert.ok(messages.some(m => m.includes("panne simulée")), "l'erreur est journalisée")
})
