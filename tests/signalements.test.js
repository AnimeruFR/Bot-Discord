process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('assert')
const Discord = require('discord.js')
const { creerRouteur } = require('../Fonctions/routeur')
const { controler } = require('../Fonctions/garde')
const cooldowns = require('../Fonctions/cooldowns')
const loadCommands = require('../Loader/loadCommands')
const { setSalonFamille } = require('../Fonctions/logs')
const sig = require('../Fonctions/signalements')
const cases = require('../Fonctions/cases')
const db = require('../Fonctions/db')

const { Flags } = Discord.PermissionsBitField
const G = "111111111111111111"
const SALON_LOGS = "222222222222222222"
const MEMBRE = "777777777777777777"
const AUTEUR = "888888888888888888"

function chargerTout() {
    const bot = { commands: new Discord.Collection(), routeur: creerRouteur() }
    loadCommands(bot, { silencieux: true })
    return bot
}

// Faux serveur avec un salon de logs où le bot peut écrire (ou sans salon du tout)
function serveur({ avecSalon = true } = {}) {
    const envoyes = []
    const salon = { isTextBased: () => true, permissionsFor: () => ({ has: () => true }), send: async m => envoyes.push(m) }
    return {
        envoyes, id: G, preferredLocale: "fr", members: { me: {} },
        channels: { cache: new Map(avecSalon ? [[SALON_LOGS, salon]] : []) }
    }
}

// Faux composant ou menu : membre sans droit par défaut
function interaction(customId, { perms = [], guild = serveur() } = {}) {
    const reponses = []
    return {
        reponses, reply: async r => reponses.push(r), user: { id: MEMBRE }, channelId: "333333333333333333",
        customId, guildId: G, guild, locale: "fr", inGuild: () => true,
        isButton: () => customId.startsWith("sigmod:"), isAnySelectMenu: () => false, isModalSubmit: () => false,
        memberPermissions: new Discord.PermissionsBitField(perms), member: { roles: { cache: new Set() } }
    }
}

const message = (auteur = {}) => ({ id: "444444444444444444", channelId: "333333333333333333", guildId: G, content: "Salut", author: { id: AUTEUR, bot: false, ...auteur } })

test("un non-staff qui clique Warn, Mute ou Ignorer est refusé par le routeur", async () => {
    const bot = chargerTout()
    for (const action of ["w", "m", "i"]) {
        const clic = interaction(`sigmod:${action}:${AUTEUR}`)
        assert.strictEqual(await bot.routeur.router(bot, clic), true, action)
        assert.ok(clic.reponses[0].flags, `${action} : refus éphémère`)
    }
    // Le staff passe la garde : le gestionnaire est bien atteint
    const route = bot.routeur.routes.find(r => r.prefixe === sig.PREFIXE_ACTION)
    let atteint = 0
    route.gestionnaire = () => atteint++
    await bot.routeur.router(bot, interaction(`sigmod:w:${AUTEUR}`, { perms: Flags.ModerateMembers }))
    assert.strictEqual(atteint, 1)
})

test("un non-staff ne peut pas utiliser les menus staff, le staff le peut", async () => {
    const bot = chargerTout()
    for (const nom of ["Dossier", "Warn rapide", "Mute 10 min"]) {
        const commande = bot.commands.get(nom)
        assert.ok(commande, nom)
        assert.ok(await controler(interaction("x"), commande), `${nom} refusé à un membre simple`)
        assert.strictEqual(await controler(interaction("x", { perms: Flags.ModerateMembers }), commande), null, `${nom} permis au modérateur`)
    }
    // Le modal du Warn rapide passe aussi par la garde staff
    const modal = interaction(`ctxwarn:${AUTEUR}`)
    modal.isModalSubmit = () => true
    modal.isButton = () => false
    assert.strictEqual(await bot.routeur.router(bot, modal), true)
    assert.ok(modal.reponses[0].flags)
})

test("un membre simple peut signaler, avec un délai", async () => {
    const bot = chargerTout()
    const commande = bot.commands.get("Signaler au staff")
    cooldowns.vider()
    assert.strictEqual(await controler(interaction("x"), commande), null)
    assert.ok(await controler(interaction("x"), commande), "deuxième signalement dans la minute : refusé")
    cooldowns.vider()

    setSalonFamille(G, "signalements", SALON_LOGS)
    assert.strictEqual(sig.verifierSignalement(interaction("x"), message()), null)
})

test("refus : son propre message, un bot, un webhook, un message système, aucun salon de logs", () => {
    const i = interaction("x")
    assert.ok(sig.verifierSignalement(i, message({ id: MEMBRE })), "son propre message")
    assert.ok(sig.verifierSignalement(i, message({ bot: true })), "un bot")
    assert.ok(sig.verifierSignalement(i, { ...message(), webhookId: "5" }), "un webhook")
    assert.ok(sig.verifierSignalement(i, { ...message(), system: true }), "un message système")
    const sansSalon = interaction("x", { guild: serveur({ avecSalon: false }) })
    assert.match(sig.verifierSignalement(sansSalon, message()), /configuré les signalements/)
})

test("les customId restent sous 100 caractères, même avec des identifiants de 20 chiffres", () => {
    const long = "9".repeat(20)
    const modal = sig.modalSignalement(interaction("x"), { ...message(), id: long, channelId: long })
    assert.ok(modal.data.custom_id.length <= 100)
    for (const bouton of sig.boutonsAction(serveur(), long)[0].components) assert.ok(bouton.data.custom_id.length <= 100)
    assert.ok(`${sig.PREFIXE_WARN}${long}`.length <= 100)
})

test("verrou : deux clics en même temps ne traitent le signalement qu'une fois", async () => {
    const guild = serveur()
    const edits = []
    const embed = new Discord.EmbedBuilder().setTitle("Message signalé").toJSON()
    const clic = () => {
        const i = interaction(`sigmod:i:${AUTEUR}`, { guild })
        Object.assign(i, {
            message: { id: "555555555555555555", components: [], embeds: [embed], edit: async m => edits.push(m) },
            deferReply: () => new Promise(r => setTimeout(r, 10)), editReply: async r => i.reponses.push(r),
            followUp: async r => i.reponses.push(r)
        })
        return i
    }
    const [a, b] = [clic(), clic()]
    await Promise.all([sig.traiterSignalement(null, a), sig.traiterSignalement(null, b)])
    assert.strictEqual(edits.length, 1, "un seul traitement")
    assert.strictEqual(a.reponses.length + b.reponses.length, 2)
    assert.ok([a, b].some(i => i.reponses[0].flags && /en cours/.test(i.reponses[0].content)), "le second est refusé")
    assert.ok(edits[0].components[0].components.every(c => c.data.disabled), "boutons désactivés")
    assert.match(edits[0].embeds[0].data.fields[0].value, /ignoré/)

    // Un clic tardif sur un signalement déjà traité (boutons désactivés) est refusé aussi
    const tardif = clic()
    tardif.message.components = [{ components: [{ disabled: true }] }]
    await sig.traiterSignalement(null, tardif)
    assert.match(tardif.reponses[0].content, /déjà été traité/)
    sig.verrous.clear()
})

test("menus staff : refus sur soi-même et sur un bot", () => {
    const i = interaction("x")
    assert.ok(sig.verifierMembre(i, { id: MEMBRE, bot: false }))
    assert.ok(sig.verifierMembre(i, { id: AUTEUR, bot: true }))
    assert.strictEqual(sig.verifierMembre(i, { id: AUTEUR, bot: false }), null)
})

test("loader : au plus 5 menus contextuels de chaque type", () => {
    const bot = chargerTout()
    const menus = { user: [], message: [] }
    for (const c of bot.commands.values()) if (c.type) menus[c.type].push(c.name)
    assert.ok(menus.message.includes("Signaler au staff"))
    assert.ok(menus.user.length >= 3)
    for (const [type, noms] of Object.entries(menus)) {
        assert.ok(noms.length <= 5, `${type} : ${noms.length} menus`)
        for (const nom of noms) assert.ok(nom.length <= 32, `${nom} : nom trop long`)
    }
})

// Soumission du modal : faux salon du message (permissions du signaleur au choix) et faux serveur
const SALON_MSG = "333333333333333333"
function soumission({ id, accordees = [Flags.ViewChannel, Flags.ReadMessageHistory], guild = serveur(), signaleur = MEMBRE }) {
    const msg = { ...message(), id, guildId: G }
    const salon = {
        isTextBased: () => true, messages: { fetch: async () => msg },
        permissionsFor: () => ({ has: p => [].concat(p).every(x => accordees.includes(x)) })
    }
    guild.channels.cache.set(SALON_MSG, salon)
    const i = interaction(`signal:${SALON_MSG}:${id}`, { guild })
    return Object.assign(i, {
        user: { id: signaleur }, deferred: true, ephemeral: true,
        fields: { getTextInputValue: () => "insultes" },
        deferReply: async () => {}, editReply: async r => i.reponses.push(r)
    })
}

test("signalement refusé sans salon « signalements », même si le salon général existe", async () => {
    const H = "999999999999999999"
    const guild = { ...serveur(), id: H }
    db.setLogChannel(H, SALON_LOGS)
    assert.ok(guild.channels.cache.get(SALON_LOGS), "le salon général existe et le bot peut y écrire")
    const i = interaction("x", { guild })
    assert.match(sig.verifierSignalement(i, message()), /pas encore configuré les signalements/)

    const modal = soumission({ id: "444444444444444450", guild })
    await sig.recevoirSignalement(null, modal)
    assert.strictEqual(guild.envoyes.length, 0, "rien n'est envoyé dans le salon général")
    assert.match(modal.reponses[0].content, /pas encore configuré les signalements/)
})

test("signalement refusé si le signaleur ne peut pas lire l'historique du salon", async () => {
    setSalonFamille(G, "signalements", SALON_LOGS)
    const guild = serveur()
    const sansHistorique = soumission({ id: "444444444444444451", accordees: [Flags.ViewChannel], guild })
    await sig.recevoirSignalement(null, sansHistorique)
    assert.match(sansHistorique.reponses[0].content, /n'existe plus ou n'est pas accessible/)
    const sansVue = soumission({ id: "444444444444444452", accordees: [Flags.ReadMessageHistory], guild })
    await sig.recevoirSignalement(null, sansVue)
    assert.match(sansVue.reponses[0].content, /n'existe plus ou n'est pas accessible/)
    assert.strictEqual(guild.envoyes.length, 0)

    const ok = soumission({ id: "444444444444444453", guild })
    await sig.recevoirSignalement(null, ok)
    assert.match(ok.reponses[0].content, /transmis au staff/)
    assert.strictEqual(guild.envoyes.length, 1)
})

test("le 2e signaleur d'un message déjà signalé apprend qu'il l'est déjà, sans nouvel envoi", async () => {
    setSalonFamille(G, "signalements", SALON_LOGS)
    const guild = serveur()
    const premier = soumission({ id: "444444444444444454", guild })
    await sig.recevoirSignalement(null, premier)
    const second = soumission({ id: "444444444444444454", guild, signaleur: "666666666666666666" })
    await sig.recevoirSignalement(null, second)
    assert.match(premier.reponses[0].content, /transmis au staff/)
    assert.match(second.reponses[0].content, /déjà été signalé/)
    assert.strictEqual(guild.envoyes.length, 1, "un seul signalement au staff")
})

test("ligne de sanction annulée : raison barrée, les « s » ne sont pas touchés", () => {
    const c = { id: 7, type: "kick", reason: "ssss  espaces\nmultiples", created_at: 1000, cancelled_at: 5000, moderator_id: MEMBRE }
    const ligne = cases.ligneSanction(interaction("x"), c)
    assert.ok(ligne.includes("~~ssss espaces multiples~~"), ligne)
    assert.ok(ligne.includes("Annulée"))
    const active = cases.ligneSanction(interaction("x"), { ...c, cancelled_at: null })
    assert.ok(!active.includes("~~") && !active.includes("Annulée"))
    assert.strictEqual(cases.nomType(interaction("x"), "automod"), "Blocage AutoMod", "type automod connu")
    assert.strictEqual(cases.nomType(interaction("x"), "inconnu"), "inconnu")
})
