// Vérifications hors ligne : aucune connexion à Discord, aucun token nécessaire
// Base en mémoire : les tests ne touchent jamais à data/bot.db
process.env.DATABASE_PATH = ":memory:"

const assert = require('assert')
const Discord = require('discord.js')
const loadCommands = require('../Loader/loadCommands')
const { buildSlashCommand } = require('../Loader/loadSlashCommands')
const { checkHierarchy, formatReason, auditReason } = require('../Fonctions/moderation')
const { ticketOwnerId } = require('../Fonctions/tickets')

// 1. Toutes les commandes se chargent et produisent une définition valide
const bot = { commands: new Discord.Collection() }
loadCommands(bot, { silencieux: true })
for (const command of bot.commands.values()) buildSlashCommand(command).toJSON()
console.log(`OK : ${bot.commands.size} commandes valides`)

// 2. Hiérarchie des rôles
const role = position => ({ comparePositionTo: other => position - other.position, position })
const fakeInteraction = (userId, position) => ({
    user: { id: userId },
    guild: { ownerId: "owner" },
    client: { user: { id: "bot" } },
    member: { roles: { highest: role(position) } }
})
const target = (id, position) => ({ id, roles: { highest: role(position) } })

assert.ok(checkHierarchy(fakeInteraction("mod", 5), target("mod", 1), "ban"), "se bannir soi-même")
assert.ok(checkHierarchy(fakeInteraction("mod", 5), target("owner", 1), "ban"), "bannir le propriétaire")
assert.ok(checkHierarchy(fakeInteraction("mod", 5), target("bot", 1), "ban"), "bannir le bot")
assert.ok(checkHierarchy(fakeInteraction("mod", 5), target("x", 5), "ban"), "rôle égal")
assert.ok(checkHierarchy(fakeInteraction("mod", 5), target("x", 9), "ban"), "rôle supérieur")
assert.strictEqual(checkHierarchy(fakeInteraction("mod", 5), target("x", 2), "ban"), null, "rôle inférieur")
assert.strictEqual(checkHierarchy(fakeInteraction("owner", 1), target("x", 9), "ban"), null, "le propriétaire peut tout")
console.log("OK : hiérarchie des rôles")

// 3. Raisons
assert.strictEqual(formatReason(null), "Aucune raison fournie")
assert.strictEqual(formatReason("   "), "Aucune raison fournie")
assert.ok(!formatReason("***gras***").includes("***"), "markdown échappé")
assert.ok(formatReason("[Faire appel](https://exemple.com)").startsWith("\\["), "lien déguisé échappé")
assert.ok(auditReason({ user: { tag: "mod" } }, "x".repeat(2000)).length <= 512, "raison d'audit tronquée")
console.log("OK : raisons")

// 4. Détection des tickets
const salon = (name, topic, type = Discord.ChannelType.GuildText) => ({ name, topic, type })
assert.strictEqual(ticketOwnerId(salon("ticket-bob", "123456789012345678")), "123456789012345678")
assert.strictEqual(ticketOwnerId(salon("general", "123456789012345678")), null)
assert.strictEqual(ticketOwnerId(salon("ticket-bob", "pas un id")), null)
assert.strictEqual(ticketOwnerId(salon("ticket-bob", "123456789012345678", Discord.ChannelType.GuildVoice)), null)
assert.strictEqual(ticketOwnerId(salon("ferme-bob", "123456789012345678")), "123456789012345678")
assert.strictEqual(ticketOwnerId(null), null)
console.log("OK : détection des tickets")

// 5. Base de données
const db = require('../Fonctions/db')
const G1 = "111111111111111111", G2 = "222222222222222222", U = "333333333333333333", MOD = "444444444444444444"

const w1 = db.addWarn(G1, U, MOD, "spam")
const w2 = db.addWarn(G1, U, MOD, "'); DROP TABLE warns; --")
db.addWarn(G2, U, MOD, "autre serveur")
assert.strictEqual(db.countWarns(G1, U), 2)
assert.strictEqual(db.listWarns(G1, U)[0].reason, "'); DROP TABLE warns; --", "injection SQL stockée comme simple texte")
assert.strictEqual(db.listWarns(G1, U, 1).length, 1, "limite respectée")
assert.strictEqual(db.getWarn(G2, w1), undefined, "un serveur ne voit pas les warns d'un autre")
assert.strictEqual(db.removeWarn(G2, w1), false, "un serveur ne supprime pas les warns d'un autre")
assert.strictEqual(db.removeWarn(G1, w2), true)
assert.strictEqual(db.countWarns(G1, U), 1)
assert.strictEqual(db.countWarns(G2, U), 1)
console.log("OK : warns (isolation par serveur, injection SQL)")

assert.strictEqual(db.getLogChannel(G1), null)
db.setLogChannel(G1, "555555555555555555")
assert.strictEqual(db.getLogChannel(G1), "555555555555555555")
db.setLogChannel(G1, null)
assert.strictEqual(db.getLogChannel(G1), null)
console.log("OK : salon de logs")

assert.strictEqual(db.getTicketCooldown(G1, U), 0)
db.setTicketCooldown(G1, U)
assert.ok(Date.now() - db.getTicketCooldown(G1, U) < 1000)
db.purgeTicketCooldowns(Date.now() + 1)
assert.strictEqual(db.getTicketCooldown(G1, U), 0, "purge des vieux délais")
console.log("OK : délai des tickets")

assert.deepStrictEqual(db.getTicketConfig(G1), { categoryId: null, staffRoleId: null })
db.setLogChannel(G1, "555555555555555555")
db.setTicketConfig(G1, "666666666666666666", "777777777777777777")
assert.deepStrictEqual(db.getTicketConfig(G1), { categoryId: "666666666666666666", staffRoleId: "777777777777777777" })
assert.strictEqual(db.getLogChannel(G1), "555555555555555555", "la config des tickets n'écrase pas le salon de logs")
db.setLogChannel(G1, null)
assert.strictEqual(db.getTicketConfig(G1).staffRoleId, "777777777777777777", "le salon de logs n'écrase pas la config des tickets")
assert.deepStrictEqual(db.getTicketConfig(G2), { categoryId: null, staffRoleId: null }, "config isolée par serveur")
db.setTicketConfig(G1, null, "121212121212121212")
assert.deepStrictEqual(db.getTicketConfig(G1), { categoryId: "666666666666666666", staffRoleId: "121212121212121212" }, "changer le rôle garde la catégorie")
db.resetTicketConfig(G1)
assert.deepStrictEqual(db.getTicketConfig(G1), { categoryId: null, staffRoleId: null }, "réinitialisation")
console.log("OK : configuration des tickets")

// 6. Rôle staff
const { roleValide } = require('../Fonctions/tickets')
const roles = new Discord.Collection([
    [G1, { id: G1, managed: false }],
    ["888888888888888888", { id: "888888888888888888", managed: true }],
    ["999999999999999999", { id: "999999999999999999", managed: false }]
])
const guildFactice = { id: G1, roles: { cache: roles } }
assert.ok(!roleValide(guildFactice, G1), "@everyone refusé")
assert.ok(!roleValide(guildFactice, "888888888888888888"), "rôle de bot refusé")
assert.ok(!roleValide(guildFactice, "123"), "rôle inexistant refusé")
assert.ok(!roleValide(guildFactice, null))
assert.ok(roleValide(guildFactice, "999999999999999999"))
console.log("OK : rôle staff")

// 7. Transcript (250 messages factices, pagination par 100)
const { buildTranscript } = require('../Fonctions/transcript')
const faux = Array.from({ length: 250 }, (_, i) => ({
    id: String(1000 + i),
    content: i === 0 ? "premier\nsur deux lignes" : `message ${i}`,
    createdTimestamp: Date.UTC(2026, 0, 1) + i * 60000,
    author: { tag: "membre", id: U },
    attachments: new Discord.Collection(i === 5 ? [["a", { name: "preuve.png", url: "https://cdn.exemple/preuve.png" }]] : []),
    embeds: []
}))
const salonFactice = {
    name: "ticket-bob",
    createdTimestamp: Date.UTC(2026, 0, 1),
    client: { application: { fetch: async () => ({ flags: new Discord.ApplicationFlagsBitField(0) }) } },
    messages: {
        // Comme Discord : du plus récent au plus ancien, avant l'ID "before"
        fetch: async ({ limit, before }) => {
            const avant = faux.filter(m => !before || Number(m.id) < Number(before)).reverse().slice(0, limit)
            return new Discord.Collection(avant.map(m => [m.id, m]))
        }
    }
}
buildTranscript(salonFactice, { fermePar: { tag: "modo", id: MOD }, auteurId: U }).then(({ texte, nombre }) => {
    assert.strictEqual(nombre, 250, "toutes les pages sont lues")
    assert.ok(texte.indexOf("premier") < texte.indexOf("message 249"), "ordre chronologique")
    assert.ok(texte.includes("premier\n    sur deux lignes"), "lignes multiples indentées")
    assert.ok(texte.includes("[pièce jointe] preuve.png"), "pièces jointes listées")
    assert.ok(texte.includes("Message Content Intent"), "avertissement si l'intent est absent")
    console.log("OK : transcript")
})

// 8. Transcript trop gros : on garde les messages les plus récents sous la limite d'envoi de Discord
const { MAX_OCTETS_TRANSCRIPT, sendAttachments } = require('../Fonctions/transcript')
const enorme = Array.from({ length: 1000 }, (_, i) => ({
    id: String(10000 + i),
    content: `${i} ` + "😀".repeat(2000), // ~8 Ko par message, ~8 Mo au total
    createdTimestamp: Date.UTC(2026, 0, 1) + i * 1000,
    author: { tag: "membre", id: U },
    attachments: new Discord.Collection(),
    embeds: []
}))
const gros = { ...salonFactice, messages: { fetch: async ({ limit, before }) => {
    const avant = enorme.filter(m => !before || Number(m.id) < Number(before)).reverse().slice(0, limit)
    return new Discord.Collection(avant.map(m => [m.id, m]))
} } }
buildTranscript(gros, { fermePar: { tag: "modo", id: MOD }, auteurId: U }).then(({ texte, nombre }) => {
    assert.ok(Buffer.byteLength(texte, "utf8") <= MAX_OCTETS_TRANSCRIPT + 4096, "taille sous la limite")
    assert.ok(nombre < 1000 && texte.includes("999 "), "on garde les plus récents")
    assert.ok(texte.includes("tronqué"), "troncature signalée")
    console.log("OK : transcript tronqué sous la limite de taille")
})

// 9. Pièces jointes : seul le CDN de Discord est téléchargé, rien de trop lourd
const envois = []
const logsFactice = { send: async m => envois.push(m) }
sendAttachments(logsFactice, [
    { name: "piege.png", url: "http://169.254.169.254/latest/meta-data", size: 10 },
    { name: "enorme.mp4", url: "https://cdn.discordapp.com/x/enorme.mp4", size: 50 * 1024 * 1024 }
], "ticket-bob").then(ignorees => {
    assert.deepStrictEqual(ignorees.sort(), ["enorme.mp4", "piege.png"], "hôte inconnu et fichier trop lourd ignorés")
    assert.strictEqual(envois.length, 0, "aucun téléchargement ni envoi")
    console.log("OK : pièces jointes filtrées")
}).then(async () => {
    // fetch simulé : 404 -> ignorée, 503 puis 200 -> retentée et envoyée, redirection interdite
    const appels = []
    const reponses = { "/supprime.png": [404], "/instable.png": [503, 200] }
    global.fetch = async (url, options) => {
        assert.strictEqual(options.redirect, "error", "pas de redirection suivie")
        appels.push(url.pathname)
        const status = reponses[url.pathname].shift()
        return { ok: status === 200, status, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(4) }
    }
    envois.length = 0
    const ignorees = await sendAttachments(logsFactice, [
        { name: "supprime.png", url: "https://cdn.discordapp.com/supprime.png", size: 4 },
        { name: "instable.png", url: "https://cdn.discordapp.com/instable.png", size: 4 }
    ], "ticket-bob")
    assert.deepStrictEqual(ignorees, ["supprime.png"], "fichier supprimé ignoré")
    assert.strictEqual(appels.filter(a => a === "/instable.png").length, 2, "erreur passagère retentée")
    assert.strictEqual(envois.length, 1, "fichier instable finalement envoyé")
    console.log("OK : téléchargement des pièces jointes (404, nouvel essai)")
})

// 10. Choix de l'environnement (dev / prod)
const { envFile } = require('../Fonctions/env')
assert.deepStrictEqual(envFile(["node", "main.js"], {}), { fichier: ".env", obligatoire: false, nom: "défaut" })
assert.deepStrictEqual(envFile(["node", "main.js", "--env=dev"], {}), { fichier: ".env.dev", obligatoire: true, nom: "dev" }, "--env=dev obligatoire, sans repli")
assert.strictEqual(envFile(["node", "main.js"], { ENV_FILE: ".env.prod" }).obligatoire, true)
assert.strictEqual(envFile(["node", "main.js", "--env=dev"], { ENV_FILE: ".env.prod" }).fichier, ".env.dev", "--env prime sur ENV_FILE")
assert.throws(() => envFile(["node", "main.js", "--env=../../secret"], {}), /invalide/, "pas de chemin dans --env")
assert.throws(() => envFile(["node", "main.js", "--env="], {}), /invalide/)
assert.throws(() => envFile(["node", "deploy.js", "--env", "dev", "--clear"], {}), /--env=dev/, "--env sans = refusé")
const { appliquer } = require('../Fonctions/env')
const envTest = { DISCORD_TOKEN: "TOKEN_PROD", AUTRE: "garde" }
appliquer("DISCORD_TOKEN=TOKEN_DEV\nDATABASE_PATH=data/dev.db", true, envTest)
assert.strictEqual(envTest.DISCORD_TOKEN, "TOKEN_DEV", "fichier explicite : il prime sur le token déjà défini")
assert.strictEqual(envTest.AUTRE, "garde")
const envDocker = { DISCORD_TOKEN: "TOKEN_DOCKER" }
appliquer("DISCORD_TOKEN=TOKEN_FICHIER", false, envDocker)
assert.strictEqual(envDocker.DISCORD_TOKEN, "TOKEN_DOCKER", ".env par défaut : les variables existantes priment")
console.log("OK : choix de l'environnement")

// 10 bis. Healthcheck : un shard déconnecté = bot non connecté
const { estConnecte } = require('../Fonctions/heartbeat')
const botFactice = statuts => ({ ws: { status: Discord.Status.Ready, shards: new Discord.Collection(statuts.map((s, i) => [i, { status: s }])) } })
assert.strictEqual(estConnecte(botFactice([Discord.Status.Ready])), true)
assert.strictEqual(estConnecte(botFactice([Discord.Status.Disconnected])), false, "shard déconnecté malgré ws.status Ready")
assert.strictEqual(estConnecte(botFactice([Discord.Status.Ready, Discord.Status.Reconnecting])), false)
assert.strictEqual(estConnecte(botFactice([])), false)
console.log("OK : détection de la connexion (healthcheck)")

// 11. RGPD : départ, panne, retour, purge à 30 jours
const privacy = require('../Fonctions/privacy')
const G3 = "555555555555555551", G4 = "555555555555555552"
db.addWarn(G3, U, MOD, "a"); db.setLogChannel(G3, "666666666666666661"); db.setTicketCooldown(G3, U)
db.addWarn(G4, U, MOD, "b")

assert.strictEqual(privacy.onGuildDelete({ id: G3, available: false }), false, "panne : rien n'est noté")
assert.strictEqual(db.guildsLeftBefore(Date.now() + 1).includes(G3), false)

const ilYa31Jours = Date.now() - 31 * 24 * 3600 * 1000
db.markGuildLeft(G3, ilYa31Jours)
db.markGuildLeft(G3) // une 2e notification ne repousse pas la date
assert.ok(db.guildsLeftBefore(Date.now() - 30 * 24 * 3600 * 1000).includes(G3), "date de départ conservée")

assert.deepStrictEqual(privacy.purge(new Set([G3])), [], "revenu sur le serveur : rien n'est effacé")
assert.strictEqual(db.countWarns(G3, U), 1)

db.markGuildLeft(G3, ilYa31Jours)
assert.deepStrictEqual(privacy.purge(new Set([G4])), [G3], "parti depuis 31 jours : effacé")
assert.strictEqual(db.countWarns(G3, U), 0)
assert.strictEqual(db.getLogChannel(G3), null)
assert.strictEqual(db.getTicketCooldown(G3, U), 0)
assert.strictEqual(db.countWarns(G4, U), 1, "les autres serveurs ne sont pas touchés")

assert.strictEqual(privacy.reconcile(new Set([G1, G2])) >= 1, true, "serveur quitté pendant que le bot était éteint détecté")
assert.ok(db.guildsLeftBefore(Date.now() + 1).includes(G4))
assert.deepStrictEqual(privacy.purge(new Set([G1, G2])).includes(G4), false, "pas effacé avant 30 jours")
privacy.onGuildCreate({ id: G4 })
assert.ok(!db.guildsLeftBefore(Date.now() + 1).includes(G4), "retour sur le serveur : suppression annulée")
assert.strictEqual(db.deleteGuildData(G4), 2, "le warn et sa ligne d'historique")
console.log("OK : RGPD (panne, retour, purge à 30 jours, isolation)")

// 12. Sauvegarde sur une vraie base fichier (processus séparé), rotation et restauration
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const dossierTest = fs.mkdtempSync(path.join(os.tmpdir(), "bot-backup-"))
try {
    const sortie = execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", "-e", `
        const db = require(${JSON.stringify(path.join(__dirname, "..", "Fonctions", "db.js"))})
        const { makeBackup } = require(${JSON.stringify(path.join(__dirname, "..", "Fonctions", "backup.js"))})
        const fs = require("fs"), path = require("path")
        db.addWarn("1", "2", "3", "à sauvegarder")
        const dossier = process.env.BACKUP_DIR
        fs.mkdirSync(dossier, { recursive: true })
        for (let i = 1; i <= 5; i++) fs.writeFileSync(path.join(dossier, "bot-2020010" + i + "-000000.db"), "ancienne")
        fs.writeFileSync(path.join(dossier, "autre-fichier.txt"), "à garder")
        fs.writeFileSync(path.join(dossier, "bot-20200101-000000.db.tmp"), "orphelin")
        const fichier = makeBackup(dossier, 3)
        console.log(JSON.stringify({ fichier, liste: fs.readdirSync(dossier).sort() }))
    `], { env: { ...process.env, DATABASE_PATH: path.join(dossierTest, "bot.db"), BACKUP_DIR: path.join(dossierTest, "backups"), ENV_FILE: "" }, cwd: dossierTest, encoding: "utf8" }).trim()
    const { fichier, liste } = JSON.parse(sortie.split("\n").pop())
    assert.strictEqual(liste.filter(f => /^bot-/.test(f)).length, 3, "rotation : 3 sauvegardes gardées")
    assert.ok(liste.includes("autre-fichier.txt"), "les autres fichiers ne sont pas touchés")
    assert.ok(liste.includes(path.basename(fichier)), "la nouvelle sauvegarde est gardée")
    assert.ok(!liste.some(f => f.endsWith(".tmp")), "pas de fichier temporaire restant (orphelin nettoyé)")
    const { DatabaseSync } = require('node:sqlite')
    const restauree = new DatabaseSync(fichier, { readOnly: true })
    assert.strictEqual(restauree.prepare("SELECT reason FROM warns").get().reason, "à sauvegarder", "la sauvegarde se relit")
    restauree.close()
    console.log("OK : sauvegarde (vérifiée, rotation, restauration)")
} finally {
    fs.rmSync(dossierTest, { recursive: true, force: true })
}

// 13. Lot E : durées, historique des sanctions, seuils, verrouillage
const { parseDuree, formatDuree } = require('../Fonctions/moderation')
assert.strictEqual(parseDuree("1h", { max: 2 * 3600000 }).duree, 3600000)
assert.ok(parseDuree("abc", { max: 1e9 }).erreur, "durée illisible refusée")
assert.ok(parseDuree("30s", { max: 1e9 }).erreur, "moins d'une minute refusé par défaut")
assert.ok(parseDuree("400d", { max: 365 * 86400000 }).erreur, "plus que le maximum refusé")
assert.ok(parseDuree("-5m", { max: 1e9 }).erreur, "durée négative refusée")
assert.strictEqual(formatDuree(90000000), "1 jour et 1 heure")
assert.strictEqual(formatDuree(2 * 60000), "2 minutes")
console.log("OK : durées")

const G5 = "555555555555555553", U2 = "333333333333333334"
const idWarn = db.addWarn(G5, U2, MOD, "insulte")
const numeroKick = db.addCase(G5, { userId: U2, moderatorId: MOD, type: "kick", reason: "  " })
let historique = db.listCases(G5, U2)
assert.strictEqual(historique.length, 2, "le warn apparaît dans l'historique")
assert.strictEqual(historique[0].id, numeroKick, "du plus récent au plus ancien")
assert.strictEqual(historique[0].reason, "Aucune raison fournie")
assert.strictEqual(historique[1].warn_id, idWarn)
db.removeWarn(G5, idWarn)
historique = db.listCases(G5, U2)
assert.strictEqual(historique[1].reason, "(avertissement retiré)", "raison d'un warn retiré effacée de l'historique")
assert.strictEqual(db.countCases(G2, U2), 0, "historique isolé par serveur")
assert.strictEqual(db.purgeOldCases(Date.now() - 1000), 0, "rien de récent n'est purgé")
console.log("OK : historique des sanctions")

db.setThreshold(G5, 3, "mute", 3600000)
db.setThreshold(G5, 3, "kick", null)
assert.deepStrictEqual(db.listThresholds(G5).map(s => [s.warns, s.action]), [[3, "kick"]], "un seul seuil par nombre de warns")
assert.strictEqual(db.getThreshold(G2, 3), null, "seuils isolés par serveur")

db.setTempban(G5, U2, Date.now() + 1000)
assert.ok(db.addLock(G5, "999999999999999990", { SendMessages: null }))
assert.strictEqual(db.addLock(G5, "999999999999999990", {}), false, "un salon ne se verrouille qu'une fois")
assert.strictEqual(db.deleteGuildData(G5), 5, "historique, seuils, tempbans et verrous effacés par /privacy")
assert.strictEqual(db.listThresholds(G5).length, 0)
console.log("OK : seuils, verrous et effacement RGPD des nouvelles tables")

// Verrouillage : seuls les 5 droits de @everyone changent, et /unlock remet exactement l'état d'avant
const verrou = require('../Fonctions/verrou')
const { Flags } = Discord.PermissionsBitField
const ow = (id, allow, deny) => ({ id, type: Discord.OverwriteType.Role, allow: new Discord.PermissionsBitField(allow), deny: new Discord.PermissionsBitField(deny) })
const overwrites = new Discord.Collection([
    [G5, ow(G5, Flags.AddReactions, Flags.CreatePrivateThreads)],
    ["777777777777777770", ow("777777777777777770", Flags.SendMessages, 0n)]
])
const modifs = []
const salonVerrou = {
    id: "999999999999999991",
    guild: { id: G5, roles: { everyone: { id: G5 } } },
    permissionOverwrites: { cache: overwrites, edit: async (cible, droits) => modifs.push(droits) }
}
assert.deepStrictEqual(verrou.etatEveryone(salonVerrou), {
    SendMessages: null, SendMessagesInThreads: null, CreatePublicThreads: null, CreatePrivateThreads: false, AddReactions: true
})
assert.deepStrictEqual(verrou.rolesQuiEcriventEncore(salonVerrou), ["<@&777777777777777770>"], "rôle qui garde le droit d'écrire signalé")

// Tempbans, verrouillage et sanctions automatiques (asynchrones)
const { traiterTempbans } = require('../Fonctions/tempbans')
const { appliquerSeuil, marqueurTempban } = require('../Fonctions/sanctions')
;(async () => {
    assert.strictEqual(await verrou.verrouiller(salonVerrou, "test"), true)
    assert.strictEqual(await verrou.verrouiller(salonVerrou, "test"), false, "double /lock refusé")
    assert.deepStrictEqual(modifs[0], { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false, CreatePrivateThreads: false, AddReactions: false })
    assert.strictEqual(await verrou.deverrouiller(salonVerrou, "test"), true)
    assert.deepStrictEqual(modifs[1], { SendMessages: null, SendMessagesInThreads: null, CreatePublicThreads: null, CreatePrivateThreads: false, AddReactions: true }, "état d'avant restauré")
    assert.strictEqual(await verrou.deverrouiller(salonVerrou, "test"), false, "rien à déverrouiller")
    console.log("OK : /lock et /unlock")

    const G6 = "555555555555555554", G7 = "555555555555555556"
    const passe = Date.now() - 1000
    const erreurDiscord = code => Object.assign(new Error(`code ${code}`), { code })
    // A = tempban normal, B = re-banni à la main, C = déjà débanni, D = permission perdue,
    // E = pas encore fini, F = marqueur imité (autre date que celle en base)
    const bans = {
        A: { user: { id: "A" }, reason: `${marqueurTempban(passe)} modo : spam` },
        B: { user: { id: "B" }, reason: "modo : re-banni définitivement" },
        D: { user: { id: "D" }, reason: `${marqueurTempban(passe)} modo : x` },
        E: { user: { id: "E" }, reason: `${marqueurTempban(passe + 3600000)} modo : x` },
        F: { user: { id: "F" }, reason: `${marqueurTempban(passe)} faux marqueur` }
    }
    const debannis = []
    const guildTest = {
        id: G6, available: true, channels: { cache: new Discord.Collection() },
        bans: {
            fetch: async ({ user }) => {
                if (!bans[user]) throw erreurDiscord(Discord.RESTJSONErrorCodes.UnknownBan)
                return bans[user]
            },
            remove: async user => {
                if (user === "D") throw erreurDiscord(Discord.RESTJSONErrorCodes.MissingPermissions)
                debannis.push(user)
            }
        }
    }
    for (const u of ["A", "B", "C", "D"]) db.setTempban(G6, u, passe)
    db.setTempban(G6, "E", passe + 3600000)
    db.setTempban(G6, "F", passe - 5)
    db.setTempban(G7, "A", passe)
    const botTest = { user: { id: "bot", tag: "bot" }, guilds: { cache: new Discord.Collection([[G6, guildTest]]) } }

    assert.strictEqual(await traiterTempbans(botTest), 1, "un seul déban")
    assert.deepStrictEqual(debannis, ["A"], "seul le vrai tempban expiré est levé")
    assert.strictEqual(db.getTempban(G6, "A"), null)
    assert.strictEqual(db.getTempban(G6, "B"), null, "re-banni à la main : entrée oubliée, pas de déban")
    assert.strictEqual(db.getTempban(G6, "C"), null, "déjà débanni : on n'insiste pas")
    assert.strictEqual(db.getTempban(G6, "D"), passe, "permission perdue : échéance d'origine gardée")
    assert.ok(!db.expiredTempbans().some(t => t.user_id === "D"), "permission perdue : nouvel essai plus tard seulement")
    assert.ok(db.getTempban(G6, "E"), "pas encore terminé : rien ne change")
    assert.strictEqual(db.getTempban(G6, "F"), null, "marqueur imité : pas de déban")
    assert.ok(db.getTempban(G7, "A"), "serveur absent : entrée gardée")
    assert.strictEqual(db.listCases(G6, "A")[0].type, "unban")

    // 6 h plus tard, la permission est revenue : le ban reporté est bien levé (le marqueur correspond toujours)
    guildTest.bans.remove = async user => debannis.push(user)
    assert.strictEqual(await traiterTempbans(botTest, Date.now() + 7 * 3600000), 2, "D (reporté) et E (arrivé à échéance) levés")
    assert.deepStrictEqual(debannis.sort(), ["A", "D", "E"])
    assert.strictEqual(db.getTempban(G6, "D"), null)
    console.log("OK : débans automatiques (retard, déban manuel, re-ban, permission perdue puis retrouvée)")

    // Seuil : le modérateur doit avoir lui-même le droit d'appliquer la sanction
    db.setThreshold(G6, 2, "ban", null)
    const membreCible = { id: U2, roles: { highest: role(1) }, bannable: true }
    const interactionSeuil = perm => ({
        guild: {
            id: G6, ownerId: "owner", name: "test",
            members: { fetch: async () => membreCible },
            bans: { create: async () => { throw new Error("ne doit pas bannir") } }
        },
        user: { id: MOD, tag: "modo" }, client: { user: { id: "bot" } },
        member: { roles: { highest: role(5) } },
        memberPermissions: new Discord.PermissionsBitField(perm)
    })
    assert.strictEqual(await appliquerSeuil(interactionSeuil(Flags.ModerateMembers), { id: U2 }, 1), null, "pas de seuil à 1 warn")
    assert.match(await appliquerSeuil(interactionSeuil(Flags.ModerateMembers), { id: U2 }, 2), /non appliquée.*permission/, "modérateur sans BanMembers : pas de ban")
    assert.strictEqual(await appliquerSeuil(interactionSeuil(Flags.ModerateMembers), { id: U2 }, 3), null, "seuil exact uniquement")
    console.log("OK : sanctions automatiques (seuil exact, permission du modérateur)")

    // Une erreur réseau ne doit jamais passer pour « membre absent » (la hiérarchie serait sautée)
    const { fetchMember } = require('../Fonctions/moderation')
    const guildErreur = code => ({ members: { fetch: async () => { throw erreurDiscord(code) } } })
    assert.strictEqual(await fetchMember(guildErreur(Discord.RESTJSONErrorCodes.UnknownMember), U2), null)
    await assert.rejects(fetchMember(guildErreur(500), U2), "erreur passagère relancée")
    console.log("OK : relecture des membres (erreurs)")

    await testsLotF()
    await testsLotG()
    await testsLotH()
    testsLotI()
    testsFichiersSuivis()
})()

// 18. Aucun fichier de code ignoré par git (un .gitignore trop large a déjà fait oublier Commandes/config.js)
function testsFichiersSuivis() {
    const dossiers = ["Commandes", "Fonctions", "Events", "Loader", "scripts", "locales"]
    const fichiers = dossiers.flatMap(d => fs.readdirSync(path.join(__dirname, "..", d), { recursive: true })
        .filter(f => /\.(js|json)$/.test(f)).map(f => path.join(d, f)))
    let ignores = ""
    try {
        ignores = execFileSync("git", ["check-ignore", "--no-index", ...fichiers], { cwd: path.join(__dirname, ".."), encoding: "utf8" })
    } catch (err) {
        // code 1 : aucun fichier ignoré (cas normal) ; git absent : test sauté
        if (err.status !== 1) return console.log("(git indisponible : vérification des fichiers ignorés sautée)")
    }
    assert.strictEqual(ignores.trim(), "", `fichiers de code ignorés par git : ${ignores.trim()}`)
    console.log("OK : aucun fichier de code ignoré par git")
}

// 17. Lot I : invitation et liens
function testsLotI() {
    const { Flags } = Discord.PermissionsBitField
    const { permissionsMinimales, lienInvitation, lienValide } = require('../Fonctions/invitation')
    const perms = permissionsMinimales()
    assert.ok(!perms.has(Flags.Administrator, false), "jamais Administrateur")
    for (const utile of [Flags.ManageRoles, Flags.BanMembers, Flags.ModerateMembers, Flags.AttachFiles, Flags.SendPolls, Flags.ManageGuild]) assert.ok(perms.has(utile, false))
    // /lock exige que le bot possède les droits qu'il retire à @everyone
    const { DROITS_VERROU } = require('../Fonctions/verrou')
    for (const droit of DROITS_VERROU) assert.ok(perms.has(Flags[droit], false), `${droit} demandé (nécessaire à /lock)`)
    const lien = new URL(lienInvitation("123456789012345678"))
    assert.strictEqual(lien.hostname, "discord.com")
    assert.strictEqual(lien.searchParams.get("scope"), "bot applications.commands")
    assert.strictEqual(lien.searchParams.get("permissions"), perms.bitfield.toString())
    assert.throws(() => lienInvitation("abc&redirect_uri=https://piege.example"), /invalide/, "ID d'application vérifié")
    assert.strictEqual(lienValide("https://discord.gg/abc"), "https://discord.gg/abc")
    for (const faux of ["http://exemple.com", "javascript:alert(1)", "", null, "pas un lien", `https://exemple.com/${"a".repeat(600)}`]) assert.strictEqual(lienValide(faux), null, `lien ${String(faux).slice(0, 30)} refusé`)
    const { dureeCourte } = require('../Commandes/about')
    assert.strictEqual(dureeCourte(3 * 86400000 + 4 * 3600000), "3 j 4 h")
    assert.strictEqual(dureeCourte(90 * 60000), "1 h 30 min")
    console.log("OK : invitation (permissions minimales, liens sûrs)")
}

// 16. Lot H : langues, apparence, /config
async function testsLotH() {
    const i18n = require('../Fonctions/i18n')
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
        assert.ok(json.description_localizations?.["en-US"], `localisation enregistrée pour /${command.name}`)
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
    const G13 = "555555555555555564"
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
    console.log("OK : traductions (fr/en complètes, variables, commandes localisées)")

    // Couleur
    const { couleur, lireCouleur, formatCouleur, COULEUR_DEFAUT } = require('../Fonctions/apparence')
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
    console.log("OK : apparence (couleur, panneau)")

    // /config ne permet rien de plus que les commandes
    const cfg = require('../Fonctions/config')
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
    console.log("OK : /config (mêmes règles que les commandes, logs tracés)")

    // RGPD : la langue, la couleur et le panneau partent avec le serveur
    db.deleteGuildData(G13)
    assert.deepStrictEqual(db.getApparence(G13), { langue: "auto", couleur: null, panneauTitre: null, panneauTexte: null })
    console.log("OK : RGPD du lot H")
}

// 15. Lot G : engagement
async function testsLotG() {
    const { Flags } = Discord.PermissionsBitField
    // Dates en heure de Paris, changement d'heure compris
    const { parseQuand } = require('../Fonctions/dates')
    const loin = { maintenant: Date.UTC(2027, 0, 1), max: 400 * 86400000 }
    assert.strictEqual(parseQuand("15/01/2027 18:00", loin).date, Date.UTC(2027, 0, 15, 17, 0), "hiver : UTC+1")
    assert.strictEqual(parseQuand("15/07/2027 18h00", loin).date, Date.UTC(2027, 6, 15, 16, 0), "été : UTC+2")
    assert.match(parseQuand("28/03/2027 02:30", loin).erreur, /n'existe pas/, "heure sautée au passage à l'heure d'été")
    assert.strictEqual(parseQuand("31/10/2027 02:30", loin).date, Date.UTC(2027, 9, 31, 0, 30), "heure en double : la 1re")
    assert.match(parseQuand("31/02/2027 10:00", loin).erreur, /invalide/, "31 février refusé")
    assert.match(parseQuand("01/01/2026 10:00", loin).erreur, /au moins une minute/, "date passée refusée")
    assert.strictEqual(parseQuand("2h", { maintenant: 0 }).date, 7200000)
    assert.match(parseQuand("90d", { maintenant: 0, max: 60 * 86400000 }).erreur, /moins de 60 jours/)
    console.log("OK : dates (heure de Paris, changement d'heure)")

    // Tirage
    const { tirer } = require('../Fonctions/giveaways')
    const gens = ["a", "b", "c", "d", "e"]
    for (let i = 0; i < 50; i++) {
        const g = tirer(gens, 3, ["a"])
        assert.strictEqual(new Set(g).size, 3, "pas de doublon")
        assert.ok(!g.includes("a"), "anciens gagnants exclus")
    }
    assert.deepStrictEqual(tirer(["x"], 5).length, 1, "plus de gagnants demandés que de participants")
    assert.deepStrictEqual(tirer([], 3), [])

    // Giveaway de bout en bout : un seul tirage, seuls les gagnants mentionnés, republication après crash
    const giveaways = require('../Fonctions/giveaways')
    const { traiterProgrammes, envoyerAnnonce } = require('../Fonctions/programmes')
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
    const idG = db.addGiveaway(G11, { channelId: salonG.id, prix: "@everyone Nitro <@&123>", gagnants: 2, endsAt: Date.now() - 1000, hostId: MOD })
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
    console.log("OK : giveaways (tirage unique, membres partis, mentions, reprise après crash, publication unique)")

    // Annonces : droits de l'auteur revérifiés à l'envoi, jamais de mention, au plus une fois
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
    console.log("OK : annonces programmées (droits à l'envoi, mentions, au plus une fois)")

    // Rôles par boutons : rôle dangereux ou trop haut refusé, revérifié au clic
    const { refusRole, onClicRole } = require('../Fonctions/rolesBoutons')
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
    console.log("OK : rôles par boutons (rôles dangereux, revérification au clic)")

    // Bienvenue : seul le nouveau membre est mentionné, anti-raid
    const bienvenue = require('../Fonctions/bienvenue')
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
    console.log("OK : bienvenue / au revoir (mentions, anti-raid)")

    // Sondages
    const { lireChoix } = require('../Commandes/sondage')
    assert.deepStrictEqual(lireChoix(" Oui ; Non ;; oui ; Oui ").choix, ["Oui", "Non", "oui"], "vides et doublons retirés")
    assert.ok(lireChoix("Seul").erreur)
    assert.ok(lireChoix(Array.from({ length: 11 }, (_, i) => `c${i}`).join(";")).erreur, "11 choix refusés")
    assert.ok(lireChoix(`${"x".repeat(56)};b`).erreur, "choix trop long refusé")
    console.log("OK : sondages")

    // RGPD : tout le lot G s'efface avec le serveur, giveaways terminés purgés à 30 jours
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
    console.log("OK : RGPD du lot G")
}

// 14. Lot F : tickets pro
async function testsLotF() {
    const { echapper } = require('../Fonctions/transcript')
    assert.strictEqual(echapper(`<img src=x onerror="alert('x')">&`), "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;")
    assert.strictEqual(echapper("abc‮def\u0000"), "abcdef", "caractères d'inversion et de contrôle retirés")
    assert.strictEqual(echapper(null), "")

    // Transcript HTML : rien de ce qu'écrit un membre ne devient du HTML
    const piege = [{
        id: "5000", content: "<script>alert(1)</script><img src=x onerror=alert(2)>", createdTimestamp: Date.UTC(2026, 0, 1),
        author: { tag: "\"><script>alert(3)</script>", id: U },
        attachments: new Discord.Collection([["a", { name: "<svg onload=alert(4)>.png", url: "https://cdn.discordapp.com/a.png" }]]), embeds: []
    }]
    const salonPiege = {
        ...salonFactice, name: "ticket-<b>bob</b>",
        messages: { fetch: async ({ before }) => new Discord.Collection(before ? [] : piege.map(m => [m.id, m])) }
    }
    const { html } = await buildTranscript(salonPiege, { fermePar: { tag: "<i>modo</i>", id: MOD }, auteurId: U })
    assert.ok(html.includes("Content-Security-Policy") && html.includes("default-src 'none'"), "CSP présente")
    const corps = html.slice(html.indexOf("<body>"))
    assert.ok(!/<(script|img|svg|iframe|a|i)\b/i.test(corps), "aucune balise venant des membres dans la page")
    assert.ok(!/<[^>]*\son\w+=/i.test(corps), "aucun attribut d'événement (onerror, onload…)")
    assert.ok(corps.includes("ticket-&lt;b&gt;bob&lt;/b&gt;") && corps.includes("&lt;i&gt;modo&lt;/i&gt;"), "nom du salon et pseudo échappés")
    assert.ok(corps.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "le texte reste lisible, échappé")

    // Le formulaire d'ouverture (embed du bot) est recopié dans les deux transcripts, échappé dans le HTML
    const formulaire = [{
        id: "6000", content: "", createdTimestamp: Date.UTC(2026, 0, 1), author: { tag: "bot", id: "1" }, attachments: new Discord.Collection(),
        embeds: [{ title: "Ticket : Support", description: "Bienvenue", fields: [{ name: "Sujet", value: "<b>rôle perdu</b>" }] }]
    }]
    const salonFormulaire = { ...salonFactice, messages: { fetch: async ({ before }) => new Discord.Collection(before ? [] : formulaire.map(m => [m.id, m])) } }
    const recu = await buildTranscript(salonFormulaire, { fermePar: { tag: "modo", id: MOD }, auteurId: U })
    assert.ok(recu.texte.includes("Sujet : <b>rôle perdu</b>"), "formulaire dans le .txt")
    assert.ok(recu.html.includes("Sujet : &lt;b&gt;rôle perdu&lt;/b&gt;"), "formulaire échappé dans le .html")
    console.log("OK : transcript HTML (XSS échappé, CSP)")

    // Types de tickets : isolation et modification partielle
    const G8 = "555555555555555557", G9 = "555555555555555558"
    const t1 = db.addTicketType(G8, { nom: "Support", description: "Aide", categoryId: "111111111111111110" })
    assert.strictEqual(db.getTicketType(G9, t1), null, "un serveur ne voit pas les types d'un autre")
    assert.strictEqual(db.updateTicketType(G9, t1, { nom: "Piraté" }), false)
    db.updateTicketType(G8, t1, { staffRoleId: "222222222222222220" })
    assert.deepStrictEqual([db.getTicketType(G8, t1).nom, db.getTicketType(G8, t1).category_id, db.getTicketType(G8, t1).staff_role_id],
        ["Support", "111111111111111110", "222222222222222220"], "modifier le rôle garde le nom et la catégorie")

    // Tickets : prise en charge atomique, libération, notes
    const C1 = "666666666666666601", OWNER = "777777777777777701", STAFF1 = "888888888888888801", STAFF2 = "888888888888888802"
    db.addTicket(G8, C1, OWNER, t1, { staffRoleId: "222222222222222220" })
    assert.strictEqual(db.claimTicket(C1, STAFF1), true)
    assert.strictEqual(db.claimTicket(C1, STAFF2), false, "déjà pris : le 2e clic échoue")
    const premiereFois = db.getTicket(C1).claimed_at
    assert.strictEqual(db.unclaimTicket(C1, STAFF2), false, "on ne libère pas le ticket d'un autre")
    assert.strictEqual(db.unclaimTicket(C1, STAFF1), true)
    db.claimTicket(C1, STAFF2)
    assert.strictEqual(db.getTicket(C1).claimed_at, premiereFois, "la date de 1re prise en charge est gardée")
    assert.strictEqual(db.rateTicket(C1, OWNER, 5), false, "pas de note tant que le ticket n'est pas supprimé")
    db.setTicketStatus(C1, "supprime")
    assert.strictEqual(db.rateTicket(C1, STAFF1, 1), false, "seul l'auteur note")
    assert.strictEqual(db.rateTicket(C1, OWNER, 4), true)
    assert.strictEqual(db.rateTicket(C1, OWNER, 1), false, "une seule note")
    assert.strictEqual(db.getTicket(C1).rating, 4)

    // Note en MP : tout est revérifié en base, le customId n'est pas cru sur parole
    const tickets = require('../Fonctions/tickets')
    const C2 = "666666666666666602"
    db.addTicket(G8, C2, OWNER, null)
    db.setTicketStatus(C2, "supprime")
    const reponses = []
    const clicNote = (customId, userId) => ({
        customId, user: { id: userId },
        reply: async r => reponses.push(["reply", r.content]), update: async r => reponses.push(["update", r.content])
    })
    const botNote = { guilds: { cache: new Discord.Collection() } }
    await tickets.noterTicket(botNote, clicNote(`note:${C2}:5`, STAFF1))
    await tickets.noterTicket(botNote, clicNote(`note:${C2}:9`, OWNER))
    await tickets.noterTicket(botNote, clicNote(`note:../../x:5`, OWNER))
    assert.deepStrictEqual(reponses.map(r => r[0]), ["reply", "reply", "reply"], "mauvais membre, note hors limites, ID invalide : refusés")
    assert.strictEqual(db.getTicket(C2).rating, null)
    await tickets.noterTicket(botNote, clicNote(`note:${C2}:3`, OWNER))
    assert.strictEqual(db.getTicket(C2).rating, 3)

    // Ticket fermé il y a 8 jours puis supprimé aujourd'hui : le délai de note part de la suppression
    const C5 = "666666666666666605"
    db.addTicket(G8, C5, OWNER, null)
    db.setTicketStatus(C5, "ferme", Date.now() - 8 * 24 * 3600000)
    db.setTicketStatus(C5, "supprime")
    await tickets.noterTicket(botNote, clicNote(`note:${C5}:5`, OWNER))
    assert.strictEqual(db.getTicket(C5).rating, 5, "note acceptée après une fermeture ancienne")

    // Staff : rôle posé sur le ticket à sa création (et pas le rôle actuel du type)
    const guildStaff = { id: G8, ownerId: "owner", roles: { cache: new Discord.Collection([["222222222222222220", { id: "222222222222222220", managed: false }]]) } }
    const membreAvec = roles => ({ memberPermissions: new Discord.PermissionsBitField(0n), guild: guildStaff, member: { roles: { cache: new Discord.Collection(roles.map(r => [r, {}])) } } })
    assert.strictEqual(tickets.isStaff(membreAvec(["222222222222222220"]), { id: C1 }), true, "rôle du ticket")
    assert.strictEqual(tickets.isStaff(membreAvec([]), { id: C1 }), false)
    db.updateTicketType(G8, t1, { staffRoleId: "333333333333333330" })
    assert.strictEqual(tickets.isStaff(membreAvec(["222222222222222220"]), { id: C1 }), true, "changer le type ne change pas l'accès au ticket existant")
    console.log("OK : tickets (types, prise en charge, notes, staff du ticket)")

    // Stats
    const { calculerStats } = require('../Commandes/stats')
    const s = calculerStats([
        { status: "ouvert", type_id: 1, created_at: 0, claimed_at: 60000, claimed_by: "a", rating: null },
        { status: "supprime", type_id: 1, created_at: 0, claimed_at: 180000, claimed_by: "a", rating: 4 },
        { status: "ferme", type_id: null, created_at: 0, claimed_at: null, claimed_by: null, rating: 2 }
    ], [{ id: 1, nom: "Support" }])
    assert.deepStrictEqual([s.total, s.enCours, s.fermes, s.delaiPriseEnCharge, s.noteMoyenne], [3, 1, 2, 120000, 3])
    assert.deepStrictEqual(s.parType, [["Support", 2], ["Sans type", 1]])
    assert.deepStrictEqual(s.topStaff, [["a", 2]])
    console.log("OK : statistiques des tickets")

    // Inactivité : avertissement, réponse qui l'annule, puis fermeture 24 h après un nouvel avertissement
    const { traiterInactifs } = require('../Fonctions/ticketsInactifs')
    const G10 = "555555555555555559", C3 = "666666666666666603"
    db.setTicketInactivity(G10, 2)
    db.addTicket(G10, C3, OWNER, null)
    const jour = 24 * 3600000
    const t0 = Date.now()
    let derniers = [{ author: { bot: false }, createdTimestamp: t0 - 3 * jour }]
    const envoyes = [], actions = []
    const salonInactif = {
        id: C3, name: "ticket-bob", topic: OWNER, type: Discord.ChannelType.GuildText, createdTimestamp: t0 - 5 * jour,
        guild: { id: G10 },
        messages: { fetch: async () => new Discord.Collection(derniers.map((m, i) => [String(i), m])) },
        send: async texte => { envoyes.push(texte); return { id: "999" } },
        setName: async nom => { actions.push(["nom", nom]); salonInactif.name = nom },
        permissionOverwrites: {
            cache: new Discord.Collection(),
            edit: async (id, droits, options) => {
                // Comme discord.js : sans type, un utilisateur absent du cache fait échouer l'appel
                assert.strictEqual(options?.type, Discord.OverwriteType.Member, "type Member précisé")
                actions.push(["droits", id, droits])
                salonInactif.permissionOverwrites.cache.set(id, { deny: new Discord.PermissionsBitField(droits.ViewChannel === false ? Flags.ViewChannel : 0n) })
            }
        }
    }
    const guildInactif = { id: G10, available: true, channels: { cache: new Discord.Collection([[C3, salonInactif]]) } }
    const botInactif = { user: { id: "bot" }, guilds: { cache: new Discord.Collection([[G10, guildInactif]]) } }

    assert.deepStrictEqual(await traiterInactifs(botInactif, t0), { avertis: 1, fermes: 0 })
    assert.strictEqual(db.getTicket(C3).warned_at, t0)
    // Le message d'avertissement du bot ne compte pas comme activité
    derniers = [{ author: { bot: true }, createdTimestamp: t0 }, ...derniers]
    assert.deepStrictEqual(await traiterInactifs(botInactif, t0 + 3600000), { avertis: 0, fermes: 0 }, "pas de double avertissement")
    // L'auteur répond : avertissement annulé
    derniers = [{ author: { bot: false }, createdTimestamp: t0 + 7200000 }]
    await traiterInactifs(botInactif, t0 + 3 * 3600000)
    assert.strictEqual(db.getTicket(C3).warned_at, null, "réponse : avertissement annulé")
    // Nouvel avertissement 2 jours plus tard, puis 24 h sans réponse : fermeture
    await traiterInactifs(botInactif, t0 + 3 * jour)
    assert.deepStrictEqual(await traiterInactifs(botInactif, t0 + 4 * jour + 60000), { avertis: 0, fermes: 1 })
    assert.deepStrictEqual(actions[0], ["nom", "ferme-bob"])
    assert.deepStrictEqual(actions[1], ["droits", OWNER, { ViewChannel: false }], "l'auteur perd l'accès")
    assert.strictEqual(db.getTicket(C3).status, "ferme")
    assert.deepStrictEqual(await traiterInactifs(botInactif, t0 + 5 * jour), { avertis: 0, fermes: 0 }, "ticket fermé : plus traité")
    assert.strictEqual(actions.length, 2, "fermeture complète : rien à refaire")

    // Fermeture interrompue (renommé "ferme-" mais l'auteur a encore accès) : terminée au passage suivant
    salonInactif.permissionOverwrites.cache.clear()
    await traiterInactifs(botInactif, t0 + 6 * jour)
    assert.deepStrictEqual(actions[2], ["droits", OWNER, { ViewChannel: false }], "accès de l'auteur retiré au rattrapage")

    // Salon supprimé à la main pendant que le bot était éteint
    const C4 = "666666666666666604"
    db.addTicket(G10, C4, OWNER, null)
    await traiterInactifs(botInactif, t0)
    assert.strictEqual(db.getTicket(C4).status, "supprime")
    console.log("OK : fermeture des tickets inactifs")

    // RGPD : types et tickets effacés avec le serveur, tickets supprimés purgés après 90 jours
    assert.ok(db.guildsWithData().includes(G8))
    assert.ok(db.deleteGuildData(G8) >= 3)
    assert.strictEqual(db.listTicketTypes(G8).length, 0)
    assert.strictEqual(db.getTicket(C1), null)
    assert.strictEqual(db.purgeOldTickets(Date.now() + 1), 1, "C4 (supprimé) purgé, C3 (fermé, pas supprimé) gardé")
    assert.ok(db.getTicket(C3))
    console.log("OK : RGPD des tickets")
}
