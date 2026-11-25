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
