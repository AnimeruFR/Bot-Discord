# PROGRESS – Bot-Discord

## État des lots

| Lot | Contenu | État |
|---|---|---|
| Sécurité | Failles S1 à S19 (voir `AUDIT.md`) | ✅ Corrigé sur la branche `securite/durcissement`, **pas encore commité** |
| A – Robustesse | deploy séparé, `setContexts`, arrêt propre, ESLint + CI | ⏳ À faire |
| B – Modération persistante | warns en SQLite, logs, confirmation de ban | ⏳ À faire |
| C – Tickets | transcript, catégorie configurable | ⏳ À faire |

## Décisions prises
- Token et rôle staff dans `.env` (`process.loadEnvFile`, Node ≥ 20.12), plus de `config.js`.
- Intent `Guilds` uniquement, `allowedMentions` désactivé globalement.
- Tickets identifiés par le nom (`ticket-` / `ferme-`) + l'ID de l'auteur dans le sujet du salon.
- Historique git non réécrit (pas de push forcé) : la vraie protection est de régénérer le token.

## À faire par Animeru
1. Régénérer le token sur le Developer Portal (S1), le mettre dans `.env`.
2. Tester le bot sur un serveur de test (`npm start`).
3. Dire si on commite / pousse la branche.

## Prochaine étape
Valider la branche, puis « fais le lot A ».
