# PROGRESS – Bot-Discord

## État des lots

| Lot | Contenu | État |
|---|---|---|
| Sécurité | Failles S2 à S21 (voir `AUDIT.md`) | ✅ Commité (`6561b6b`) |
| A – Robustesse | deploy séparé, `setContexts`, arrêt propre, ESLint + CI + Dependabot | ✅ Commité (`6e37ea6`) |
| B – Modération persistante | warns en SQLite, `/warns`, `/unwarn`, `/setlogs`, logs, confirmation de ban, délai des tickets en base | ✅ Commité (`d6a0341`) |
| C – Tickets | `/setticket`, panneau en message simple, confirmation + transcript + pièces jointes avant suppression | ✅ Commité (`38cbc75`) |
| PR #1, #6, Dependabot #2 à #5 | Tout le travail précédent | ✅ Fusionné dans `main`, CI verte |
| D – Socle dev/prod et conformité | `--env=dev/prod`, Docker durci + healthcheck, sauvegardes vérifiées, RGPD (purge à 30 jours, `/privacy`), pages légales, job CI Docker | ✅ Fusionné (PR #7), CI verte |
| E – Modération avancée | historique `/historique`, `/tempban` + débans automatiques, seuils `/sanctions`, `/lock` `/unlock` `/slowmode`, `/automod` | ✅ Fusionné (PR #8), CI verte |
| F – Tickets pro | types (`/tickettype`), formulaire, prise en charge, `/ticket ajouter/retirer`, fermeture des inactifs, transcript HTML, notes en MP, `/stats` | ✅ Commité sur `lot-f/tickets-pro` |
| G – Engagement | rôles à boutons, giveaways, sondages natifs, annonces programmées, bienvenue/au revoir (intent Server Members) | ✅ Commité sur `lot-g/engagement` (part du lot F) |
| H – Configuration et langues | `/config` interactive, traductions FR/EN (commandes + messages principaux), couleur et texte du panneau personnalisables | ✅ Commité sur `lot-h/config-langues` (part du lot G) |
| H bis – Traduction complète | toutes les réponses aux membres en FR/EN (473 clés, dictionnaires par domaine dans `locales/fr/` et `locales/en/`) ; logs et raisons d'audit restent en français | ✅ Commité sur `lot-hbis-i/traductions-croissance` (part du lot H) |
| I – Croissance | `/invite` et `npm run invite` (permissions minimales, jamais Administrateur), `/about`, README vitrine, `docs/vitrine.md` (fiche top.gg FR/EN, serveur de support, vérification) | ✅ Commité sur la même branche |
| J – Monétisation | premium par serveur (Premium Apps de Discord) : `Fonctions/premium.js` (entitlements + cache), `/premium`, bouton d'achat natif, `npm run premium:test`, `docs/monetisation.md` | ✅ Commité sur `lot-j/monetisation` |
| K – Tableau de bord web | `dashboard/` (node:http, OAuth2 Discord, sessions, CSRF, IDOR, mêmes règles que les commandes, CSP stricte), service Docker, tribunal de fin de jalon passé (jalon validé) | ✅ Commité sur `lot-k/dashboard` |

## Décisions prises
- Token et rôle staff dans `.env` (`process.loadEnvFile`), plus de `config.js`.
- Intent `Guilds` uniquement, `allowedMentions` désactivé globalement.
- Tickets identifiés par le nom (`ticket-` / `ferme-`) + l'ID de l'auteur dans le sujet du salon.
- Commandes enregistrées par `npm run deploy`, plus au démarrage. Prettier écarté (réécriture complète pour peu de gain).
- Base `node:sqlite` (intégrée à Node, pas de dépendance native) dans `data/bot.db`, Node 22.13 minimum.
- Logs par serveur configurés en base (`/setlogs`) plutôt que dans `.env`.
- Catégorie et rôle staff des tickets par serveur en base (le `.env` reste un repli).
- Transcript : le texte des messages demande le Message Content Intent (réglage du Developer Portal, pas de changement de code).
- `npm audit` bloquant en CI (volontaire : projet orienté sécurité).
- Historique git non réécrit (pas de push forcé) : la vraie protection est de régénérer le token.
- Dev/prod : deux applications Discord, deux serveurs, `.env.dev` / `.env.prod`, prod sur Oracle Always Free ou un VPS payé avec les crédits du Student Pack (voir `ROADMAP.md` §3).
- Lot D : un fichier d'environnement choisi (`--env=dev`) est obligatoire et prime sur les variables déjà définies (jamais le token de prod en dev). Données d'un serveur quitté effacées 30 jours après (pas sur une simple panne). Sauvegardes par `VACUUM INTO` vérifiées, pas de sauvegarde au démarrage si la dernière est récente. Bot arrêté (code 1) en cas de déconnexion définitive pour que Docker le relance.
- Lot E : historique dans une table `cases` (les anciens warns y sont repris à la migration, purge à 2 ans, raison effacée sur `/unwarn`). Seuil de sanction automatique déclenché au nombre exact de warns, et seulement si le modérateur a lui-même le droit de la sanction. Ban temporaire marqué `[tempban:<échéance>]` dans le journal d'audit : sans ce marqueur exact, le bot ne débannit pas (re-ban manuel). Intent `GuildModeration` ajouté (non privilégié) pour suivre les débans manuels. `/lock` exige « Gérer les permissions » et ne restaure que les 5 droits qu'il a retirés.
- Lot F : rôle staff figé sur le ticket à sa création (modifier un type ne change pas l'accès aux tickets existants). Contenu du formulaire jamais stocké en base. Inactivité mesurée sur le dernier message d'un humain, relu via l'API (pas d'intent messages ajouté). Transcript HTML envoyé dans un 2e message (chaque envoi reste sous la limite de Discord). `/ticket` sans permission par défaut : chaque action vérifie ses droits.
- Lot G : intent privilégié **Server Members** accepté (bienvenue, vérification des participants de giveaway) : à cocher dans le Developer Portal. Rôles à boutons interdits pour tout rôle ayant une permission de modération, revérifié à chaque clic. Annonces : droits de l'auteur revérifiés à l'envoi, aucune mention active, envoyées « au plus une fois ». Giveaway : fin et gagnants écrits en une seule fois (jamais deux tirages), résultat republié après un crash.
- Lot H : langue = celle imposée par le serveur (/config), sinon celle du client du membre (messages publics : langue du serveur). Noms de commandes non traduits (descriptions seulement). `/config` réutilise les validations des commandes (`Fonctions/config.js`) : jamais plus de droits que `/setlogs` et `/setticket`. Traduction progressive des messages (clés dans `locales/*.json`, test de cohérence fr/en).
- H bis : messages publics et MP dans la langue du serveur, réponses dans celle du membre ; logs du salon de logs, raisons d'audit et transcripts restent en français ; textes écrits par les admins jamais traduits. Un fichier de traduction par domaine (moderation, tickets, engagement, dates, croissance) : une clé en double fait échouer le démarrage et les tests.
- Leçon : le `.gitignore` et le `.dockerignore` n'excluent `config.js` qu'à la racine ; `scripts/check.js` échoue si un fichier de code est ignoré, et la CI charge toutes les commandes dans l'image Docker.
- Lot I : liens du `.env` (`SUPPORT_URL`, `PRIVACY_URL`, `TERMS_URL`) acceptés seulement en https. Lien d'invitation avec `integration_type=0` (installation sur un serveur).
- Lot J : premium désactivé tant que `PREMIUM_SKU_ID` est vide (tout gratuit). Premium = confort seulement (créer/modifier des types de tickets, transcript HTML, `/stats`, couleur et texte du panneau) ; les types déjà créés, le transcript texte et toute la modération restent gratuits. Entitlements = source de vérité, cache 10 min vidé par les événements ; en cas de panne de Discord, dernière valeur connue. Le script de test ne supprime que les entitlements de test (type 4).
- Lot K : site sans dépendance (`node:http`), pages rendues côté serveur sans JavaScript, même base que le bot (SQLite avec `timeout` 5 s, écritures du site en transaction). Contrats entre modules : `dashboard/CONTRATS.md`.
- Reporté par le tribunal du lot K (à traiter plus tard) : sessions persistantes en base ; contrôle de version du formulaire (deux admins en même temps) ; modérateur en timeout ; relecture des droits au GET (5 min) ; sessions par utilisateur ; cache premium du site (10 min) ; regroupement IPv6 /64 ; avertissement « journal non envoyé » ; édition des seuils et types de tickets depuis le site ; env dédié au service dashboard, healthcheck HTTP ; découpage de `enregistrer`.
- Monétisation éventuelle : premium par serveur via les Premium Apps Discord, jamais sur les fonctions de sécurité de base.

## À faire par Animeru
1. Régénérer le token sur le Developer Portal (S1), le mettre dans `.env`.
2. Tester sur un serveur de test : `npm run deploy -- --guild ID` puis `npm start`.
3. Créer la 2e application Discord « Bot-Discord DEV » et un serveur de test, puis `.env.dev` (copie de `.env.dev.example`).
4. Compléter les espaces réservés de `docs/conditions.md` et `docs/confidentialite.md` avant de les publier.
5. (Optionnel) `gh auth login --web` pour que Claude gère les PR directement.

## Plan v2 : bot tout-en-un (25/11/2026)
- Branche `docs/plan-ameliorations` (non commitée) : `docs/PLAN-AMELIORATIONS.md` (100 idées notées, classement, phases 0 à 6, backlog), `docs/ECONOMIE.md` (sources, puits, gains par jour, anti-inflation, courbe d'XP), section 4 de `ROADMAP.md`.
- Critique du plan (sonnet) : 3 bloquants corrigés (signalement rangé dans `General/` + garde staff sur les boutons, plus aucun bonus d'XP premium, mises seulement via le module Casino), plafonds de transfert toutes voies, registre RGPD effacer/anonymiser/conserver, dépendances et limites Discord corrigées.
- Décisions du plan : modules `Commandes/Moderation/`, `Commandes/Communaute/<Sous-module>/`, `Commandes/General/` ; monnaie par serveur, sans valeur réelle ; tirages de cartes seulement en monnaie gagnée ou gratuits ; premium jamais en monnaie ni en tirage, +10 % d'XP max ; pas de banque à intérêts ; casino, RPG complet, bataille navale et confessions en backlog.
- **État : en attente de validation par Animeru. Aucun code écrit.**

## Phase 0 – Fondations (25/11/2026)

Branche d'intégration locale `phase-0/fondations` (non poussée), qui empile une branche par idée : `docs/plan-ameliorations` → `feat/86-loader-modules` → `feat/91-erreurs` → `feat/90-cooldowns` → (fusion `feat/88-migrations`) → `feat/1-garde-staff` → (fusion `feat/92-tests-node`) → `feat/89-routeur` → `feat/87-config-modules` → `feat/95-help-modules` → (fusion `feat/93-rgpd-membre`).

| Idée | État | Résumé |
|---|---|---|
| #86 Loader par module | ✅ | `Commandes/Moderation/` (21), `Communaute/Animation/` (6), `General/` (7) ; champs `module`/`sousModule` |
| #88 Migrations | ✅ | `migrations/NNN-*.js`, `PRAGMA user_version`, sauvegarde `avant-migration-…`, `npm run migrate` (001 schéma, 002 rôle staff, 003 modules) |
| #92 Tests node:test | ✅ | `tests/*.test.js`, `scripts/check.js` supprimé (333 assertions portées), `npm run couverture` |
| #91 Erreurs | ✅ | `Fonctions/erreurs.js` : `ErreurUtilisateur`, numéro d'incident |
| #90 Cooldowns | ✅ | champ `cooldown` (secondes) dans une commande |
| #1 Garde staff | ✅ | `Fonctions/staff.js` ; rôle staff (`/config`) pour warn/warns/unwarn/historique seulement ; `/ticket` passe à « Gérer les messages » par défaut |
| #89 Routeur | ✅ | `composants` déclarés par les commandes, garde staff sauf `public: true` |
| #87 /config modules | ✅ | Modération, Tickets, Communauté et sous-modules désactivables (Général jamais), salons de jeux ; admin uniquement |
| #96 Interrupteurs | ✅ | `DESACTIVER=communaute.jeux,commande:quiz` |
| #95 /help | ✅ | groupé par module, staff masqué, autocomplétion filtrée |
| #93 RGPD membre | ✅ | `/privacy moi exporter|effacer`, registre `Fonctions/registreRgpd.js` + test garde-fou |

Décisions de la phase 0 :
- Le rôle staff ne donne jamais un pouvoir propre au bot (ban, kick, mute, clear, lock…) : seulement les commandes qui déclarent `roleStaffSuffit`.
- Une commande de modération sans permission bigint, ou utilisable en MP, empêche le bot de démarrer.
- Les tickets forment un module à part (Tickets) : désactiver la Modération ne bloque plus les tickets des membres.
- Les menus contextuels (prévus dans #86) sont reportés à #22, première idée qui en a besoin.
- Cooldowns en mémoire seulement : les délais longs avec une valeur (daily) seront stockés par l'économie (#36).
- #87 et #96 sont dans le même commit (même fichier `Fonctions/modules.js`).
- Le champ `category` des commandes n'est plus lu par `/help` (remplacé par le module).

### Tribunal de fin de jalon 0 — **jalon validé** (corrections appliquées)
Accusation : sécurité (opus), amélioration continue (sonnet), propreté (haiku). Défense (sonnet), jury (opus). 0 CVE (`npm audit` + OSV).
- ✅ Corrigé : S1 export RGPD sans données de tiers · S2 warn refusé s'il déclenche une sanction que l'auteur n'a pas le droit d'appliquer · S3 sauvegardes avant-migration purgées à 30 j · S4 warns purgés à 2 ans · S5 `/unwarn` sur un membre parti exige « Exclure temporairement » · S6 le dashboard ne migre pas (`DATABASE_NO_MIGRATE`), PID dans le .tmp · S7 `/privacy moi effacer` 1 fois/h, délai de ticket conservé · A1 garde commune (`Fonctions/garde.js`) pour commandes ET composants (module, droits, salons de jeux, délai) · A2 `moduleActif`/`estCoupeCle` pour événements et tâches · A3 `/help` = exactement ce que le membre peut utiliser · A5 module **Tickets** séparé (`Commandes/Tickets/`) · A8 délai libéré si la commande échoue, serveur/membre dans le log d'incident · P1-P4, P6, P7 nettoyage · P5 vouvoiement partout · P8 commentaire clarifié.
- 🕓 Reporté : S3 bis rejouer les effacements RGPD après une restauration (phase 3) · S8 purge des délais sur minuteur avant les jeux en boutons (phase 3) · A4 rôle staff et permissions par défaut des commandes (phase 1) · A6 dériver purge serveur et liste des guildes du registre RGPD + vérificateurs d'effacement enregistrés (phase 3) · pagination de `/help` (phase 3) · réponses de `/warn` encore publiques sur certaines erreurs (phase 1).
- ❌ Rejeté : A7 cache des modules (gain non mesuré) · P8 remarques de style.

## Prochaine étape
Phase 0 codée, tribunal passé, tout commité en local sur `phase-0/fondations` (rien de poussé). À faire : tester sur l'application **dev** (`npm run deploy:dev -- --guild ID` puis `npm run dev`), puis, sur accord d'Animeru, pousser et ouvrir la PR. Ensuite : phase 1 (quick wins).
