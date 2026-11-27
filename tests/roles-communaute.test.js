process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const { refusRoleCommunaute, texteRefusRole, roleReserve } = require('../Fonctions/rolesCommunaute')

const { Flags } = Discord.PermissionsBitField
let compteur = 0

// Faux serveur : le bot a « Gérer les rôles » et un rôle en position 10 ; le propriétaire est "1"
function fauxServeur() {
    const id = `92000000000000${String(++compteur).padStart(4, "0")}`
    const guild = { id, ownerId: "1", roles: { cache: new Discord.Collection() }, channels: { cache: new Discord.Collection() } }
    guild.members = { me: fauxMembre(guild, "bot", Flags.ManageRoles, 10) }
    return guild
}

function fauxMembre(guild, id, perms = 0n, position = 1) {
    return { id, guild, permissions: new Discord.PermissionsBitField(perms), roles: { highest: { position, comparePositionTo: autre => position - autre.position } } }
}

function fauxRole(guild, id, { position = 3, perms = 0n, managed = false } = {}) {
    const role = { id, guild, managed, position, permissions: new Discord.PermissionsBitField(perms), comparePositionTo: autre => role.position - autre.position }
    guild.roles.cache.set(id, role)
    return role
}

test("rôle sain : accepté ; inexistant, @everyone, géré, trop haut : refusés", () => {
    const guild = fauxServeur()
    const admin = fauxMembre(guild, "admin", Flags.ManageRoles, 5)
    assert.strictEqual(refusRoleCommunaute(guild, fauxRole(guild, "sain", { perms: Flags.SendMessages }), admin), null)
    assert.strictEqual(refusRoleCommunaute(guild, null), "rolecom.refus.inexistant")
    assert.strictEqual(refusRoleCommunaute(guild, { ...fauxRole(guild, guild.id) }), "rolecom.refus.everyone")
    assert.strictEqual(refusRoleCommunaute(guild, fauxRole(guild, "gere", { managed: true })), "rolecom.refus.gere")
    assert.strictEqual(refusRoleCommunaute(guild, fauxRole(guild, "haut", { position: 12 })), "rolecom.refus.bot", "au-dessus du bot")
    assert.strictEqual(refusRoleCommunaute(guild, fauxRole(guild, "haut-admin", { position: 7 }), admin), "rolecom.refus.configurateur")
    assert.strictEqual(refusRoleCommunaute(guild, fauxRole(guild, "haut-admin", { position: 7 })), null, "à l'attribution : contrôle du bot seulement")
})

test("pouvoirs de modération ou d'administration, au niveau du serveur ou par surcharge de salon", () => {
    const guild = fauxServeur()
    for (const perm of [Flags.Administrator, Flags.ManageGuild, Flags.ManageRoles, Flags.ManageChannels, Flags.ManageMessages, Flags.BanMembers,
        Flags.KickMembers, Flags.ModerateMembers, Flags.MentionEveryone, Flags.ManageNicknames, Flags.MoveMembers, Flags.ViewAuditLog]) {
        assert.strictEqual(refusRoleCommunaute(guild, fauxRole(guild, `p${perm}`, { perms: perm })), "rolecom.refus.dangereux", String(perm))
    }
    const surcharge = fauxRole(guild, "surcharge")
    guild.channels.cache.set("c1", { permissionOverwrites: { cache: new Discord.Collection([[surcharge.id, { allow: new Discord.PermissionsBitField(Flags.ManageMessages) }]]) } })
    assert.strictEqual(refusRoleCommunaute(guild, surcharge), "rolecom.refus.dangereux_salon")
})

test("rôles réservés : staff du bot, staff des tickets (serveur, type, .env), quarantaine, vérification", () => {
    const guild = fauxServeur()
    const role = id => fauxRole(guild, id)
    db.setStaffRole(guild.id, "staff")
    assert.strictEqual(refusRoleCommunaute(guild, role("staff")), "rolecom.refus.staff")
    db.setTicketConfig(guild.id, null, "tk-staff")
    assert.strictEqual(refusRoleCommunaute(guild, role("tk-staff")), "rolecom.refus.staff")
    db.addTicketType(guild.id, { nom: "Aide", staffRoleId: "tk-type" })
    assert.strictEqual(refusRoleCommunaute(guild, role("tk-type")), "rolecom.refus.staff")
    process.env.TICKET_STAFF_ROLE_ID = "tk-env"
    try {
        assert.strictEqual(refusRoleCommunaute(guild, role("tk-env")), "rolecom.refus.staff")
    } finally {
        delete process.env.TICKET_STAFF_ROLE_ID
    }
    assert.strictEqual(refusRoleCommunaute(guild, role("tk-env")), null, "plus réservé sans la variable")
    db.sqlRun("INSERT INTO quarantine_config (guild_id, role_id) VALUES (?, ?)", [guild.id, "quar"])
    assert.strictEqual(refusRoleCommunaute(guild, role("quar")), "rolecom.refus.quarantaine")
    db.sqlRun("INSERT INTO verification_config (guild_id, role_id) VALUES (?, ?)", [guild.id, "verifie"])
    assert.strictEqual(refusRoleCommunaute(guild, role("verifie")), "rolecom.refus.verifie")
    db.sqlRun("INSERT INTO account_filter (guild_id, min_age_days, action, role_id) VALUES (?, 7, 'role', ?)", [guild.id, "attente"])
    assert.strictEqual(refusRoleCommunaute(guild, role("attente")), "rolecom.refus.attente", "rôle en attente du filtre des comptes")
    assert.strictEqual(roleReserve(guild.id, "libre"), null)

    // Un autre serveur n'est pas concerné
    const autre = fauxServeur()
    assert.strictEqual(refusRoleCommunaute(autre, fauxRole(autre, "staff")), null)
})

test("texte du refus : traduit, avec la mention du rôle", () => {
    const guild = fauxServeur()
    const role = fauxRole(guild, "123")
    assert.ok(texteRefusRole("fr", "rolecom.refus.staff", role).includes("<@&123>"))
    assert.ok(texteRefusRole("en", "rolecom.refus.staff", role).includes("staff role"))
    assert.ok(!texteRefusRole("fr", "rolecom.refus.inexistant", null).includes("rolecom."))
})
