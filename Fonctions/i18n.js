const fs = require('fs')
const path = require('path')

const LANGUES = ["fr", "en"]
const dossier = path.join(__dirname, '..', 'locales')
// Textes d'une langue : locales/<langue>.json + tous les fichiers de locales/<langue>/ (un par domaine).
// Une même clé définie deux fois est une erreur (deux traductions qui se marcheraient dessus).
function charger(langue) {
    const fichiers = [path.join(dossier, `${langue}.json`)]
    const sousDossier = path.join(dossier, langue)
    if (fs.existsSync(sousDossier)) {
        for (const f of fs.readdirSync(sousDossier).filter(f => f.endsWith('.json')).sort()) fichiers.push(path.join(sousDossier, f))
    }
    const tout = {}
    for (const fichier of fichiers) {
        for (const [cle, texte] of Object.entries(JSON.parse(fs.readFileSync(fichier, 'utf8')))) {
            if (cle in tout) throw new Error(`Traduction en double : ${cle} (${path.basename(fichier)})`)
            tout[cle] = texte
        }
    }
    return tout
}
const textes = Object.fromEntries(LANGUES.map(l => [l, charger(l)]))
// Traductions anglaises des commandes : locales/commandes.en.json + un fichier par domaine dans locales/commandes.en/
// (une commande traduite deux fois est une erreur)
function chargerCommandesEn() {
    const tout = JSON.parse(fs.readFileSync(path.join(dossier, 'commandes.en.json'), 'utf8'))
    const sousDossier = path.join(dossier, 'commandes.en')
    if (fs.existsSync(sousDossier)) {
        for (const f of fs.readdirSync(sousDossier).filter(f => f.endsWith('.json')).sort()) {
            for (const [nom, def] of Object.entries(JSON.parse(fs.readFileSync(path.join(sousDossier, f), 'utf8')))) {
                if (nom in tout) throw new Error(`Traduction de commande en double : ${nom} (${f})`)
                tout[nom] = def
            }
        }
    }
    return tout
}
const commandesEn = chargerCommandesEn()
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
