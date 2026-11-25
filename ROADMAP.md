# Roadmap du Bot-Discord

*Rédigée le 24/11/2026, après les lots Sécurité, A, B et C (PR #1).*

Ce document sert de point de départ pour une **nouvelle conversation**. Il contient :
1. la liste des améliorations et des ajouts, notés sur l'utilité et le potentiel de revenu ;
2. le plan, découpé en lots applicables un par un ;
3. l'organisation d'un environnement de dev et de prod gratuit.

## Comment reprendre dans une autre conversation

Ouvre une session dans `C:\Users\pokem\Documents\bot-discord\repo` et écris par exemple :

> Lis `PROGRESS.md`, `ROADMAP.md` et `AUDIT.md`. Crée une branche à partir de `main` et fais le lot D. Même méthode que pour les lots précédents : tests, critique, puis tu me demandes avant de commiter.

Un lot à la fois, dans l'ordre conseillé ci-dessous. Chaque lot se termine par `npm test`, une revue critique et la mise à jour de `PROGRESS.md`.

---

## 1. Idées d'amélioration et d'ajout

Légende : **Utilité** ⭐ à ⭐⭐⭐ · **Revenu** 💰 à 💰💰💰 (si la fonction peut servir d'argument pour une offre premium) · **Effort** S / M / L

| # | Idée | Utilité | Revenu | Effort | Remarque |
|---|---|---|---|---|---|
| 1 | Variables d'environnement séparées dev / prod (`ENV_FILE`) | ⭐⭐⭐ | – | S | Prérequis de tout le reste |
| 2 | Docker + sauvegardes automatiques de la base | ⭐⭐⭐ | – | S | Indispensable en prod |
| 3 | RGPD : nettoyage des données quand le bot quitte un serveur, `/privacy`, durée de conservation | ⭐⭐⭐ | – | S | Obligatoire pour la vérification et la monétisation |
| 4 | Conditions d'utilisation + politique de confidentialité (pages web) | ⭐⭐ | 💰 | S | Exigées par Discord pour monétiser |
| 5 | **Système de « cas »** : toutes les sanctions en base, `/historique membre` | ⭐⭐⭐ | 💰💰 | M | Les warns existent déjà, à étendre aux ban/kick/mute |
| 6 | Ban temporaire avec déban automatique | ⭐⭐⭐ | 💰 | M | Tâche planifiée qui relit la base |
| 7 | Sanctions automatiques par seuil (3 warns → mute 1 h, etc.) | ⭐⭐ | 💰💰 | M | Configurable par serveur |
| 8 | `/lock`, `/unlock`, `/slowmode`, raisons prédéfinies en autocomplétion | ⭐⭐ | – | S | |
| 9 | Anti-raid : verrouillage automatique si trop d'arrivées | ⭐⭐ | 💰💰 | M | Demande l'intent `GuildMembers` (privilégié) |
| 10 | Intégration AutoMod de Discord (`/automod` : mots interdits, liens, spam) | ⭐⭐⭐ | 💰💰 | M | Utilise l'AutoMod natif, pas d'intent `MessageContent` |
| 11 | **Tickets par type** (menu déroulant + formulaire modal à l'ouverture) | ⭐⭐⭐ | 💰💰💰 | M | Fonction premium classique |
| 12 | Tickets : prise en charge (« claim »), ajout/retrait de membres, fermeture auto si inactif | ⭐⭐⭐ | 💰💰 | M | |
| 13 | Transcript **HTML** (mise en forme proche de Discord) en plus du .txt | ⭐⭐ | 💰💰💰 | M | Très apprécié, souvent payant chez les concurrents |
| 14 | Note de satisfaction après un ticket + statistiques du staff | ⭐⭐ | 💰💰 | M | |
| 15 | Bienvenue / au revoir avec image générée | ⭐⭐ | 💰 | M | Intent `GuildMembers` |
| 16 | Rôles par boutons / menus déroulants | ⭐⭐⭐ | 💰 | S | |
| 17 | Giveaways, sondages, annonces programmées | ⭐⭐ | 💰 | M | |
| 18 | `/config` unifiée (panneau interactif avec boutons) | ⭐⭐⭐ | 💰 | M | Remplace `/setlogs` et `/setticket` à terme |
| 19 | Bot en français et en anglais (traductions des commandes et des messages) | ⭐⭐ | 💰💰 | M | Multiplie l'audience possible |
| 20 | Embeds personnalisables (couleur, logo, textes des tickets) | ⭐⭐ | 💰💰💰 | S | Argument premium simple |
| 21 | Tableau de bord web (connexion avec Discord) | ⭐⭐⭐ | 💰💰💰 | L | Gros chantier, à faire en dernier |
| 22 | **Offre premium par serveur** (abonnement via les Premium Apps de Discord) | – | 💰💰💰 | M | Voir lot J et ses conditions |
| 23 | Référencement : top.gg, serveur de support, mini-site de documentation | ⭐ | 💰💰 | S | Nécessaire pour avoir des utilisateurs |
| 24 | TypeScript + tests `node:test` + logs structurés | ⭐⭐ | – | L | Quand le code grossit |

**Ce qui peut rapporter de l'argent**, de façon réaliste :
- un abonnement **premium par serveur** (n° 11, 13, 14, 20, 21) : les fonctions de base restent gratuites pour attirer des serveurs ;
- ou un **bot sur mesure** pour un serveur précis (communauté, e-sport, boutique), payé une fois.

Un bot ne rapporte qu'à partir de quelques centaines de serveurs : le référencement (n° 23) et la qualité comptent plus que le nombre de fonctions.

---

## 2. Plan par lots (dans l'ordre conseillé)

### Lot D – Socle dev/prod et conformité (idées 1 à 4) ✅ fait
- **But** : pouvoir faire tourner une version dev et une version prod sans risque, et être en règle.
- **Tâches** :
  1. Lire `ENV_FILE` dans `Fonctions/env.js` (`process.loadEnvFile(process.env.ENV_FILE ?? ".env")`), avec `.env.dev.example` et `.env.prod.example`, et des scripts `npm run dev` / `npm run prod`.
  2. `Dockerfile` (image `node:22-alpine`, utilisateur non-root, `npm ci --omit=dev`) et `docker-compose.yml` (volume pour `data/`, `restart: unless-stopped`, `.env` monté, jamais copié dans l'image).
  3. Sauvegarde de la base : script `scripts/backup.js` (sauvegarde SQLite à chaud vers `backups/`, garde les 7 dernières).
  4. Événement `guildDelete` : supprimer les données du serveur (warns, config, délais). Commande `/privacy` qui explique ce qui est stocké.
  5. Pages `docs/conditions.md` et `docs/confidentialite.md`, publiables avec GitHub Pages.
- **Critères d'acceptation** : `npm test` vert ; `docker compose up` démarre le bot ; une sauvegarde se restaure ; quand le bot quitte un serveur, ses données sont supprimées (test en base mémoire).

### Lot E – Modération avancée (idées 5 à 8, puis 10) ✅ fait
- **But** : un historique complet et des sanctions automatiques.
- **Tâches** :
  - table `cases` (type, cible, modérateur, raison, durée, date d'expiration) alimentée par toutes les commandes ;
  - `/historique membre` ;
  - `/tempban` avec une tâche périodique qui débannit à l'expiration, et qui reprend les débans en retard après un redémarrage ;
  - seuils de sanctions automatiques configurables ;
  - `/lock`, `/unlock`, `/slowmode` ;
  - `/automod` qui crée des règles AutoMod natives.
- **Points de vigilance** : la hiérarchie des rôles est revérifiée dans chaque commande ; les seuils ne doivent pas déclencher deux fois la même sanction ; si Discord refuse le déban (membre déjà débanni), on n'insiste pas.

### Lot F – Tickets pro (idées 11 à 14) ✅ fait
- **But** : rendre les tickets assez bons pour servir d'argument premium.
- **Tâches** :
  - types de tickets configurables (menu déroulant, catégorie et rôle staff par type) ;
  - formulaire (modal) rempli à l'ouverture ;
  - bouton « Prendre en charge » ;
  - `/ticket ajouter|retirer membre` ;
  - fermeture automatique après X jours d'inactivité ;
  - transcript HTML (contenu échappé contre le XSS : jamais de HTML brut venant des membres) ;
  - note de 1 à 5 en MP après la fermeture ;
  - `/stats tickets`.
- **Points de vigilance** : le transcript HTML est la seule partie à risque d'injection (échapper tout le texte, pas de script, pas d'image distante sans contrôle).

### Lot G – Engagement (idées 15 à 17) ✅ fait
- Rôles par boutons (en premier : pas d'intent privilégié), giveaways (tirage enregistré en base, qui survit au redémarrage), sondages, annonces programmées.
- Bienvenue / au revoir **seulement si tu acceptes l'intent `GuildMembers`**, qui se coche dans le Developer Portal et que Discord justifie à la vérification.

### Lot H – Configuration et langues (idées 18 à 20)
- `/config` interactive (boutons et menus) qui regroupe logs, tickets, sanctions et apparence.
- Traductions FR/EN : `setNameLocalizations` / `setDescriptionLocalizations` pour les commandes, un dictionnaire `locales/fr.json` et `locales/en.json` pour les messages, langue lue depuis `interaction.locale` ou depuis la config du serveur.
- Embeds personnalisables (couleur, texte du panneau de tickets).

### Lot I – Croissance (idée 23)
- Page top.gg, serveur de support, README « vitrine », lien d'invitation avec les permissions minimales.
- La **vérification** du bot se demande dans le Developer Portal quand il approche des 75 à 100 serveurs (obligatoire à 100 serveurs).

### Lot J – Monétisation (idée 22)
- **Prérequis Discord** (à revérifier dans la documentation officielle avant de commencer) :
  - application vérifiée et rattachée à une **équipe** dans le Developer Portal ;
  - liens vers les conditions d'utilisation et la politique de confidentialité ;
  - développeur dans un pays pris en charge (la France, membre de l'UE, en fait partie) ;
  - e-mail vérifié et 2FA pour tous les membres de l'équipe ;
  - acceptation des conditions de monétisation.
- **Prérequis légaux de ton côté** : un statut pour encaisser des revenus (micro-entreprise par exemple ; à vérifier avec ton statut d'alternant) et des conditions de vente.
- **Code** :
  - créer un SKU « abonnement serveur » dans le Developer Portal ;
  - lire les entitlements (`interaction.entitlements`) ;
  - fonction `isPremium(guildId)` avec un cache ;
  - bouton « Passer premium » sur les fonctions réservées ;
  - événements `entitlementCreate` / `entitlementDelete`.
- **Ne jamais rendre payante une fonction de sécurité de base** (modération, protection des tickets) : seulement le confort (types de tickets, transcript HTML, personnalisation, statistiques).
- **Alternative sans vérification** : Ko-fi ou Patreon avec un rôle « premium » sur ton serveur de support. C'est plus simple mais plus manuel.

### Lot K – Tableau de bord web (idée 21, en dernier)
- Petit site (Vue ou Angular, que tu connais déjà, ou Express) avec connexion Discord OAuth2, qui lit et écrit la même base que le bot (ou passe par une API interne).
- Sécurité :
  - vérifier côté serveur que l'utilisateur a « Gérer le serveur » sur le serveur qu'il configure (protection contre l'IDOR) ;
  - sessions en cookies `HttpOnly` + `Secure` + `SameSite` ;
  - protection CSRF ;
  - secret OAuth2 seulement dans `.env`.

---

## 3. Dev et prod gratuitement

### Principe : tout en double, sauf le code

| | Dev | Prod |
|---|---|---|
| Application Discord | « Bot-Discord **DEV** » (2e application dans le Developer Portal) | « Bot-Discord » |
| Token | `.env.dev` | `.env.prod` (seulement sur le serveur d'hébergement) |
| Serveur Discord | Un serveur privé de test (toi + un compte secondaire) | Les vrais serveurs |
| Commandes | `npm run deploy -- --guild ID_SERVEUR_DEV` (immédiat) | `npm run deploy` (global) |
| Base | `data/dev.db` | `data/bot.db` sur l'hébergement, sauvegardée chaque jour |
| Où ça tourne | Ton PC (`npm run dev`) | Un serveur allumé en permanence (voir ci-dessous) |
| Branche git | Branches de fonctionnalité | `main` (fusion seulement par PR avec la CI verte) |

Pourquoi deux applications Discord : si le token de dev fuit (capture d'écran, commit raté), la prod n'est pas touchée. Et les commandes de test n'apparaissent jamais aux vrais utilisateurs.

### Cycle de travail
1. Une branche par lot.
2. Tests sur ton PC avec le bot DEV, dans le serveur de test.
3. PR vers `main` : la CI doit être verte.
4. Fusion de la PR.
5. Sur l'hébergement : `git pull`, `npm ci --omit=dev`, `npm run deploy` (seulement si une commande a changé), redémarrage.
6. Un tag par version (`git tag v1.4.0`) pour revenir en arrière facilement.

L'automatisation du déploiement (GitHub Actions qui se connecte en SSH) pourra venir plus tard : elle demande de stocker une clé SSH dans les secrets GitHub, avec une clé dédiée aux droits limités.

### Où héberger la prod gratuitement

Les offres gratuites changent souvent : **vérifie toujours la page de tarifs officielle au moment de t'inscrire.**

| Option | Gratuit ? | Pour un bot 24/7 | Remarques |
|---|---|---|---|
| **Oracle Cloud Always Free** | Oui, sans limite de durée | ⭐⭐⭐ La meilleure option gratuite | Vraie VM Linux (tu sais faire, avec SSH et Docker). Carte bancaire demandée pour vérification. Oracle peut récupérer une instance jugée inactive : le bot tourne en permanence, mais garde des sauvegardes. |
| **GitHub Student Developer Pack** | Crédits gratuits pour étudiants | ⭐⭐⭐ | Tu es étudiant à CPE Lyon : le pack donne des crédits chez des hébergeurs (DigitalOcean, Azure for Students…), de quoi payer un petit VPS pendant longtemps. Vérifie les offres actuelles du pack. |
| **Ton PC ou un Raspberry Pi** | Oui (hors électricité) | ⭐⭐ | Parfait pour le dev. Pour la prod, le bot s'arrête quand la machine s'éteint. |
| Fly.io, Railway, Koyeb | Essai ou crédits limités, conditions qui changent | ⭐ | Les sources se contredisent sur ce qui reste gratuit. Railway fonctionne avec des crédits, pas une offre gratuite permanente. |
| Render, Replit (gratuits) | Oui mais mise en veille | ✗ | Un bot doit rester connecté en permanence : la mise en veille le coupe. |
| Hébergeurs « gratuits » spécialisés bots | Oui avec limites | ✗ pour la prod | Tu leur confies ton token : à éviter pour un bot qui modère de vrais serveurs. |

**Recommandation** :
- **dev** sur ton PC ;
- **prod** sur une VM Oracle Always Free (ou un VPS payé avec les crédits du Student Pack), avec Docker Compose (lot D).

### Sécurité du serveur de prod (checklist)
- Connexion SSH par clé uniquement (mot de passe désactivé), `fail2ban`, mises à jour automatiques (`unattended-upgrades`).
- Pare-feu : rien d'ouvert en entrée sauf SSH. Le bot n'a besoin d'aucun port entrant, il se connecte lui-même à Discord.
- `.env.prod` en `chmod 600`, jamais dans git ni dans l'image Docker.
- Le bot tourne avec un utilisateur non-root (dans le conteneur aussi).
- Sauvegarde quotidienne de `data/bot.db` copiée **hors de la VM** (ton PC, un stockage objet), avec un test de restauration de temps en temps.
- Dependabot + CI déjà en place : applique les mises à jour de sécurité rapidement.

### Sources (offres vérifiées le 24/11/2026, à reconfirmer)
- [Comparatif hébergement gratuit de bots 2026 (space-node)](https://space-node.net/blog/host-discord-bot-free-247-2026)
- [Free Discord Bot Hosting: The Honest 2026 Truth (hostingbuff)](https://hostingbuff.com/guides/free-discord-bot-hosting)
- [How to Host a Discord Bot 24/7 for Free (discordcraft)](https://discordcraft.com/blog/how-to-host-a-discord-bot-247-for-free-replit-railway-vps)
- [Discord – Enabling Monetization (documentation officielle)](https://docs.discord.com/developers/monetization/enabling-monetization)
- [Discord – Premium Apps : exigences de support pour la monétisation](https://support-dev.discord.com/hc/en-us/articles/23810643331735)
