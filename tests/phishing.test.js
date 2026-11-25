process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const Discord = require('discord.js')
const ph = require('../Fonctions/phishing')
const { controler } = require('../Fonctions/garde')
const { role, chargerCommandes } = require('./aides')

const { Flags } = Discord.PermissionsBitField
const TriggerType = Discord.AutoModerationRuleTriggerType
const BOT = "900000000000000001", AUTRE = "900000000000000002", U = "800000000000000001"
const id = n => String(100000000000000000n + BigInt(n))
const bot = { user: { id: BOT, tag: "bot#0" } }

// Faux serveur : seules les règles AutoMod comptent (create / fetch / edit / delete comme Discord)
function fauxServeur(guildId, { permsBot = Flags.ManageGuild } = {}) {
    const guild = {
        id: guildId, ownerId: "owner", regles: [], channels: { cache: new Discord.Collection() },
        members: { me: { id: BOT, roles: { highest: role(10) }, permissions: new Discord.PermissionsBitField(permsBot) } }
    }
    const ajouter = donnees => {
        const regle = {
            id: id(guild.regles.length + 1), creatorId: BOT, enabled: true, actions: [], triggerType: TriggerType.Keyword,
            exemptRoles: new Discord.Collection(), exemptChannels: new Discord.Collection(), supprimee: false, ...donnees,
            async edit(opts) {
                for (const cle of ["triggerMetadata", "actions", "enabled"]) if (opts[cle] !== undefined) regle[cle] = opts[cle]
                return regle
            },
            async delete() {
                regle.supprimee = true
                guild.regles = guild.regles.filter(r => r !== regle)
            }
        }
        guild.regles.push(regle)
        return regle
    }
    guild.ajouter = ajouter
    guild.autoModerationRules = {
        fetch: async () => new Discord.Collection(guild.regles.map(r => [r.id, r])),
        create: async opts => ajouter({
            name: opts.name, triggerType: opts.triggerType, triggerMetadata: opts.triggerMetadata, actions: opts.actions,
            exemptRoles: new Discord.Collection((opts.exemptRoles ?? []).map(i => [i, i]))
        })
    }
    return guild
}

// Fausse interaction pour run() : options en objet, réponses gardées dans `textes`
function fausseInteraction(guild, options) {
    const textes = []
    const contenu = r => typeof r === "string" ? r : r.content
    const i = {
        guild, guildId: guild.id, user: { id: U, tag: "mod#0" }, locale: "fr", textes, deferred: false, replied: false, ephemeral: false,
        deferReply: async (o = {}) => { i.deferred = true; i.ephemeral = Boolean(o.flags) },
        editReply: async r => { textes.push(contenu(r)) },
        reply: async r => { i.replied = true; textes.push(contenu(r)) },
        followUp: async r => { textes.push(contenu(r)) },
        deleteReply: async () => {}
    }
    const args = {
        getString: nom => options[nom] ?? null, getUser: () => null, getRole: () => null, getChannel: () => null, getBoolean: () => null
    }
    return { i, args }
}
const appel = async (guild, options) => {
    const commande = chargerCommandes().commands.get("phishing")
    const { i, args } = fausseInteraction(guild, options)
    await commande.run(bot, i, args)
    return i.textes.at(-1)
}

test("/phishing : refusé à un membre sans « Gérer le serveur » (garde commune)", async () => {
    const commande = chargerCommandes().commands.get("phishing")
    assert.strictEqual(commande.module, "moderation")
    const interaction = perms => ({
        guildId: "700000000000000001", channelId: "333333333333333333", user: { id: U }, locale: "fr", inGuild: () => true,
        memberPermissions: new Discord.PermissionsBitField(perms), member: { roles: { cache: new Set() } }
    })
    assert.ok(await controler(interaction(Flags.ModerateMembers | Flags.KickMembers | Flags.ManageRoles), commande), "sans droit : refusé")
    assert.strictEqual(await controler(interaction(Flags.ManageGuild), commande), null, "avec le droit : accepté")
})

test("la liste du dépôt est valide : minuscules, sans doublon, dans les limites de Discord", () => {
    const { domaines, invalides, doublons } = ph.analyserListe(fs.readFileSync(ph.FICHIER, "utf8"))
    assert.deepStrictEqual(invalides, [])
    assert.deepStrictEqual(doublons, [])
    assert.ok(domaines.length >= 30, "une trentaine de domaines au moins")
    assert.strictEqual(new Set(domaines).size, domaines.length)
    for (const d of domaines) {
        assert.strictEqual(d, d.toLowerCase())
        assert.strictEqual(ph.normaliserDomaine(d), d, `${d} est déjà normalisé`)
    }
    const { mots } = ph.construireMotsCles(domaines)
    assert.strictEqual(mots.length, domaines.length)
    assert.ok(mots.every(m => m.length <= 60 && m.startsWith("*") && m.endsWith("*")))
    // Aucun domaine officiel dans la liste : la règle bloque tout lien qui le contient
    for (const officiel of ["discord.com", "discordapp.com", "discord.gg", "discord.gift", "steamcommunity.com", "steampowered.com"]) {
        assert.ok(!domaines.some(d => officiel.includes(d)), `${officiel} ne doit pas être bloqué`)
    }
    assert.deepStrictEqual(ph.chargerListe(), domaines, "le chargeur lit la même liste")
})

test("lecture de la liste : commentaires ignorés, doublons et lignes invalides signalés", () => {
    const r = ph.analyserListe("# commentaire\n\nexemple.com\nautre.net\nexemple.com\nMAJUSCULE.com\nhttps://x.com/chemin\nsans-point\n*.joker.com\r\nok.org\n")
    assert.deepStrictEqual(r.domaines, ["exemple.com", "autre.net", "ok.org"])
    assert.deepStrictEqual(r.doublons, ["exemple.com"])
    assert.deepStrictEqual(r.invalides.map(l => l.texte), ["MAJUSCULE.com", "https://x.com/chemin", "sans-point", "*.joker.com"])
})

test("saisie d'un domaine : adresse complète acceptée, tout le reste refusé", () => {
    assert.strictEqual(ph.normaliserDomaine("HTTPS://WWW.Exemple.COM/chemin?x=1#a"), "exemple.com")
    assert.strictEqual(ph.normaliserDomaine("  sous.exemple.fr:8080 "), "sous.exemple.fr")
    assert.strictEqual(ph.normaliserDomaine("exemple.com."), "exemple.com")
    assert.strictEqual(ph.normaliserDomaine("xn--exemple-9ua.com"), "xn--exemple-9ua.com")
    for (const faux of ["", "exemple", "*.exemple.com", "exem*ple.com", "a b.com", "-x.com", "exemple.c", "exemple.123", "éxemple.com", null, undefined, `${"a".repeat(59)}.com`]) {
        assert.strictEqual(ph.normaliserDomaine(faux), null, `« ${faux} » refusé`)
    }
    // Le motif *domaine* doit tenir en 60 caractères
    assert.ok(ph.normaliserDomaine(`${"a".repeat(54)}.com`), "58 caractères : accepté")
    assert.strictEqual(ph.normaliserDomaine(`${"a".repeat(55)}.com`), null, "59 caractères : refusé")
})

test("liste blanche retirée des mots-clés (sous-domaines compris)", () => {
    const r = ph.construireMotsCles(["a.com", "b.com", "x.b.com", "c.net"], ["b.com"])
    assert.deepStrictEqual(r.mots, ["*a.com*", "*c.net*"])
    assert.strictEqual(r.retires, 2)
    assert.strictEqual(r.tronques, 0)
    assert.ok(!ph.estAutorise("ab.com", ["b.com"]), "ab.com n'est pas un sous-domaine de b.com")
    assert.deepStrictEqual(ph.construireMotsCles(["a.com"], ["a.com"]).mots, [])
})

test("limites de Discord : 1 000 mots-clés, on garde les premiers et on le signale", () => {
    const domaines = Array.from({ length: 1200 }, (_, n) => `d${n}.com`)
    const r = ph.construireMotsCles(domaines, ["d0.com"])
    assert.strictEqual(r.mots.length, 1000)
    assert.strictEqual(r.mots[0], "*d1.com*", "les premiers de la liste sont gardés")
    assert.strictEqual(r.tronques, 199)
    assert.strictEqual(r.retires, 1)
    assert.strictEqual(ph.LIMITES.reglesMotsCles, 6)
    assert.strictEqual(ph.LIMITES.blanche, 50)
})

test("6 règles de mots-clés par serveur : la nôtre ne prend pas de place en plus", () => {
    const regle = (n, creatorId, name = `r${n}`, triggerType = TriggerType.Keyword) => ({ id: id(n), creatorId, name, triggerType })
    const cinq = [1, 2, 3, 4, 5].map(n => regle(n, AUTRE))
    assert.ok(ph.placeDisponible(cinq, BOT), "5 règles : une place")
    const six = [...cinq, regle(6, AUTRE)]
    assert.ok(!ph.placeDisponible(six, BOT), "6 règles d'autres : plus de place")
    assert.ok(!ph.placeDisponible(new Discord.Collection(six.map(r => [r.id, r])), BOT), "Collection comprise")
    assert.ok(ph.placeDisponible([...cinq, regle(7, BOT, ph.NOM_REGLE)], BOT), "6 règles dont la nôtre : mise à jour possible")
    assert.ok(!ph.placeDisponible([...cinq, regle(7, AUTRE, ph.NOM_REGLE)], BOT), "une règle d'un autre au même nom n'est pas la nôtre")
    assert.ok(ph.placeDisponible([...cinq, regle(8, AUTRE, "spam", TriggerType.Spam)], BOT), "les règles d'un autre type ne comptent pas")
})

test("liste blanche : 50 domaines au maximum, pas de doublon", () => {
    const G = "700000000000000010"
    assert.strictEqual(ph.autoriser(G, "a.com"), "ok")
    assert.strictEqual(ph.autoriser(G, "a.com"), "deja")
    for (let n = 1; n < 50; n++) assert.strictEqual(ph.autoriser(G, `d${n}.com`), "ok")
    assert.strictEqual(ph.listeBlanche(G).length, 50)
    assert.strictEqual(ph.autoriser(G, "de-trop.com"), "max")
    assert.strictEqual(ph.autoriser("700000000000000011", "a.com"), "ok", "la liste est propre à chaque serveur")
    assert.ok(ph.retirerAutorisation(G, "a.com"))
    assert.ok(!ph.retirerAutorisation(G, "a.com"))
    assert.strictEqual(ph.autoriser(G, "de-trop.com"), "ok")
})

test("/phishing activer : crée UNE règle du bot, la met à jour, ne touche pas à celle d'un autre", async () => {
    const guild = fauxServeur("700000000000000020")
    const etrangere = guild.ajouter({ name: ph.NOM_REGLE, creatorId: AUTRE, triggerMetadata: { keywordFilter: ["*x*"] } })
    guild.ajouter({ name: "[Bot] Mots interdits", creatorId: BOT, exemptRoles: new Discord.Collection([[id(77), id(77)]]) })

    await appel(guild, { action: "autoriser", domaine: "https://www.discord-gift.com/x" })
    const texte = await appel(guild, { action: "activer" })
    assert.match(texte, /créée/)
    const nos = guild.regles.filter(r => r.creatorId === BOT && r.name === ph.NOM_REGLE)
    assert.strictEqual(nos.length, 1)
    assert.ok(!nos[0].triggerMetadata.keywordFilter.includes("*discord-gift.com*"), "domaine autorisé : non bloqué")
    assert.ok(nos[0].triggerMetadata.keywordFilter.includes("*dlscord.com*"))
    assert.ok(nos[0].actions.some(a => a.type === Discord.AutoModerationActionType.BlockMessage))
    assert.ok(nos[0].exemptRoles.has(id(77)), "exemptions reprises des autres règles du bot")
    assert.deepStrictEqual(etrangere.triggerMetadata.keywordFilter, ["*x*"], "règle d'un autre intacte")

    // La liste blanche change : la règle existante est remise à jour, sans doublon
    const avant = nos[0].triggerMetadata.keywordFilter.length
    const suite = await appel(guild, { action: "retirer", domaine: "discord-gift.com" })
    assert.match(suite, /mise à jour/)
    assert.strictEqual(guild.regles.filter(r => r.name === ph.NOM_REGLE && r.creatorId === BOT).length, 1)
    assert.strictEqual(nos[0].triggerMetadata.keywordFilter.length, avant + 1)
    assert.match(await appel(guild, { action: "activer" }), /mis à jour/)
})

test("/phishing desactiver : supprime seulement la règle du bot", async () => {
    const guild = fauxServeur("700000000000000021")
    const etrangere = guild.ajouter({ name: ph.NOM_REGLE, creatorId: AUTRE })
    assert.match(await appel(guild, { action: "desactiver" }), /pas activé/)
    await appel(guild, { action: "activer" })
    assert.match(await appel(guild, { action: "desactiver" }), /supprimée/)
    assert.deepStrictEqual(guild.regles, [etrangere], "seule la règle d'un autre reste")
})

test("/phishing : permission du bot, plus de place, domaine invalide, tout autorisé", async () => {
    const sansPerm = fauxServeur("700000000000000022", { permsBot: 0n })
    assert.match(await appel(sansPerm, { action: "activer" }), /Gérer le serveur/)
    assert.strictEqual(sansPerm.regles.length, 0)
    // Autoriser sans la permission : enregistré, mais la règle n'est pas touchée
    assert.match(await appel(sansPerm, { action: "autoriser", domaine: "exemple.com" }), /prochain/)

    const pleine = fauxServeur("700000000000000023")
    for (let n = 0; n < 6; n++) pleine.ajouter({ name: `admin${n}`, creatorId: AUTRE })
    assert.match(await appel(pleine, { action: "activer" }), /6 règles/)
    assert.strictEqual(pleine.regles.length, 6, "rien n'est créé")

    const guild = fauxServeur("700000000000000024")
    assert.match(await appel(guild, { action: "autoriser", domaine: "pas un domaine" }), /pas un nom de domaine valide/)
    assert.match(await appel(guild, { action: "autoriser" }), /option `domaine`/)
    for (const d of ph.chargerListe()) ph.autoriser(guild.id, d)
    assert.match(await appel(guild, { action: "activer" }), /rien à bloquer/)
})

test("/phishing liste : état et domaines autorisés", async () => {
    const guild = fauxServeur("700000000000000025")
    await appel(guild, { action: "autoriser", domaine: "exemple.com" })
    const inactif = await appel(guild, { action: "liste" })
    assert.match(inactif, /: inactif/)
    assert.match(inactif, /`exemple\.com`/)
    await appel(guild, { action: "activer" })
    assert.match(await appel(guild, { action: "liste" }), /: actif/)
    assert.match(await appel(guild, { action: "autoriser", domaine: "exemple.com" }), /déjà autorisé/)
})
