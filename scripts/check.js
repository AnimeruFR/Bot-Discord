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
})()
