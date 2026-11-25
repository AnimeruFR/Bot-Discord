const assert = require("assert")
const pages = require("../pages")

const XSS = `<script>alert(1)</script>`
const XSS_ATTR = `"><img src=x onerror=alert(1)>`
const utilisateur = { id: "1", username: XSS, globalName: XSS_ATTR, avatarUrl: "https://evil.example/a.png" }

const config = (extra = {}) => ({
    langue: "fr", couleur: "#112233", logs: "c2",
    tickets: { categorie: "k1", staff: "r2", inactivite: 7 },
    panneau: { titre: XSS_ATTR, texte: XSS },
    bienvenue: { salon: "c1", message: XSS },
    aurevoir: null, nbSeuils: 3, nbTypes: 1, premium: false, premiumActif: true,
    salonsTexte: [{ id: "c1", name: XSS }, { id: "c2", name: XSS_ATTR }],
    categories: [{ id: "k1", name: XSS }],
    roles: [{ id: "r1", name: XSS_ATTR, couleur: "#fff" }, { id: "r2", name: "Staff", couleur: "#000" }],
    ...extra
})

// Pas de balise <script>, d'attribut style= ni de gestionnaire on...= dans une vraie balise
function verifierSure(html, nom) {
    assert.ok(html.startsWith("<!doctype html>"), `${nom} : doctype`)
    assert.ok(/<html lang="fr">/.test(html) && html.includes('<meta charset="utf-8">') && html.includes('name="viewport"'), `${nom} : entête`)
    assert.ok(html.includes('<link rel="stylesheet" href="/style.css">'), `${nom} : feuille de style`)
    assert.ok(!/<script/i.test(html), `${nom} : script`)
    // Les valeurs entre guillemets sont retirées : un texte échappé y est inoffensif
    const balises = (html.match(/<[^>]*>/g) || []).map(b => b.replace(/"[^"]*"/g, '""'))
    assert.ok(!balises.some(b => /\sstyle\s*=/i.test(b)), `${nom} : style inline`)
    assert.ok(!balises.some(b => /\son[a-z]+\s*=/i.test(b)), `${nom} : gestionnaire d'événement`)
    assert.ok(!html.includes(XSS) && !html.includes(XSS_ATTR), `${nom} : texte non échappé`)
    assert.ok(!html.includes("evil.example"), `${nom} : URL non Discord`)
    assert.ok(html.trimEnd().endsWith("</html>"), `${nom} : page complète`)
}

async function tester() {
    const serveur = { id: "42", name: XSS, iconUrl: "https://evil.example/i.png" }

    const accueil = pages.pageAccueil({ utilisateur: null })
    verifierSure(accueil, "accueil")
    assert.ok(accueil.includes('href="/connexion"'))

    const erreur = pages.pageErreur({ code: XSS, titre: XSS_ATTR, texte: XSS })
    verifierSure(erreur, "erreur")

    // Liste des serveurs
    const liste = pages.pageServeurs({
        utilisateur, csrf: "jeton\"1", lienInvitation: "https://discord.com/oauth2/authorize?a=1&b=2",
        serveurs: [
            { id: "1", name: XSS, iconUrl: "https://cdn.discordapp.com/icons/1/a.png", botPresent: true },
            { id: "2", name: XSS_ATTR, iconUrl: "javascript:alert(1)", botPresent: false }
        ]
    })
    verifierSure(liste, "serveurs")
    assert.ok(liste.includes('src="https://cdn.discordapp.com/icons/1/a.png"'), "icône Discord conservée")
    assert.ok(!liste.includes("javascript:"), "URL javascript ignorée")
    assert.ok(liste.includes('href="/serveur/1"') && liste.includes("Configurer"))
    assert.ok(liste.includes("Ajouter le bot") && liste.includes('rel="noopener noreferrer"'))
    assert.ok(liste.includes("a=1&amp;b=2"), "lien d'invitation échappé")
    assert.ok(/action="\/deconnexion"[^>]*><input type="hidden" name="_csrf" value="jeton&quot;1">/.test(liste), "csrf de déconnexion")
    assert.ok(liste.includes('class="avatar initiales"'), "initiales si avatar non Discord")

    // Page d'un serveur : formulaire, sélection, premium
    const html = pages.pageServeur({ utilisateur, serveur, config: config(), csrf: "abc", message: null })
    verifierSure(html, "serveur")
    assert.ok(/action="\/serveur\/42"/.test(html) && /method="post"/.test(html))
    assert.ok(html.includes('name="_csrf" value="abc"'), "csrf du formulaire")
    for (const nom of ["langue", "couleur", "logs", "ticketsCategorie", "ticketsStaff", "ticketsInactivite", "panneauTitre", "panneauTexte", "bienvenueSalon", "bienvenueMessage", "aurevoirSalon", "aurevoirMessage"]) {
        assert.ok(html.includes(`name="${nom}"`), `champ ${nom}`)
    }
    assert.ok(html.includes('<option value="" selected>Aucun / par défaut</option>'), "option vide sélectionnée si aurevoir absent")
    assert.ok(html.includes('<option value="fr" selected>'), "langue actuelle")
    assert.ok(html.includes('<option value="c2" selected>'), "salon de logs actuel")
    assert.ok(html.includes('<option value="r2" selected>@Staff</option>'), "rôle staff actuel")
    assert.ok(html.includes('<option value="7" selected>7 jours</option>'), "inactivité actuelle")
    assert.ok(html.includes('<option value="k1" selected>'), "catégorie actuelle")
    assert.ok(html.includes('<option value="c1" selected>'), "salon de bienvenue actuel")
    for (const j of [0, 1, 2, 3, 7, 14, 30]) assert.ok(html.includes(`<option value="${j}"`), `inactivité ${j}`)
    assert.ok(!/<option value="r1" selected/.test(html), "une seule option sélectionnée")
    assert.ok(/<input[^>]*name="couleur"[^>]*disabled/.test(html), "couleur désactivée")
    assert.ok(/<input[^>]*name="panneauTitre"[^>]*disabled/.test(html), "titre désactivé")
    assert.ok(/<textarea[^>]*name="panneauTexte"[^>]*disabled/.test(html), "texte désactivé")
    assert.ok(!/<textarea[^>]*name="bienvenueMessage"[^>]*disabled/.test(html), "bienvenue non désactivé")
    assert.ok((html.match(/badge-premium/g) || []).length === 3, "badges Premium")
    assert.ok(html.includes("3</strong> seuils") && html.includes("/sanctions") && html.includes("1</strong> type ") && html.includes("/tickettype"), "résumé")

    // Cases « Rétablir le défaut » : seulement si verrouillé ET une valeur existe
    assert.ok(/<input type="checkbox" name="couleurDefaut" value="1">/.test(html) && /<input type="checkbox" name="panneauDefaut" value="1">/.test(html), "cases Rétablir le défaut")
    const sansValeur = pages.pageServeur({ utilisateur, serveur, config: config({ couleur: null, panneau: {} }), csrf: "abc" })
    assert.ok(!sansValeur.includes("couleurDefaut") && !sansValeur.includes("panneauDefaut"), "pas de case sans valeur")
    const deverrouille = pages.pageServeur({ utilisateur, serveur, config: config({ premium: true }), csrf: "abc" })
    assert.ok(!deverrouille.includes("couleurDefaut") && !deverrouille.includes("panneauDefaut"), "pas de case si premium actif")

    // Salon configuré mais invisible (name: null)
    const prive = pages.pageServeur({ utilisateur, serveur, config: config({ logs: "c9", salonsTexte: [{ id: "c9", name: null }] }), csrf: "abc" })
    assert.ok(prive.includes('<option value="c9" selected>Salon privé (non visible)</option>'), "salon privé conservé")

    // Premium actif ou service premium non utilisé : rien de désactivé
    for (const extra of [{ premium: true }, { premium: false, premiumActif: false }]) {
        const libre = pages.pageServeur({ utilisateur, serveur, config: config(extra), csrf: "abc" })
        assert.ok(!/disabled/.test(libre) && !libre.includes("badge-premium\">"), "champs premium libres")
    }

    // Élément configuré mais supprimé : conservé visiblement
    const orphelin = pages.pageServeur({ utilisateur, serveur, config: config({ logs: "999" }), csrf: "abc" })
    assert.ok(orphelin.includes('<option value="999" selected>Introuvable (999)</option>'))

    // Message de résultat
    const erreurs = pages.pageServeur({ utilisateur, serveur, config: config(), csrf: "abc", message: { type: "erreur", lignes: ["a <b>", XSS_ATTR] } })
    verifierSure(erreurs, "serveur avec erreurs")
    assert.ok(erreurs.includes('role="alert"') && erreurs.includes("<li>a &lt;b&gt;</li>"))
    const reussi = pages.pageServeur({ utilisateur, serveur, config: config(), csrf: "abc", message: { type: "ok", lignes: ["Langue : fr", "Logs : #x"] } })
    assert.ok(reussi.includes('role="status"') && (reussi.match(/<li>(Langue|Logs)/g) || []).length === 2)
    assert.ok(reussi.indexOf("message ok") < reussi.indexOf("<form method=\"post\" action=\"/serveur"), "message au-dessus du formulaire")

    // Config minimale
    const mini = pages.pageServeur({ utilisateur, serveur: { id: "1", name: "S" }, csrf: "c", config: { langue: "auto", couleur: null, logs: null, tickets: {}, panneau: {}, bienvenue: null, aurevoir: null, nbSeuils: 0, nbTypes: 0, premium: true, premiumActif: false, salonsTexte: [], categories: [], roles: [] } })
    assert.ok(mini.includes('<option value="auto" selected>') && mini.includes("0</strong> seuil "))
}

module.exports = { tester }
