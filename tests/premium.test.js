process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const premium = require('../Fonctions/premium')

test("premium (entitlements, cache, remboursement, serveurs offerts, bouton d'achat)", async (t) => {
    // Le timer du code testé est unref : on garde la boucle d'événements éveillée le temps du test
    const garde = setInterval(() => {}, 1000)
    t.after(() => clearInterval(garde))

    const G = "555555555555555570", AUTRE = "555555555555555571", SKU = "999999999999999970"
    const sauvegarde = { sku: process.env.PREMIUM_SKU_ID, offerts: process.env.PREMIUM_GUILD_IDS }
    try {
        // Sans SKU : premium désactivé, tout est gratuit (aucun appel à Discord)
        delete process.env.PREMIUM_SKU_ID
        assert.strictEqual(await premium.estPremium({ application: null }, G), true, "sans SKU : tout est gratuit")

        process.env.PREMIUM_SKU_ID = SKU
        process.env.PREMIUM_GUILD_IDS = `${AUTRE}, pas-un-id`
        const maintenant = Date.now()
        const ent = (champs = {}) => ({ skuId: SKU, guildId: G, deleted: false, consumed: false, startsTimestamp: null, endsTimestamp: null, ...champs })
        assert.ok(premium.entitlementValide(ent(), G), "entitlement de test (sans fin) valide")
        assert.ok(premium.entitlementValide(ent({ endsTimestamp: maintenant + 1000 }), G), "abonnement en cours")
        assert.ok(!premium.entitlementValide(ent({ endsTimestamp: maintenant - 1000 }), G), "abonnement terminé")
        assert.ok(!premium.entitlementValide(ent({ deleted: true }), G), "remboursé")
        assert.ok(!premium.entitlementValide(ent({ skuId: "111111111111111111" }), G), "autre SKU")
        assert.ok(!premium.entitlementValide(ent({ guildId: AUTRE }), G), "autre serveur : pas de premium par contagion")
        assert.ok(!premium.entitlementValide(ent({ startsTimestamp: maintenant + 60000 }), G), "pas encore commencé")

        // Serveur offert, puis entitlements de l'interaction, puis appel à Discord avec cache
        let appels = 0, reponse = [ent()], panne = false
        const botP = { application: { entitlements: { fetch: async options => {
            appels++
            assert.deepStrictEqual([options.guild, options.skus, options.excludeEnded], [G, [SKU], true])
            if (panne) throw new Error("Discord indisponible")
            return new Discord.Collection(reponse.map((e, i) => [String(i), e]))
        } } } }
        assert.strictEqual(await premium.estPremium(botP, AUTRE), true, "serveur offert via PREMIUM_GUILD_IDS")
        assert.strictEqual(await premium.estPremium(botP, null), false, "hors serveur : jamais premium")
        assert.strictEqual(await premium.estPremium(botP, G, { entitlements: new Discord.Collection([["e", ent()]]) }), true, "entitlement de l'interaction")
        assert.strictEqual(appels, 0, "aucun appel à Discord pour ces deux cas")
        assert.strictEqual(await premium.estPremium(botP, G), true)
        assert.strictEqual(await premium.estPremium(botP, G), true)
        assert.strictEqual(appels, 1, "résultat gardé en cache")
        // Remboursement : l'événement vide le cache, le statut est relu
        reponse = []
        premium.oublier(G)
        assert.strictEqual(await premium.estPremium(botP, G), false, "remboursé : plus de premium")
        // Discord en panne : dernière valeur connue
        premium.oublier(G)
        panne = true
        assert.strictEqual(await premium.estPremium(botP, G), false, "panne sans valeur connue : pas de premium (confort seulement)")

        // Discord trop lent : on n'attend pas plus de 1,5 s (l'interaction doit répondre en 3 s)
        panne = false
        const lent = { application: { entitlements: { fetch: () => new Promise(r => setTimeout(() => r(new Discord.Collection()), 5000).unref()) } } }
        const debut = Date.now()
        assert.strictEqual(await premium.estPremium(lent, "555555555555555572"), false)
        assert.ok(Date.now() - debut < 2500, "délai respecté")

        // Remboursement pendant la lecture : le résultat (périmé) n'est pas gardé en cache
        const G2 = "555555555555555573"
        let liberer
        const pendant = { application: { entitlements: { fetch: () => new Promise(r => { liberer = () => r(new Discord.Collection([["e", ent({ guildId: G2 })]])) }) } } }
        const lecture = premium.estPremium(pendant, G2)
        premium.oublier(G2)
        liberer()
        assert.strictEqual(await lecture, true)
        reponse = []
        appels = 0
        assert.strictEqual(await premium.estPremium({ application: { entitlements: { fetch: async () => { appels++; return new Discord.Collection() } } } }, G2), false, "relu après le remboursement")
        assert.strictEqual(appels, 1)

        // Fonction premium refusée : réponse éphémère avec le bouton d'achat natif
        const reponses = []
        const interactionP = {
            client: botP, guildId: G, locale: "fr", entitlements: new Discord.Collection(), deferred: false, replied: false,
            reply: async r => reponses.push(r)
        }
        assert.strictEqual(await premium.exigerPremium(interactionP, "stats"), false)
        const bouton = reponses[0].components[0].toJSON().components[0]
        assert.deepStrictEqual([bouton.style, bouton.sku_id], [Discord.ButtonStyle.Premium, SKU], "bouton Premium avec le SKU")
        assert.ok(reponses[0].content.includes("statistiques"), "message traduit avec le nom de la fonction")
        for (const f of premium.FONCTIONS) assert.ok(require('../Fonctions/i18n').textes.fr[`premium.fonction.${f}`], `nom de la fonction ${f}`)
    } finally {
        if (sauvegarde.sku === undefined) delete process.env.PREMIUM_SKU_ID; else process.env.PREMIUM_SKU_ID = sauvegarde.sku
        if (sauvegarde.offerts === undefined) delete process.env.PREMIUM_GUILD_IDS; else process.env.PREMIUM_GUILD_IDS = sauvegarde.offerts
    }
})
