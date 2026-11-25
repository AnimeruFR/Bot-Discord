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
| J et K | Voir `ROADMAP.md` (monétisation, dashboard) | ⏳ À faire |

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
- Monétisation éventuelle : premium par serveur via les Premium Apps Discord, jamais sur les fonctions de sécurité de base.

## À faire par Animeru
1. Régénérer le token sur le Developer Portal (S1), le mettre dans `.env`.
2. Tester sur un serveur de test : `npm run deploy -- --guild ID` puis `npm start`.
3. Créer la 2e application Discord « Bot-Discord DEV » et un serveur de test, puis `.env.dev` (copie de `.env.dev.example`).
4. Compléter les espaces réservés de `docs/conditions.md` et `docs/confidentialite.md` avant de les publier.
5. (Optionnel) `gh auth login --web` pour que Claude gère les PR directement.

## Prochaine étape
Lots F (PR #9) et G (PR #10) fusionnés. Lot H, H bis et I : une seule PR depuis `lot-hbis-i/traductions-croissance` (le lot H seul était cassé : `Commandes/config.js` et `Fonctions/config.js` ignorés par une règle trop large du .gitignore, corrigé + test + étape de CI). Branche `lot-h/config-langues` à supprimer après la fusion. Ensuite : lot J (monétisation) puis K (dashboard).
