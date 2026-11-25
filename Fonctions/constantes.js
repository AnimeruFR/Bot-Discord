// Valeurs communes au bot (/config) et au tableau de bord : une seule source, pour qu'elles ne divergent pas
const INACTIVITES = [0, 1, 2, 3, 7, 14, 30] // fermeture des tickets inactifs, en jours (0 = jamais)
const LANGUES = ["auto", "fr", "en"]

module.exports = { INACTIVITES, LANGUES }
