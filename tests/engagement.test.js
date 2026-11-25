process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const { parseQuand } = require('../Fonctions/dates')
const giveaways = require('../Fonctions/giveaways')
const { traiterProgrammes, envoyerAnnonce } = require('../Fonctions/programmes')
const { refusRole, onClicRole } = require('../Fonctions/rolesBoutons')
const bienvenue = require('../Fonctions/bienvenue')
const { lireChoix } = require('../Commandes/Communaute/Animation/sondage')

const { Flags } = Discord.PermissionsBitField
const U = "333333333333333333", MOD = "444444444444444444"
const { tirer } = giveaways
let idG

const G11 = "555555555555555560"
const envoisG = []
const salonG = {
    id: "777777777777777760", isTextBased: () => true,
    messages: { fetch: async () => ({ edit: async () => {} }) },
    send: async m => { envoisG.push(m); return { id: "888888888888888860" } },
    permissionsFor: () => ({ has: () => true })
}
const membresG = new Set(["111111111111111161", "111111111111111162"])
const guildG = {
    id: G11, available: true, name: "Test", members: {
        me: {},
        fetch: async ({ user, force }) => {
            if (Array.isArray(user)) return new Discord.Collection(user.filter(id => membresG.has(id)).map(id => [id, {}]))
            void force
            if (user === "auteur-parti" || (/^\d+$/.test(user) && !membresG.has(user))) throw Object.assign(new Error("x"), { code: Discord.RESTJSONErrorCodes.UnknownMember })
            return { permissions: new Discord.PermissionsBitField(user === "auteur-ok" ? Flags.ManageMessages : 0n) }
        }
    },
    channels: { cache: new Discord.Collection([[salonG.id, salonG]]) }
}
const botG = { user: { id: "bot" }, guilds: { cache: new Discord.Collection([[G11, guildG]]) } }

const roleFactice = (id, position, perms = 0n, managed = false) => ({
    id, managed, permissions: new Discord.PermissionsBitField(perms), position,
    comparePositionTo: autre => position - autre.position, toString: () => `<@&${id}>`
})
// r7 n'a aucune permission au niveau du serveur, mais « Gérer les messages » dans un salon
const salonR = { toString: () => "#staff", permissionOverwrites: { cache: new Discord.Collection([["r7", { allow: new Discord.PermissionsBitField(Flags.ManageMessages) }]]) } }
const guildR = {
    id: "555555555555555561", ownerId: "owner", channels: { cache: new Discord.Collection([["s", salonR]]) },
    members: { me: { roles: { highest: { position: 10 } }, permissions: new Discord.PermissionsBitField(Flags.ManageRoles) } }
}

test("dates (heure de Paris, changement d'heure)", async () => {
    const loin = { maintenant: Date.UTC(2027, 0, 1), max: 400 * 86400000 }
    assert.strictEqual(parseQuand("15/01/2027 18:00", loin).date, Date.UTC(2027, 0, 15, 17, 0), "hiver : UTC+1")
    assert.strictEqual(parseQuand("15/07/2027 18h00", loin).date, Date.UTC(2027, 6, 15, 16, 0), "été : UTC+2")
    assert.match(parseQuand("28/03/2027 02:30", loin).erreur, /n'existe pas/, "heure sautée au passage à l'heure d'été")
    assert.strictEqual(parseQuand("31/10/2027 02:30", loin).date, Date.UTC(2027, 9, 31, 0, 30), "heure en double : la 1re")
    assert.match(parseQuand("31/02/2027 10:00", loin).erreur, /invalide/, "31 février refusé")
    assert.match(parseQuand("01/01/2026 10:00", loin).erreur, /au moins une minute/, "date passée refusée")
    assert.strictEqual(parseQuand("2h", { maintenant: 0 }).date, 7200000)
    assert.match(parseQuand("90d", { maintenant: 0, max: 60 * 86400000 }).erreur, /moins de 60 jours/)
})

test("giveaways (tirage unique, membres partis, mentions, reprise après crash, publication unique)", async () => {
    const gens = ["a", "b", "c", "d", "e"]
    for (let i = 0; i < 50; i++) {
        const g = tirer(gens, 3, ["a"])
        assert.strictEqual(new Set(g).size, 3, "pas de doublon")
        assert.ok(!g.includes("a"), "anciens gagnants exclus")
    }
    assert.deepStrictEqual(tirer(["x"], 5).length, 1, "plus de gagnants demandés que de participants")
    assert.deepStrictEqual(tirer([], 3), [])
    idG = db.addGiveaway(G11, { channelId: salonG.id, prix: "@everyone Nitro <@&123>", gagnants: 2, endsAt: Date.now() - 1000, hostId: MOD })
    db.setGiveawayMessage(idG, "888888888888888861")
    for (const u of ["111111111111111161", "111111111111111162", "111111111111111163"]) db.addEntry(idG, u)
    const g = db.getGiveawayById(idG)
    assert.strictEqual(await giveaways.terminer(botG, g), true)
    assert.strictEqual(await giveaways.terminer(botG, g), false, "jamais deux tirages")
    const gagnantsG = JSON.parse(db.getGiveawayById(idG).winners)
    assert.deepStrictEqual([...gagnantsG].sort(), ["111111111111111161", "111111111111111162"], "le membre parti n'est pas tiré")
    const annonceG = envoisG.find(m => m.content?.includes("Félicitations"))
    assert.deepStrictEqual(annonceG.allowedMentions.parse, [], "ni @everyone ni rôle (même écrits dans le prix)")
    assert.deepStrictEqual([...annonceG.allowedMentions.users].sort(), [...gagnantsG].sort(), "seuls les gagnants sont notifiés")
    assert.strictEqual(db.unannouncedGiveaways().length, 0)
    // Crash entre le tirage et la publication : republié au passage suivant
    const id2 = db.addGiveaway(G11, { channelId: salonG.id, prix: "x", gagnants: 1, endsAt: Date.now() - 1000, hostId: MOD })
    db.endGiveaway(id2, [])
    envoisG.length = 0
    await traiterProgrammes(botG)
    assert.ok(envoisG.some(m => m.content?.includes(`n°${id2}`)), "résultat non publié : republié")
    assert.strictEqual(db.unannouncedGiveaways().length, 0)

    // Deux publieurs en même temps (commande + tâche de fond) : une seule annonce
    const id4 = db.addGiveaway(G11, { channelId: salonG.id, prix: "y", gagnants: 1, endsAt: Date.now() - 1000, hostId: MOD })
    db.endGiveaway(id4, ["111111111111111161"])
    envoisG.length = 0
    await Promise.all([giveaways.publier(botG, db.getGiveawayById(id4)), giveaways.publier(botG, db.getGiveawayById(id4))])
    assert.strictEqual(envoisG.filter(m => m.content?.includes(`n°${id4}`)).length, 1, "jamais deux annonces")

    // Nouveau tirage : aucun ancien gagnant (même de tirages plus anciens), et rien ne change s'il n'y a plus personne
    db.addEntry(id4, "111111111111111161")
    db.addEntry(id4, "111111111111111162")
    const r1 = await giveaways.relancer(botG, db.getGiveawayById(id4))
    assert.deepStrictEqual(r1, ["111111111111111162"])
    const r2 = await giveaways.relancer(botG, db.getGiveawayById(id4))
    assert.deepStrictEqual(r2, [], "plus personne : aucun gagnant déjà tiré ne revient")
    assert.deepStrictEqual(JSON.parse(db.getGiveawayById(id4).winners), ["111111111111111162"], "gagnants inchangés")

    // Membre parti : ses participations aux giveaways en cours disparaissent
    const id5 = db.addGiveaway(G11, { channelId: salonG.id, prix: "z", gagnants: 1, endsAt: Date.now() + 60000, hostId: MOD })
    db.addEntry(id5, "111111111111111169")
    assert.strictEqual(db.removeEntriesOfMember(G11, "111111111111111169"), 1)
})

test("annonces programmées (droits à l'envoi, mentions, au plus une fois)", async () => {
    envoisG.length = 0
    const annonce = (auteur, sendAt = Date.now() - 1000) => ({
        id: db.addAnnouncement(G11, { channelId: salonG.id, authorId: auteur, contenu: "@everyone soirée ce soir", sendAt }),
        guild_id: G11, channel_id: salonG.id, author_id: auteur, contenu: "@everyone soirée ce soir", send_at: sendAt
    })
    const a1 = annonce("auteur-ok")
    assert.strictEqual(await envoyerAnnonce(botG, a1), "envoyee")
    assert.deepStrictEqual(envoisG[0].allowedMentions, { parse: [] }, "@everyone de l'annonce inactif")
    assert.strictEqual(await envoyerAnnonce(botG, a1), "deja", "jamais publiée deux fois")
    assert.strictEqual(await envoyerAnnonce(botG, annonce("auteur-sans-droit")), "abandon", "auteur qui a perdu ses droits")
    assert.strictEqual(await envoyerAnnonce(botG, annonce("auteur-parti")), "abandon", "auteur parti")
    assert.strictEqual(await envoyerAnnonce(botG, annonce("auteur-ok", Date.now() - 25 * 3600000)), "abandon", "plus de 24 h de retard")
    assert.strictEqual(envoisG.length, 1, "seule la 1re annonce est partie")
})

test("rôles par boutons (rôles dangereux, revérification au clic)", async () => {
    assert.ok(refusRole(guildR, roleFactice("r7", 3)), "permission dangereuse donnée dans un salon : refusé")
    assert.ok(refusRole(guildR, roleFactice("r8", 3, Flags.MoveMembers)), "déplacer des membres refusé")
    assert.strictEqual(refusRole(guildR, roleFactice("r1", 3)), null)
    assert.ok(refusRole(guildR, roleFactice("r2", 3, Flags.Administrator)), "administrateur refusé")
    assert.ok(refusRole(guildR, roleFactice("r3", 3, Flags.BanMembers)), "bannir refusé")
    assert.ok(refusRole(guildR, roleFactice("r4", 12)), "au-dessus du bot refusé")
    assert.ok(refusRole(guildR, roleFactice("r5", 3, 0n, true)), "rôle d'intégration refusé")
    assert.ok(refusRole(guildR, roleFactice(guildR.id, 0)), "@everyone refusé")
    assert.ok(refusRole(guildR, roleFactice("r6", 5), { id: "mod", roles: { highest: { position: 5 } } }), "rôle égal à celui du configurateur refusé")
    assert.ok(refusRole(guildR, null))

    // Clic : le rôle doit être sur CE panneau, et ne pas être devenu dangereux
    db.addRolePanel(guildR.id, { messageId: "999999999999999961", channelId: "c", titre: "Couleurs", mode: "multiple" })
    db.addRoleButton(guildR.id, "999999999999999961", "r1", "Rouge")
    db.addRoleButton(guildR.id, "999999999999999961", "r2", "Admin")
    const ajoutes = [], repR = []
    const rolesR = new Discord.Collection([["r1", roleFactice("r1", 3)], ["r2", roleFactice("r2", 3, Flags.Administrator)], ["r9", roleFactice("r9", 3)]])
    const clicRole = (customId, messageId = "999999999999999961") => ({
        customId, inCachedGuild: () => true, user: { id: U },
        guild: { ...guildR, roles: { cache: rolesR } },
        message: { id: messageId, url: "lien" },
        member: { roles: { cache: new Discord.Collection(), add: async id => ajoutes.push(id), remove: async () => {} } },
        reply: async r => repR.push(r.content), deferReply: async () => {}, editReply: async t => repR.push(t)
    })
    await onClicRole({ user: { id: "bot" } }, clicRole("role:r9"))
    await onClicRole({ user: { id: "bot" } }, clicRole("role:r1", "999999999999999999"))
    await onClicRole({ user: { id: "bot" } }, clicRole("role:r2"))
    assert.deepStrictEqual(ajoutes, [], "rôle absent du panneau, autre panneau, rôle devenu dangereux : rien n'est donné")
    await onClicRole({ user: { id: "bot" } }, clicRole("role:r1"))
    assert.deepStrictEqual(ajoutes, ["r1"])
})

test("bienvenue / au revoir (mentions, anti-raid)", async () => {
    const G12 = "555555555555555562"
    assert.strictEqual(bienvenue.rendre("Salut {membre} sur {serveur} ({nombre})", { membre: "<@1>", serveur: "Mon *serveur*", nombre: 42 }), "Salut <@1> sur Mon \\*serveur\\* (42)")
    let autorises = 0
    for (let i = 0; i < 15; i++) if (bienvenue.autorise(G12, 1000)) autorises++
    assert.strictEqual(autorises, bienvenue.MAX_PAR_MINUTE, "raid : messages plafonnés")
    assert.strictEqual(bienvenue.autorise(G12, 1000 + 61000), true, "plafond levé après une minute")
    db.setWelcome(G11, "bienvenue", salonG.id, "Bienvenue {membre} @everyone")
    db.setWelcome(G11, "aurevoir", salonG.id, "{membre} est parti")
    envoisG.length = 0
    const membreW = { guild: { ...guildG, memberCount: 10 }, user: { id: "111111111111111170", username: "nouveau_*" } }
    assert.strictEqual(await bienvenue.envoyer(membreW, "bienvenue"), "envoye")
    assert.deepStrictEqual(envoisG[0].allowedMentions, { parse: [], users: ["111111111111111170"] }, "seul le nouveau membre est notifié")
    await bienvenue.envoyer(membreW, "aurevoir")
    assert.ok(envoisG[1].content.includes("nouveau\\_\\*") && envoisG[1].allowedMentions.users.length === 0, "départ : pseudo échappé, aucune mention")
    db.setWelcome(G11, "aurevoir", null, null)
    assert.strictEqual(await bienvenue.envoyer(membreW, "aurevoir"), "desactive")
})

test("sondages", async () => {
    assert.deepStrictEqual(lireChoix(" Oui ; Non ;; oui ; Oui ").choix, ["Oui", "Non", "oui"], "vides et doublons retirés")
    assert.ok(lireChoix("Seul").erreur)
    assert.ok(lireChoix(Array.from({ length: 11 }, (_, i) => `c${i}`).join(";")).erreur, "11 choix refusés")
    assert.ok(lireChoix(`${"x".repeat(56)};b`).erreur, "choix trop long refusé")
})

test("RGPD des giveaways, annonces, bienvenue et rôles", async () => {
    assert.ok(db.guildsWithData().includes(G11))
    db.deleteGuildData(G11)
    assert.strictEqual(db.listEntries(idG).length, 0, "participations effacées avec le serveur")
    assert.strictEqual(db.getGiveawayById(idG), null)
    assert.strictEqual(db.listAnnouncements(G11).length, 0)
    assert.deepStrictEqual(db.getWelcome(G11), { bienvenue: null, aurevoir: null })
    db.deleteGuildData(guildR.id)
    assert.strictEqual(db.listRolePanels(guildR.id).length, 0)
    const id3 = db.addGiveaway("555555555555555563", { channelId: "c", prix: "x", gagnants: 1, endsAt: 0, hostId: MOD })
    db.addEntry(id3, U)
    db.endGiveaway(id3, [U], Date.now() - 31 * 86400000)
    assert.strictEqual(db.purgeOldGiveaways(Date.now() - 30 * 86400000), 1)
    assert.strictEqual(db.listEntries(id3).length, 0, "participations purgées à 30 jours")
})
