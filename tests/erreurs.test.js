process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('assert')
const { ErreurUtilisateur, traiterErreur, numeroIncident } = require('../Fonctions/erreurs')

// Fausse interaction qui garde ses réponses
function interaction({ dejaRepondu = false } = {}) {
    const envois = []
    return {
        envois, commandName: "test", guildId: null, locale: "fr",
        replied: dejaRepondu, deferred: false,
        isRepliable: () => true,
        reply: async r => envois.push(["reply", r]),
        followUp: async r => envois.push(["followUp", r])
    }
}
const journalMuet = () => {
    const lignes = []
    return { lignes, error: (...a) => lignes.push(a.join(" ")) }
}

test("numéro d'incident : 6 caractères hexadécimaux", () => {
    assert.match(numeroIncident(), /^[0-9A-F]{6}$/)
    assert.notStrictEqual(numeroIncident(), numeroIncident())
})

test("un bug donne un numéro d'incident, écrit dans les logs et montré au membre", async () => {
    const i = interaction(), journal = journalMuet()
    const incident = await traiterErreur(i, new Error("boum"), journal)
    assert.match(incident, /^[0-9A-F]{6}$/)
    assert.ok(journal.lignes[0].includes(incident) && journal.lignes[0].includes("/test"))
    assert.strictEqual(i.envois.length, 1)
    assert.ok(i.envois[0][1].content.includes(incident), "le membre voit le numéro")
    assert.ok(i.envois[0][1].flags, "réponse éphémère")
})

test("une erreur attendue n'est pas un incident et affiche son message traduit", async () => {
    const i = interaction(), journal = journalMuet()
    const incident = await traiterErreur(i, new ErreurUtilisateur("commun.permission"), journal)
    assert.strictEqual(incident, null)
    assert.strictEqual(journal.lignes.length, 0, "rien dans les logs")
    assert.ok(!i.envois[0][1].content.includes("commun.permission"), "texte traduit, pas la clé")
})

test("après une première réponse, l'erreur part en followUp", async () => {
    const i = interaction({ dejaRepondu: true })
    await traiterErreur(i, new Error("x"), journalMuet())
    assert.strictEqual(i.envois[0][0], "followUp")
})

test("une réponse impossible (interaction expirée) ne lève pas d'erreur", async () => {
    const i = { commandName: "x", isRepliable: () => true, replied: false, reply: async () => { throw new Error("Unknown interaction") } }
    await traiterErreur(i, new Error("x"), journalMuet())
    const j = { customId: "jeu:1", isRepliable: () => false }
    assert.match(await traiterErreur(j, new Error("x"), journalMuet()), /^[0-9A-F]{6}$/)
})
