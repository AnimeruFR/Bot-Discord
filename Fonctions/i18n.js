const fs = require('fs')
const path = require('path')

const LANGUES = ["fr", "en"]
const dossier = path.join(__dirname, '..', 'locales')
const textes = Object.fromEntries(LANGUES.map(l => [l, JSON.parse(fs.readFileSync(path.join(dossier, `${l}.json`), 'utf8'))]))
const commandesEn = JSON.parse(fs.readFileSync(path.join(dossier, 'commandes.en.json'), 'utf8'))
const manquantes = new Set() // clés introuvables déjà signalées (un seul avertissement par clé)

// Langue à utiliser. cible : une interaction (réponse à un membre) ou un serveur (message public).
// - Langue imposée par le serveur (/config) : toujours elle.
// - Sinon, pour une interaction : la langue du client Discord du membre.
// - Sinon, pour un message public (cible = serveur) : français, la langue historique du bot. On ne se fie pas à
//   guild.preferredLocale, qui vaut « en-US » par défaut sur la plupart des serveurs (même français).
// Les descriptions des commandes, elles, suivent toujours la langue du client (choix de Discord).
function langueDe(cible) {
    const estServeur = cible && cible.guildId === undefined && cible.guild === undefined && "preferredLocale" in cible
    const guildId = estServeur ? cible.id : (cible?.guildId ?? cible?.guild?.id ?? null)
    // Base chargée à la demande (évite un cycle de require au chargement)
    const imposee = guildId ? require('./db').getApparence(guildId).langue : "auto"
    if (LANGUES.includes(imposee)) return imposee
    if (estServeur || !cible?.locale) return "fr"
    return String(cible.locale).startsWith("fr") ? "fr" : "en"
}

// Texte traduit. cible : une interaction, un serveur, ou directement "fr"/"en".
// Variables {nom} remplacées par une fonction (une valeur contenant "$&" reste telle quelle).
// Repli : anglais absent -> français ; absent partout -> la clé, avec un avertissement unique.
function t(cible, cle, variables = {}) {
    const langue = LANGUES.includes(cible) ? cible : langueDe(cible)
    let texte = textes[langue][cle] ?? textes.fr[cle]
    if (texte === undefined) {
        if (!manquantes.has(cle)) {
            manquantes.add(cle)
            console.warn(`Traduction manquante : ${cle}`)
        }
        return cle
    }
    for (const [nom, valeur] of Object.entries(variables)) texte = texte.replaceAll(`{${nom}}`, () => String(valeur))
    return texte
}

// Traductions anglaises d'une commande (pour l'enregistrement auprès de Discord)
const localisation = texte => texte ? { "en-US": texte, "en-GB": texte } : null
function traductionsCommande(nom) {
    return commandesEn[nom] ?? null
}

module.exports = { t, langueDe, localisation, traductionsCommande, textes, commandesEn, LANGUES }
