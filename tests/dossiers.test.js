process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const { controler } = require('../Fonctions/garde')
const notes = require('../Fonctions/notes')
const raisons = require('../Fonctions/raisons')
const cases = require('../Fonctions/cases')
const { role, chargerCommandes } = require('./aides')

const { Flags } = Discord.PermissionsBitField
const G = "111111111111111101", AUTRE = "111111111111111102"
const U = "333333333333333301", MOD = "444444444444444401", MOD2 = "444444444444444402"
const bot = chargerCommandes()

// Faux membre ciblé par une sanction (rôle bas, timeout en cours ou non)
function fauxMembre({ muet = false } = {}) {
    const m = { id: U, roles: { highest: role(1) }, appels: [], isCommunicationDisabled: () => muet }
    m.timeout = async (duree) => { m.appels.push(duree) }
    return m
}

// Fausse interaction de commande : options au choix, permissions au choix
function interaction({ options = {}, perms = [], user = MOD, guildId = G, membre = fauxMembre() } = {}) {
    const i = {
        reponses: [], guildId, channelId: "333333333333333399", locale: "fr", user: { id: user, tag: "mod#0001" }, deferred: false, ephemeral: true,
        client: { user: { id: "999999999999999999" } },
        guild: { id: guildId, ownerId: "888888888888888888", members: { fetch: async () => membre } },
        member: { roles: { highest: role(10) } },
        memberPermissions: new Discord.PermissionsBitField(perms), inGuild: () => true,
        options: {
            getString: n => options[n] ?? null, getInteger: n => options[n] ?? null,
            getUser: n => options[n] ?? null, getFocused: () => options.saisie ?? ""
        },
        reply: async r => { i.reponses.push(r) }, editReply: async r => { i.reponses.push(r) },
        followUp: async r => { i.reponses.push(r) }, deleteReply: async () => {},
        deferReply: async () => { i.deferred = true },
        respond: async choix => { i.propositions = choix }
    }
    return i
}
const texte = i => { const r = i.reponses.at(-1); return typeof r === "string" ? r : r?.content ?? "" }
const lancer = (nom, i) => bot.commands.get(nom).run(null, i, i.options)

test("refus d'un membre sans droit : /note, /raisons et /case", async () => {
    for (const nom of ["note", "raisons", "case"]) {
        const refus = await controler(interaction({ perms: [] }), bot.commands.get(nom))
        assert.ok(refus, `/${nom} refusé sans permission`)
    }
    // Un modérateur n'a pas pour autant le droit de gérer les raisons du serveur
    assert.ok(await controler(interaction({ perms: [Flags.ModerateMembers] }), bot.commands.get("raisons")), "/raisons demande ManageGuild")
    assert.strictEqual(await controler(interaction({ perms: [Flags.ManageGuild] }), bot.commands.get("raisons")), null)
    assert.strictEqual(await controler(interaction({ perms: [Flags.ModerateMembers] }), bot.commands.get("case")), null)
    assert.strictEqual(await controler(interaction({ perms: [Flags.ModerateMembers] }), bot.commands.get("note")), null)
})

test("notes staff : limite de 50, ordre, isolation par serveur", () => {
    for (let n = 1; n <= notes.LIMITE_NOTES; n++) assert.ok(notes.ajouterNote(G, U, MOD, `note ${n}`) > 0)
    assert.strictEqual(notes.ajouterNote(G, U, MOD, "de trop"), null, "51e note refusée")
    assert.strictEqual(notes.compterNotes(G, U), 50)
    assert.ok(notes.ajouterNote(AUTRE, U, MOD, "autre serveur") > 0, "limite par serveur")
    const dernieres = notes.listerNotes(G, U, 3)
    assert.deepStrictEqual(dernieres.map(n => n.content), ["note 50", "note 49", "note 48"], "plus récentes d'abord")
    assert.deepStrictEqual(Object.keys(dernieres[0]).sort(), ["author_id", "content", "created_at", "id"])
    assert.strictEqual(notes.retirerNote(AUTRE, dernieres[0].id), false, "une note d'un autre serveur ne se retire pas")
    assert.strictEqual(notes.retirerNote(G, dernieres[0].id), true)
    assert.strictEqual(notes.retirerNote(G, dernieres[0].id), false, "déjà retirée")
    assert.ok(notes.ajouterNote(G, U, MOD, "place libérée") > 0)
})

test("/note : retrait par un non-auteur refusé, par l'auteur ou ManageGuild accepté", async () => {
    const A = "333333333333333302"
    const ajout = interaction({ options: { action: "ajouter", membre: { id: A, tag: "x#1" }, texte: "  note privée  " }, perms: [Flags.ModerateMembers] })
    await lancer("note", ajout)
    const [note] = notes.listerNotes(G, A)
    assert.strictEqual(note.content, "note privée", "texte nettoyé")
    assert.ok(ajout.reponses[0].flags, "réponse éphémère")

    const intrus = interaction({ options: { action: "retirer", membre: { id: A }, numero: note.id }, user: MOD2, perms: [Flags.ModerateMembers] })
    await lancer("note", intrus)
    assert.strictEqual(notes.compterNotes(G, A), 1, "non-auteur : la note reste")
    assert.ok(texte(intrus).includes("auteur"))

    const admin = interaction({ options: { action: "retirer", membre: { id: A }, numero: note.id }, user: MOD2, perms: [Flags.ModerateMembers, Flags.ManageGuild] })
    await lancer("note", admin)
    assert.strictEqual(notes.compterNotes(G, A), 0, "ManageGuild peut retirer")

    await lancer("note", interaction({ options: { action: "ajouter", membre: { id: A }, texte: "bis" }, perms: [Flags.ModerateMembers] }))
    const [bis] = notes.listerNotes(G, A)
    await lancer("note", interaction({ options: { action: "retirer", membre: { id: A }, numero: bis.id }, perms: [Flags.ModerateMembers] }))
    assert.strictEqual(notes.compterNotes(G, A), 0, "l'auteur peut retirer")

    // Note d'un autre serveur : introuvable
    const idAutre = notes.listerNotes(AUTRE, U)[0].id
    const autreServeur = interaction({ options: { action: "retirer", membre: { id: U }, numero: idAutre }, perms: [Flags.ManageGuild] })
    await lancer("note", autreServeur)
    assert.strictEqual(notes.compterNotes(AUTRE, U), 1)
    assert.ok(texte(autreServeur).includes("n'existe pas"))

    // Texte requis pour ajouter
    const vide = interaction({ options: { action: "ajouter", membre: { id: A }, texte: "   " }, perms: [Flags.ModerateMembers] })
    await lancer("note", vide)
    assert.strictEqual(notes.compterNotes(G, A), 0)
})

test("raisons prédéfinies : 25 au plus, doublons, taille, retrait", () => {
    for (let n = 1; n <= raisons.LIMITE_RAISONS; n++) assert.strictEqual(raisons.ajouterRaison(G, `Raison ${n}`), "ok")
    assert.strictEqual(raisons.ajouterRaison(G, "Une de plus"), "limite")
    assert.strictEqual(raisons.ajouterRaison(G, "raison 1"), "doublon", "doublon, casse ignorée")
    assert.strictEqual(raisons.ajouterRaison(AUTRE, "Raison 1"), "ok", "raisons propres à chaque serveur")
    assert.strictEqual(raisons.ajouterRaison(AUTRE, "   "), "invalide")
    assert.strictEqual(raisons.ajouterRaison(AUTRE, "x".repeat(101)), "invalide")
    assert.strictEqual(raisons.ajouterRaison(AUTRE, "x".repeat(100)), "ok")
    assert.strictEqual(raisons.listerRaisons(G).length, 25)
    assert.strictEqual(raisons.retirerRaison(G, "RAISON 25"), true)
    assert.strictEqual(raisons.retirerRaison(G, "Raison 25"), false)
    assert.strictEqual(raisons.ajouterRaison(G, "Une de plus"), "ok", "place libérée")
})

test("autocomplétion des raisons : filtrée, 25 au plus, 100 caractères au plus", async () => {
    const i = interaction({ options: { saisie: "RAISON 1" } })
    await raisons.autocompleterRaison(i)
    const noms = i.propositions.map(p => p.name)
    assert.ok(noms.includes("Raison 1") && noms.includes("Raison 10") && !noms.includes("Raison 2"), "filtre insensible à la casse")
    assert.ok(i.propositions.every(p => p.name === p.value))

    const toutes = interaction({ options: { saisie: "" } })
    await raisons.autocompleterRaison(toutes)
    assert.ok(toutes.propositions.length <= 25 && toutes.propositions.length > 0)

    const longue = interaction({ options: { saisie: "xxxx" }, guildId: AUTRE })
    await raisons.autocompleterRaison(longue)
    assert.ok(longue.propositions.every(p => p.name.length <= 100 && p.value.length <= 100))

    const aucune = interaction({ options: { saisie: "introuvable" } })
    await raisons.autocompleterRaison(aucune)
    assert.deepStrictEqual(aucune.propositions, [])

    // Les commandes de sanction proposent la même autocomplétion sur l'option "raison"
    for (const nom of ["ban", "kick", "tempban", "mute", "warn"]) {
        const c = bot.commands.get(nom)
        assert.strictEqual(c.options.find(o => o.name === "raison").autocomplete, true, `/${nom}`)
        assert.strictEqual(typeof c.autocomplete, "function")
    }
})

test("/raisons : ajout, doublon et refus visibles de l'auteur seulement", async () => {
    const G2 = "111111111111111103"
    const ajout = interaction({ options: { action: "ajouter", texte: "Spam" }, guildId: G2, perms: [Flags.ManageGuild] })
    await lancer("raisons", ajout)
    assert.deepStrictEqual(raisons.listerRaisons(G2), ["Spam"])
    const doublon = interaction({ options: { action: "ajouter", texte: "spam" }, guildId: G2, perms: [Flags.ManageGuild] })
    await lancer("raisons", doublon)
    assert.ok(doublon.reponses[0].flags, "refus éphémère")
    assert.ok(texte(doublon).includes("existe déjà"))
    await lancer("raisons", interaction({ options: { action: "retirer", texte: "SPAM" }, guildId: G2, perms: [Flags.ManageGuild] }))
    assert.deepStrictEqual(raisons.listerRaisons(G2), [])
})

test("annulation d'un warn : le total de warns baisse, double annulation refusée", () => {
    const idWarn = db.addWarn(G, U, MOD, "insulte")
    db.addWarn(G, U, MOD, "spam")
    assert.strictEqual(db.countWarns(G, U), 2)
    const numero = db.listCases(G, U, 10).find(c => c.warn_id === idWarn).id
    assert.strictEqual(cases.annulerCase(G, numero, MOD2), "ok")
    assert.strictEqual(db.countWarns(G, U), 1, "le warn lié est supprimé")
    assert.strictEqual(db.getWarn(G, idWarn), undefined)
    assert.strictEqual(cases.annulerCase(G, numero, MOD2), "deja", "double annulation")
    assert.strictEqual(db.countWarns(G, U), 1)
    assert.ok(cases.lireCase(G, numero).cancelled_at)
    const modifs = cases.listerModifs(G, numero)
    assert.strictEqual(modifs.length, 1, "une seule trace")
    assert.deepStrictEqual([modifs[0].field, modifs[0].editor_id], ["annulation", MOD2])
    // Les retraits (unwarn) ne s'annulent pas
    const unwarn = db.addCase(G, { userId: U, moderatorId: MOD, type: "unwarn", reason: "x" })
    assert.strictEqual(cases.annulerCase(G, unwarn, MOD), "non_annulable")
})

test("modification de raison : trace, warn synchronisé, sanction annulée figée", () => {
    const idWarn = db.addWarn(G, U, MOD, "avant")
    const numero = db.listCases(G, U, 10).find(c => c.warn_id === idWarn).id
    assert.strictEqual(cases.modifierRaison(G, numero, MOD, "après"), "ok")
    assert.strictEqual(cases.lireCase(G, numero).reason, "après")
    assert.strictEqual(db.getWarn(G, idWarn).reason, "après", "le warn suit")
    const [modif] = cases.listerModifs(G, numero)
    assert.deepStrictEqual([modif.field, modif.old_value, modif.new_value, modif.editor_id], ["raison", "avant", "après", MOD])
    assert.strictEqual(cases.annulerCase(G, numero, MOD), "ok")
    assert.strictEqual(cases.modifierRaison(G, numero, MOD, "encore"), "annulee", "raison d'une sanction annulée figée")
    assert.notStrictEqual(cases.lireCase(G, numero).reason, "encore")

    // Warn retiré par /unwarn : sa raison anonymisée ne peut plus être réécrite
    const id2 = db.addWarn(G, U, MOD, "x")
    const numero2 = db.listCases(G, U, 10).find(c => c.warn_id === id2).id
    db.removeWarn(G, id2)
    assert.strictEqual(cases.modifierRaison(G, numero2, MOD, "y"), "warn_retire")
})

test("/case : numéro d'un autre serveur introuvable", async () => {
    const numero = db.addCase(AUTRE, { userId: U, moderatorId: MOD, type: "kick", reason: "secret" })
    for (const action of ["voir", "raison", "annuler"]) {
        const i = interaction({ options: { action, numero, texte: "x" }, perms: [Flags.ModerateMembers, Flags.ManageGuild] })
        await lancer("case", i)
        assert.ok(texte(i).includes("n'existe pas"), `${action} : introuvable`)
    }
    assert.strictEqual(cases.lireCase(AUTRE, numero).cancelled_at, null, "rien n'a changé")
    assert.strictEqual(cases.listerModifs(AUTRE, numero).length, 0)
})

test("/case annuler : double annulation, warn, ban sans déban", async () => {
    const idWarn = db.addWarn(G, "333333333333333310", MOD, "w")
    const user = "333333333333333310"
    const numeroWarn = db.listCases(G, user, 10).find(c => c.warn_id === idWarn).id
    const i1 = interaction({ options: { action: "annuler", numero: numeroWarn }, perms: [Flags.ModerateMembers] })
    await lancer("case", i1)
    assert.ok(texte(i1).includes("annulée") && texte(i1).includes("0"), "total de warns annoncé")
    assert.strictEqual(db.countWarns(G, user), 0)
    const i2 = interaction({ options: { action: "annuler", numero: numeroWarn }, perms: [Flags.ModerateMembers] })
    await lancer("case", i2)
    assert.ok(texte(i2).includes("déjà annulée"))

    const numeroBan = db.addCase(G, { userId: user, moderatorId: MOD, type: "ban", reason: "b" })
    const i3 = interaction({ options: { action: "annuler", numero: numeroBan }, perms: [Flags.ModerateMembers] })
    await lancer("case", i3)
    assert.ok(texte(i3).includes("/unban"), "message : utilisez /unban")
    assert.ok(cases.lireCase(G, numeroBan).cancelled_at)
})

test("/case annuler : un mute encore actif est levé, hiérarchie respectée", async () => {
    const numero = db.addCase(G, { userId: U, moderatorId: MOD, type: "mute", reason: "m", durationMs: 3600000 })
    // Membre plus haut que le modérateur : refus, rien n'est annulé
    const haut = fauxMembre({ muet: true })
    haut.roles.highest = role(50)
    const refus = interaction({ options: { action: "annuler", numero }, perms: [Flags.ModerateMembers], membre: haut })
    await lancer("case", refus)
    assert.strictEqual(cases.lireCase(G, numero).cancelled_at, null)
    assert.deepStrictEqual(haut.appels, [])

    const membre = fauxMembre({ muet: true })
    const ok = interaction({ options: { action: "annuler", numero }, perms: [Flags.ModerateMembers], membre })
    await lancer("case", ok)
    assert.deepStrictEqual(membre.appels, [null], "timeout retiré")
    assert.ok(cases.lireCase(G, numero).cancelled_at)

    // Mute déjà terminé : annulé sans toucher au membre
    const vieux = db.addCase(G, { userId: U, moderatorId: MOD, type: "mute", reason: "m", durationMs: 1000 })
    db.sqlRun("UPDATE cases SET created_at = ? WHERE id = ? AND guild_id = ?", [Date.now() - 60000, vieux, G])
    const autre = fauxMembre({ muet: true })
    await lancer("case", interaction({ options: { action: "annuler", numero: vieux }, perms: [Flags.ModerateMembers], membre: autre }))
    assert.deepStrictEqual(autre.appels, [])
    assert.ok(cases.lireCase(G, vieux).cancelled_at)
})

test("/case raison : sanction d'un autre modérateur demande ManageGuild, sanction annulée figée", async () => {
    const numero = db.addCase(G, { userId: U, moderatorId: MOD, type: "kick", reason: "ancienne" })
    const refus = interaction({ options: { action: "raison", numero, texte: "nouvelle" }, user: MOD2, perms: [Flags.ModerateMembers] })
    await lancer("case", refus)
    assert.strictEqual(cases.lireCase(G, numero).reason, "ancienne")
    assert.strictEqual(cases.listerModifs(G, numero).length, 0)

    await lancer("case", interaction({ options: { action: "raison", numero, texte: "nouvelle" }, user: MOD2, perms: [Flags.ModerateMembers, Flags.ManageGuild] }))
    assert.strictEqual(cases.lireCase(G, numero).reason, "nouvelle")
    await lancer("case", interaction({ options: { action: "raison", numero, texte: "propre" }, user: MOD, perms: [Flags.ModerateMembers] }))
    assert.strictEqual(cases.lireCase(G, numero).reason, "propre", "l'auteur modifie sa propre sanction")
    assert.strictEqual(cases.listerModifs(G, numero).length, 2)

    await lancer("case", interaction({ options: { action: "annuler", numero }, perms: [Flags.ModerateMembers] }))
    const figee = interaction({ options: { action: "raison", numero, texte: "tardive" }, perms: [Flags.ModerateMembers] })
    await lancer("case", figee)
    assert.strictEqual(cases.lireCase(G, numero).reason, "propre")
    assert.ok(texte(figee).includes("ne peut plus"))

    const voir = interaction({ options: { action: "voir", numero }, perms: [Flags.ModerateMembers] })
    await lancer("case", voir)
    assert.ok(voir.reponses.at(-1).embeds[0].data.fields.some(f => f.name === "Modifications"))
})

test("/historique : sanction annulée barrée et nombre de notes", async () => {
    const user = "333333333333333320"
    const numero = db.addCase(G, { userId: user, moderatorId: MOD, type: "kick", reason: "raison visible" })
    notes.ajouterNote(G, user, MOD, "secret")
    cases.annulerCase(G, numero, MOD)
    const i = interaction({ options: { membre: { id: user, tag: "x#1", displayAvatarURL: () => null } }, perms: [Flags.ModerateMembers] })
    await lancer("historique", i)
    const description = i.reponses.at(-1).embeds[0].data.description
    assert.ok(description.includes("~~raison visible~~") && description.includes("Annulée"))
    assert.ok(description.includes("1 note"))
    assert.ok(!description.includes("secret"), "le texte des notes n'apparaît pas")
})

test("/case et /note : refusés si le membre visé est maintenant au-dessus du modérateur, même pour l'auteur", async () => {
    const haut = () => { const m = fauxMembre({ muet: true }); m.roles.highest = role(50); return m }
    const numero = db.addCase(G, { userId: U, moderatorId: MOD, type: "kick", reason: "d'origine" })

    const raison = interaction({ options: { action: "raison", numero, texte: "modifiée" }, perms: [Flags.ModerateMembers], membre: haut() })
    await lancer("case", raison)
    assert.strictEqual(cases.lireCase(G, numero).reason, "d'origine", "raison inchangée")
    assert.strictEqual(cases.listerModifs(G, numero).length, 0)
    assert.ok(texte(raison).includes("rôle"), texte(raison))

    const annuler = interaction({ options: { action: "annuler", numero }, perms: [Flags.ModerateMembers], membre: haut() })
    await lancer("case", annuler)
    assert.strictEqual(cases.lireCase(G, numero).cancelled_at, null, "sanction non annulée")

    // Même un membre qui gère le serveur reste soumis à la hiérarchie
    const gestionnaire = interaction({ options: { action: "annuler", numero }, user: MOD2, perms: [Flags.ModerateMembers, Flags.ManageGuild], membre: haut() })
    await lancer("case", gestionnaire)
    assert.strictEqual(cases.lireCase(G, numero).cancelled_at, null)

    // Membre parti du serveur (introuvable) : la garde ne bloque pas
    const parti = interaction({ options: { action: "annuler", numero }, perms: [Flags.ModerateMembers], membre: null })
    parti.guild.members.fetch = async () => { throw Object.assign(new Error("absent"), { code: Discord.RESTJSONErrorCodes.UnknownMember }) }
    await lancer("case", parti)
    assert.ok(cases.lireCase(G, numero).cancelled_at, "membre absent : annulation permise")

    // /note retirer : même garde
    const A = "333333333333333399"
    notes.ajouterNote(G, A, MOD, "note")
    const [note] = notes.listerNotes(G, A)
    const refus = interaction({ options: { action: "retirer", membre: { id: A }, numero: note.id }, perms: [Flags.ModerateMembers], membre: haut() })
    await lancer("note", refus)
    assert.strictEqual(notes.compterNotes(G, A), 1, "note conservée")
    assert.ok(texte(refus).includes("rôle"), texte(refus))
})
