// Délais entre deux utilisations (idée #90), déclarés dans la commande : `cooldown: 5` (en secondes).
// Gardés en mémoire : un redémarrage les remet à zéro, ce qui est acceptable pour quelques secondes ou minutes.
// Les délais longs qui ont une valeur (daily, travail…) sont stockés en base par l'économie elle-même.

const MAX_ENTREES = 50_000 // au-delà, on purge les délais expirés (la mémoire ne grossit pas sans fin)
const delais = new Map() // "commande:serveur:membre" -> fin du délai (ms)

const cle = (nom, guildId, userId) => `${nom}:${guildId ?? "mp"}:${userId}`

function purger(maintenant = Date.now()) {
    for (const [k, fin] of delais) if (fin <= maintenant) delais.delete(k)
}

// Temps restant en ms (0 = libre). Si libre, le délai démarre tout de suite :
// deux clics presque simultanés ne passent donc jamais tous les deux.
function prendre(nom, secondes, guildId, userId, maintenant = Date.now()) {
    if (!secondes || secondes <= 0) return 0
    const k = cle(nom, guildId, userId)
    const fin = delais.get(k)
    if (fin && fin > maintenant) return fin - maintenant
    if (delais.size >= MAX_ENTREES) purger(maintenant)
    delais.set(k, maintenant + secondes * 1000)
    return 0
}

// Annule un délai (ex. : la commande a été refusée avant d'agir, le membre peut réessayer)
function liberer(nom, guildId, userId) {
    delais.delete(cle(nom, guildId, userId))
}

// Délai d'une commande pour cette interaction. Renvoie le temps restant en ms (0 = la commande peut s'exécuter).
function verifierCommande(command, interaction, maintenant = Date.now()) {
    return prendre(command.name, command.cooldown, interaction.guildId, interaction.user.id, maintenant)
}

const vider = () => delais.clear() // pour les tests

module.exports = { prendre, liberer, verifierCommande, purger, vider }
