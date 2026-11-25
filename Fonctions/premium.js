const Discord = require('discord.js')
const { t } = require('./i18n')

const EPHEMERAL = Discord.MessageFlags.Ephemeral
const DUREE_CACHE = 10 * 60 * 1000 // un serveur est relu auprès de Discord au plus toutes les 10 minutes
const DELAI_DISCORD = 1500 // au-delà, on n'attend pas Discord (une interaction doit recevoir une réponse en 3 s)
const ID = /^\d{17,20}$/

// SKU de l'abonnement serveur (Developer Portal > Monetization). Absent : premium désactivé, tout est gratuit
// (bot auto-hébergé). Lu à chaque appel pour suivre le .env chargé au démarrage et les tests.
const skuId = () => ID.test(process.env.PREMIUM_SKU_ID ?? "") ? process.env.PREMIUM_SKU_ID : null
const premiumActif = () => skuId() !== null

// Serveurs premium offerts (les tiens, des partenaires, ou un paiement Ko-fi/Patreon) : PREMIUM_GUILD_IDS=id1,id2
const serveursOfferts = () => new Set((process.env.PREMIUM_GUILD_IDS ?? "").split(",").map(s => s.trim()).filter(s => ID.test(s)))

const cache = new Map() // serveur -> { premium, expire }
const versions = new Map() // serveur -> compteur, incrémenté à chaque événement d'entitlement

// Un entitlement donne le premium s'il concerne notre SKU, ce serveur, et qu'il est en cours
// (pas supprimé, pas consommé, pas terminé ; un entitlement de test n'a pas de fin).
function entitlementValide(entitlement, guildId, maintenant = Date.now()) {
    if (!entitlement || entitlement.skuId !== skuId() || entitlement.guildId !== guildId) return false
    if (entitlement.deleted || entitlement.consumed) return false
    if (entitlement.startsTimestamp && entitlement.startsTimestamp > maintenant) return false
    return !entitlement.endsTimestamp || entitlement.endsTimestamp > maintenant
}

// Le serveur a-t-il le premium ? Toujours vrai si le premium est désactivé.
// interaction (facultative) : ses entitlements suffisent souvent, sans appel à Discord.
async function estPremium(bot, guildId, interaction = null) {
    if (!premiumActif()) return true
    if (!guildId) return false // hors serveur : jamais premium
    if (serveursOfferts().has(guildId)) return true
    if (interaction?.entitlements?.some(e => entitlementValide(e, guildId))) return true

    const enCache = cache.get(guildId)
    if (enCache && enCache.expire > Date.now()) return enCache.premium
    const version = versions.get(guildId) ?? 0
    try {
        const liste = await Promise.race([
            bot.application.entitlements.fetch({ guild: guildId, skus: [skuId()], excludeEnded: true, cache: false }),
            new Promise((_, rejeter) => setTimeout(() => rejeter(new Error("Discord trop lent")), DELAI_DISCORD).unref())
        ])
        const premium = liste.some(e => entitlementValide(e, guildId))
        // Un achat ou un remboursement arrivé pendant la lecture : ce résultat est peut-être déjà périmé, on ne le garde pas
        if ((versions.get(guildId) ?? 0) === version) {
            if (cache.size > 5000) for (const [id, e] of cache) if (e.expire <= Date.now()) cache.delete(id)
            cache.set(guildId, { premium, expire: Date.now() + DUREE_CACHE })
        }
        return premium
    } catch (err) {
        // Discord indisponible : dernière valeur connue (même périmée), sinon non premium (fonctions de confort seulement)
        console.error("Vérification du premium impossible :", err.message)
        return enCache?.premium ?? false
    }
}

// Événements entitlementCreate / Update / Delete : le serveur sera relu au prochain appel
function oublier(guildId) {
    if (!guildId) return
    cache.delete(guildId)
    versions.set(guildId, (versions.get(guildId) ?? 0) + 1)
}

// Bouton d'achat natif de Discord (affiche le nom et le prix du SKU ; aucun clic à gérer)
function boutonAchat() {
    if (!premiumActif()) return []
    return [new Discord.ActionRowBuilder().addComponents(new Discord.ButtonBuilder().setStyle(Discord.ButtonStyle.Premium).setSKUId(skuId()))]
}

// À appeler au début d'une fonction premium. Renvoie true si on peut continuer ;
// sinon répond à l'interaction (message éphémère + bouton d'achat) et renvoie false.
async function exigerPremium(interaction, fonction) {
    if (await estPremium(interaction.client, interaction.guildId, interaction)) return true
    const contenu = { content: t(interaction, "premium.requis", { fonction: t(interaction, `premium.fonction.${fonction}`) }), components: boutonAchat(), flags: EPHEMERAL }
    if (interaction.deferred || interaction.replied) await interaction.followUp(contenu)
    else await interaction.reply(contenu)
    return false
}

module.exports = { estPremium, exigerPremium, oublier, boutonAchat, entitlementValide, premiumActif, skuId, serveursOfferts, FONCTIONS: ["types", "html", "stats", "apparence"] }
