process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

test("aucun fichier de code ignoré par git", async (t) => {
    const dossiers = ["Commandes", "Fonctions", "Events", "Loader", "scripts", "locales"]
    const fichiers = dossiers.flatMap(d => fs.readdirSync(path.join(__dirname, "..", d), { recursive: true })
        .filter(f => /\.(js|json)$/.test(f)).map(f => path.join(d, f)))
    let ignores = ""
    try {
        ignores = execFileSync("git", ["check-ignore", "--no-index", ...fichiers], { cwd: path.join(__dirname, ".."), encoding: "utf8" })
    } catch (err) {
        // code 1 : aucun fichier ignoré (cas normal) ; git absent : test sauté
            if (err.status !== 1) return t.skip("git indisponible : vérification des fichiers ignorés sautée")
    }
    assert.strictEqual(ignores.trim(), "", `fichiers de code ignorés par git : ${ignores.trim()}`)
})
