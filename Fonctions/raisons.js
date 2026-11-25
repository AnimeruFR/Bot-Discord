const db = require('./db')

// Raisons de sanction prédéfinies par serveur (mod_reasons), proposées en autocomplétion
const LIMITE_RAISONS = 25
const TAILLE_MAX = 100

function listerRaisons(guildId) {
    return db.sqlAll("SELECT content FROM mod_reasons WHERE guild_id = ? ORDER BY id", [guildId]).map(l => l.content)
}

// Id de la raison égale au texte, casse ignorée (comparée en JS : lower() de SQLite ignore les lettres accentuées)
function trouver(guildId, texte) {
    const cible = texte.toLocaleLowerCase("fr")
    return db.sqlAll("SELECT id, content FROM mod_reasons WHERE guild_id = ?", [guildId]).find(l => l.content.toLocaleLowerCase("fr") === cible)?.id ?? null
}

// Ajoute une raison. Renvoie "ok", "invalide" (vide ou trop longue), "doublon" (même texte, casse ignorée) ou "limite"
function ajouterRaison(guildId, texte) {
    const contenu = String(texte ?? "").trim()
    if (!contenu || contenu.length > TAILLE_MAX) return "invalide"
    return db.transaction(() => {
        if (trouver(guildId, contenu) !== null) return "doublon"
        if (listerRaisons(guildId).length >= LIMITE_RAISONS) return "limite"
        db.sqlRun("INSERT INTO mod_reasons (guild_id, content) VALUES (?, ?)", [guildId, contenu])
        return "ok"
    })
}

// Retire une raison (casse ignorée). Renvoie false si elle n'existe pas.
function retirerRaison(guildId, texte) {
    const id = trouver(guildId, String(texte ?? "").trim())
    return id !== null && db.sqlRun("DELETE FROM mod_reasons WHERE guild_id = ? AND id = ?", [guildId, id]) > 0
}

// Réponse à une autocomplétion : les raisons du serveur qui contiennent la saisie (25 au plus, 100 caractères au plus)
async function autocompleterRaison(interaction) {
    const saisie = String(interaction.options.getFocused() ?? "").toLowerCase()
    const choix = interaction.guildId ? listerRaisons(interaction.guildId) : []
    await interaction.respond(choix
        .filter(r => r.toLowerCase().includes(saisie))
        .slice(0, 25)
        .map(r => ({ name: r.slice(0, 100), value: r.slice(0, 100) })))
}

module.exports = { LIMITE_RAISONS, TAILLE_MAX, listerRaisons, ajouterRaison, retirerRaison, autocompleterRaison }
