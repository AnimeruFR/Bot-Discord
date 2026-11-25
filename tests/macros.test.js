process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const { controler } = require('../Fonctions/garde')
const macros = require('../Fonctions/macros')
const { chargerCommandes } = require('./aides')

const { Flags } = Discord.PermissionsBitField
const G = "111111111111111111", U = "777777777777777777"
const commande = chargerCommandes().commands.get("reponse")

// Faux interaction : droits et salon au choix
function faux({ perms = [], channel = { type: Discord.ChannelType.GuildText, name: "general", topic: "" }, guildId = G } = {}) {
    const reponses = []
    return {
        reponses, reply: async r => reponses.push(r), guildId, guild: { id: guildId, roles: { cache: new Map() } }, channel, channelId: "333333333333333333",
        user: { id: U }, locale: "fr", inGuild: () => true,
        memberPermissions: new Discord.PermissionsBitField(perms), member: { roles: { cache: new Set() } },
        options: { getFocused: () => "" }
    }
}

test("un membre sans droit est refusé par la garde", async () => {
    assert.ok(commande, "commande /reponse chargée")
    assert.strictEqual(typeof commande.permission, "bigint")
    assert.ok(await controler(faux(), commande), "refus sans droit")
    assert.strictEqual(await controler(faux({ perms: [Flags.ManageMessages] }), commande), null)
})

test("normalisation du nom", () => {
    assert.strictEqual(macros.normaliserNom("  Bienvenue À Tous_! "), "bienvenue-a-tous")
    assert.strictEqual(macros.normaliserNom("--a  b--"), "a-b")
    assert.strictEqual(macros.normaliserNom("???"), "")
    assert.strictEqual(macros.normaliserNom("x".repeat(50)).length, 32)
})

test("ajout, doublon et limite de 25", () => {
    assert.strictEqual(macros.ajouter(G, "Salut", "Bonjour", U).etat, "ok")
    assert.strictEqual(macros.ajouter(G, "salut", "Autre", U).etat, "doublon")
    assert.strictEqual(macros.ajouter(G, "!!!", "Texte", U).etat, "nom_invalide")
    assert.strictEqual(macros.ajouter(G, "vide", "   ", U).etat, "texte_invalide")
    assert.strictEqual(macros.ajouter(G, "long", "x".repeat(2001), U).etat, "texte_invalide")
    for (let i = 1; i < 25; i++) assert.strictEqual(macros.ajouter(G, `rep-${i}`, "texte", U).etat, "ok")
    assert.strictEqual(macros.lister(G).length, 25)
    assert.strictEqual(macros.ajouter(G, "de-trop", "texte", U).etat, "limite")
    assert.strictEqual(macros.ajouter("222222222222222222", "salut", "autre serveur", U).etat, "ok", "limite et noms propres à chaque serveur")
})

test("autocomplétion filtrée par la saisie", () => {
    assert.deepStrictEqual(macros.propositions(G, "sal"), [{ name: "salut", value: "salut" }])
    assert.strictEqual(macros.propositions(G, "").length, 25)
    assert.strictEqual(macros.propositions(G, "rep-2").length, 6, "rep-2, rep-20 à rep-24")
    assert.strictEqual(macros.propositions(G, "zzz").length, 0)
})

test("envoi hors ticket refusé, retrait d'une réponse", async () => {
    const hors = faux({ perms: [Flags.ManageMessages] })
    await macros.envoyer(hors, "salut")
    assert.strictEqual(hors.reponses.length, 1)
    assert.ok(hors.reponses[0].flags, "refus éphémère")
    assert.ok(!hors.reponses[0].content.includes("Bonjour"), "le texte n'est pas posté")

    assert.strictEqual(macros.retirer(G, "Salut"), true)
    assert.strictEqual(macros.retirer(G, "salut"), false)
})
