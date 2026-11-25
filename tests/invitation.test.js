process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const { permissionsMinimales, lienInvitation, lienValide } = require('../Fonctions/invitation')
const { DROITS_VERROU } = require('../Fonctions/verrou')
const { dureeCourte } = require('../Commandes/about')

test("invitation (permissions minimales, liens sûrs)", async () => {
    const { Flags } = Discord.PermissionsBitField
    const perms = permissionsMinimales()
    assert.ok(!perms.has(Flags.Administrator, false), "jamais Administrateur")
    for (const utile of [Flags.ManageRoles, Flags.BanMembers, Flags.ModerateMembers, Flags.AttachFiles, Flags.SendPolls, Flags.ManageGuild]) assert.ok(perms.has(utile, false))
    // /lock exige que le bot possède les droits qu'il retire à @everyone
    for (const droit of DROITS_VERROU) assert.ok(perms.has(Flags[droit], false), `${droit} demandé (nécessaire à /lock)`)
    const lien = new URL(lienInvitation("123456789012345678"))
    assert.strictEqual(lien.hostname, "discord.com")
    assert.strictEqual(lien.searchParams.get("scope"), "bot applications.commands")
    assert.strictEqual(lien.searchParams.get("permissions"), perms.bitfield.toString())
    assert.throws(() => lienInvitation("abc&redirect_uri=https://piege.example"), /invalide/, "ID d'application vérifié")
    assert.strictEqual(lienValide("https://discord.gg/abc"), "https://discord.gg/abc")
    for (const faux of ["http://exemple.com", "javascript:alert(1)", "", null, "pas un lien", `https://exemple.com/${"a".repeat(600)}`]) assert.strictEqual(lienValide(faux), null, `lien ${String(faux).slice(0, 30)} refusé`)
    assert.strictEqual(dureeCourte(3 * 86400000 + 4 * 3600000), "3 j 4 h")
    assert.strictEqual(dureeCourte(90 * 60000), "1 h 30 min")
})
