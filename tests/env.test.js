process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const { envFile, appliquer } = require('../Fonctions/env')
const { estConnecte } = require('../Fonctions/heartbeat')

test("choix de l'environnement", async () => {
    assert.deepStrictEqual(envFile(["node", "main.js"], {}), { fichier: ".env", obligatoire: false, nom: "défaut" })
    assert.deepStrictEqual(envFile(["node", "main.js", "--env=dev"], {}), { fichier: ".env.dev", obligatoire: true, nom: "dev" }, "--env=dev obligatoire, sans repli")
    assert.strictEqual(envFile(["node", "main.js"], { ENV_FILE: ".env.prod" }).obligatoire, true)
    assert.strictEqual(envFile(["node", "main.js", "--env=dev"], { ENV_FILE: ".env.prod" }).fichier, ".env.dev", "--env prime sur ENV_FILE")
    assert.throws(() => envFile(["node", "main.js", "--env=../../secret"], {}), /invalide/, "pas de chemin dans --env")
    assert.throws(() => envFile(["node", "main.js", "--env="], {}), /invalide/)
    assert.throws(() => envFile(["node", "deploy.js", "--env", "dev", "--clear"], {}), /--env=dev/, "--env sans = refusé")
    const envTest = { DISCORD_TOKEN: "TOKEN_PROD", AUTRE: "garde" }
    appliquer("DISCORD_TOKEN=TOKEN_DEV\nDATABASE_PATH=data/dev.db", true, envTest)
    assert.strictEqual(envTest.DISCORD_TOKEN, "TOKEN_DEV", "fichier explicite : il prime sur le token déjà défini")
    assert.strictEqual(envTest.AUTRE, "garde")
    const envDocker = { DISCORD_TOKEN: "TOKEN_DOCKER" }
    appliquer("DISCORD_TOKEN=TOKEN_FICHIER", false, envDocker)
    assert.strictEqual(envDocker.DISCORD_TOKEN, "TOKEN_DOCKER", ".env par défaut : les variables existantes priment")
})

test("détection de la connexion (healthcheck)", async () => {
    const botFactice = statuts => ({ ws: { status: Discord.Status.Ready, shards: new Discord.Collection(statuts.map((s, i) => [i, { status: s }])) } })
    assert.strictEqual(estConnecte(botFactice([Discord.Status.Ready])), true)
    assert.strictEqual(estConnecte(botFactice([Discord.Status.Disconnected])), false, "shard déconnecté malgré ws.status Ready")
    assert.strictEqual(estConnecte(botFactice([Discord.Status.Ready, Discord.Status.Reconnecting])), false)
    assert.strictEqual(estConnecte(botFactice([])), false)
})
