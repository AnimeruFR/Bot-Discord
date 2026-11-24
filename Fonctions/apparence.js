const COULEUR_DEFAUT = 0xFF0000

// Couleur des embeds du serveur (/config), rouge par défaut. Sans serveur (MP) : couleur par défaut.
function couleur(guild) {
    if (!guild) return COULEUR_DEFAUT
    return require('./db').getApparence(guild.id).couleur ?? COULEUR_DEFAUT
}

// "#5865F2", "5865f2" -> 0x5865F2 ; null si le format est invalide
function lireCouleur(texte) {
    const m = String(texte ?? "").trim().match(/^#?([0-9a-f]{6})$/i)
    return m ? parseInt(m[1], 16) : null
}

const formatCouleur = valeur => `#${valeur.toString(16).padStart(6, "0").toUpperCase()}`

module.exports = { couleur, lireCouleur, formatCouleur, COULEUR_DEFAUT }
