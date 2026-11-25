process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

test("sauvegarde (vérifiée, rotation, restauration)", async () => {
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
    } finally {
        fs.rmSync(dossierTest, { recursive: true, force: true })
    }
})
