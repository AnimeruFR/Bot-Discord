# PROGRESS – Bot-Discord

## État des lots

| Lot | Contenu | État |
|---|---|---|
| Sécurité | Failles S2 à S21 (voir `AUDIT.md`) | ✅ Commité (`6561b6b`) |
| A – Robustesse | deploy séparé, `setContexts`, arrêt propre, ESLint + CI + Dependabot | ✅ Commité (`6e37ea6`) |
| B – Modération persistante | warns en SQLite, `/warns`, `/unwarn`, `/setlogs`, logs, confirmation de ban, délai des tickets en base | ✅ Commité (`d6a0341`) |
| C – Tickets | `/setticket`, panneau en message simple, confirmation + transcript + pièces jointes avant suppression | ✅ Commité (`38cbc75`) |
| PR #1, #6, Dependabot #2 à #5 | Tout le travail précédent | ✅ Fusionné dans `main`, CI verte |
| D – Socle dev/prod et conformité | `--env=dev/prod`, Docker durci + healthcheck, sauvegardes vérifiées, RGPD (purge à 30 jours, `/privacy`), pages légales, job CI Docker | ✅ Commité (`7e0b59e`), PR #7 ouverte, CI verte |
| E – Modération avancée | historique `/historique`, `/tempban` + débans automatiques, seuils `/sanctions`, `/lock` `/unlock` `/slowmode`, `/automod` | ✅ Commité sur `lot-e/moderation-avancee`, pas encore poussé |
| F à K | Voir `ROADMAP.md` (tickets pro, engagement, langues, croissance, monétisation, dashboard) | ⏳ À faire, dans l'ordre |

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
- Monétisation éventuelle : premium par serveur via les Premium Apps Discord, jamais sur les fonctions de sécurité de base.

## À faire par Animeru
1. Régénérer le token sur le Developer Portal (S1), le mettre dans `.env`.
2. Tester sur un serveur de test : `npm run deploy -- --guild ID` puis `npm start`.
3. Créer la 2e application Discord « Bot-Discord DEV » et un serveur de test, puis `.env.dev` (copie de `.env.dev.example`).
4. Compléter les espaces réservés de `docs/conditions.md` et `docs/confidentialite.md` avant de les publier.
5. (Optionnel) `gh auth login --web` pour que Claude gère les PR directement.

## Prochaine étape
Lot E (modération avancée) codé sur `lot-e/moderation-avancee` (part de la branche du lot D, PR #7 pas encore fusionnée). Commité. Prochaines étapes : fusionner #7, pousser la branche et ouvrir la PR du lot E, tester `/tempban` (2 min) et `/automod action:invitations` sur le serveur de test. Ensuite : lot F (tickets pro).
