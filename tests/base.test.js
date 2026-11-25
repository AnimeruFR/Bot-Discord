process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const db = require('../Fonctions/db')

const G1 = "111111111111111111", G2 = "222222222222222222", U = "333333333333333333", MOD = "444444444444444444"

test("warns (isolation par serveur, injection SQL)", async () => {
    const w1 = db.addWarn(G1, U, MOD, "spam")
    const w2 = db.addWarn(G1, U, MOD, "'); DROP TABLE warns; --")
    db.addWarn(G2, U, MOD, "autre serveur")
    assert.strictEqual(db.countWarns(G1, U), 2)
    assert.strictEqual(db.listWarns(G1, U)[0].reason, "'); DROP TABLE warns; --", "injection SQL stockée comme simple texte")
    assert.strictEqual(db.listWarns(G1, U, 1).length, 1, "limite respectée")
    assert.strictEqual(db.getWarn(G2, w1), undefined, "un serveur ne voit pas les warns d'un autre")
    assert.strictEqual(db.removeWarn(G2, w1), false, "un serveur ne supprime pas les warns d'un autre")
    assert.strictEqual(db.removeWarn(G1, w2), true)
    assert.strictEqual(db.countWarns(G1, U), 1)
    assert.strictEqual(db.countWarns(G2, U), 1)
})

test("salon de logs", async () => {
    assert.strictEqual(db.getLogChannel(G1), null)
    db.setLogChannel(G1, "555555555555555555")
    assert.strictEqual(db.getLogChannel(G1), "555555555555555555")
    db.setLogChannel(G1, null)
    assert.strictEqual(db.getLogChannel(G1), null)
})

test("délai des tickets", async () => {
    assert.strictEqual(db.getTicketCooldown(G1, U), 0)
    db.setTicketCooldown(G1, U)
    assert.ok(Date.now() - db.getTicketCooldown(G1, U) < 1000)
    db.purgeTicketCooldowns(Date.now() + 1)
    assert.strictEqual(db.getTicketCooldown(G1, U), 0, "purge des vieux délais")
})

test("configuration des tickets", async () => {
    assert.deepStrictEqual(db.getTicketConfig(G1), { categoryId: null, staffRoleId: null })
    db.setLogChannel(G1, "555555555555555555")
    db.setTicketConfig(G1, "666666666666666666", "777777777777777777")
    assert.deepStrictEqual(db.getTicketConfig(G1), { categoryId: "666666666666666666", staffRoleId: "777777777777777777" })
    assert.strictEqual(db.getLogChannel(G1), "555555555555555555", "la config des tickets n'écrase pas le salon de logs")
    db.setLogChannel(G1, null)
    assert.strictEqual(db.getTicketConfig(G1).staffRoleId, "777777777777777777", "le salon de logs n'écrase pas la config des tickets")
    assert.deepStrictEqual(db.getTicketConfig(G2), { categoryId: null, staffRoleId: null }, "config isolée par serveur")
    db.setTicketConfig(G1, null, "121212121212121212")
    assert.deepStrictEqual(db.getTicketConfig(G1), { categoryId: "666666666666666666", staffRoleId: "121212121212121212" }, "changer le rôle garde la catégorie")
    db.resetTicketConfig(G1)
    assert.deepStrictEqual(db.getTicketConfig(G1), { categoryId: null, staffRoleId: null }, "réinitialisation")
})
