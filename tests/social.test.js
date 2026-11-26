process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const profils = require('../Fonctions/profils')
const anniv = require('../Fonctions/anniversaires')
const { ecouter, retirerEcouteurs } = require('../Fonctions/evenements')

const JOUR = 24 * 3600 * 1000
const G = "910000000000000001"

const membre = (id, { jours = 30, timeout = null, bot = false, guildId = G } = {}) => ({
    id, guild: { id: guildId }, joinedTimestamp: Date.now() - jours * JOUR, communicationDisabledUntilTimestamp: timeout, user: { id, bot }
})

test("rep : une fois par jour, refus soi, bot, compte récent, sanctionné", () => {
    retirerEcouteurs()
    const evenements = []
    ecouter("rep:donnee", d => evenements.push(["donnee", d.userId, d.to]))
    ecouter("rep:recue", d => evenements.push(["recue", d.userId, d.from]))

    const a = membre("100000000000000001"), b = membre("100000000000000002"), c = membre("100000000000000003")
    assert.deepStrictEqual(profils.donnerRep(a, b), { ok: true, total: 1 })
    assert.deepStrictEqual(evenements, [["donnee", a.id, b.id], ["recue", b.id, a.id]])

    assert.deepStrictEqual(profils.donnerRep(a, c), { ok: false, refus: "deja" }, "2e réputation du jour refusée, même à un autre membre")
    assert.strictEqual(profils.reputation(G, c.id), 0)
    assert.strictEqual(db.sqlAll("SELECT * FROM rep_donnees WHERE giver_id = ?", [a.id]).length, 1, "2 clics = 1 ligne")
    // Un autre donneur peut donner au même membre
    assert.deepStrictEqual(profils.donnerRep(c, b), { ok: true, total: 2 })
    // Le lendemain : la ligne d'hier ne bloque plus
    db.sqlRun("UPDATE rep_donnees SET day = '2000-01-01' WHERE giver_id = ?", [a.id])
    assert.strictEqual(profils.donnerRep(a, b).ok, true)

    const d = membre("100000000000000004")
    assert.strictEqual(profils.donnerRep(d, d).refus, "soi_meme")
    assert.strictEqual(profils.donnerRep(d, membre("100000000000000005", { bot: true })).refus, "bot")
    assert.strictEqual(profils.donnerRep(membre("100000000000000006", { jours: 3 }), d).refus, "compte_recent")
    assert.strictEqual(profils.donnerRep({ ...membre("100000000000000007"), joinedTimestamp: null }, d).refus, "compte_recent", "date d'arrivée inconnue")
    assert.strictEqual(profils.donnerRep(membre("100000000000000008", { timeout: Date.now() + 3600000 }), d).refus, "sanctionne")
    assert.strictEqual(profils.reputation(G, d.id), 0, "aucun refus ne donne de réputation")
    retirerEcouteurs()
})

test("anniversaire : dates valides et invalides, effaçable, jamais l'année", () => {
    const U = "200000000000000001"
    assert.strictEqual(anniv.definir(G, U, 29, 2), true, "29/02 accepté")
    assert.deepStrictEqual(anniv.lire(G, U), { day: 29, month: 2 })
    for (const [j, m] of [[31, 4], [30, 2], [31, 6], [0, 5], [32, 1], [10, 13], [10, 0], [null, 5], [1.5, 2]]) {
        assert.strictEqual(anniv.definir(G, U, j, m), false, `${j}/${m} refusé`)
    }
    assert.deepStrictEqual(anniv.lire(G, U), { day: 29, month: 2 }, "une date refusée ne change rien")
    assert.strictEqual(anniv.definir(G, U, 31, 12), true)
    assert.deepStrictEqual(Object.keys(db.sqlAll("SELECT * FROM anniversaires WHERE user_id = ?", [U])[0]).sort(), ["day", "guild_id", "month", "user_id"], "pas d'année")
    assert.strictEqual(anniv.retirer(G, U), true)
    assert.strictEqual(anniv.lire(G, U), null)
    assert.strictEqual(anniv.retirer(G, U), false)
})

test("anniversaire : 29/02 fêté le 28/02 les années non bissextiles", () => {
    const G2 = "910000000000000002"
    anniv.definir(G2, "300000000000000001", 29, 2)
    anniv.definir(G2, "300000000000000002", 28, 2)
    const midi = (annee, mois, jour) => Date.UTC(annee, mois - 1, jour, 12)
    assert.deepStrictEqual(anniv.fetesDuJour(G2, midi(2027, 2, 28)).sort(), ["300000000000000001", "300000000000000002"])
    assert.deepStrictEqual(anniv.fetesDuJour(G2, midi(2028, 2, 28)), ["300000000000000002"], "2028 est bissextile")
    assert.deepStrictEqual(anniv.fetesDuJour(G2, midi(2028, 2, 29)), ["300000000000000001"])
    assert.deepStrictEqual(anniv.fetesDuJour(G2, midi(2027, 3, 1)), [])
    assert.strictEqual(anniv.estBissextile(1900), false)
    assert.strictEqual(anniv.estBissextile(2000), true)
})

// Faux serveur pour la tâche de fond
function fauxServeur(id, { roleDangereux = false } = {}) {
    const membres = new Map()
    const envoyes = []
    const ajouterMembre = (uid, { aRole = false } = {}) => {
        const m = {
            id: uid, user: { bot: false }, roleIds: new Set(aRole ? ["ROLE"] : []),
            roles: {
                add: async () => { m.roleIds.add("ROLE") },
                remove: async () => { m.roleIds.delete("ROLE") }
            }
        }
        membres.set(uid, m)
        return m
    }
    const role = {
        id: "ROLE", managed: false, comparePositionTo: () => -1,
        permissions: new Discord.PermissionsBitField(roleDangereux ? Discord.PermissionFlagsBits.Administrator : 0n)
    }
    Object.defineProperty(role, "members", { get: () => new Map([...membres].filter(([, m]) => m.roleIds.has("ROLE"))) })
    const moi = { id: "OWNER", permissions: new Discord.PermissionsBitField(), roles: { highest: {} } }
    const salon = {
        isTextBased: () => true, permissionsFor: () => ({ has: () => true }),
        send: async message => { envoyes.push(message) }
    }
    const guild = {
        id, ownerId: "OWNER",
        members: { me: moi, fetch: async uid => (uid ? (membres.get(uid) ?? Promise.reject(new Error("absent"))) : membres) },
        roles: { cache: new Map([["ROLE", role]]) },
        channels: { cache: new Map([["SALON", salon]]) }
    }
    role.guild = guild
    return { guild, ajouterMembre, envoyes, role }
}

test("anniversaire : annonce une seule fois par jour, rôle donné puis retiré le lendemain", async () => {
    const G3 = "910000000000000003"
    const { guild, ajouterMembre, envoyes } = fauxServeur(G3)
    const fete = ajouterMembre("400000000000000001")
    const autre = ajouterMembre("400000000000000002", { aRole: true }) // fêté hier : garde le rôle jusqu'au lendemain
    anniv.definir(G3, fete.id, 10, 6)
    anniv.definir(G3, autre.id, 9, 6)
    anniv.ecrireConfig(G3, { salon: "SALON", role: "ROLE" })

    const jour1 = Date.UTC(2027, 5, 10, 8) // 10 juin 2027
    await anniv.traiterServeur(guild, jour1)
    await anniv.traiterServeur(guild, jour1 + 30 * 60 * 1000)
    await anniv.traiterServeur(guild, jour1 + 5 * 3600 * 1000)
    assert.strictEqual(envoyes.length, 1, "une seule annonce ce jour-là")
    assert.ok(envoyes[0].content.includes(`<@${fete.id}>`) && !envoyes[0].content.includes(autre.id))
    assert.deepStrictEqual(envoyes[0].allowedMentions, { parse: [] }, "mention non notifiante")
    assert.ok(fete.roleIds.has("ROLE"), "rôle du jour donné")
    assert.ok(!autre.roleIds.has("ROLE"), "rôle retiré à celui dont ce n'est plus le jour")
    assert.strictEqual(anniv.lireConfig(G3).last_run_day, "2027-06-10")

    // Lendemain : le rôle est retiré, personne à annoncer
    await anniv.traiterServeur(guild, Date.UTC(2027, 5, 11, 8))
    assert.ok(!fete.roleIds.has("ROLE"), "rôle retiré le lendemain")
    assert.strictEqual(envoyes.length, 1)
    assert.strictEqual(anniv.lireConfig(G3).last_run_day, "2027-06-11")
})

test("anniversaire : jour noté avant l'envoi, rôle dangereux jamais donné, module coupé", async () => {
    const G4 = "910000000000000004"
    const s = fauxServeur(G4, { roleDangereux: true })
    const m = s.ajouterMembre("500000000000000001")
    anniv.definir(G4, m.id, 1, 1)
    anniv.ecrireConfig(G4, { salon: "SALON", role: "ROLE" })
    await anniv.traiterServeur(s.guild, Date.UTC(2027, 0, 1, 12))
    assert.ok(!m.roleIds.has("ROLE"), "rôle avec permission dangereuse : jamais donné")
    assert.strictEqual(s.envoyes.length, 1)

    // Échec de l'envoi : le jour est déjà noté, pas de seconde annonce
    const G5 = "910000000000000005"
    const s5 = fauxServeur(G5)
    const m5 = s5.ajouterMembre("500000000000000002")
    anniv.definir(G5, m5.id, 2, 1)
    anniv.ecrireConfig(G5, { salon: "SALON" })
    s5.guild.channels.cache.get("SALON").send = async () => { throw new Error("échec") }
    await anniv.traiterServeur(s5.guild, Date.UTC(2027, 0, 2, 12))
    assert.strictEqual(anniv.lireConfig(G5).last_run_day, "2027-01-02")

    // Module désactivé : rien n'est fait
    const G6 = "910000000000000006"
    const s6 = fauxServeur(G6)
    s6.ajouterMembre("500000000000000003")
    anniv.definir(G6, "500000000000000003", 3, 1)
    anniv.ecrireConfig(G6, { salon: "SALON" })
    db.setModule(G6, "communaute.social", false)
    await anniv.traiterServeur(s6.guild, Date.UTC(2027, 0, 3, 12))
    assert.strictEqual(s6.envoyes.length, 0)
    assert.strictEqual(anniv.lireConfig(G6).last_run_day, null)
})

test("anniversaire : la config garde le dernier jour traité, null efface un champ", () => {
    const G7 = "910000000000000007"
    anniv.ecrireConfig(G7, { salon: "S", role: "R" })
    db.sqlRun("UPDATE anniv_config SET last_run_day = '2027-01-01' WHERE guild_id = ?", [G7])
    anniv.ecrireConfig(G7, { role: null })
    assert.deepStrictEqual(anniv.lireConfig(G7), { channel_id: "S", role_id: null, last_run_day: "2027-01-01" })
    assert.strictEqual(anniv.roleDangereux({ permissions: new Discord.PermissionsBitField(Discord.PermissionFlagsBits.ManageRoles) }), true)
    assert.strictEqual(anniv.roleDangereux({ permissions: new Discord.PermissionsBitField(Discord.PermissionFlagsBits.SendMessages) }), false)
})

test("profil : bio sans mention, limite, thème, badge parmi les succès obtenus", () => {
    const U = "600000000000000001"
    const bio = "Salut @everyone <@123456789012345678> <@&987654321098765432>"
    assert.strictEqual(profils.definirBio(G, U, bio), bio, "texte conservé tel quel")
    const affiche = profils.sansMention(bio)
    assert.ok(!/@everyone|<@\d|<@&\d/.test(affiche), "plus aucune mention dans l'affichage")
    assert.strictEqual(affiche.replaceAll("​", ""), bio, "même texte à l'œil")

    assert.strictEqual(profils.definirBio(G, U, "x".repeat(201)), null, "201 caractères refusés")
    assert.strictEqual(profils.lireProfil(G, U).bio, bio, "refus : l'ancienne bio reste")
    assert.strictEqual(profils.definirBio(G, U, "x".repeat(200)).length, 200)
    assert.strictEqual(profils.definirBio(G, U, "   "), "")
    assert.strictEqual(profils.lireProfil(G, U).bio, null, "bio vide : effacée")

    assert.strictEqual(profils.definirTheme(G, U, "rose"), true)
    assert.strictEqual(profils.definirTheme(G, U, "or"), false)
    assert.strictEqual(profils.donneesProfil(G, U).couleur, profils.THEMES.rose)

    assert.strictEqual(profils.definirBadge(G, U, "premier"), false, "succès non obtenu")
    db.sqlRun("INSERT INTO succes (guild_id, user_id, achievement, earned_at) VALUES (?, ?, 'premier', 1)", [G, U])
    assert.strictEqual(profils.definirBadge(G, U, "premier"), true)
    const p = profils.donneesProfil(G, U)
    assert.deepStrictEqual([p.badge, p.nbSucces, p.niveau, p.solde, p.reputation], ["premier", 1, 0, 0, 0])
    assert.strictEqual(profils.definirBadge(G, U, null), true)
    assert.strictEqual(profils.donneesProfil(G, U).badge, null)
    assert.strictEqual(profils.donneesProfil(G, "600000000000000099").theme, "bleu", "thème par défaut")
})

test("commandes : sous-module social, permissions", () => {
    const { chargerCommandes } = require('./aides')
    const bot = chargerCommandes()
    for (const nom of ["profil", "rep", "anniversaire"]) {
        const c = bot.commands.get(nom)
        assert.ok(c, nom)
        assert.strictEqual(c.sousModule, "social")
        assert.strictEqual(c.permission, "Aucune")
    }
})
