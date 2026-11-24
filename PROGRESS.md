# PROGRESS – Bot-Discord

## État des lots

| Lot | Contenu | État |
|---|---|---|
| Sécurité | Failles S2 à S21 (voir `AUDIT.md`) | ✅ Commité (`6561b6b`) |
| A – Robustesse | deploy séparé, `setContexts`, arrêt propre, ESLint + CI + Dependabot | ✅ Fait, testé, **pas encore commité** |
| B – Modération persistante | warns en SQLite, logs, confirmation de ban | ⏳ À faire |
| C – Tickets | transcript, catégorie configurable | ⏳ À faire |

## Décisions prises
- Token et rôle staff dans `.env` (`process.loadEnvFile`, Node ≥ 20.12), plus de `config.js`.
- Intent `Guilds` uniquement, `allowedMentions` désactivé globalement.
- Tickets identifiés par le nom (`ticket-` / `ferme-`) + l'ID de l'auteur dans le sujet du salon.
- Commandes enregistrées par `npm run deploy`, plus au démarrage. Prettier écarté (réécriture complète pour peu de gain).
- `npm audit` bloquant en CI (volontaire : projet orienté sécurité).
- Historique git non réécrit (pas de push forcé) : la vraie protection est de régénérer le token.

## À faire par Animeru
1. Régénérer le token sur le Developer Portal (S1), le mettre dans `.env`.
2. Tester sur un serveur de test : `npm run deploy -- --guild ID` puis `npm start`.
3. Dire si on commite le lot A et si on pousse la branche (la CI ne tournera qu'une fois poussée).

## Prochaine étape
Commiter le lot A, puis « fais le lot B » (warns en SQLite, logs, confirmation de ban).
