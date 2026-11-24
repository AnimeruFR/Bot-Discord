# Audit du Bot-Discord

*Audit du 24/11/2026, branche `securite/durcissement`.*

## 1. Failles de sécurité trouvées

| # | Gravité | Faille | Où | Statut |
|---|---|---|---|---|
| S1 | **Critique** | Un **vrai token du bot** est dans l'historique git (commit `5cb9440`, fichier `config.js`). Supprimer le fichier ensuite ne l'efface pas : n'importe qui peut le lire sur GitHub et prendre le contrôle du bot. | historique git | ⚠️ À faire par toi : régénérer le token |
| S2 | Haute | `/clear salon:#x` vérifiait la permission « Gérer les messages » seulement dans le salon courant : un modérateur pouvait vider un salon où il n'a pas ce droit, voire qu'il ne voit pas (salon staff). | `Commandes/clear.js` | ✅ Corrigé |
| S3 | Haute | `/ban` sautait la vérification de hiérarchie quand la cible n'était pas dans le cache : un modérateur pouvait bannir quelqu'un de plus gradé que lui. | `Commandes/ban.js` | ✅ Corrigé |
| S4 | Haute | Salon de ticket créé **visible par tout le monde**, puis verrouillé quelques requêtes plus tard (fenêtre de fuite). | `Events/interactionCreate.js` | ✅ Corrigé |
| S5 | Haute | Bouton « Créer un ticket » sans limite : un seul membre peut créer des centaines de salons (spam, limite de 500 salons atteinte, serveur bloqué). | `Events/interactionCreate.js` | ✅ 1 ticket ouvert par membre + anti double-clic |
| S6 | Moyenne | Bouton « Fermer » sans contrôle : il supprimait **le salon où il était cliqué** sans vérifier que c'était un ticket ni qui cliquait. | `Events/interactionCreate.js` | ✅ Réservé à l'auteur du ticket ou au staff |
| S7 | Moyenne | Aucune gestion d'erreur : la moindre erreur (membre parti, permission manquante, `parent` null…) laissait une promesse rejetée, et sur Node récent **le process s'arrête** (bot hors ligne). | partout | ✅ try/catch central + handlers globaux |
| S8 | Moyenne | Injection de mentions : une raison contenant `@everyone` ou `<@&role>` faisait pinger tout le serveur via le bot. | toutes les commandes | ✅ `allowedMentions` désactivé + markdown échappé |
| S9 | Moyenne | Tous les intents (`3276799`), y compris les privilégiés (contenu des messages, présences, membres), alors qu'aucun n'est utile. Principe du moindre privilège. | `main.js` | ✅ Seulement `Guilds` |
| S10 | Moyenne | ``require(`../Commandes/${interaction.commandName}`)`` : chemin construit à partir d'une donnée reçue. Exploitable seulement si les commandes enregistrées divergent du code, mais à proscrire. | `Events/interactionCreate.js` | ✅ `bot.commands.get()` |
| S11 | Moyenne | 7 vulnérabilités npm (dont 3 hautes dans `ws`) + paquet `fs` inutile (paquet « placeholder » de npm). | `package.json` | ✅ 0 vulnérabilité |
| S12 | Basse | ID du rôle staff écrit en dur dans le code (`1105190954710868070`). | tickets | ✅ Variable `TICKET_STAFF_ROLE_ID` |
| S13 | Basse | `package.json` sans `"private": true` (risque de publication accidentelle sur npm) et ignoré par `.gitignore` alors qu'il est suivi. | racine | ✅ Corrigé |
| S14 | Basse | Mute avec durée négative ou absurde (`-5m`) → erreur non gérée. | `Commandes/mute.js` | ✅ Durée validée (1 s à 28 j) |
| S15 | Haute | Les permissions d'une slash commande ne sont qu'une **valeur par défaut** modifiable par un admin (Paramètres > Intégrations) : un rôle sans « Bannir » à qui on ouvre `/ban` bannissait grâce aux droits du bot. | `Events/interactionCreate.js` | ✅ Permission revérifiée à chaque appel |
| S16 | Moyenne | L'auteur d'un ticket (ex. un arnaqueur signalé) pouvait supprimer le salon et donc les preuves. | tickets | ✅ L'auteur perd seulement l'accès, seul le staff supprime |
| S17 | Moyenne | Ouvrir/fermer des tickets en boucle ou en raid de comptes secondaires. | tickets | ✅ 10 min entre deux tickets, 50 ouverts max |
| S18 | Basse | Lien déguisé `[Faire appel](https://phishing…)` dans une raison, relayé en MP par le bot. | `Fonctions/moderation.js` | ✅ Liens déguisés échappés |
| S19 | Basse | `TICKET_STAFF_ROLE_ID` réglé sur @everyone ou un rôle d'intégration → tout le monde voit les tickets. | tickets | ✅ Refusé |
| S20 | Haute | Un membre pouvait ouvrir/fermer en boucle : les salons `ferme-` n'étaient pas comptés, la catégorie (50 salons) puis le serveur (500) se remplissaient. | tickets | ✅ Tickets fermés comptés, 1 par membre tant que le staff n'a pas supprimé |
| S21 | Moyenne | `/clear` dans un salon de ticket effaçait les preuves. | `Commandes/clear.js` | ✅ Refusé |

*Points S15 à S21 relevés par les deux tours de revue critique.*

Points de la revue **volontairement reportés** (ce sont des fonctionnalités, pas des failles) :
- Confirmation avant suppression d'un ticket + transcript → lot C. Le transcript demande l'intent privilégié `MessageContent`.
- Liens bruts dans les raisons relayées en MP : seuls les modérateurs écrivent les raisons, et ils sont de confiance. Lien déguisé et mentions sont déjà neutralisés.
- Cooldown de ticket perdu au redémarrage : il serait persisté avec la base SQLite du lot B.
- MP envoyé avant le kick/ban : c'est obligatoire. Après l'action, le bot ne partage plus de serveur avec la personne et le MP échoue.

### Ce que tu dois faire toi-même pour S1

1. [Discord Developer Portal](https://discord.com/developers/applications) > ton application > **Bot** > **Reset Token**. L'ancien token devient inutilisable immédiatement : c'est ce qui compte.
2. Mets le nouveau token dans `.env` (jamais dans le code).
3. (Optionnel) Nettoyer l'historique avec `git filter-repo` puis `git push --force`. Ça réécrit tout l'historique : à faire seulement si tu le décides, et ça ne sert à rien sans l'étape 1.

## 2. Améliorations (corrections de bugs et qualité)

Déjà faites dans ce lot (en plus de la sécurité) :
- `/ban` répondait « L'utilisateur n'existe pas » pour **toute** erreur, et répondait avant d'agir (double réponse si le ban échouait).
- `/clear` : en cas d'échec il supprimait jusqu'à 50 messages au lieu du nombre demandé. Il utilise maintenant `bulkDelete(n, true)`.
- Autocomplétion de `/help` : renvoyait des objets au lieu de noms et pouvait dépasser la limite de 25 choix de Discord.
- Le propriétaire du serveur ne pouvait pas modérer un membre plus haut que lui dans les rôles.
- Le token se lit dans `.env` (`process.loadEnvFile`), avec un message clair s'il manque.
- `ready` → `clientReady` (ancien nom déprécié), `ephemeral: true` → `flags` (API déprécié), `@discordjs/rest` retiré (inclus dans discord.js).
- README réécrit (il était encodé en UTF-16, illisible sur GitHub).
- `npm run check` : vérifie hors ligne les commandes et les fonctions de sécurité.

À faire, par lots (dis « fais le lot N ») :

**Lot A – Robustesse** ✅ fait
1. ✅ Slash commandes enregistrées par `npm run deploy` (option `--guild ID` pour tester, `--clear` pour retirer) au lieu de chaque démarrage.
2. ✅ `setDMPermission` (déprécié) remplacé par `setContexts` + `setIntegrationTypes`.
3. ✅ Arrêt propre (`SIGINT`/`SIGTERM` → `bot.destroy()`, arrêt forcé au bout de 5 s) et message clair si le token est invalide.
4. ✅ ESLint (`npm run lint`, règles anti-`eval`), `npm test`, CI GitHub Actions (Node 20 et 22, lint + check + `npm audit`, droits en lecture seule, sans secret) et Dependabot.
   Prettier écarté : il réécrirait tous les fichiers (guillemets mélangés) pour un gain faible.

**Lot B – Modération persistante**
5. `/warn` n'enregistre rien : stocker les avertissements (SQLite via `better-sqlite3`) + `/warns membre` et `/unwarn`.
6. Salon de logs de modération (qui a fait quoi, quand, pourquoi).
7. Confirmation par bouton avant un `/ban`.

**Lot C – Tickets**
8. Transcript du ticket (fichier .txt envoyé dans un salon de logs) avant suppression.
9. Catégorie de tickets configurable au lieu de « catégorie du salon où est le bouton ».
10. Le bouton « Créer un ticket » posté par `/ticket` devrait être un simple message, pas une réponse à la commande.

## 3. Suggestions (nouvelles fonctionnalités)

- Configuration par serveur (`/config`) : rôle staff, salon de logs, catégorie des tickets.
- Message de bienvenue / d'au revoir (demande l'intent `GuildMembers`, à n'activer que si utilisé).
- Rôles réactions par boutons (`/roles`).
- Anti-spam simple : timeout automatique au-delà de N messages en X secondes (via AutoMod de Discord plutôt que l'intent `MessageContent`).
- `/userinfo` et `/serverinfo`.
- Hébergement : Docker + `restart: unless-stopped`, token en secret Docker.
- Passer en TypeScript si le bot grossit.
