process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const am = require('../Fonctions/automod')
const { controler } = require('../Fonctions/garde')
const { role, chargerCommandes } = require('./aides')

const { Flags } = Discord.PermissionsBitField
const { TriggerType, ActionType } = { TriggerType: Discord.AutoModerationRuleTriggerType, ActionType: Discord.AutoModerationActionType }
const BOT = "900000000000000001", AUTRE = "900000000000000002"
const G = "700000000000000001", U = "800000000000000001"
const id = n => String(100000000000000000n + BigInt(n))
const bot = { user: { id: BOT, tag: "bot#0" }, users: { fetch: async () => null } }

// Fausse règle AutoMod : edit() applique les changements, comme Discord
function faussRegle(guild, donnees) {
    const regle = {
        id: id(guild.regles.length + 1), name: "", creatorId: BOT, enabled: true, actions: [{ type: ActionType.BlockMessage }],
        exemptRoles: new Discord.Collection(), exemptChannels: new Discord.Collection(), modifs: 0, ...donnees,
        async edit(opts) {
            regle.modifs++
            if (opts.exemptRoles) regle.exemptRoles = new Discord.Collection(opts.exemptRoles.map(i => [i, i]))
            if (opts.exemptChannels) regle.exemptChannels = new Discord.Collection(opts.exemptChannels.map(i => [i, i]))
            if (opts.enabled !== undefined) regle.enabled = opts.enabled
            if (opts.triggerMetadata) regle.triggerMetadata = opts.triggerMetadata
            return regle
        }
    }
    guild.regles.push(regle)
    return regle
}

function fauxServeur(guildId = G) {
    const guild = {
        id: guildId, regles: [], ownerId: "owner", channels: { cache: new Discord.Collection() },
        members: { me: { id: BOT, roles: { highest: role(10) }, permissions: new Discord.PermissionsBitField(Flags.KickMembers | Flags.ManageGuild) } }
    }
    guild.autoModerationRules = {
        fetch: async arg => {
            if (arg?.autoModerationRule) {
                const r = guild.regles.find(x => x.id === arg.autoModerationRule)
                if (!r) throw new Error("règle inconnue")
                return r
            }
            return new Discord.Collection(guild.regles.map(r => [r.id, r]))
        },
        create: async opts => faussRegle(guild, {
            name: opts.name, triggerType: opts.triggerType, triggerMetadata: opts.triggerMetadata, actions: opts.actions,
            exemptRoles: new Discord.Collection((opts.exemptRoles ?? []).map(i => [i, i])),
            exemptChannels: new Discord.Collection((opts.exemptChannels ?? []).map(i => [i, i]))
        })
    }
    return guild
}

test("/automod : refusé à un membre sans « Gérer le serveur » (garde commune)", async () => {
    const commande = chargerCommandes().commands.get("automod")
    assert.strictEqual(commande.module, "moderation")
    const interaction = perms => ({
        guildId: G, channelId: "333333333333333333", user: { id: U }, locale: "fr", inGuild: () => true,
        memberPermissions: new Discord.PermissionsBitField(perms), member: { roles: { cache: new Set() } }
    })
    assert.ok(await controler(interaction(Flags.ModerateMembers | Flags.KickMembers), commande), "sans droit : refusé")
    assert.strictEqual(await controler(interaction(Flags.ManageGuild), commande), null, "avec le droit : accepté")
})

test("préréglages : règles dans les limites de Discord, une règle de chaque sorte", async () => {
    for (const niveau of Object.keys(am.NIVEAUX)) {
        const { regles, aDesactiver } = am.construirePreset(niveau)
        const noms = regles.map(r => r.nom)
        assert.strictEqual(new Set(noms).size, noms.length, "pas de règle en double")
        for (const r of regles) assert.strictEqual(am.verifierLimites(r), null, `${niveau} : ${r.nom} dans les limites`)
        assert.ok(regles.some(r => r.type === TriggerType.Spam) && regles.some(r => r.type === TriggerType.MentionSpam))
        assert.ok(!regles.some(r => aDesactiver.includes(r.cle)), "une règle n'est pas à la fois créée et coupée")
    }
    assert.strictEqual(am.construirePreset("extreme"), null)
    assert.ok(am.NIVEAUX.strict.mentions < am.NIVEAUX.normal.mentions && am.NIVEAUX.normal.mentions < am.NIVEAUX.souple.mentions)
    assert.ok(am.verifierLimites({ triggerMetadata: { mentionTotalLimit: 51 } }), "limite de mentions de Discord")
    assert.ok(am.verifierLimites({ triggerMetadata: { regexPatterns: Array(11).fill("a") } }), "10 regex au plus")
})

test("préréglage appliqué : crée, met à jour, ne touche pas aux règles des autres", async () => {
    const guild = fauxServeur()
    const etrangere = faussRegle(guild, { name: "[Bot] Spam", creatorId: AUTRE, triggerType: TriggerType.Spam })
    const premier = await am.appliquerPreset(guild, bot, "normal", null, "test")
    assert.ok(premier.every(r => r.etat === "creee"), "première fois : tout est créé")
    assert.strictEqual(guild.regles.filter(r => r.creatorId === BOT).length, 4, "spam, mentions, invitations, listes")
    assert.strictEqual(etrangere.modifs, 0, "la règle d'un autre (même nom) n'est jamais modifiée")

    const second = await am.appliquerPreset(guild, bot, "souple", null, "test")
    assert.ok(second.filter(r => r.etat === "maj").length === 2, "spam et mentions mis à jour")
    assert.deepStrictEqual(second.filter(r => r.etat === "desactivee").map(r => r.nom).sort(), ["[Bot] Invitations Discord", "[Bot] Listes de Discord"])
    assert.strictEqual(guild.regles.find(r => r.name === "[Bot] Mentions en masse").triggerMetadata.mentionTotalLimit, 15)
    assert.strictEqual(guild.regles.filter(r => r.creatorId === BOT).length, 4, "aucune règle en double")
})

test("règle refusée par Discord : les autres sont quand même appliquées", async () => {
    const guild = fauxServeur()
    const creer = guild.autoModerationRules.create
    guild.autoModerationRules.create = async opts => {
        if (opts.triggerType === TriggerType.KeywordPreset) throw new Error("limite atteinte")
        return creer(opts)
    }
    const log = console.error
    console.error = () => {}
    const resultats = await am.appliquerPreset(guild, bot, "strict", null, "test")
    console.error = log
    assert.strictEqual(resultats.find(r => r.nom.includes("Listes")).etat, "echec")
    assert.strictEqual(resultats.filter(r => r.etat === "creee").length, 3)
})

test("regex : validation (longueur, nombre, syntaxe Rust, expression qui bloquerait tout)", async () => {
    assert.deepStrictEqual(am.lireRegex("(?i)bad\\s?word;; foo[0-9]+").regex, ["(?i)bad\\s?word", "foo[0-9]+"])
    assert.ok(am.lireRegex("").erreur, "vide")
    assert.ok(am.lireRegex("(abc").erreur, "parenthèse non fermée")
    assert.ok(am.lireRegex("[a-").erreur, "classe non fermée")
    assert.ok(am.lireRegex("a".repeat(261)).erreur, "261 caractères")
    assert.ok(!am.lireRegex("a".repeat(260)).erreur, "260 caractères : accepté")
    assert.ok(!am.lireRegex(Array.from({ length: 10 }, (_, i) => `mot${i}`).join(";;")).erreur, "10 regex : accepté")
    assert.ok(am.lireRegex(Array.from({ length: 11 }, (_, i) => `mot${i}`).join(";;")).erreur, "11 regex : refusé")
    assert.ok(am.lireRegex("foo(?=bar)").erreur, "lookahead non pris en charge par Discord")
    assert.ok(am.lireRegex("(?<!x)foo").erreur, "lookbehind")
    assert.ok(am.lireRegex("(a)\\1").erreur, "référence arrière")
    assert.ok(am.lireRegex("a*").erreur, "accepte le texte vide : bloquerait tout")
    assert.ok(am.metadonnees("regex", "(").erreur && !am.metadonnees("regex", "ok+").erreur)
    assert.deepStrictEqual(am.metadonnees("regex", "ok+").triggerMetadata, { regexPatterns: ["ok+"] })
    assert.ok(am.metadonnees("mentions", "51").erreur && am.metadonnees("mentions", "0").erreur)
})

test("/automod regex invalide : refusée avant tout appel à Discord", async () => {
    const commande = chargerCommandes().commands.get("automod")
    const reponses = []
    const interaction = {
        guild: { id: G, members: { me: { permissions: new Discord.PermissionsBitField(Flags.ManageGuild) } }, autoModerationRules: { fetch: async () => { throw new Error("ne doit pas être appelé") } } },
        guildId: G, locale: "fr", deferred: false, replied: false,
        reply: async r => { reponses.push(r) }
    }
    const args = { getString: n => ({ action: "regex", valeur: "(abc" })[n] ?? null, getRole: () => null, getChannel: () => null, getBoolean: () => null }
    await commande.run(bot, interaction, args)
    assert.match(reponses[0].content, /pas valide/)
})

test("exemptions : limites de Discord (20 rôles, 50 salons), tout ou rien", async () => {
    const guild = fauxServeur("700000000000000010")
    const a = faussRegle(guild, { name: "A", triggerType: TriggerType.Spam })
    const b = faussRegle(guild, { name: "B", triggerType: TriggerType.MentionSpam })
    b.exemptRoles = new Discord.Collection(Array.from({ length: 20 }, (_, i) => [id(1000 + i), id(1000 + i)]))

    const refuse = await am.modifierExemptions([a, b], { ajoutRoles: [id(5000)] }, "test")
    assert.strictEqual(refuse.erreur, "roles")
    assert.strictEqual(refuse.regle, "B")
    assert.strictEqual(a.modifs + b.modifs, 0, "rien n'est modifié si une règle dépasse la limite")
    assert.strictEqual((await am.modifierExemptions([b], { ajoutRoles: [id(1000)] }, "test")).modifiees, 0, "déjà exempté : rien à faire")

    const ok = await am.modifierExemptions([a], { ajoutRoles: [id(5000)], ajoutSalons: Array.from({ length: 50 }, (_, i) => id(2000 + i)) }, "test")
    assert.strictEqual(ok.modifiees, 1)
    assert.strictEqual(a.exemptChannels.size, 50)
    assert.strictEqual((await am.modifierExemptions([a], { ajoutSalons: [id(9999)] }, "test")).erreur, "salons", "51e salon refusé")

    const retrait = await am.modifierExemptions([a], { retraitRoles: [id(5000)], retraitSalons: [id(2000)] }, "test")
    assert.strictEqual(retrait.modifiees, 1)
    assert.ok(!a.exemptRoles.has(id(5000)) && !a.exemptChannels.has(id(2000)) && a.exemptChannels.size === 49)
})

test("exemption automatique des salons de jeux et héritage par les nouvelles règles", async () => {
    const guild = fauxServeur("700000000000000011")
    const salonJeu = id(300), salonSupprime = id(301)
    guild.channels.cache.set(salonJeu, { id: salonJeu })
    db.setSalonsJeux(guild.id, [salonJeu, salonSupprime])
    assert.deepStrictEqual(am.salonsDeJeux(guild), [salonJeu], "un salon supprimé n'est pas envoyé à Discord")

    await am.appliquerPreset(guild, bot, "souple", null, "test")
    const regles = await am.reglesDuBot(guild, bot)
    await am.modifierExemptions([...regles.values()], { ajoutSalons: am.salonsDeJeux(guild), ajoutRoles: [id(400)] }, "test")
    assert.ok([...regles.values()].every(r => r.exemptChannels.has(salonJeu) && r.exemptRoles.has(id(400))))

    // Une règle créée ensuite reprend les exemptions déjà en place
    await am.appliquerPreset(guild, bot, "normal", null, "test")
    const invitations = guild.regles.find(r => r.name === "[Bot] Invitations Discord")
    assert.ok(invitations.exemptChannels.has(salonJeu) && invitations.exemptRoles.has(id(400)))
})

// --- Événement ---

function evenement(guild, surcharge = {}) {
    return {
        guild, userId: U, ruleId: guild.regles[0].id, channelId: id(50), matchedKeyword: "insulte", user: { id: U, bot: false, send: async () => {} },
        action: { type: ActionType.BlockMessage }, ...surcharge
    }
}

function serveurEvenement(guildId, actions = [{ type: ActionType.BlockMessage }, { type: ActionType.SendAlertMessage }]) {
    const guild = fauxServeur(guildId)
    faussRegle(guild, { name: "[Bot] Mots interdits", triggerType: TriggerType.Keyword, actions })
    return guild
}

test("dossier : un blocage = une ligne type automod (raison courte), même si Discord émet un événement par action", async () => {
    am.reinitialiserEtat()
    const guild = serveurEvenement("700000000000000020")
    const motLong = "x".repeat(300)
    const r1 = await am.traiterExecution(bot, evenement(guild, { matchedKeyword: motLong }))
    // Alerte et mute du même déclenchement : ignorés, la règle a un blocage
    assert.strictEqual(await am.traiterExecution(bot, evenement(guild, { action: { type: ActionType.SendAlertMessage }, alertSystemMessageId: id(77) })), null)
    assert.strictEqual(await am.traiterExecution(bot, evenement(guild, { action: { type: ActionType.Timeout } })), null)
    const dossiers = db.listCases(guild.id, U)
    assert.strictEqual(dossiers.length, 1)
    assert.strictEqual(dossiers[0].type, "automod")
    assert.strictEqual(dossiers[0].moderator_id, BOT)
    assert.strictEqual(dossiers[0].auto, 1)
    assert.ok(dossiers[0].reason.length <= 100 && dossiers[0].reason.includes("[Bot] Mots interdits"), "nom de la règle et mot, tronqué")
    assert.strictEqual(r1.warnId, null, "count_warns coupé par défaut : pas de warn")
    assert.strictEqual(db.countWarns(guild.id, U), 0)
})

test("dédoublonnage : règle sans blocage (une seule action retenue) et événement reçu deux fois", async () => {
    am.reinitialiserEtat()
    const guild = serveurEvenement("700000000000000021", [{ type: ActionType.SendAlertMessage }, { type: ActionType.Timeout }])
    const alerte = evenement(guild, { action: { type: ActionType.SendAlertMessage }, alertSystemMessageId: id(88) })
    assert.ok(await am.traiterExecution(bot, alerte), "règle sans blocage : la première action reçue compte")
    assert.strictEqual(await am.traiterExecution(bot, alerte), null, "même message d'alerte : déjà traité")
    assert.strictEqual(await am.traiterExecution(bot, evenement(guild, { action: { type: ActionType.Timeout }, alertSystemMessageId: id(88) })), null)
    assert.strictEqual(db.countCases(guild.id, U), 1)
    // Un blocage avec identifiant livré deux fois
    const guild2 = serveurEvenement("700000000000000022")
    const bloc = evenement(guild2, { alertSystemMessageId: id(99) })
    assert.ok(await am.traiterExecution(bot, bloc))
    assert.strictEqual(await am.traiterExecution(bot, bloc), null)
    // Deux déclenchements distincts (sans identifiant) sont tous deux enregistrés
    assert.ok(await am.traiterExecution(bot, evenement(guild2)))
    assert.ok(await am.traiterExecution(bot, evenement(guild2)))
    assert.strictEqual(db.countCases(guild2.id, U), 3)
})

test("événement ignoré : bot, module Modération coupé, règle inconnue hors blocage", async () => {
    am.reinitialiserEtat()
    const guild = serveurEvenement("700000000000000023")
    assert.strictEqual(await am.traiterExecution(bot, evenement(guild, { user: { id: U, bot: true } })), null, "auteur = bot")
    assert.strictEqual(await am.traiterExecution(bot, evenement(guild, { userId: BOT })), null, "le bot lui-même")
    assert.strictEqual(await am.traiterExecution(bot, evenement(guild, { ruleId: id(9999), action: { type: ActionType.SendAlertMessage } })), null, "règle inconnue, pas un blocage")
    db.setModule(guild.id, "moderation", false)
    assert.strictEqual(await am.traiterExecution(bot, evenement(guild)), null, "module désactivé")
    assert.strictEqual(db.countCases(guild.id, U), 0)
})

test("dossiers : avertissement et seuil seulement si count_warns est activé, une fois par minute", async () => {
    am.reinitialiserEtat()
    const guild = serveurEvenement("700000000000000024")
    const membre = { id: U, kickable: true, roles: { highest: role(1) }, kick: async () => { membre.expulse = true } }
    guild.members.fetch = async () => membre
    db.setThreshold(guild.id, 2, "kick", null)

    assert.strictEqual(am.getCountWarns(guild.id), false)
    await am.traiterExecution(bot, evenement(guild))
    assert.strictEqual(db.countWarns(guild.id, U), 0, "désactivé : pas de warn")

    am.setCountWarns(guild.id, true)
    assert.strictEqual(am.getCountWarns(guild.id), true)
    const t0 = 1_000_000_000_000
    const un = await am.traiterExecution(bot, evenement(guild), { maintenant: t0 })
    assert.ok(un.warnId)
    assert.strictEqual(db.countWarns(guild.id, U), 1)
    assert.strictEqual(db.getWarn(guild.id, un.warnId).moderator_id, BOT)

    // Rafale : le 2e blocage dans la minute est consigné mais ne warn pas (sinon le seuil de 2 partirait tout de suite)
    const rafale = await am.traiterExecution(bot, evenement(guild), { maintenant: t0 + 5000 })
    assert.strictEqual(rafale.warnId, null)
    assert.strictEqual(db.countWarns(guild.id, U), 1)
    assert.ok(!membre.expulse)

    // Une minute plus tard : 2e warn, le seuil « 2 warns = kick » s'applique avec les droits du bot
    const deux = await am.traiterExecution(bot, evenement(guild), { maintenant: t0 + 61000 })
    assert.ok(deux.warnId)
    assert.strictEqual(db.countWarns(guild.id, U), 2)
    assert.strictEqual(membre.expulse, true)
    assert.ok(deux.sanction)
    assert.ok(db.listCases(guild.id, U, 20).some(c => c.type === "kick" && c.moderator_id === BOT && c.auto === 1))

    am.setCountWarns(guild.id, false)
    assert.strictEqual(am.getCountWarns(guild.id), false)
})

test("seuil d'AutoMod : refusé si le bot n'a pas la permission de la sanction", async () => {
    am.reinitialiserEtat()
    const guild = serveurEvenement("700000000000000025")
    guild.members.me.permissions = new Discord.PermissionsBitField(Flags.ManageGuild) // ni kick ni ban
    guild.members.fetch = async () => { throw new Error("ne doit pas être appelé") }
    db.setThreshold(guild.id, 1, "ban", null)
    am.setCountWarns(guild.id, true)
    const r = await am.traiterExecution(bot, evenement(guild))
    assert.ok(r.warnId, "le warn est posé")
    assert.match(r.sanction, /non appliquée.*permission/)
})
