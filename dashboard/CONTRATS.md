# Tableau de bord web – contrats entre les modules

Processus séparé du bot (`npm run dashboard`), **aucune dépendance npm ajoutée** : `node:http`, `fetch` global, `node:crypto`, la même base SQLite que le bot via `Fonctions/db.js` (WAL : bot et tableau de bord peuvent y accéder en même temps ; le bot relit la base à chaque usage, un changement s'applique tout de suite). CommonJS, style du dépôt (pas de point-virgule, 4 espaces, code et commentaires en français, commentaires utiles seulement).

## Variables d'environnement (lues via `Fonctions/env.js` : `loadEnv()` / `loadToken()`)
- `DISCORD_TOKEN` (token du bot, déjà existant), `DISCORD_CLIENT_SECRET` (secret OAuth2 de l'application), `DASHBOARD_URL` (URL publique, ex. `http://localhost:3000` en dev, `https://bot.exemple.fr` en prod ; le `redirect_uri` est `${DASHBOARD_URL}/callback`), `DASHBOARD_PORT` (défaut 3000), `DASHBOARD_TRUST_PROXY` (`1` derrière un reverse proxy : lire l'IP de `X-Forwarded-For`).
- Le client ID est lu au démarrage via `GET /applications/@me` avec le token du bot (pas de variable).

## `dashboard/discord.js` – accès à l'API Discord (REST, aucun client gateway)
Toutes les fonctions `async` sauf mention ; délai 10 s par requête ; une 429 est réessayée une fois après `retry_after` ; une autre erreur lève `Error` avec `.status`.
- `init()` : lit l'ID de l'application. `clientId()` (synchrone) le renvoie.
- `urlConnexion(state)` (synchrone) : URL `https://discord.com/oauth2/authorize` avec `client_id`, `redirect_uri`, `response_type=code`, `scope=identify guilds`, `state`, `prompt=none`.
- `echangerCode(code)` -> `{ accessToken, expiresAt }` (POST `/oauth2/token`, `application/x-www-form-urlencoded`, secret jamais journalisé).
- `utilisateur(accessToken)` -> `{ id, username, globalName, avatarUrl }`.
- `serveursUtilisateur(accessToken)` -> `[{ id, name, iconUrl, owner, permissions }]` (`permissions` en `BigInt`).
- `serveurBot(guildId)` -> `null` si le bot n'y est pas, sinon `{ id, name, iconUrl, ownerId }` (cache 60 s).
- `salons(guildId)` -> `[{ id, name, type, parentId, position, permissionOverwrites: [{ id, type, allow, deny }] }]` (BigInt, cache 30 s).
- `roles(guildId)` -> `[{ id, name, position, managed, permissions, color }]` (BigInt, cache 30 s).
- `membre(guildId, userId)` -> `null` (absent) | `{ id, roles: [ids] }` (jamais en cache : sert aux vérifications).
- `membreBot(guildId)` -> `{ id, roles: [ids] }` (cache 60 s).
- `permissionsDans({ id, ownerId }, roles, membre, salon = null)` (synchrone, pure) -> `BigInt` : permissions effectives (propriétaire et Administrateur = tout ; base @everyone + rôles ; surcharges @everyone, rôles, membre dans le salon).
- `envoyerLog(channelId, { titre, details, auteur: { id, username } })` : embed dans le salon de logs ; ne lève jamais d'erreur.
- `entitlements(guildId, skuId)` -> liste brute de l'API (`sku_id`, `guild_id`, `deleted`, `consumed`, `starts_at`, `ends_at`).
- (l’absence du bot est aussi mise en cache 60 s dans `serveurBot`)

## `dashboard/actions.js` – lecture et enregistrement de la configuration d'un serveur
- `lireConfig(guildId, utilisateurId)` (salons et catégories filtrés : seulement ceux que l’utilisateur voit ; un salon configuré mais invisible apparaît en `{ id, name: null }`) -> `{ langue: "auto"|"fr"|"en", couleur: "#RRGGBB"|null, logs: id|null, tickets: { categorie, staff, inactivite }, panneau: { titre, texte }, bienvenue: { salon, message }|null, aurevoir: { salon, message }|null, nbSeuils, nbTypes, premium: bool, premiumActif: bool, salonsTexte: [{ id, name }], categories: [{ id, name }], roles: [{ id, name, couleur }] }` (rôles sans @everyone ni rôles gérés).
- `enregistrer(guildId, utilisateur: { id, username }, formulaire)` -> `{ erreurs: [texte], changements: [texte] }`. Revérifie TOUT côté serveur, champ par champ, avec les mêmes règles que les commandes : l'utilisateur a toujours « Gérer le serveur » (permissions recalculées avec `membre()` et `roles()`, propriétaire inclus) ; tickets (catégorie, rôle staff, inactivité) : « Gérer le serveur » + « Gérer les salons » + « Gérer les rôles » ; rôle staff valide (pas @everyone, pas géré) et strictement inférieur au rôle le plus haut de l'utilisateur (sauf propriétaire) ; salon de logs : salon texte du serveur, pas un salon de ticket (`ticket-`/`ferme-` + sujet = ID), le bot peut y voir/écrire/intégrer des liens ; catégorie : le bot peut y voir et gérer les salons ; couleur et texte du panneau : premium requis (`Fonctions/premium.js` – adapter `estPremium` avec un faux client dont `application.entitlements.fetch` appelle `discord.entitlements`) ; longueurs : panneau titre ≤ 256, texte ≤ 2000, messages de bienvenue ≤ 1000 ; inactivité ∈ {0,1,2,3,7,14,30} ; langue ∈ {auto, fr, en} ; couleur `#RRGGBB`. Un champ refusé n'empêche pas les autres d'être enregistrés. Seuls les champs qui CHANGENT sont écrits et journalisés : `envoyerLog` dans le salon de logs avec « (tableau de bord) » ; un changement du salon de logs est journalisé dans l'ANCIEN salon puis dans le NOUVEAU.
- Écritures via les fonctions existantes de `Fonctions/db.js` (`setLangue`, `setCouleur`, `setPanneauTicket`, `setLogChannel`, `setTicketConfig`, `resetTicketConfig`, `setTicketInactivity`, `setWelcome`…).

## `dashboard/pages.js` – rendu HTML (fonctions pures, renvoient une page complète)
- `pageAccueil({ utilisateur })`, `pageServeurs({ utilisateur, serveurs: [{ id, name, iconUrl, botPresent }], lienInvitation, csrf })`, `pageServeur({ utilisateur, serveur: { id, name, iconUrl }, config, csrf, message: { type: "ok"|"erreur", lignes: [] } | null })`, `pageErreur({ code, titre, texte })`.
- Tout texte venant de Discord ou de la base passe par `echapper` (`Fonctions/transcript.js`). Aucun script, aucun style inline (CSP), une feuille `dashboard/public/style.css` servie en `/style.css`.
- Formulaire `POST /serveur/:id`, champs : `_csrf`, `langue`, `couleur`, `logs`, `ticketsCategorie`, `ticketsStaff`, `ticketsInactivite`, `panneauTitre`, `panneauTexte`, `bienvenueSalon`, `bienvenueMessage`, `aurevoirSalon`, `aurevoirMessage`. Valeur vide `""` = aucun / par défaut. Champs premium désactivés + badge si `config.premium` est faux.
- Déconnexion : formulaire `POST /deconnexion` avec `_csrf`.

## `dashboard/serveur.js` et `dashboard/index.js` – serveur HTTP
- `creerServeur({ discord, actions, pages })` -> `http.Server` (injection pour les tests) ; `index.js` charge l'environnement, vérifie les variables, `discord.init()`, écoute `DASHBOARD_PORT`.
- Routes : `GET /`, `GET /connexion`, `GET /callback`, `POST /deconnexion`, `GET /serveurs`, `GET /serveur/:id`, `POST /serveur/:id`, `GET /style.css`, sinon 404.
- Sécurité : sessions côté serveur (ID aléatoire 32 octets, cookie `__Host-tdb` HttpOnly Secure SameSite=Lax Path=/, expiration 7 jours / 24 h d'inactivité) ; `state` OAuth2 aléatoire lié à un cookie court ; jeton CSRF par session vérifié en temps constant + en-tête `Origin` égal à `DASHBOARD_URL` sur tout POST ; corps limité à 16 Ko ; limite de débit par IP ; en-têtes : CSP `default-src 'none'; style-src 'self'; img-src https://cdn.discordapp.com; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`, `X-Content-Type-Options`, `Referrer-Policy: same-origin` (avec `no-referrer`, le navigateur enverrait `Origin: null` sur nos propres formulaires), `Cache-Control: no-store` pour les pages connectées ; IDOR : `/serveur/:id` exige un ID valide, présent dans la liste des serveurs de la session avec « Gérer le serveur » ou propriétaire (liste relue si plus vieille que 5 min), ET le bot présent (`serveurBot`) — sinon 404 (pas d'information sur l'existence du serveur).

## Tests
Chaque module a son fichier `dashboard/tests/<module>.js` exportant `async function tester()` (assert, aucune connexion réseau : `fetch` simulé ou dépendances injectées) ; `tests/dashboard.test.js` les appelle. Base : `process.env.DATABASE_PATH = ":memory:"` est déjà réglé par ce fichier de test.
