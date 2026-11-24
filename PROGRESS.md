# PROGRESS – Bot-Discord

## État des lots

| Lot | Contenu | État |
|---|---|---|
| Sécurité | Failles S2 à S21 (voir `AUDIT.md`) | ✅ Commité (`6561b6b`) |
| A – Robustesse | deploy séparé, `setContexts`, arrêt propre, ESLint + CI + Dependabot | ✅ Commité (`6e37ea6`) |
| B – Modération persistante | warns en SQLite, `/warns`, `/unwarn`, `/setlogs`, logs, confirmation de ban, délai des tickets en base | ✅ Commité (`d6a0341`) |
| C – Tickets | `/setticket`, panneau en message simple, confirmation + transcript + pièces jointes avant suppression | ✅ Fait, testé, **pas encore commité** |
| Suggestions | `/config`, bienvenue, rôles par boutons, anti-spam AutoMod, `/userinfo`, Docker, TypeScript (voir `AUDIT.md` §3) | ⏳ Au choix |

## Décisions prises
- Token et rôle staff dans `.env` (`process.loadEnvFile`, Node ≥ 20.12), plus de `config.js`.
- Intent `Guilds` uniquement, `allowedMentions` désactivé globalement.
- Tickets identifiés par le nom (`ticket-` / `ferme-`) + l'ID de l'auteur dans le sujet du salon.
- Commandes enregistrées par `npm run deploy`, plus au démarrage. Prettier écarté (réécriture complète pour peu de gain).
- Base `node:sqlite` (intégrée à Node, pas de dépendance native) dans `data/bot.db`, Node 22.13 minimum.
- Logs par serveur configurés en base (`/setlogs`) plutôt que dans `.env`.
- Catégorie et rôle staff des tickets par serveur en base (le `.env` reste un repli).
- Transcript : le texte des messages demande le Message Content Intent (réglage du Developer Portal, pas de changement de code).
- `npm audit` bloquant en CI (volontaire : projet orienté sécurité).
- Historique git non réécrit (pas de push forcé) : la vraie protection est de régénérer le token.

## À faire par Animeru
1. Régénérer le token sur le Developer Portal (S1), le mettre dans `.env`.
2. Tester sur un serveur de test : `npm run deploy -- --guild ID` puis `npm start` (relancer le deploy : 3 nouvelles commandes).
3. Activer le Message Content Intent si tu veux le texte dans les transcripts.
4. Dire si on commite le lot C et si on pousse la branche (la CI ne tournera qu'une fois poussée).

## Prochaine étape
Commiter le lot C. Les 3 lots prévus sont alors faits : il reste les suggestions (AUDIT.md §3), la fusion dans `main` et le push.
