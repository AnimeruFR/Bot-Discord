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

Branche d'intégration `phase-0/fondations` (poussée, PR #14 ouverte), qui empile une branche par idée : `docs/plan-ameliorations` → `feat/86-loader-modules` → `feat/91-erreurs` → `feat/90-cooldowns` → (fusion `feat/88-migrations`) → `feat/1-garde-staff` → (fusion `feat/92-tests-node`) → `feat/89-routeur` → `feat/87-config-modules` → `feat/95-help-modules` → (fusion `feat/93-rgpd-membre`).

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

## Phase 1 – Quick wins (25/11/2026)

Branche d'intégration `phase-1/quick-wins` (part de `phase-0/fondations`, PR #14 pas encore fusionnée). Une branche par commit d'idée : `feat/3-filtre-comptes`, `feat/20-reponses-tickets`, `feat/8-10-12-dossiers`, `feat/6-7-automod`, `feat/22-23-signalements`, `feat/24-94-logs-setup`.

| Idée | État | Résumé |
|---|---|---|
| Contrats communs | ✅ | migrations 004-009, logs par famille (cœur de #24), menus contextuels dans le loader, `avertir`/`muter` partagés, `refuser()` |
| #3 Filtre des comptes récents | ✅ | rôle « en attente » ou expulsion, réglé dans `/config` |
| #6 AutoMod préréglages | ✅ | souple/normal/strict, regex, exemptions (rôles, salons, salons de jeux) |
| #7 AutoMod → dossiers | ✅ | blocage consigné (case automod) ; option `dossiers` : compte comme warn + seuils |
| #8 Notes staff | ✅ | `/note`, 50 par membre, purgées à 2 ans |
| #10 Raisons prédéfinies | ✅ | `/raisons`, autocomplétion sur ban/kick/tempban/mute/warn |
| #12 /case | ✅ | voir, corriger, annuler (tracé dans case_edits) |
| #20 Réponses de tickets | ✅ | `/reponse` |
| #22 Signaler au staff | ✅ | menu message, boutons staff Warn / Mute / Ignorer |
| #23 Menus staff | ✅ | Dossier, Warn rapide, Mute 10 min |
| #24 Logs par famille | ✅ | `/setlogs famille:` et `/config` ; jeux/économie sans repli |
| #94 /setup | ✅ | 5 étapes, suggéré à l'arrivée du bot |

Décisions de la phase 1 :
- Groupes d'idées commités ensemble quand ils partagent des fichiers (#8/#10/#12, #6/#7, #22/#23, #24/#94) ; seul l'état final est testé, pas chaque commit intermédiaire.
- Rôle staff : suffit aussi pour `/note` et « Dossier » (aucun pouvoir du bot). `/case`, Warn rapide et les boutons des signalements exigent la vraie permission.
- Jamais plus de pouvoir par le bot que celui qui configure : expulsion du filtre réservée à qui peut expulser ; `/automod dossiers` exige les pouvoirs de tous les seuils en place.
- Un même message n'est signalé qu'une fois toutes les 10 min ; le message d'un membre du staff peut être signalé.
- Annuler un warn efface sa raison (même règle que `/unwarn`).
- Logs du salon de logs en français (convention existante), y compris ceux du filtre.

Critique de fin de lot (sonnet) : corrigé — annulation d'une sanction d'un collègue = Gérer le serveur ; réponse différée avant tout appel réseau (signalement, Warn rapide) ; dossier qui barre les sanctions annulées ; verrou gardé si les boutons ne se désactivent pas + anti-doublon des signalements ; expulsion du filtre et `dossiers` sans pouvoir prêté par le bot ; raisons comparées sans casse en JS (accents) ; log de config en double. Écarté : raison d'un warn annulé gardée (cohérent avec `/unwarn`) ; double ligne automod + warn (trace voulue) ; Warn rapide plus strict que `/warn` (sans faille) ; logs en français (convention).

Reporté : retrait du rôle « en attente » par un flux de vérification (#4, phase 2).

### Tribunal de fin de jalon 1 — **jalon validé** (corrections appliquées)
Accusation : sécurité (opus), amélioration continue (sonnet), propreté (haiku). Défense (sonnet), jury (opus). 0 CVE (`npm audit` ; osv-scanner indisponible sur ce poste).
- ✅ Corrigé : S1 `/automod dossiers` ne compte que les règles créées par le bot qui bloquent ou mettent en sourdine · S2 rôle « en attente » : le configurateur doit avoir Gérer les rôles et un rôle plus haut · S3 signalements jamais dans le salon général (famille sans repli) + ReadMessageHistory et fils privés vérifiés · S4 anti-rafale AutoMod (1 dossier + 1 log par membre et par minute, compteur « +N ») · S5 export RGPD avec les modifications des sanctions du membre · S8 `/case` et `/note retirer` revérifient la hiérarchie actuelle · A4 « déjà signalé » pour le 2e signaleur · A5 regex du dossier · A6 libellés des familles en i18n (déjà conforme) · P2 TYPES et rendu d'une sanction en un seul endroit (`Fonctions/cases.js`) · P3 comptage en requête préparée · P6 une seule garde `verifierDroitSurCible` · P8 tests de `avertir`/`muter`.
- 🕓 Reporté : S6 notes visant un membre du staff (phase 2, avec le dossier unifié #9) · A3 mesure de `/setup` en moins de 2 min (avant la démo) · A4 bis garde-fous des signalements persistés (phase 2) · A7 `/automod` en sous-commandes + confirmation avant remplacement (phase 2) · P7 nettoyage (verifierLimites, paramètres inutilisés, INSERT dupliqué) (phase 2).
- ❌ Rejeté : S7 extrait AutoMod (justifie la sanction, durée déclarée) · A1 logs de jeux (familles prêtes, jeux en phase 3) · A2 /setup limité aux 5 étapes du plan · P4 préfixes i18n (cosmétique) · P5 logs en français (convention).
- Risque connu : un membre avec « Gérer le serveur » peut modifier dans Discord une règle créée par le bot (son créateur ne change pas) ; la règle reste alors comptée pour `dossiers` (cache de 5 min).

## Phase 2 – Modération avancée (26/11/2026)

Phase 1 fusionnée (PR #15). Branche d'intégration `phase-2/moderation-avancee` (part de `main`). Branches par groupe d'idées : `feat/15-16-17-stats`, `feat/2-13-anti-raid`, `feat/9-11-dossier-appels`, `feat/18-19-21-tickets`, `feat/5-14-phishing-quarantaine`, `feat/4-25-verification-pseudos`.

| Idée | État | Résumé |
|---|---|---|
| Contrats communs | ✅ | migrations 010-018, familles de logs antiraid et appels, journal de config alimenté par sendModLog, arrivée d'un membre en étapes isolées, hiérarchie commune (`estAuDessus`, `peutDonnerRole`) |
| #2 Anti-raid | ✅ | `/raid` : seuils par serveur, un seul mode raid, niveau de vérification relevé et invitations suspendues (pas sans salon d'alerte : MP au propriétaire), bouton de levée, levée automatique après 60 min |
| #4 Vérification | ✅ | `/verification` : défi d'emoji à 8 boutons lié au membre, erreurs et blocage en base, suspendue seulement si un raid a verrouillé le serveur |
| #5 Anti-phishing | ✅ | `/phishing` : règle AutoMod du bot, liste `data-statique/domaines-phishing.txt` (à relire et compléter par PR), liste blanche |
| #9 Dossier unifié | ✅ | `/dossier` (et `/historique`) en pages ; jamais le sien ; notes masquées pour une cible plus haut placée ou partie |
| #11 Appels | ✅ | bouton « Faire appel » dans les MP de sanction, un appel par sanction (30 jours), décision par l'auteur ou Gérer le serveur |
| #13 Ban en masse | ✅ | `/massban` : 200 max, aperçu + confirmation, hiérarchie, une case par ban réussi |
| #14 Quarantaine | ✅ | `/quarantaine` : rôles sauvegardés avant retrait, reprise après crash, réappliquée si le membre revient |
| #15 #16 #17 | ✅ | `/journal`, `/modstats` (90/365 j premium), rapport du lundi 9 h |
| #18 #19 #21 | ✅ | délai cible des tickets, 5 champs de formulaire par type, `/ticket transferer` |
| #25 Filtre de pseudos | ✅ | `/pseudos` : hoist, zalgo, mots interdits ; jamais un membre du staff ni au-dessus de qui a activé le filtre |

Décisions de la phase 2 :
- Une étape d'arrivée qui échoue ne bloque jamais les suivantes (anti-raid → filtre → pseudo → quarantaine → vérification → bienvenue).
- Appels et signalements : familles de logs sans repli (jamais dans le salon général).
- Le journal de config (#15) est écrit par `sendModLog(action config)`, une seule fois par changement.
- Node épinglé en 22.23.5 (Docker et `engines`) pour les correctifs de sécurité, dont le SQLite embarqué.
- Commits faits avant la critique de fin de lot (écart à la règle), corrections dans des commits séparés.
- Incident : un agent a chargé le code sans base de test et a migré `data/bot.db` de la v9 à la v17 (ce que le bot aurait fait au démarrage). Sauvegarde : `backups/avant-migration-v9-20261126-082645.db`. Les briefs interdisent désormais tout `require` hors tests.

Critique de fin de lot (sonnet) : corrigé — quarantaine contournée par la vérification et les rôles à boutons ; rôles ajoutés pendant une quarantaine ; échec de vérification sans réponse ; appel accepté sans annulation ; levée de raid marquée avant la restauration ; verrouillage qui retardait l'arrivée ; repli du massban ; rafale d'alertes SLA. Reporté : appel orphelin après un crash entre écriture et envoi ; défi de vérification lisible par un script (documenté).

### Tribunal de fin de jalon 2 — 1er procès : **jalon à reprendre** ; 2e procès : **jalon validé** (corrections appliquées)
Accusation : sécurité (opus), amélioration continue (sonnet), propreté (haiku). Défense (sonnet), jury (opus). 2e procès sur le diff correctif seulement (sécurité opus, conception et propreté sonnet). `npm audit` : 0 ; Node 22.20 en retard → épinglé 22.23.5.
- ✅ Corrigé (1er procès) : S1 pseudos sans pouvoir prêté · S2 plafond de renommage · S3 purges RGPD · S4/A4 vérification persistée · S5 refuser un appel = même contrôle qu'accepter · S6 rôle de quarantaine · S7 notes d'un membre parti · S8 ancien pseudo jamais loggé · CVE Node · A1 reprise de quarantaine · A2 pas de verrouillage sans alerte + levée auto · A3 test < 5 s (horloge simulée) · A6 permission de /massban · A8 case par ban · P1 SQL des tickets · P2 helpers de hiérarchie · P8 exports.
- ✅ Corrigé (2e procès) : N1 quarantaines actives jamais purgées · N2 plus de boucle de renommage · N5/C1 vérification suspendue seulement si le raid a verrouillé · C2 raid expiré ignoré · N3 surcharge de salon refusée · S3 durées déclarées + docs/confidentialite.md · S1 auteur du filtre mémorisé · C4 hiérarchie du massban · C6 tests manquants.
- 🕓 Reporté : A5 vue d'ensemble des modules dans /config et /setup (phase 3) · A6 bis verrou par serveur de /massban · A8 bis message « appel refusé = définitif » et débit · P3 découpage de Fonctions/tickets.js · S8 bis fetch du massban et plafond global de MP · S4 bis défi plus robuste · N4 durée de raid réglable et alerte si le salon disparaît · tests des purges · image Docker par digest et engines strict · C4 chaînes en dur (raid, pseudos) · C5 messages de vérification plus précis.
- ❌ Rejeté : A7 (modules distincts) · P4, P6, P7 (style) · P5 (massban déjà testé) · P2 bis (16 comparaisons locales de sens différents) · P8 bis (exports pour les tests).

## Prochaine étape
Phase 2 codée, deux procès passés (jalon validé), commitée en local sur `phase-2/moderation-avancee` (rien de poussé). À faire : tester sur l'application **dev** (`npm run deploy:dev -- --guild ID`, puis `npm run dev`) ; faire relire `data-statique/domaines-phishing.txt` ; sur accord d'Animeru, pousser et ouvrir la PR. Ensuite : phase 3 (cœur ludique), qui demande de trancher les 3 questions en attente (casino, intent GuildMessages pour l'XP, carte de rang en image ou en embed).
