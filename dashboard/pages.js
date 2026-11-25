// Rendu HTML du tableau de bord : fonctions pures, une page complète par appel.
// Tout texte venant de Discord ou de la base passe par echapper, y compris dans les attributs.
// Aucun script ni style inline : la CSP du serveur les interdirait de toute façon.
const { echapper: e } = require("../Fonctions/transcript")

const { INACTIVITES, LANGUES } = require("../Fonctions/constantes")

const LIBELLES_LANGUES = { auto: "Automatique (langue du serveur)", fr: "Français", en: "English" }

// Seules les images du CDN Discord sont affichées (la CSP n'autorise que cet hôte)
function urlImage(url) {
    try {
        const u = new URL(String(url))
        return u.protocol === "https:" && u.hostname === "cdn.discordapp.com" ? u.href : null
    } catch {
        return null
    }
}

function initiales(nom) {
    const mots = String(nom ?? "").trim().split(/\s+/).filter(Boolean)
    const lettres = mots.length > 1 ? [mots[0], mots[1]].map(m => [...m][0]) : [...(mots[0] ?? "?")].slice(0, 2)
    return lettres.join("").toUpperCase()
}

function image(url, nom, classe) {
    const src = urlImage(url)
    if (src) return `<img class="${classe}" src="${e(src)}" alt="" width="40" height="40">`
    return `<span class="${classe} initiales" aria-hidden="true">${e(initiales(nom))}</span>`
}

function enTete(utilisateur, csrf) {
    let droite = ""
    if (utilisateur && csrf) {
        const nom = utilisateur.globalName || utilisateur.username
        droite = `<div class="utilisateur">${image(utilisateur.avatarUrl, nom, "avatar")}`
            + `<span class="pseudo">${e(nom)}</span>`
            + `<form method="post" action="/deconnexion"><input type="hidden" name="_csrf" value="${e(csrf)}">`
            + `<button type="submit" class="bouton secondaire">Déconnexion</button></form></div>`
    } else if (utilisateur) {
        droite = `<div class="utilisateur"><span class="pseudo">${e(utilisateur.globalName || utilisateur.username)}</span>`
            + `<a class="bouton secondaire" href="/serveurs">Mes serveurs</a></div>`
    }
    return `<header class="entete"><a class="marque" href="/">Tableau de bord</a>${droite}</header>`
}

function page({ titre, corps, utilisateur = null, csrf = null }) {
    return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(titre)}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
${enTete(utilisateur, csrf)}
<main class="contenu">
${corps}
</main>
</body>
</html>
`
}

function pageAccueil({ utilisateur } = {}) {
    const action = utilisateur
        ? `<a class="bouton principal" href="/serveurs">Mes serveurs</a>`
        : `<a class="bouton principal" href="/connexion">Se connecter avec Discord</a>`
    return page({
        titre: "Tableau de bord du bot",
        utilisateur,
        corps: `<section class="accueil carte">
<h1>Gérez votre bot depuis votre navigateur</h1>
<p>Connectez-vous avec Discord pour régler la langue, les logs, les tickets, les messages de bienvenue et d'au revoir de vos serveurs.</p>
<p>Seuls les serveurs où vous avez la permission « Gérer le serveur » sont affichés.</p>
${action}
</section>`
    })
}

function pageErreur({ code, titre, texte } = {}) {
    return page({
        titre: `${titre || "Erreur"}`,
        corps: `<section class="erreur-page carte">
<p class="code">${e(code)}</p>
<h1>${e(titre)}</h1>
<p>${e(texte)}</p>
<a class="bouton principal" href="/">Retour à l'accueil</a>
</section>`
    })
}

function pageServeurs({ utilisateur, serveurs = [], lienInvitation, csrf }) {
    const cartes = serveurs.map(s => {
        const action = s.botPresent
            ? `<a class="bouton principal" href="/serveur/${encodeURIComponent(s.id)}">Configurer</a>`
            : `<a class="bouton secondaire" href="${e(lienInvitation)}" target="_blank" rel="noopener noreferrer">Ajouter le bot</a>`
        return `<li class="serveur carte">${image(s.iconUrl, s.name, "icone")}<span class="nom">${e(s.name)}</span>${action}</li>`
    }).join("\n")
    const contenu = serveurs.length
        ? `<ul class="grille">\n${cartes}\n</ul>`
        : `<p class="vide carte">Aucun serveur où vous pouvez gérer le bot. Il vous faut la permission « Gérer le serveur ».</p>`
    return page({
        titre: "Mes serveurs",
        utilisateur,
        csrf,
        corps: `<h1>Mes serveurs</h1>\n<p class="aide">Choisissez un serveur à configurer.</p>\n${contenu}`
    })
}

function options(liste, actuel, libelleVide) {
    const valeur = actuel === null || actuel === undefined ? "" : String(actuel)
    const connu = valeur === "" || liste.some(o => String(o.id) === valeur)
    const lignes = [`<option value=""${valeur === "" ? " selected" : ""}>${e(libelleVide)}</option>`]
    for (const o of liste) {
        lignes.push(`<option value="${e(o.id)}"${String(o.id) === valeur ? " selected" : ""}>${e(o.nom)}</option>`)
    }
    // L'élément configuré a été supprimé : on le garde visible pour ne pas l'effacer sans le dire
    if (!connu) lignes.push(`<option value="${e(valeur)}" selected>Introuvable (${e(valeur)})</option>`)
    return lignes.join("")
}

function selection(id, nom, label, contenu, { aide = "", desactive = false, premium = false } = {}) {
    return `<div class="champ">
<label for="${id}">${e(label)}${premium ? ` <span class="badge-premium">Premium</span>` : ""}</label>
<select id="${id}" name="${nom}"${desactive ? " disabled" : ""}${aide ? ` aria-describedby="${id}-aide"` : ""}>${contenu}</select>
${aide ? `<p class="aide" id="${id}-aide">${e(aide)}</p>` : ""}
</div>`
}

function texte(id, nom, label, valeur, { aide = "", desactive = false, premium = false, max = 0, type = "texte", motif = "", exemple = "" } = {}) {
    const commun = ` id="${id}" name="${nom}"${desactive ? " disabled" : ""}${max ? ` maxlength="${max}"` : ""}${aide ? ` aria-describedby="${id}-aide"` : ""}`
    const saisie = type === "zone"
        ? `<textarea${commun} rows="4">${e(valeur)}</textarea>`
        : `<input type="text"${commun} value="${e(valeur)}"${motif ? ` pattern="${motif}"` : ""}${exemple ? ` placeholder="${e(exemple)}"` : ""} autocomplete="off">`
    return `<div class="champ">
<label for="${id}">${e(label)}${premium ? ` <span class="badge-premium">Premium</span>` : ""}</label>
${saisie}
${aide ? `<p class="aide" id="${id}-aide">${e(aide)}</p>` : ""}
</div>`
}

// Champ premium verrouillé : case pour revenir au défaut (la saisie reste désactivée)
function caseDefaut(nom, label) {
    return `<div class="champ case"><label><input type="checkbox" name="${nom}" value="1"> ${e(label)}</label></div>`
}

function section(titre, contenu, note = "") {
    return `<fieldset class="section carte"><legend>${e(titre)}</legend>${note ? `<p class="aide">${e(note)}</p>` : ""}\n${contenu}\n</fieldset>`
}

function blocMessage(message) {
    if (!message) return ""
    const lignes = (message.lignes || []).map(l => `<li>${e(l)}</li>`).join("")
    const ok = message.type === "ok"
    return `<div class="message ${ok ? "ok" : "erreur"}" role="${ok ? "status" : "alert"}"><p class="message-titre">${ok ? "Enregistré" : "Une erreur est survenue"}</p>`
        + (lignes ? `<ul>${lignes}</ul>` : "") + `</div>`
}

function pageServeur({ utilisateur, serveur, config, csrf, message = null }) {
    const salons = (config.salonsTexte || []).map(s => ({ id: s.id, nom: s.name === null || s.name === undefined ? "Salon privé (non visible)" : `#${s.name}` }))
    const categories = (config.categories || []).map(c => ({ id: c.id, nom: c.name }))
    const roles = (config.roles || []).map(r => ({ id: r.id, nom: `@${r.name}` }))
    const vide = "Aucun / par défaut"
    const verrou = Boolean(config.premiumActif && !config.premium)
    const optionsPremium = { desactive: verrou, premium: verrou }
    const tickets = config.tickets || {}
    const panneau = config.panneau || {}
    const bienvenue = config.bienvenue || {}
    const aurevoir = config.aurevoir || {}

    const general = selection("langue", "langue", "Langue", LANGUES.map(v =>
        `<option value="${v}"${config.langue === v ? " selected" : ""}>${e(LIBELLES_LANGUES[v] ?? v)}</option>`).join(""))
        + texte("couleur", "couleur", "Couleur des embeds", config.couleur, {
            ...optionsPremium, motif: "#[0-9A-Fa-f]{6}", exemple: "#5865F2", max: 7,
            aide: verrou ? "Modifier la couleur demande le Premium. Tu peux seulement la rétablir au défaut." : "Format #RRGGBB. Laissez vide pour la couleur par défaut."
        })
        + (verrou && config.couleur ? caseDefaut("couleurDefaut", "Rétablir le défaut (couleur)") : "")
    const logs = selection("logs", "logs", "Salon de logs", options(salons, config.logs, vide),
        { aide: "Les actions de modération et les changements faits ici y sont journalisés." })
    const sansInactivite = tickets.inactivite === null || tickets.inactivite === undefined
    const inactivite = INACTIVITES.map(j =>
        `<option value="${j}"${!sansInactivite && Number(tickets.inactivite) === j ? " selected" : ""}>${j === 0 ? "Jamais" : `${j} jour${j > 1 ? "s" : ""}`}</option>`).join("")
    const ticketsHtml = selection("ticketsCategorie", "ticketsCategorie", "Catégorie des tickets", options(categories, tickets.categorie, vide))
        + selection("ticketsStaff", "ticketsStaff", "Rôle du staff", options(roles, tickets.staff, vide))
        + selection("ticketsInactivite", "ticketsInactivite", "Fermer les tickets inactifs après",
            `<option value=""${sansInactivite ? " selected" : ""}>${vide}</option>${inactivite}`)
    const panneauHtml = texte("panneauTitre", "panneauTitre", "Titre du panneau", panneau.titre, { ...optionsPremium, max: 256 })
        + texte("panneauTexte", "panneauTexte", "Texte du panneau", panneau.texte, { ...optionsPremium, max: 2000, type: "zone" })
        + (verrou && (panneau.titre || panneau.texte) ? caseDefaut("panneauDefaut", "Rétablir le défaut (titre et texte)") : "")
    const bienvenueHtml = selection("bienvenueSalon", "bienvenueSalon", "Salon", options(salons, bienvenue.salon, vide))
        + texte("bienvenueMessage", "bienvenueMessage", "Message", bienvenue.message, { max: 1000, type: "zone", aide: "Laissez le salon vide pour désactiver." })
    const aurevoirHtml = selection("aurevoirSalon", "aurevoirSalon", "Salon", options(salons, aurevoir.salon, vide))
        + texte("aurevoirMessage", "aurevoirMessage", "Message", aurevoir.message, { max: 1000, type: "zone", aide: "Laissez le salon vide pour désactiver." })

    const nbSeuils = Number(config.nbSeuils) || 0
    const nbTypes = Number(config.nbTypes) || 0
    const resume = `<ul class="resume">
<li><strong>${nbSeuils}</strong> seuil${nbSeuils > 1 ? "s" : ""} de sanctions : à modifier avec la commande <code>/sanctions</code>.</li>
<li><strong>${nbTypes}</strong> type${nbTypes > 1 ? "s" : ""} de tickets : à modifier avec la commande <code>/tickettype</code>.</li>
</ul>`

    return page({
        titre: `Configurer ${serveur.name}`,
        utilisateur,
        csrf,
        corps: `<div class="titre-serveur">${image(serveur.iconUrl, serveur.name, "icone")}<h1>${e(serveur.name)}</h1><a class="lien" href="/serveurs">Tous les serveurs</a></div>
${blocMessage(message)}
<form method="post" action="/serveur/${encodeURIComponent(serveur.id)}" class="formulaire">
<input type="hidden" name="_csrf" value="${e(csrf)}">
${section("Général", general)}
${section("Logs", logs)}
${section("Tickets", ticketsHtml)}
${section("Panneau de tickets", panneauHtml, verrou ? "Le titre et le texte du panneau demandent le Premium : ils sont verrouillés, mais tu peux les rétablir au défaut." : "")}
${section("Bienvenue", bienvenueHtml)}
${section("Au revoir", aurevoirHtml)}
${section("Résumé (lecture seule)", resume)}
<div class="actions"><button type="submit" class="bouton principal">Enregistrer</button></div>
</form>`
    })
}

module.exports = { pageAccueil, pageServeurs, pageServeur, pageErreur }
