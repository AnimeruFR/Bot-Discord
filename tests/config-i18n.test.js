process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const db = require('../Fonctions/db')
const i18n = require('../Fonctions/i18n')
const cfg = require('../Fonctions/config')
const { buildSlashCommand } = require('../Loader/loadSlashCommands')
const { couleur, lireCouleur, formatCouleur, COULEUR_DEFAUT } = require('../Fonctions/apparence')
const { chargerCommandes } = require('./aides')

const bot = chargerCommandes()
const G13 = "555555555555555564", MOD = "444444444444444444"

test("traductions (fr/en complètes, variables, commandes localisées)", async () => {
    const variables = texte => [...texte.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",")
    // Mêmes clés et mêmes variables en français et en anglais
    for (const [a, b] of [["fr", "en"], ["en", "fr"]]) {
        for (const cle of Object.keys(i18n.textes[a])) {
            assert.ok(cle in i18n.textes[b], `clé ${cle} absente de ${b}.json`)
            assert.strictEqual(variables(i18n.textes[a][cle]), variables(i18n.textes[b][cle]), `variables différentes pour ${cle}`)
        }
    }
    // Chaque commande, option et choix a sa traduction anglaise (1 à 100 caractères)
    for (const command of bot.commands.values()) {
        const en = i18n.commandesEn[command.name]
        assert.ok(en?.description, `description anglaise de /${command.name}`)
        const textes = [en.description]
        for (const opt of command.options ?? []) {
            assert.ok(en.options?.[opt.name], `option ${opt.name} de /${command.name}`)
            textes.push(en.options[opt.name])
            for (const choix of opt.choices ?? []) {
                assert.ok(en.choix?.[opt.name]?.[choix.value], `choix ${choix.value} de /${command.name}`)
                textes.push(en.choix[opt.name][choix.value])
            }
        }
        for (const texte of textes) assert.ok(texte.length >= 1 && texte.length <= 100, `traduction trop longue dans /${command.name}`)
        const json = buildSlashCommand(command).toJSON()
        if (command.type) {
            // Menu contextuel : c'est le nom (affiché au clic droit) qui est traduit, 32 caractères au plus
            assert.ok(en.nom && en.nom.length <= 32 && command.name.length <= 32, `nom anglais du menu « ${command.name} »`)
            assert.ok(json.name_localizations?.["en-US"], `localisation enregistrée pour le menu « ${command.name} »`)
        } else {
            assert.ok(json.description_localizations?.["en-US"], `localisation enregistrée pour /${command.name}`)
        }
    }
    // t() : variables (même avec "$&"), repli anglais -> français, clé inconnue
    assert.strictEqual(i18n.t("fr", "ping.reponse", { ping: 42 }), "Ping : `42 ms`")
    assert.strictEqual(i18n.t("en", "tickets.cree", { salon: "$& <#1>" }), "Your ticket has been created: $& <#1>", "valeur avec $& intacte")
    const avertir = console.warn
    let avertissements = 0
    console.warn = () => avertissements++
    assert.strictEqual(i18n.t("en", "cle.inconnue"), "cle.inconnue")
    i18n.t("en", "cle.inconnue")
    console.warn = avertir
    assert.strictEqual(avertissements, 1, "une clé manquante n'est signalée qu'une fois")
    // Langue : celle imposée par le serveur, sinon celle du client
    assert.strictEqual(i18n.langueDe({ guildId: G13, locale: "en-US" }), "en")
    assert.strictEqual(i18n.langueDe({ guildId: G13, locale: "fr" }), "fr")
    db.setLangue(G13, "fr")
    assert.strictEqual(i18n.langueDe({ guildId: G13, locale: "en-US" }), "fr", "langue imposée par le serveur")
    db.setLangue(G13, "auto")
    assert.strictEqual(db.getApparence(G13).langue, "auto")
    // Messages publics (cible = serveur) : jamais l'anglais par défaut, la langue imposée sinon
    assert.strictEqual(i18n.langueDe({ id: G13, preferredLocale: "en-US" }), "fr", "serveur en mode auto : français")
    db.setLangue(G13, "en")
    assert.strictEqual(i18n.langueDe({ id: G13, preferredLocale: "fr" }), "en", "serveur : langue imposée en anglais")
    db.setLangue(G13, "fr")
    assert.strictEqual(i18n.langueDe({ id: G13, preferredLocale: "en-US" }), "fr", "serveur : langue imposée en français")
    db.setLangue(G13, "auto")
    assert.strictEqual(i18n.langueDe(null), "fr")
})

test("apparence (couleur, panneau)", async () => {
    assert.strictEqual(lireCouleur("#5865F2"), 0x5865F2)
    assert.strictEqual(lireCouleur("5865f2"), 0x5865F2)
    for (const faux of ["#12345", "rouge", "#GGGGGG", "", "#1234567", "javascript:"]) assert.strictEqual(lireCouleur(faux), null, `couleur ${faux} refusée`)
    assert.strictEqual(formatCouleur(0x00FF00), "#00FF00")
    assert.strictEqual(couleur({ id: G13 }), COULEUR_DEFAUT)
    db.setCouleur(G13, 0x123456)
    assert.strictEqual(couleur({ id: G13 }), 0x123456)
    assert.strictEqual(couleur(null), COULEUR_DEFAUT, "en MP : couleur par défaut")
    db.setPanneauTicket(G13, "Support", "")
    assert.deepStrictEqual([db.getApparence(G13).panneauTitre, db.getApparence(G13).panneauTexte], ["Support", null], "texte vide = par défaut")
})

test("/config (mêmes règles que les commandes, logs tracés)", async () => {
    assert.strictEqual(bot.commands.get("setticket").permission, cfg.PERMISSION_TICKETS, "/setticket et /config : même permission pour les tickets")
    const { Flags } = Discord.PermissionsBitField
    assert.strictEqual(cfg.peutConfigurerTickets({ memberPermissions: new Discord.PermissionsBitField(Flags.ManageGuild) }), false, "Gérer le serveur seul ne suffit pas pour les tickets")
    assert.strictEqual(cfg.peutConfigurerTickets({ memberPermissions: new Discord.PermissionsBitField(cfg.PERMISSION_TICKETS) }), true)
    const roleStaff = (id, position) => ({ id, position, comparePositionTo: autre => position - autre.position })
    const interactionCfg = (userId, position) => ({
        user: { id: userId }, member: { roles: { highest: { position } } },
        guild: { id: G13, ownerId: "owner", roles: { cache: new Discord.Collection([["r1", { id: "r1", managed: false }], ["r2", { id: "r2", managed: true }]]) } }
    })
    assert.ok(cfg.refusRoleStaff(interactionCfg("mod", 5), roleStaff("r1", 5)), "rôle égal au sien refusé")
    assert.strictEqual(cfg.refusRoleStaff(interactionCfg("mod", 5), roleStaff("r1", 3)), null)
    assert.strictEqual(cfg.refusRoleStaff(interactionCfg("owner", 1), roleStaff("r1", 9)), null, "le propriétaire peut tout")
    assert.ok(cfg.refusRoleStaff(interactionCfg("mod", 5), roleStaff("r2", 1)), "rôle d'un bot refusé")

    // Changement du salon de logs : tracé dans l'ancien salon AVANT, puis dans le nouveau APRÈS
    const traces = []
    const salonLogs = (id, ticket = false) => ({
        id, type: Discord.ChannelType.GuildText, name: ticket ? "ticket-bob" : "logs", topic: ticket ? "123456789012345678" : null,
        isTextBased: () => true, toString: () => `<#${id}>`,
        permissionsFor: () => ({ has: () => true }),
        send: async () => traces.push(id)
    })
    const ancienSalon = salonLogs("111111111111111180"), nouveauSalon = salonLogs("111111111111111181")
    const guildLogs = {
        id: G13, members: { me: {} }, roles: { everyone: {} },
        channels: { cache: new Discord.Collection([[ancienSalon.id, ancienSalon], [nouveauSalon.id, nouveauSalon]]) }
    }
    const interactionLogs = { guild: guildLogs, user: { id: MOD, toString: () => `<@${MOD}>` } }
    db.setLogChannel(G13, ancienSalon.id)
    assert.ok((await cfg.changerSalonLogs(interactionLogs, salonLogs("111111111111111182", true))).erreur, "salon de ticket refusé")
    assert.deepStrictEqual(await cfg.changerSalonLogs(interactionLogs, ancienSalon), { inchange: true })
    await cfg.changerSalonLogs(interactionLogs, nouveauSalon)
    assert.deepStrictEqual(traces, [ancienSalon.id, nouveauSalon.id], "ancien salon prévenu, puis le nouveau")
    traces.length = 0
    await cfg.changerSalonLogs(interactionLogs, null)
    assert.deepStrictEqual(traces, [nouveauSalon.id], "désactivation tracée dans le salon qui était actif")
    assert.strictEqual(db.getLogChannel(G13), null)
})

test("RGPD de la langue, de la couleur et du panneau", async () => {
    db.deleteGuildData(G13)
    assert.deepStrictEqual(db.getApparence(G13), { langue: "auto", couleur: null, panneauTitre: null, panneauTexte: null })
})
