# Bot-Discord

Bot Discord de modération (ban, kick, mute, warn, clear) et de tickets, en slash commandes.

## Installation

1. Crée une application sur le [Discord Developer Portal](https://discord.com/developers/applications), ajoute-lui un bot et récupère son token (*Bot > Reset Token*).
2. Invite le bot sur ton serveur avec les scopes `bot` et `applications.commands` et les permissions : Gérer les salons, Gérer les messages, Expulser, Bannir, Exclure temporairement des membres, Voir les salons, Envoyer des messages, Lire l'historique, **Joindre des fichiers**, **Intégrer des liens** (ces deux dernières sont nécessaires aux tickets).
   Le rôle du bot doit être placé **au-dessus** des rôles qu'il doit modérer.
3. Copie `.env.example` en `.env` et remplis-le :
   ```
   DISCORD_TOKEN=ton_token
   TICKET_STAFF_ROLE_ID=id_du_role_staff   (optionnel)
   ```
   Le fichier `.env` est ignoré par git : **ne mets jamais ton token dans le code**.
4. Installe, enregistre les slash commandes puis lance (Node.js 22.13 ou plus) :
   ```
   npm install
   npm run deploy
   npm start
   ```

## Slash commandes

Les commandes ne sont plus enregistrées à chaque démarrage. Relance `npm run deploy` seulement après avoir ajouté ou modifié une commande.

| Commande | Effet |
|---|---|
| `npm run deploy` | Enregistre les commandes sur tous les serveurs (peut prendre un moment à apparaître) |
| `npm run deploy -- --guild ID` | Enregistre sur un seul serveur, immédiatement (pratique pour tester) |
| `npm run deploy -- --guild ID --clear` | Retire les commandes de ce serveur (à faire après les tests, sinon elles apparaissent en double) |

## Tickets

1. `/setticket categorie:<catégorie> staff:<rôle>` (optionnel, demande Gérer le serveur + Gérer les salons + Gérer les rôles) : choisit où créer les tickets et quel rôle les gère. On ne peut choisir qu'un rôle inférieur au sien. Sans configuration, les tickets vont dans la catégorie du panneau et le rôle staff est `TICKET_STAFF_ROLE_ID` du `.env`. `/setticket` seul affiche la configuration, `reinitialiser:True` la remet par défaut.
2. `/ticket` poste dans le salon un panneau avec le bouton « Créer un ticket ».

Règles :
- **Un** ticket ouvert par membre, 10 min minimum entre deux, 50 tickets max par serveur.
- Le salon n'est visible que par son auteur, le bot, le rôle staff et les administrateurs. Sans rôle staff, seuls les administrateurs (et les membres avec « Gérer les salons ») voient les tickets.
- Quand l'auteur ferme son ticket, il perd seulement l'accès : le salon est renommé `ferme-…` et le staff garde l'historique.
- Quand le staff supprime un ticket, le bot demande une confirmation puis envoie un **transcript** (.txt, 1000 derniers messages, 7 Mo max) et une copie des **pièces jointes** (40 Mo max) dans le salon de logs (`/setlogs`) avant de supprimer. Si l'envoi échoue, le ticket n'est pas supprimé.
- Pour que le transcript contienne le texte des messages, active **Message Content Intent** dans le Developer Portal (*Bot > Privileged Gateway Intents*). Sans lui, le transcript garde les auteurs, les dates et les pièces jointes, mais pas le texte.

## Données et logs

- Les avertissements, le salon de logs de chaque serveur et le délai entre tickets sont stockés dans une base SQLite locale : `data/bot.db` (ignorée par git, à sauvegarder si tu héberges le bot). Elle utilise `node:sqlite`, intégré à Node : aucune dépendance native à compiler.
- `/setlogs #salon` envoie dans ce salon un résumé de chaque action de modération (qui, quoi, sur qui, pourquoi). Choisis un salon privé : le bot prévient s'il est visible par tout le monde.

## Vérification

- `npm test` lance le lint (ESLint) puis `npm run check`, qui vérifie sans se connecter à Discord que toutes les commandes se chargent, que leurs définitions sont valides et que les règles de sécurité tiennent.
- La CI GitHub Actions lance les mêmes vérifications et `npm audit` à chaque push sur `main` et à chaque pull request. Elle ne demande aucun secret.
- Dependabot propose chaque semaine les mises à jour des dépendances.

## Commandes

| Commande | Permission requise | Rôle |
|---|---|---|
| `/help [commande]` | aucune | Liste des commandes |
| `/ping` | aucune | Latence du bot |
| `/quoi` | aucune | Répond « Feur » |
| `/ban`, `/unban` | Bannir des membres | Bannir (avec confirmation par bouton) / débannir |
| `/kick` | Expulser des membres | Expulser |
| `/mute`, `/unmute` | Exclure temporairement | Timeout (28 j max) |
| `/warn` | Exclure temporairement | Avertir (enregistré en base + MP) |
| `/warns membre` | Exclure temporairement | Liste des avertissements d'un membre |
| `/unwarn numero` | Exclure temporairement | Retire un avertissement (pas les siens, ni ceux d'un supérieur) |
| `/setlogs [salon]` | Gérer le serveur | Salon des logs de modération (sans salon : désactive) |
| `/clear` | Gérer les messages | Supprimer 1 à 100 messages |
| `/ticket` | Gérer les messages | Poste le panneau de création de tickets |
| `/setticket [categorie] [staff] [reinitialiser]` | Gérer le serveur + les salons + les rôles | Catégorie et rôle staff des tickets |
