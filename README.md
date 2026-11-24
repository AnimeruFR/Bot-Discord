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
- **Sanctions automatiques** : un seuil se déclenche quand le membre atteint *exactement* ce nombre de warns, et seulement si le modérateur qui met le warn a lui-même le droit d'appliquer la sanction (un modérateur qui ne peut que warn ne fait jamais bannir quelqu'un). Un membre qui repasse par le seuil après un `/unwarn` est sanctionné à nouveau.
- **Ban temporaire** : le bot vérifie chaque minute les bans arrivés à échéance. S'il était éteint, il rattrape les débans en retard au démarrage. Si le membre a été débanni ou re-banni à la main entre-temps, le bot ne touche à rien.
- **Vie privée (RGPD)** : `/privacy` résume ce qui est conservé. Quand le bot quitte un serveur, ses données sont effacées 30 jours après (réinvitation par erreur possible sans perte). Un administrateur peut tout effacer tout de suite avec `/privacy supprimer:True`. Pages complètes : [docs/confidentialite.md](docs/confidentialite.md) et [docs/conditions.md](docs/conditions.md) (à compléter avant publication).

## Dev et prod

Utilise **deux applications Discord** (« Bot-Discord DEV » pour tester, et la vraie) avec deux tokens et deux bases séparées. Détails dans [ROADMAP.md](ROADMAP.md) §3.

| | Dev (ton PC) | Prod (serveur d'hébergement) |
|---|---|---|
| Fichier | `.env.dev` (copie de `.env.dev.example`) | `.env.prod` (copie de `.env.prod.example`, `chmod 600`) |
| Commandes | `npm run deploy:dev -- --guild ID_SERVEUR_TEST` | `npm run deploy:prod` |
| Lancement | `npm run dev` | `npm run prod` ou `docker compose up -d --build` |

`npm run dev` refuse de démarrer si `.env.dev` manque : il ne se rabat jamais sur un autre fichier, pour ne pas utiliser le token de prod par erreur.

### Docker (prod)
```
cp .env.prod.example .env.prod && chmod 600 .env.prod   # puis remplir le token
mkdir -p data backups && sudo chown 1000:1000 data backups
docker compose up -d --build
docker compose logs -f
```
L'image tourne sans root, avec un système de fichiers en lecture seule. Le `.env.prod` n'est jamais copié dedans. Docker redémarre le bot s'il plante et le marque « unhealthy » s'il perd la connexion à Discord.

### Sauvegardes
- Automatiques toutes les `BACKUP_INTERVAL_HOURS` heures (24 par défaut en prod) dans `backups/`, en gardant les `BACKUP_KEEP` dernières (7). Chaque sauvegarde est vérifiée avant d'être gardée. Au démarrage, une sauvegarde n'est faite que si la dernière est trop ancienne (un bot qui redémarre en boucle n'écrase donc pas les bonnes sauvegardes).
- Manuelle avec Docker : `docker compose exec bot node scripts/backup.js`. Sans Docker : `npm run backup -- --env=prod`. N'utilise pas `sudo npm run backup` sur une installation Docker : les fichiers créés appartiendraient à root et le bot ne pourrait plus ouvrir sa base.
- **Copie régulièrement `backups/` hors du serveur** (ton PC, un stockage en ligne) : une sauvegarde sur la même machine ne protège pas d'une panne de disque.
- Restauration : arrête le bot, remplace `data/bot.db` par la sauvegarde choisie, supprime `data/bot.db-wal` et `data/bot.db-shm` s'ils existent, relance.

## Vérification

- `npm test` lance le lint (ESLint) puis `npm run check`, qui vérifie sans se connecter à Discord que toutes les commandes se chargent, que leurs définitions sont valides et que les règles de sécurité tiennent.
- La CI GitHub Actions lance les mêmes vérifications et `npm audit` à chaque push sur `main` et à chaque pull request, puis construit l'image Docker et vérifie qu'elle tourne sans root et sans aucun secret. Elle ne demande aucun secret.
- Dependabot propose chaque semaine les mises à jour des dépendances.

## Commandes

| Commande | Permission requise | Rôle |
|---|---|---|
| `/help [commande]` | aucune | Liste des commandes |
| `/ping` | aucune | Latence du bot |
| `/quoi` | aucune | Répond « Feur » |
| `/ban`, `/unban` | Bannir des membres | Bannir (avec confirmation par bouton) / débannir |
| `/tempban membre duree raison` | Bannir des membres | Ban temporaire (1 min à 365 j), déban automatique même après un redémarrage |
| `/historique membre` | Exclure temporairement | Toutes les sanctions d'un membre (warns, mutes, kicks, bans, débans) |
| `/sanctions action …` | Gérer le serveur | Sanctions automatiques : « au 3e warn, mute 1 h », etc. (10 seuils max) |
| `/lock [salon]`, `/unlock [salon]` | Gérer les salons + Gérer les permissions | @everyone ne peut plus écrire ; `/unlock` remet les permissions d'avant |
| `/slowmode duree [salon]` | Gérer les salons | Mode lent (0 = désactivé, 6 h max) |
| `/automod action [valeur]` | Gérer le serveur | Règles AutoMod natives : mots interdits, invitations, mentions en masse, spam |
| `/kick` | Expulser des membres | Expulser |
| `/mute`, `/unmute` | Exclure temporairement | Timeout (28 j max) |
| `/warn` | Exclure temporairement | Avertir (enregistré en base + MP) |
| `/warns membre` | Exclure temporairement | Liste des avertissements d'un membre |
| `/unwarn numero` | Exclure temporairement | Retire un avertissement (pas les siens, ni ceux d'un supérieur) |
| `/setlogs [salon]` | Gérer le serveur | Salon des logs de modération (sans salon : désactive) |
| `/clear` | Gérer les messages | Supprimer 1 à 100 messages |
| `/ticket` | Gérer les messages | Poste le panneau de création de tickets |
| `/setticket [categorie] [staff] [reinitialiser]` | Gérer le serveur + les salons + les rôles | Catégorie et rôle staff des tickets |
| `/privacy [supprimer]` | aucune (suppression : administrateur) | Données conservées, effacement immédiat des données du serveur |
