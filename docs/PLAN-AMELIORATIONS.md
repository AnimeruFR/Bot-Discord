# Plan d'améliorations : bot tout-en-un (Modération + Communauté)

*Rédigé le 25/11/2026, à partir de `main` (`0681dbe`, lots Sécurité et A à K fusionnés). **Statut : en attente de validation, rien n'est codé.***

Ce plan fait passer le bot d'un outil de modération et de tickets à un bot « tout-en-un » en deux modules séparés :
- **Module A : Modération**, réservé au staff, sérieux et discret ;
- **Module B : Communauté**, ludique : économie, progression, jeux, collection, événements, et une offre premium non pay-to-win.

L'équilibrage économique est dans [ECONOMIE.md](ECONOMIE.md).

---

## 1. Point de départ

| Domaine | Existant | Conséquence pour le plan |
|---|---|---|
| Commandes | 33 fichiers à plat dans `Commandes/`, chacun avec `name`, `permission` (bigint ou `"Aucune"`), `category`, `options` | Il faut une arborescence par module (#86) et un champ `module` |
| Permissions | `setDefaultMemberPermissions` + revérification de `command.permission` dans `interactionCreate` (S15), `setContexts(Guild)` (remplace `setDMPermission`, déprécié) | Base saine ; manque une notion de **rôle staff** commune (#1) |
| Événements | 12 fichiers, liés par nom de fichier | Ajout de `messageCreate` (XP), `autoModerationActionExecution` et `guildMemberUpdate` |
| Intents | `Guilds`, `GuildModeration`, `GuildMembers` (privilégié) | Ajouter `GuildMessages` (XP) et `AutoModerationExecution` (#7), tous deux **non privilégiés**. On ne lit jamais le contenu : pas de Message Content Intent |
| Limites Discord à respecter | — | AutoMod : 6 règles de mots-clés par serveur, 1 000 mots-clés et 10 regex par règle, 20 rôles et 50 salons exemptés. Menus contextuels : 5 par type (message, utilisateur). Bulk ban : 200 membres, Bannir + Gérer le serveur |
| Base | `node:sqlite`, 16 tables créées par `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` conditionnels dans `Fonctions/db.js` (604 lignes) | Pas de version de schéma : migrations versionnées obligatoires avant l'économie (#88) |
| Routage des composants | Liste de `if (customId…)` dans `Events/interactionCreate.js` | Routeur par préfixe (#89) avant les jeux |
| Tests | `scripts/check.js` (1 073 lignes, `assert`, base en mémoire) via `npm test` | Découpage en `node:test` (#92) pour tester les jeux |
| i18n | FR/EN, un fichier par domaine dans `locales/<langue>/`, clé en double = erreur | Nouveaux domaines : `communaute`, `jeux`, `economie` |
| RGPD | Purge **par serveur** 30 jours après le départ, `/privacy supprimer` (admin) | Manque l'export et l'effacement **par membre** (#93), indispensable avec des soldes et inventaires |
| Premium | Abonnement serveur (SKU), `Fonctions/premium.js`, cache 10 min, modération jamais payante | Réutilisé pour le premium Communauté (#81) et le premium utilisateur (#80) |
| Exploitation | Docker non-root en lecture seule (volumes `data/`, `backups/`), sauvegardes `VACUUM INTO`, CI (lint, check, `npm audit`, build Docker), dashboard `node:http` | Toute nouvelle écriture reste dans `data/` ; aucune dépendance native |

Déjà prévu ou signalé et repris ici **avec une amélioration nette** : anti-raid (ROADMAP #9, jamais fait → #2, #3, #13), raisons prédéfinies (ROADMAP #8, partie jamais faite → #10), `/historique` (→ dossier unifié #9), `/automod` (→ préréglages et exemptions #6), giveaways (→ conditions d'entrée #74), premium serveur (→ volet Communauté #81), tests (ROADMAP #24 → #92), points reportés du tribunal du lot K (→ dashboard Communauté #98). Bienvenue avec image (ROADMAP #15) n'est pas reproposé.

## 2. Règles non négociables (rappel)

- **Séparation** : `Commandes/Moderation/`, `Commandes/Communaute/<Sous-module>/`, `Commandes/General/`. Toute commande de modération : `setDefaultMemberPermissions` + `setContexts(Guild)` + garde staff côté code (#1) + réponse éphémère + logs dans le salon staff uniquement. La garde s'applique aussi aux **boutons, menus et modals** du module (routeur #89). Un test prouve le refus d'un membre sans droit. Ce que les membres utilisent pour joindre le staff (signalement #22) est rangé dans `General/`.
- **Monnaie virtuelle** : aucune valeur réelle, jamais achetable, revendable ni convertible. Aucune loot box payante : les tirages de cartes (#60) se font **uniquement** avec la monnaie gagnée ou un tirage gratuit quotidien, et le premium ne donne **aucun** tirage. Les cartes de serveur et d'événement sont liées au compte (ni échangeables ni vendables).
- **Hasard et mises** : le casino (#70, #71) et **toute mise**, y compris dans les duels, passent par le module Casino : monnaie gagnée uniquement, désactivé par défaut, salons autorisés, mise et perte quotidienne plafonnées. Par défaut, les duels se jouent sans mise.
- **Premium** : seulement par les SKU et entitlements de Discord. Cosmétiques, confort, fonctions de serveur. **Aucun bonus d'XP ni de place d'inventaire**, rien qui compte dans un classement, une saison, un palier ou la monnaie. Jamais de monnaie ni de tirage. La modération et la sécurité ne sont jamais payantes ; seuls les conforts déjà décidés au lot J (statistiques, personnalisation des tickets) le restent.
- **Anti-triche** : cooldowns, plafond quotidien, journal des transactions, détection des transferts suspects, gel par le staff, pas de jeu pendant une sanction. **Toute valeur transférée** (`/payer`, échange, vente au marché, mise) compte dans les mêmes plafonds, et les comptes de moins de 7 jours sur le serveur ne peuvent pas en envoyer.
- **RGPD** : chaque nouvelle table personnelle est déclarée dans un registre (`Fonctions/privacy.js`) avec son traitement : **effacer**, **anonymiser** ou **conserver** (avec durée et motif). Elle apparaît dans `/privacy`, suit `/privacy moi` (#93) et la purge du serveur. Les effacements sont rejoués après toute restauration de sauvegarde.
- **Contenu** : cartes, créatures, mots, quiz et classes 100 % originaux ; noms de jeux génériques (« Aligne-4 », pas la marque).

## 3. Les 100 idées

Légende : **I** impact (1–5) · **E** effort (1–5) · **R** risque (1–5) · **💰** potentiel lucratif (0–3) · **🔁** potentiel viral / rétention (0–3) · ⚡ quick win · 🧱 fondation · ⭐ produit phare.

### Module A — Modération (staff uniquement) (25 idées)

| # | Titre | Mod. | Sous-catégorie | Description | Pourquoi ils vont l'aimer | I | E | R | 💰 | 🔁 | Dépend de | Fichiers / modules |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Garde staff centralisée ⚡🧱 | A | Permissions | Fonction `estStaff(membre)` (rôle staff configuré OU permission Discord de la commande) appelée par toutes les commandes de `Moderation/`, en plus de `setDefaultMemberPermissions` et `setContexts(Guild)`. Test : un membre sans droit est refusé. | Les admins ne peuvent plus ouvrir une commande staff par erreur dans Paramètres > Intégrations. | 5 | 2 | 1 | 0 | 0 | 86 | Fonctions/staff.js, Events/interactionCreate.js, Commandes/Moderation/* |
| 2 | Anti-raid avec verrouillage auto  | A | Anti-raid | Détecte une vague d'arrivées (N en X s, comptes récents) puis active le mode raid : niveau de vérification relevé, invitations suspendues, alerte staff, levée par bouton. Prévu au ROADMAP #9 mais jamais fait. | Le raid est la peur n°1 des admins ; c'est un argument d'installation. | 5 | 3 | 3 | 1 | 1 | 1, 24 | Events/guildMemberAdd.js, Fonctions/antiraid.js, migration raid_events |
| 3 | Filtre des comptes récents ⚡ | A | Anti-raid | Un compte de moins de X jours reçoit un rôle « en attente » (ou est expulsé, au choix), avec un log staff. Réglable dans `/config`. | Bloque la majorité des comptes jetables sans gêner les vrais membres. | 4 | 2 | 2 | 0 | 0 | 1 | Events/guildMemberAdd.js, Fonctions/antiraid.js |
| 4 | Vérification à l'arrivée (captcha boutons)  | A | Vérification | Bouton « Je ne suis pas un robot » qui ouvre un défi (choisir l'emoji demandé parmi 5 boutons mélangés, 3 essais), puis donne le rôle vérifié. Aucune image générée, aucune dépendance. | Remplace les bots de vérification séparés : un bot de moins à installer. | 5 | 3 | 2 | 1 | 1 | 1, 89 | Fonctions/verification.js, Commandes/Moderation/verification.js, migration verification_config |
| 5 | Anti-phishing (domaines malveillants)  | A | Anti-phishing | Règle AutoMod native alimentée par une liste locale de domaines d'arnaque (fichier versionné, mise à jour par PR), plus une liste blanche par serveur. Limites Discord : 6 règles de mots-clés par serveur, 1 000 mots-clés et 10 regex par règle ; on garde les domaines les plus fréquents et on prévient l'admin s'il n'y a plus de place. Aucun intent Message Content. | Les faux « Nitro gratuit » volent des comptes chaque semaine. | 4 | 3 | 2 | 1 | 0 | 6 | Fonctions/automod.js, data-statique/domaines-phishing.txt |
| 6 | AutoMod : préréglages et exemptions ⚡ | A | AutoMod | Amélioration de `/automod` : préréglages souple/normal/strict, regex, exemption de rôles et de salons (dont les salons de jeux, pour ne pas sanctionner les jeux), dans les limites de Discord (20 rôles et 50 salons exemptés par règle). | Configurer AutoMod natif est pénible ; un clic suffit. | 4 | 2 | 2 | 1 | 0 | — | Commandes/Moderation/automod.js, Fonctions/automod.js |
| 7 | AutoMod relié aux dossiers ⚡ | A | AutoMod | Écoute `autoModerationActionExecution` (intent `AutoModerationExecution`, non privilégié ; le bot doit avoir Gérer le serveur ; le contenu du message n'est pas fourni sans Message Content Intent, ce qui suffit ici) : chaque blocage crée une entrée dans `cases` et compte pour les seuils de sanctions automatiques. | Les récidivistes AutoMod finissent sanctionnés sans travail du staff. | 4 | 2 | 2 | 0 | 0 | 24 | Events/autoModerationActionExecution.js, Fonctions/sanctions.js |
| 8 | Notes staff sur un membre ⚡ | A | Dossiers | `/note ajouter\|liste\|retirer membre` : notes privées du staff, jamais montrées au membre, purgées avec l'historique. | Le staff garde le contexte (« déjà averti oralement ») au même endroit. | 4 | 1 | 1 | 0 | 0 | 1, 88 | Commandes/Moderation/note.js, migration staff_notes |
| 9 | Dossier membre unifié ⚡ | A | Dossiers | `/dossier membre` : sanctions, notes, tickets, âge du compte, ancienneté, état économie (ajouté dès que #35 existe), avec pagination par boutons. Remplace `/historique` en l'enrichissant. | Toute la décision de modération sur un seul écran. | 4 | 2 | 1 | 1 | 0 | 8 | Commandes/Moderation/dossier.js |
| 10 | Raisons prédéfinies en autocomplétion ⚡ | A | Confort | Raisons fréquentes configurables par serveur, proposées en autocomplétion dans ban, kick, mute, warn. Prévu au ROADMAP #8, jamais fait. | Sanctions plus rapides et raisons cohérentes. | 3 | 1 | 1 | 0 | 0 | — | Fonctions/raisons.js, Commandes/Moderation/* |
| 11 | Appels de sanction  | A | Appels | Bouton « Faire appel » dans le MP de sanction : formulaire (modal), envoyé dans un salon d'appels staff avec boutons Accepter / Refuser. Un appel par sanction, délai de 30 jours. | Transparence pour les membres, moins de MP agressifs au staff. | 4 | 3 | 2 | 1 | 1 | 9, 89 | Fonctions/appels.js, migration appeals |
| 12 | Modifier ou annuler une sanction ⚡ | A | Dossiers | `/case raison\|annuler numero` avec trace (qui, quand, ancienne valeur) dans les logs staff. | Corriger une erreur sans passer par la base de données. | 3 | 1 | 1 | 0 | 0 | 1 | Commandes/Moderation/case.js, Fonctions/db.js |
| 13 | Ban en masse anti-raid ⚡ | A | Anti-raid | `/massban` : liste d'IDs ou « arrivés depuis X min », aperçu, confirmation, ban groupé (API bulk ban : 200 max, le bot et le modérateur doivent avoir Bannir et Gérer le serveur). | Nettoyer un raid en 10 secondes au lieu de 10 minutes. | 4 | 2 | 3 | 0 | 0 | 2 | Commandes/Moderation/massban.js |
| 14 | Quarantaine  | A | Sanctions | `/quarantaine membre` : retire les rôles (sauvegardés en base), applique un rôle isolé, et les restaure à la levée. | Isoler un compte compromis sans le bannir. | 4 | 3 | 3 | 0 | 0 | 1, 88 | Commandes/Moderation/quarantaine.js, migration quarantines |
| 15 | Journal d'audit consultable ⚡ | A | Audit | `/journal` filtré par modérateur, type d'action, période : sanctions et changements de configuration du bot. | Contrôler un modérateur abusif, prouver ce qui s'est passé. | 3 | 2 | 1 | 1 | 0 | 24 | Commandes/Moderation/journal.js, migration config_audit |
| 16 | Statistiques de modération ⚡ | A | Statistiques | `/modstats` : actions par modérateur et par type sur 7/30 jours, délai de prise en charge des tickets. Premium pour l'historique long. | Les admins mesurent l'activité de leur équipe. | 3 | 2 | 1 | 2 | 0 | 15 | Commandes/Moderation/modstats.js |
| 17 | Rapport hebdomadaire staff ⚡ | A | Statistiques | Résumé automatique le lundi dans le salon de logs staff : sanctions, tickets, raids, AutoMod, appels. | Le staff voit les tendances sans rien taper. | 3 | 2 | 1 | 2 | 0 | 16 | Fonctions/rapportHebdo.js, Fonctions/programmes.js |
| 18 | Tickets : délai cible (SLA) ⚡ | A | Tickets | Délai de prise en charge cible par type ; au-delà, alerte au rôle staff puis relance. Affiché dans `/stats`. | Aucun ticket oublié. | 4 | 2 | 1 | 2 | 0 | — | Fonctions/tickets.js, Fonctions/ticketsInactifs.js |
| 19 | Tickets : formulaires personnalisés ⚡ | A | Tickets | Jusqu'à 5 champs (texte court/long, requis) définis par type de ticket, au lieu du formulaire fixe sujet + détails. | Le staff reçoit tout de suite les bonnes infos (pseudo en jeu, preuve…). | 4 | 2 | 1 | 3 | 0 | 88 | Commandes/Moderation/tickettype.js, Fonctions/tickets.js, migration ticket_fields |
| 20 | Tickets : réponses prédéfinies ⚡ | A | Tickets | `/reponse nom` (autocomplétion) : le staff poste une réponse enregistrée dans le ticket. | Gagne du temps sur les questions répétitives. | 3 | 1 | 1 | 1 | 0 | 88 | Commandes/Moderation/reponse.js, migration ticket_macros |
| 21 | Tickets : transfert et escalade ⚡ | A | Tickets | `/ticket transferer type\|staff` : change le type, la catégorie et le rôle staff d'un ticket ouvert, avec trace. | Un ticket mal classé n'oblige plus à en rouvrir un. | 3 | 2 | 2 | 1 | 0 | — | Fonctions/tickets.js, Commandes/Moderation/ticket.js |
| 22 | Signaler un message au staff ⚡ | A | Signalements | Menu contextuel « Signaler au staff » sur un message, ouvert à tous (rangé dans `General/`, réponse éphémère) : lien, auteur et raison (modal) envoyés au salon staff, avec boutons Warn / Mute / Ignorer réservés au staff (garde vérifiée par le routeur #89). Discord limite à 5 menus contextuels par type. | Les membres aident la modération sans pinger le staff en public. | 5 | 2 | 1 | 1 | 1 | 86, 89 | Commandes/General/signaler.js, Loader/loadSlashCommands.js (menus contextuels) |
| 23 | Menus contextuels staff ⚡ | A | Confort | Clic droit sur un membre : « Dossier », « Warn rapide », « Mute 10 min ». | Modérer depuis la liste des membres, sur mobile aussi. | 3 | 1 | 1 | 0 | 0 | 22 | Commandes/Moderation/ctx-*.js |
| 24 | Salons de logs séparés ⚡🧱 | A | Logs | Un salon par famille (sanctions, AutoMod, tickets, membres, économie). Les logs de jeux ne vont jamais dans le salon de modération. | Le spam de jeux ne noie plus les vraies alertes. | 4 | 2 | 1 | 0 | 0 | 88 | Fonctions/logs.js, Commandes/Moderation/setlogs.js, migration log_channels |
| 25 | Filtre de pseudos ⚡ | A | AutoMod | Renommage automatique des pseudos qui se mettent en haut de la liste (`!!!`), illisibles (zalgo) ou interdits, à l'arrivée et au changement. | Liste des membres propre, moins d'usurpation du staff. | 3 | 2 | 2 | 0 | 0 | 1 | Events/guildMemberUpdate.js, Fonctions/pseudos.js |

### Module B — Communauté (60 idées)

| # | Titre | Mod. | Sous-catégorie | Description | Pourquoi ils vont l'aimer | I | E | R | 💰 | 🔁 | Dépend de | Fichiers / modules |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 26 | Noyau économie (portefeuille + journal) 🧱 | B | Économie | Tables `eco_comptes` et `eco_journal`, fonction `crediter/debiter/transferer` dans une transaction `BEGIN IMMEDIATE`, nom et emoji de la monnaie par serveur. Monnaie par serveur, sans valeur réelle. | Base de toute la partie ludique. | 5 | 3 | 2 | 1 | 2 | 87, 88 | Fonctions/economie.js, migration eco_* |
| 27 | /daily avec série ⚡ | B | Économie | Récompense quotidienne, bonus de série plafonné à 10 jours, la série se perd après 48 h. | Raison simple de revenir chaque jour. | 4 | 1 | 1 | 1 | 3 | 26, 90 | Commandes/Communaute/Economie/daily.js |
| 28 | /travail et métiers ⚡ | B | Économie | 5 métiers originaux (forgeron, cartographe…), cooldown 1 h, gain selon le niveau du métier, petit texte aléatoire. | Progression longue et variée. | 4 | 2 | 1 | 0 | 2 | 26, 90 | Commandes/Communaute/Economie/travail.js, migration eco_metiers |
| 29 | Boutique du serveur  | B | Économie | `/boutique` : rôles (permanents ou temporaires), couleurs de pseudo, objets ; les admins fixent prix et stock. Un rôle avec une permission de modération ne peut jamais être vendu. | Les admins récompensent l'activité sans travail manuel. | 5 | 3 | 2 | 1 | 3 | 26, 30 | Commandes/Communaute/Economie/boutique.js, Fonctions/boutique.js, migration shop_items |
| 30 | Inventaire et objets ⚡🧱 | B | Économie | `/inventaire`, objets consommables (boost d'XP perso 1 h, ticket de tirage gratuit…), catalogue en JSON versionné. | Socle de la boutique, du craft et des cartes. | 4 | 2 | 1 | 0 | 2 | 26 | Fonctions/inventaire.js, data-statique/objets.json, migration inventaire |
| 31 | Échanges entre membres  | B | Économie | `/echange membre` : offre (objets, cartes, monnaie), double confirmation, verrou des objets pendant l'offre, expiration 2 min, frais de 5 %. La valeur échangée compte dans les plafonds de transfert ; échanges refusés aux comptes de moins de 7 jours sur le serveur. | Crée de l'interaction sociale autour de la collection. | 4 | 3 | 3 | 0 | 3 | 26, 30, 37 | Commandes/Communaute/Economie/echange.js |
| 32 | /payer ⚡ | B | Économie | Transfert simple avec frais de 2 %, plafond quotidien, refusé vers un compte de moins de 7 jours sur le serveur. | Entraide entre amis, sans ouvrir la porte au farm. | 3 | 1 | 2 | 0 | 1 | 26, 36 | Commandes/Communaute/Economie/payer.js |
| 33 | Classements du serveur ⚡ | B | Économie | `/classement monnaie\|niveau\|jeux\|cartes`, pagination par boutons, sa propre place toujours affichée. | Compétition = rétention. | 3 | 1 | 1 | 0 | 2 | 26, 39 | Commandes/Communaute/classement.js |
| 34 | Hôtel des ventes  | B | Économie | Mettre en vente objets et cartes à prix fixe ; taxe de 8 % à la vente et 2 % de dépôt (puits de monnaie), 10 annonces par membre, prix plancher par rareté, achats comptés dans les plafonds de transfert (sinon un compte secondaire « vend » une carte à 1 ✦). | Économie vivante entre joueurs. | 4 | 4 | 3 | 0 | 3 | 31 | Commandes/Communaute/Economie/marche.js, migration market |
| 35 | Journal économique et gel staff ⚡ | B | Anti-triche | `/eco journal\|geler\|degeler\|reinitialiser membre` (commande staff, éphémère, log staff) : historique des transactions, gel du compte, remise à zéro. | Le staff peut punir un tricheur sans toucher à la base. | 5 | 2 | 1 | 0 | 0 | 26, 1 | Commandes/Moderation/eco.js |
| 36 | Plafonds et cooldowns économiques ⚡🧱 | B | Anti-triche | Plafond quotidien de gains « actifs » par membre et par serveur, cooldowns centralisés, gains réduits pendant les 7 premiers jours sur le serveur. | Rend le farm et les comptes jetables inutiles. | 5 | 2 | 1 | 0 | 0 | 26, 90 | Fonctions/economie.js, Fonctions/cooldowns.js |
| 37 | Détection des transferts suspects  | B | Anti-triche | Heuristiques : transferts toujours dans le même sens, compte récent qui donne tout, gains anormaux par rapport à la médiane. Alerte dans le salon de logs économie, jamais de sanction automatique. | Repère les multi-comptes sans faux positif punitif. | 4 | 3 | 2 | 0 | 0 | 35 | Fonctions/antitriche.js |
| 38 | Sanctionné = pas de jeux ⚡ | B | Anti-triche | Un membre en timeout ou en quarantaine ne peut ni jouer, ni gagner d'XP, ni recevoir de récompense ; vérifié dans le moteur de parties et dans `crediter`. | Le lien attendu entre modération et communauté. | 4 | 1 | 1 | 0 | 0 | 26, 50 | Fonctions/economie.js, Fonctions/parties.js |
| 39 | XP et niveaux 🧱 | B | Progression | XP pour l'activité écrite (intent GuildMessages, non privilégié, sans lire le contenu), 1 gain par minute, salons exclus configurables. Courbe dans ECONOMIE.md. | Le système que tous les membres attendent. | 5 | 3 | 2 | 1 | 3 | 87, 88, 36 | Events/messageCreate.js, Fonctions/xp.js, main.js (intent), migration xp |
| 40 | Carte de rang en image  | B | Progression | `/rang` génère une image (SVG rendu en PNG par une bibliothèque WebAssembly, pas de dépendance native). Thèmes cosmétiques en premium. | Les membres la partagent : visibilité du bot. | 4 | 3 | 2 | 3 | 3 | 39 | Fonctions/carteRang.js, Commandes/Communaute/Niveaux/rang.js |
| 41 | Rôles par palier ⚡ | B | Progression | Rôles donnés aux niveaux choisis (cumulés ou remplacés), plus une récompense en monnaie. Mêmes protections que les rôles à boutons. | Les admins automatisent leurs grades. | 4 | 2 | 2 | 0 | 2 | 39 | Fonctions/paliers.js, migration xp_paliers |
| 42 | Saisons  | B | Progression | Classement XP et jeux remis à zéro chaque saison (1 à 3 mois), podium archivé, badge de saison. Le niveau global, lui, reste. | Les nouveaux ont une chance de gagner : rétention. | 4 | 3 | 2 | 0 | 3 | 39, 44 | Fonctions/saisons.js, migration saisons |
| 43 | Bonus d'XP du serveur ⚡ | B | Progression | Multiplicateurs par salon ou rôle (admin), week-ends double XP programmés. | Les admins animent un salon calme. | 3 | 1 | 1 | 0 | 2 | 39 | Fonctions/xp.js |
| 44 | Succès et badges 🧱 | B | Progression | ~40 succès déclenchés par un bus d'événements interne (`partie:gagnee`, `daily:serie`…), affichés sur le profil. | Objectifs à long terme, effet collection. | 4 | 3 | 1 | 1 | 3 | 26, 39 | Fonctions/evenements.js, Fonctions/succes.js, data-statique/succes.json |
| 45 | Quêtes du jour et de la semaine  | B | Progression | 3 quêtes tirées chaque jour (« gagne 2 duels », « fais ton daily ») et 1 quête hebdo, récompense fixe. | Guide le joueur vers tous les jeux. | 5 | 3 | 2 | 0 | 3 | 44, 26, 50 | Fonctions/quetes.js, Commandes/Communaute/quetes.js |
| 46 | Quiz par thèmes ⚡ | B | Mini-jeux solo | Banque de questions originales FR/EN en JSON (300 au départ), 4 boutons, 3 difficultés, cooldown. | Jeu le plus universel, facile à étendre. | 4 | 2 | 1 | 0 | 3 | 50 | Commandes/Communaute/Jeux/quiz.js, data-statique/quiz/*.json |
| 47 | Le Mot du jour ⚡ | B | Mini-jeux solo | Un mot de 5 lettres par jour, 6 essais par formulaire, grille emoji partageable sans dévoiler le mot, série. | Rituel quotidien, partage viral de la grille. | 4 | 2 | 1 | 0 | 3 | 50 | Commandes/Communaute/Jeux/mot.js, data-statique/mots-fr.txt |
| 48 | Énigme du jour ⚡ | B | Mini-jeux solo | Énigme publique quotidienne, réponse par formulaire, les 3 premiers gagnent plus. | Anime le salon général chaque jour. | 3 | 2 | 1 | 0 | 2 | 50 | Commandes/Communaute/Jeux/enigme.js |
| 49 | Pendu ⚡ | B | Mini-jeux solo | Pendu à boutons (lettres en menus), solo ou ouvert au salon. | Classique que tout le monde connaît. | 3 | 2 | 1 | 0 | 2 | 50 | Commandes/Communaute/Jeux/pendu.js |
| 50 | Moteur de parties 🧱 | B | Multijoueur | Module commun : une partie par joueur, timeout et boutons expirés, abandon, mises bloquées en séquestre puis rendues ou payées en une transaction, reprise propre après redémarrage. | Tous les jeux sont fiables d'un coup. | 5 | 3 | 2 | 0 | 1 | 26, 89, 90 | Fonctions/parties.js, migration parties |
| 51 | Duel pierre-feuille-ciseaux ⚡ | B | Multijoueur | Défi sans mise par défaut, choix en éphémère, meilleur des 3. Les mises n'existent que si le module Casino (#70) est activé, avec ses plafonds. | Le duel le plus rapide pour démarrer. | 3 | 1 | 1 | 0 | 2 | 50 | Commandes/Communaute/Jeux/pfc.js |
| 52 | Morpion ⚡ | B | Multijoueur | Grille 3×3 en boutons, tour par tour, timeout 60 s par coup. | Classique, aucune explication nécessaire. | 3 | 2 | 1 | 0 | 2 | 50 | Commandes/Communaute/Jeux/morpion.js |
| 53 | Aligne-4 ⚡ | B | Multijoueur | Grille 7×6 en emoji, colonnes en boutons, détection de victoire testée. | Plus stratégique que le morpion. | 4 | 2 | 1 | 0 | 3 | 50 | Commandes/Communaute/Jeux/aligne4.js |
| 54 | Bataille navale  | B | Multijoueur | Placement en éphémère, tirs par menus, grilles mises à jour en direct. | Partie longue, très engageante. | 4 | 4 | 2 | 0 | 3 | 50 | Commandes/Communaute/Jeux/navale.js |
| 55 | Course de réaction ⚡ | B | Multijoueur | Le bouton devient vert à un instant aléatoire : le premier clic gagne, clic trop tôt éliminé. | 30 secondes de fun à plusieurs. | 3 | 1 | 1 | 0 | 2 | 50 | Commandes/Communaute/Jeux/reaction.js |
| 56 | Loup-garou ⭐ | B | Multijoueur | Jeu à rôles (villageois, loups, voyante, sorcière…) pour 6 à 16 joueurs : rôles en éphémère, votes par menus, phases chronométrées, fil de discussion pour les loups. | Soirées entières sur le serveur : produit phare. | 5 | 5 | 3 | 1 | 3 | 50 | Commandes/Communaute/Jeux/loupgarou.js, Fonctions/loupgarou/* |
| 57 | L'Imposteur du mot ⭐ | B | Multijoueur | Tous reçoivent le même mot sauf l'imposteur (mot proche) ; chacun donne un indice à son tour, puis vote. 4 à 10 joueurs, parties de 5 min. | Jeu à rôles cachés court, idéal pour Discord. | 5 | 3 | 2 | 0 | 3 | 50 | Commandes/Communaute/Jeux/imposteur.js, data-statique/paires-mots.json |
| 58 | Quiz en équipes  | B | Multijoueur | Un animateur lance une soirée quiz, équipes par boutons, tableau des scores en direct, récompense à l'équipe. | Événement de serveur clé en main. | 4 | 3 | 2 | 0 | 3 | 46 | Commandes/Communaute/Jeux/soireequiz.js |
| 59 | Tournois  | B | Multijoueur | Inscription, arbre éliminatoire (8 à 64), matchs lancés sur les jeux de duel, vainqueur récompensé. Plus de tournois simultanés en premium serveur. | Moments forts qui fédèrent le serveur. | 4 | 4 | 2 | 2 | 3 | 50, 51, 52 | Commandes/Communaute/Jeux/tournoi.js, migration tournois |
| 60 | Cartes à collectionner originales 🧱⭐ | B | Collection | Set de départ de 120 cartes originales (créatures, lieux), 5 raretés, 1 tirage gratuit par jour, les autres achetés en monnaie gagnée. Collection propre à chaque serveur, comme la monnaie. Jamais d'achat de tirage avec de l'argent réel, ni de monnaie achetable. | Effet collection très fort : produit phare. | 5 | 4 | 2 | 0 | 3 | 26, 30 | Fonctions/cartes.js, data-statique/cartes/set1.json, Commandes/Communaute/Collection/* |
| 61 | Album et séries ⚡ | B | Collection | `/album` paginé, compléter une série donne un badge et une récompense. | Objectif clair pour les collectionneurs. | 4 | 2 | 1 | 0 | 3 | 60, 44 | Commandes/Communaute/Collection/album.js |
| 62 | Fusion de doublons ⚡ | B | Collection | 5 doublons + frais en monnaie = 1 carte de rareté supérieure au hasard. | Les doublons gardent une valeur ; puits de monnaie. | 3 | 2 | 1 | 0 | 2 | 60 | Commandes/Communaute/Collection/fusion.js |
| 63 | Cartes d'événement limitées ⚡ | B | Collection | Cartes disponibles seulement pendant un événement saisonnier, jamais rééditées, liées au compte (ni échangeables ni vendables). | Pic d'activité à chaque événement. | 3 | 2 | 1 | 0 | 3 | 60, 75 | data-statique/cartes/*.json, Fonctions/cartes.js |
| 64 | Set de cartes du serveur ⭐ | B | Collection | Les admins créent des cartes propres à leur serveur (nom, texte, emoji, rareté), filtrées et signalables : 5 gratuites, jusqu'à 30 avec le premium serveur (#81). Liées au compte, jamais échangeables ni vendables. | Aucun concurrent ne le fait : chaque serveur a sa collection. | 4 | 3 | 2 | 3 | 3 | 60 | Commandes/Communaute/Collection/setserveur.js, migration cartes_serveur |
| 65 | Personnage et classes  | B | Aventure | 3 classes originales, statistiques, emplacements d'équipement. | Base d'un RPG léger. | 3 | 3 | 2 | 0 | 2 | 26, 30 | Fonctions/rpg/personnage.js |
| 66 | Donjons au tour par tour  | B | Aventure | Expédition solo de 5 salles, choix par boutons, butin plafonné. | Contenu solo profond. | 4 | 4 | 2 | 0 | 3 | 65 | Commandes/Communaute/Aventure/donjon.js |
| 67 | Boss de serveur coopératif ⭐ | B | Aventure | Un boss par semaine avec des PV communs : chaque membre attaque une fois par heure (mini-défi : réaction, question), récompense selon la contribution, message de victoire collectif. | Tout le serveur joue ensemble : produit phare. | 5 | 3 | 2 | 0 | 3 | 26, 50, 44 | Commandes/Communaute/Aventure/boss.js, Fonctions/boss.js, migration boss |
| 68 | Fabrication (craft)  | B | Aventure | Recettes : matériaux gagnés en jouant → objets et cosmétiques. | Puits d'objets et de monnaie. | 3 | 3 | 2 | 0 | 2 | 30 | Fonctions/craft.js, data-statique/recettes.json |
| 69 | Familiers  | B | Aventure | Adopter un familier original, le nourrir (puits), 3 stades d'évolution, affiché sur le profil. Apparences en cosmétiques premium. | Attachement fort, rappel quotidien. | 4 | 3 | 1 | 2 | 3 | 30, 76 | Commandes/Communaute/Familier/*, migration familiers |
| 70 | Casino virtuel encadré ⚡ | B | Casino | Module désactivé par défaut : salons autorisés, mise max, perte max par jour, cooldown, message « monnaie virtuelle sans valeur ». | Cadre de conformité avant tout jeu de hasard. | 3 | 2 | 3 | 0 | 2 | 87, 26, 36 | Fonctions/casino.js |
| 71 | Pile ou face, machine à sous, blackjack ⚡ | B | Casino | Jeux de hasard en monnaie gagnée uniquement, avantage maison de 2 à 5 % (puits). | Demandé par beaucoup de serveurs. | 3 | 2 | 3 | 0 | 2 | 70, 50 | Commandes/Communaute/Casino/* |
| 72 | Drops dans le chat ⚡ | B | Événements | Un coffre apparaît au hasard dans un salon actif : le premier qui clique gagne. Fréquence liée à l'activité, salons choisis par les admins. | Surprise qui garde les membres dans le chat. | 4 | 2 | 2 | 0 | 3 | 26, 39 | Fonctions/drops.js |
| 73 | Objectif communautaire ⭐ | B | Événements | Objectif commun (« 50 000 messages », « vaincre 3 boss ») avec barre de progression ; à la fin, récompense pour tous les participants. | Le serveur entier avance ensemble. | 5 | 3 | 1 | 0 | 3 | 44, 39, 67 | Fonctions/objectifs.js, Commandes/Communaute/objectif.js |
| 74 | Giveaways avancés ⚡ | B | Événements | Conditions d'entrée (niveau minimum, rôle, ancienneté) et participations bonus par rôle choisi par l'admin (jamais par achat). Amélioration du `/giveaway` existant. | Récompense les membres actifs, pas les comptes jetables. | 4 | 2 | 1 | 1 | 2 | 39 | Fonctions/giveaways.js, Commandes/Communaute/giveaway.js |
| 75 | Événements saisonniers  | B | Événements | Halloween, Noël, nouvel an : thème, quêtes, objets et cartes limités, monnaie d'événement échangée contre des cosmétiques à la fin. | Pics d'activité réguliers dans l'année. | 4 | 3 | 1 | 1 | 3 | 26, 30, 45 | Fonctions/evenementsSaison.js, data-statique/saisons/*.json |
| 76 | Profil membre ⚡ | B | Social | `/profil` : bio, niveau, badges, carte favorite, familier, réputation ; thèmes cosmétiques. | Vitrine de tout ce que le membre a fait. | 5 | 2 | 1 | 3 | 3 | 26, 39, 44 | Commandes/Communaute/Social/profil.js, migration profils |
| 77 | Réputation ⚡ | B | Social | `/rep membre` une fois par jour, pas sur soi, pas depuis un compte de moins de 7 jours sur le serveur. | Valorise les membres serviables. | 3 | 1 | 2 | 0 | 2 | 36 | Commandes/Communaute/Social/rep.js |
| 78 | Anniversaires ⚡ | B | Social | Jour et mois seulement (jamais l'année), annonce et rôle du jour, effaçable à tout moment. | Moment chaleureux, sans donnée sensible. | 4 | 2 | 1 | 0 | 2 | 93 | Commandes/Communaute/Social/anniversaire.js, migration anniversaires |
| 79 | Confessions anonymes modérées  | B | Social | Confession envoyée dans une file staff, publiée anonymement seulement après validation ; l'auteur reste connu du staff 30 jours (abus), puis effacé. | Très populaire, mais sensible. | 3 | 3 | 4 | 0 | 3 | 1, 24, 93 | Commandes/Communaute/Social/confession.js |
| 80 | Premium utilisateur  | B | Monétisation | Abonnement par utilisateur (SKU Discord) : thèmes de profil et de carte de rang, badge premium, statistiques détaillées, rappels de daily. Aucun bonus d'XP, aucune place d'inventaire en plus, jamais de monnaie ni de tirage : rien qui pèse sur un classement. | Revenu récurrent qui suit le joueur sur tous ses serveurs. | 4 | 3 | 2 | 3 | 1 | 87, 76, 40 | Fonctions/premium.js, Commandes/premium.js |
| 81 | Premium serveur « Communauté » ⚡ | B | Monétisation | Extension de l'offre serveur existante : set de cartes du serveur, plus de tournois et giveaways simultanés, boutique plus grande, marque personnalisée (couleur des embeds de jeu, emoji de monnaie personnalisé ; le nom de la monnaie reste modifiable gratuitement). | Les admins paient pour leur communauté, pas pour gagner. | 4 | 2 | 2 | 3 | 1 | 87 | Fonctions/premium.js, docs/monetisation.md |
| 82 | Cosmétiques à l'unité ⚡ | B | Monétisation | SKU durables Discord (achat unique) : packs de thèmes de profil et de cartes de rang. Purement visuels, non échangeables. | Achat ponctuel sans abonnement. | 3 | 2 | 2 | 3 | 1 | 80 | Fonctions/cosmetiques.js |
| 83 | Parrainage du bot  | B | Croissance | Un admin qui fait installer le bot sur un autre serveur (actif depuis 14 jours, 50 membres réels) débloque un badge et un thème cosmétique. | Croissance par le bouche-à-oreille. | 3 | 3 | 3 | 1 | 3 | 88 | Commandes/Communaute/parrainage.js, Events/guildCreate.js |
| 84 | Récompenses de vote ⚡ | B | Croissance | Webhook top.gg reçu par le service dashboard (signature vérifiée) : un vote donne une petite récompense sur un seul serveur (choisi avec `/vote serveur`, sinon le dernier où le membre a joué), dans le plafond quotidien ; jamais multipliée par le nombre de serveurs. | Remonte le bot dans les listes. | 3 | 2 | 2 | 1 | 3 | 26 | dashboard/vote.js, Fonctions/economie.js |
| 85 | Classement inter-serveurs  | B | Croissance | Classement global facultatif (opt-in par serveur) des serveurs les plus actifs aux jeux, sans données personnelles. | Fierté de serveur, visibilité pour le bot. | 3 | 3 | 2 | 0 | 3 | 39, 50 | Commandes/Communaute/mondial.js |

### Module T — Technique, admin et fiabilité (15 idées)

| # | Titre | Mod. | Sous-catégorie | Description | Pourquoi ils vont l'aimer | I | E | R | 💰 | 🔁 | Dépend de | Fichiers / modules |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 86 | Loader par module ⚡🧱 | T | Architecture | Arborescence `Commandes/Moderation/`, `Commandes/Communaute/<Sous-module>/`, `Commandes/General/` ; le loader lit récursivement et attache `module`/`sousModule` à chaque commande ; menus contextuels pris en charge. | Base de toute la séparation demandée. | 5 | 2 | 2 | 0 | 0 | — | Loader/*, scripts/check.js, .github/workflows/ci.yml |
| 87 | /config modules ⚡🧱 | T | Configuration | Activer/désactiver chaque module et sous-module par serveur, restreindre les jeux à des salons ; vérifié au routage avant `run`. Admin uniquement. | Chaque serveur garde seulement ce qu'il veut. | 5 | 2 | 2 | 1 | 1 | 86, 88 | Commandes/General/config.js, Fonctions/modules.js, migration modules |
| 88 | Migrations versionnées ⚡🧱 | T | Base de données | Dossier `migrations/` (`NNN-nom.js` avec `up`/`down`), `PRAGMA user_version`, chaque migration dans une transaction, idempotente ; reprise des `ALTER TABLE` actuels en migration 001. | Les nouvelles tables arrivent sans casser les bases en prod. | 5 | 2 | 3 | 0 | 0 | — | Fonctions/db.js, migrations/*, scripts/migrate.js |
| 89 | Routeur de composants ⚡🧱 | T | Architecture | Chaque module déclare ses préfixes de `customId` (`jeu:`, `eco:`, `mod:`…) ; `interactionCreate` les route sans liste de `if`. Tout bouton, menu ou modal du module Modération passe par la garde staff (#1), comme les commandes. | Ajouter un jeu ne touche plus un fichier central ; aucun bouton staff contournable. | 4 | 2 | 2 | 0 | 0 | 86, 1 | Events/interactionCreate.js, Fonctions/routeur.js |
| 90 | Cooldowns déclaratifs ⚡🧱 | T | Fiabilité | `cooldown: 5` dans la définition d'une commande, par membre, en mémoire + base pour les longs (daily). | Anti-spam des jeux sans code répété. | 4 | 1 | 1 | 0 | 0 | 86 | Fonctions/cooldowns.js, Events/interactionCreate.js |
| 91 | Erreurs centralisées avec numéro d'incident ⚡ | T | Fiabilité | Chaque erreur reçoit un identifiant court montré au membre et écrit dans les logs ; classes d'erreurs « attendues » (message clair) et « bug ». | Support plus rapide (« erreur #A7F3 »). | 3 | 1 | 1 | 0 | 0 | — | Fonctions/erreurs.js, Events/interactionCreate.js |
| 92 | Tests node:test et couverture  | T | Qualité | Découper `scripts/check.js` (1 073 lignes) en fichiers `tests/*.test.js` lancés par `node --test`, couverture en CI, tests réutilisables pour les jeux. | Chaque jeu ajouté reste testé sans tout relire. | 4 | 3 | 1 | 0 | 0 | — | tests/*, package.json, .github/workflows/ci.yml |
| 93 | RGPD par membre ⚡ | T | Conformité | `/privacy moi` : export JSON et effacement. Registre déclaré par table : effacer (solde, XP, inventaire, profil, anniversaire), anonymiser (contrepartie dans le journal économique, les échanges et le marché), conserver avec durée et motif (sanctions, notes staff, appels, alertes de triche : 2 ans, intérêt légitime de modération). Effacement différé pendant un gel ou un séquestre en cours. Un test échoue si une colonne `*_id` de membre n'est pas déclarée. Sauvegardes sur 7 jours : délai indiqué dans la page de confidentialité. | Obligatoire dès qu'on stocke des données par membre. | 5 | 2 | 2 | 0 | 0 | 88 | Fonctions/privacy.js, Commandes/General/privacy.js, docs/confidentialite.md |
| 94 | /setup guidé  | T | Configuration | Assistant en 5 étapes à l'arrivée du bot : langue, salon de logs staff, rôle staff, modules, salons de jeux. | Un bot installé et configuré en 1 minute. | 4 | 3 | 1 | 1 | 2 | 87, 24 | Commandes/General/setup.js |
| 95 | /help par module, staff masqué ⚡ | T | Confort | `/help` groupé par module ; les commandes staff ne s'affichent qu'au staff et l'autocomplétion les filtre aussi. | Les membres ne voient que ce qu'ils peuvent utiliser. | 4 | 1 | 1 | 0 | 1 | 86, 1 | Commandes/General/help.js, Events/interactionCreate.js |
| 96 | Interrupteurs d'urgence ⚡ | T | Fiabilité | Variable `DESACTIVER=jeux.casino,eco.echange` (et table globale) pour couper une fonction en prod sans redéployer, en cas de faille de duplication. | Limite les dégâts d'un bug d'économie. | 3 | 1 | 1 | 0 | 0 | 87 | Fonctions/modules.js, Fonctions/env.js |
| 97 | Observabilité ⚡ | T | Exploitation | Logs JSON (niveau, module, incident), compteurs (commandes, erreurs, latence) exposés par le service dashboard sur une route protégée. | Voir un problème avant les utilisateurs. | 3 | 2 | 1 | 0 | 0 | 91 | Fonctions/journal.js, dashboard/metriques.js |
| 98 | Dashboard Communauté  | T | Dashboard | Pages du site existant : modules, boutique, paliers d'XP, salons de jeux, journal économique (lecture). | Configurer la boutique est bien plus simple sur un écran. | 4 | 4 | 2 | 2 | 1 | 87, 29, 41 | dashboard/pages.js, dashboard/actions.js |
| 99 | Sauvegardes hors serveur chiffrées ⚡ | T | Exploitation | Script qui chiffre la dernière sauvegarde et la copie vers un stockage externe (rclone ou S3 compatible), lancé par le cron de l'hôte. | Les soldes et collections des joueurs ne se perdent jamais. | 3 | 2 | 1 | 0 | 0 | — | scripts/backup-externe.js, README.md |
| 100 | Prêt pour le sharding  | T | Scale | Écritures SQLite regroupées (une file par processus, `busy_timeout`), état des parties en base, script `ShardingManager` testé en dev à 2 shards. | Tenir au-delà de 2 500 serveurs. | 3 | 4 | 3 | 0 | 0 | 50, 88 | main.js, shard.js, Fonctions/db.js |

## 4. Tri et priorisation

### 4.1 Score

`Score = (Impact × 2 + Potentiel lucratif + Potentiel viral) / (Effort + Risque × 0,5)`

**Ajustement par les dépendances** : une idée prend au minimum le score de la meilleure idée qui dépend d'elle (directement ou non). Un prérequis passe donc toujours avant ce qu'il débloque. Une ligne par ajustement :

- **#90 Cooldowns déclaratifs** : 5,33 → 8,00, prérequis de #27 /daily avec série.
- **#87 /config modules** : 4,00 → 8,00, prérequis de #27 /daily avec série.
- **#86 Loader par module** : 3,33 → 8,00, prérequis de #27 /daily avec série.
- **#26 Noyau économie (portefeuille + journal)** : 3,25 → 8,00, prérequis de #27 /daily avec série.
- **#88 Migrations versionnées** : 2,86 → 8,00, prérequis de #27 /daily avec série.
- **#36 Plafonds et cooldowns économiques** : 4,00 → 6,40, prérequis de #76 Profil membre.
- **#39 XP et niveaux** : 3,50 → 6,40, prérequis de #76 Profil membre.
- **#44 Succès et badges** : 3,43 → 6,40, prérequis de #76 Profil membre.
- **#1 Garde staff centralisée** : 4,00 → 6,00, prérequis de #95 /help par module, staff masqué.
- **#50 Moteur de parties** : 2,75 → 5,33, prérequis de #38 Sanctionné = pas de jeux.
- **#89 Routeur de composants** : 2,67 → 5,33, prérequis de #38 Sanctionné = pas de jeux.
- **#30 Inventaire et objets** : 4,00 → 4,40, prérequis de #61 Album et séries.
- **#60 Cartes à collectionner originales** : 2,60 → 4,40, prérequis de #61 Album et séries.
- **#93 RGPD par membre** : 3,33 → 4,00, prérequis de #78 Anniversaires.
- **#67 Boss de serveur coopératif** : 3,25 → 3,71, prérequis de #73 Objectif communautaire.
- **#75 Événements saisonniers** : 3,43 → 3,60, prérequis de #63 Cartes d'événement limitées.
- **#45 Quêtes du jour et de la semaine** : 3,25 → 3,60, prérequis de #63 Cartes d'événement limitées.
- **#80 Premium utilisateur** : 3,00 → 3,33, prérequis de #82 Cosmétiques à l'unité.
- **#15 Journal d'audit consultable** : 2,80 → 3,20, prérequis de #16 Statistiques de modération.
- **#37 Détection des transferts suspects** : 2,00 → 2,44, prérequis de #31 Échanges entre membres.
- **#65 Personnage et classes** : 2,00 → 2,20, prérequis de #66 Donjons au tour par tour.

Ajustements manuels (hors formule), une ligne chacun :
- **Casino (#70, #71)** placé en backlog malgré un score moyen : risque d'image et de conformité, et il n'apporte rien que les autres jeux n'apportent pas. À réactiver seulement si tu le confirmes.
- **Bataille navale (#54)** en backlog : effort de 4 pour un jeu que l'Aligne-4 couvre en partie.
- **RPG (#65, #66, #68)** en backlog : gros effort, et le boss coopératif (#67) donne l'essentiel de l'expérience « aventure » sans classes ni équipement.
- **Confessions (#79)** en backlog : risque de 4 (harcèlement, données sensibles) ; à faire seulement avec une file de modération éprouvée.
- **Carte de rang (#40)** gardée en phase 3 malgré un score moyen : c'est le support des cosmétiques premium (#80, #82).
- **Interrupteurs d'urgence (#96)** avancés en phase 0 : ils doivent exister **avant** la première ligne d'économie, pour couper une faille de duplication.
- **Set de cartes du serveur (#64)** en phase 4 sans attendre le premium : 5 cartes gratuites d'abord, la limite de 30 arrive avec #81 en phase 5.
- **Phase 5 (monétisation)** placée après les jeux : sans joueurs, le premium Communauté n'a rien à vendre.

### 4.2 Classement complet

| Rang | Rang brut | # | Titre | Mod. | Score | Score ajusté | Marques | Phase |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 27 | /daily avec série | B | 8,00 | = | ⚡ | 3 |
| 2 | 10 | 90 | Cooldowns déclaratifs | T | 5,33 | 8,00 | ⚡🧱 | 0 |
| 3 | 31 | 87 | /config modules | T | 4,00 | 8,00 | ⚡🧱 | 0 |
| 4 | 49 | 86 | Loader par module | T | 3,33 | 8,00 | ⚡🧱 | 0 |
| 5 | 51 | 26 | Noyau économie (portefeuille + journal) | B | 3,25 | 8,00 | 🧱 | 3 |
| 6 | 66 | 88 | Migrations versionnées | T | 2,86 | 8,00 | ⚡🧱 | 0 |
| 7 | 2 | 76 | Profil membre | B | 6,40 | = | ⚡ | 3 |
| 8 | 27 | 36 | Plafonds et cooldowns économiques | B | 4,00 | 6,40 | ⚡🧱 | 3 |
| 9 | 41 | 39 | XP et niveaux | B | 3,50 | 6,40 | 🧱 | 3 |
| 10 | 44 | 44 | Succès et badges | B | 3,43 | 6,40 | 🧱 | 3 |
| 11 | 3 | 95 | /help par module, staff masqué | T | 6,00 | = | ⚡ | 0 |
| 12 | 19 | 1 | Garde staff centralisée | A | 4,00 | 6,00 | ⚡🧱 | 0 |
| 13 | 4 | 8 | Notes staff sur un membre | A | 5,33 | = | ⚡ | 1 |
| 14 | 5 | 33 | Classements du serveur | B | 5,33 | = | ⚡ | 3 |
| 15 | 6 | 38 | Sanctionné = pas de jeux | B | 5,33 | = | ⚡ | 3 |
| 16 | 7 | 43 | Bonus d'XP du serveur | B | 5,33 | = | ⚡ | 3 |
| 17 | 8 | 51 | Duel pierre-feuille-ciseaux | B | 5,33 | = | ⚡ | 3 |
| 18 | 9 | 55 | Course de réaction | B | 5,33 | = | ⚡ | 3 |
| 19 | 69 | 50 | Moteur de parties | B | 2,75 | 5,33 | 🧱 | 3 |
| 20 | 74 | 89 | Routeur de composants | T | 2,67 | 5,33 | ⚡🧱 | 0 |
| 21 | 11 | 22 | Signaler un message au staff | A | 4,80 | = | ⚡ | 1 |
| 22 | 12 | 20 | Tickets : réponses prédéfinies | A | 4,67 | = | ⚡ | 1 |
| 23 | 13 | 19 | Tickets : formulaires personnalisés | A | 4,40 | = | ⚡ | 2 |
| 24 | 14 | 46 | Quiz par thèmes | B | 4,40 | = | ⚡ | 3 |
| 25 | 15 | 47 | Le Mot du jour | B | 4,40 | = | ⚡ | 3 |
| 26 | 16 | 53 | Aligne-4 | B | 4,40 | = | ⚡ | 4 |
| 27 | 17 | 61 | Album et séries | B | 4,40 | = | ⚡ | 4 |
| 28 | 18 | 74 | Giveaways avancés | B | 4,40 | = | ⚡ | 4 |
| 29 | 25 | 30 | Inventaire et objets | B | 4,00 | 4,40 | ⚡🧱 | 3 |
| 30 | 76 | 60 | Cartes à collectionner originales | B | 2,60 | 4,40 | 🧱⭐ | 4 |
| 31 | 20 | 10 | Raisons prédéfinies en autocomplétion | A | 4,00 | = | ⚡ | 1 |
| 32 | 21 | 12 | Modifier ou annuler une sanction | A | 4,00 | = | ⚡ | 1 |
| 33 | 22 | 18 | Tickets : délai cible (SLA) | A | 4,00 | = | ⚡ | 2 |
| 34 | 23 | 23 | Menus contextuels staff | A | 4,00 | = | ⚡ | 1 |
| 35 | 24 | 28 | /travail et métiers | B | 4,00 | = | ⚡ | 3 |
| 36 | 26 | 35 | Journal économique et gel staff | B | 4,00 | = | ⚡ | 3 |
| 37 | 28 | 77 | Réputation | B | 4,00 | = | ⚡ | 3 |
| 38 | 29 | 78 | Anniversaires | B | 4,00 | = | ⚡ | 3 |
| 39 | 30 | 81 | Premium serveur « Communauté » | B | 4,00 | = | ⚡ | 5 |
| 40 | 32 | 91 | Erreurs centralisées avec numéro d'incident | T | 4,00 | = | ⚡ | 0 |
| 41 | 33 | 96 | Interrupteurs d'urgence | T | 4,00 | = | ⚡ | 0 |
| 42 | 50 | 93 | RGPD par membre | T | 3,33 | 4,00 | ⚡ | 0 |
| 43 | 34 | 69 | Familiers | B | 3,71 | = |  | 6 |
| 44 | 35 | 73 | Objectif communautaire | B | 3,71 | = | ⭐ | 4 |
| 45 | 54 | 67 | Boss de serveur coopératif | B | 3,25 | 3,71 | ⭐ | 4 |
| 46 | 36 | 72 | Drops dans le chat | B | 3,67 | = | ⚡ | 3 |
| 47 | 37 | 9 | Dossier membre unifié | A | 3,60 | = | ⚡ | 2 |
| 48 | 38 | 63 | Cartes d'événement limitées | B | 3,60 | = | ⚡ | 6 |
| 49 | 45 | 75 | Événements saisonniers | B | 3,43 | 3,60 |  | 6 |
| 50 | 52 | 45 | Quêtes du jour et de la semaine | B | 3,25 | 3,60 |  | 3 |
| 51 | 39 | 29 | Boutique du serveur | B | 3,50 | = |  | 3 |
| 52 | 40 | 32 | /payer | B | 3,50 | = | ⚡ | 3 |
| 53 | 42 | 40 | Carte de rang en image | B | 3,50 | = |  | 3 |
| 54 | 43 | 64 | Set de cartes du serveur | B | 3,50 | = | ⭐ | 4 |
| 55 | 46 | 41 | Rôles par palier | B | 3,33 | = | ⚡ | 3 |
| 56 | 47 | 82 | Cosmétiques à l'unité | B | 3,33 | = | ⚡ | 5 |
| 57 | 48 | 84 | Récompenses de vote | B | 3,33 | = | ⚡ | 5 |
| 58 | 65 | 80 | Premium utilisateur | B | 3,00 | 3,33 |  | 5 |
| 59 | 53 | 57 | L'Imposteur du mot | B | 3,25 | = | ⭐ | 4 |
| 60 | 55 | 16 | Statistiques de modération | A | 3,20 | = | ⚡ | 2 |
| 61 | 56 | 17 | Rapport hebdomadaire staff | A | 3,20 | = | ⚡ | 2 |
| 62 | 57 | 24 | Salons de logs séparés | A | 3,20 | = | ⚡🧱 | 1 |
| 63 | 58 | 48 | Énigme du jour | B | 3,20 | = | ⚡ | 3 |
| 64 | 59 | 49 | Pendu | B | 3,20 | = | ⚡ | 3 |
| 65 | 60 | 52 | Morpion | B | 3,20 | = | ⚡ | 3 |
| 66 | 61 | 62 | Fusion de doublons | B | 3,20 | = | ⚡ | 4 |
| 67 | 67 | 15 | Journal d'audit consultable | A | 2,80 | 3,20 | ⚡ | 2 |
| 68 | 62 | 94 | /setup guidé | T | 3,14 | = |  | 1 |
| 69 | 63 | 4 | Vérification à l'arrivée (captcha boutons) | A | 3,00 | = |  | 2 |
| 70 | 64 | 6 | AutoMod : préréglages et exemptions | A | 3,00 | = | ⚡ | 1 |
| 71 | 68 | 42 | Saisons | B | 2,75 | = |  | 6 |
| 72 | 70 | 58 | Quiz en équipes | B | 2,75 | = |  | 4 |
| 73 | 71 | 2 | Anti-raid avec verrouillage auto | A | 2,67 | = |  | 2 |
| 74 | 72 | 3 | Filtre des comptes récents | A | 2,67 | = | ⚡ | 1 |
| 75 | 73 | 7 | AutoMod relié aux dossiers | A | 2,67 | = | ⚡ | 1 |
| 76 | 75 | 59 | Tournois | B | 2,60 | = |  | 4 |
| 77 | 77 | 11 | Appels de sanction | A | 2,50 | = |  | 2 |
| 78 | 78 | 31 | Échanges entre membres | B | 2,44 | = |  | 4 |
| 79 | 95 | 37 | Détection des transferts suspects | B | 2,00 | 2,44 |  | 4 |
| 80 | 79 | 97 | Observabilité | T | 2,40 | = | ⚡ | 6 |
| 81 | 80 | 99 | Sauvegardes hors serveur chiffrées | T | 2,40 | = | ⚡ | 6 |
| 82 | 81 | 21 | Tickets : transfert et escalade | A | 2,33 | = | ⚡ | 2 |
| 83 | 82 | 13 | Ban en masse anti-raid | A | 2,29 | = | ⚡ | 2 |
| 84 | 83 | 70 | Casino virtuel encadré | B | 2,29 | = | ⚡ | Backlog |
| 85 | 84 | 71 | Pile ou face, machine à sous, blackjack | B | 2,29 | = | ⚡ | Backlog |
| 86 | 85 | 92 | Tests node:test et couverture | T | 2,29 | = |  | 0 |
| 87 | 86 | 5 | Anti-phishing (domaines malveillants) | A | 2,25 | = |  | 2 |
| 88 | 87 | 85 | Classement inter-serveurs | B | 2,25 | = |  | 6 |
| 89 | 88 | 83 | Parrainage du bot | B | 2,22 | = |  | 5 |
| 90 | 89 | 54 | Bataille navale | B | 2,20 | = |  | Backlog |
| 91 | 90 | 66 | Donjons au tour par tour | B | 2,20 | = |  | Backlog |
| 92 | 91 | 98 | Dashboard Communauté | T | 2,20 | = |  | 6 |
| 93 | 96 | 65 | Personnage et classes | B | 2,00 | 2,20 |  | Backlog |
| 94 | 92 | 56 | Loup-garou | B | 2,15 | = | ⭐ | 4 |
| 95 | 93 | 25 | Filtre de pseudos | A | 2,00 | = | ⚡ | 2 |
| 96 | 94 | 34 | Hôtel des ventes | B | 2,00 | = |  | 6 |
| 97 | 97 | 68 | Fabrication (craft) | B | 2,00 | = |  | Backlog |
| 98 | 98 | 79 | Confessions anonymes modérées | B | 1,80 | = |  | Backlog |
| 99 | 99 | 14 | Quarantaine | A | 1,78 | = |  | 2 |
| 100 | 100 | 100 | Prêt pour le sharding | T | 1,09 | = |  | 6 |

### 4.3 Quick wins (Impact ≥ 3 et Effort ≤ 2)

#27 /daily avec série · #90 Cooldowns déclaratifs · #87 /config modules · #86 Loader par module · #88 Migrations versionnées · #76 Profil membre · #36 Plafonds et cooldowns économiques · #95 /help par module, staff masqué · #1 Garde staff centralisée · #8 Notes staff sur un membre · #33 Classements du serveur · #38 Sanctionné = pas de jeux · #43 Bonus d'XP du serveur · #51 Duel pierre-feuille-ciseaux · #55 Course de réaction · #89 Routeur de composants · #22 Signaler un message au staff · #20 Tickets : réponses prédéfinies · #19 Tickets : formulaires personnalisés · #46 Quiz par thèmes · #47 Le Mot du jour · #53 Aligne-4 · #61 Album et séries · #74 Giveaways avancés · #30 Inventaire et objets · #10 Raisons prédéfinies en autocomplétion · #12 Modifier ou annuler une sanction · #18 Tickets : délai cible (SLA) · #23 Menus contextuels staff · #28 /travail et métiers · #35 Journal économique et gel staff · #77 Réputation · #78 Anniversaires · #81 Premium serveur « Communauté » · #91 Erreurs centralisées avec numéro d'incident · #96 Interrupteurs d'urgence · #93 RGPD par membre · #72 Drops dans le chat · #9 Dossier membre unifié · #63 Cartes d'événement limitées · #32 /payer · #41 Rôles par palier · #82 Cosmétiques à l'unité · #84 Récompenses de vote · #16 Statistiques de modération · #17 Rapport hebdomadaire staff · #24 Salons de logs séparés · #48 Énigme du jour · #49 Pendu · #52 Morpion · #62 Fusion de doublons · #15 Journal d'audit consultable · #6 AutoMod : préréglages et exemptions · #3 Filtre des comptes récents · #7 AutoMod relié aux dossiers · #97 Observabilité · #99 Sauvegardes hors serveur chiffrées · #21 Tickets : transfert et escalade · #13 Ban en masse anti-raid · #70 Casino virtuel encadré · #71 Pile ou face, machine à sous, blackjack · #25 Filtre de pseudos

Beaucoup d'idées passent le seuil parce que l'effort reste petit **une fois les fondations en place**. La phase 1 ne garde que celles qui n'en dépendent pas (surtout côté modération).

### 4.4 Fondations (au moins 3 idées en dépendent)

#90 Cooldowns déclaratifs (4 dépendants) · #87 /config modules (8 dépendants) · #86 Loader par module (6 dépendants) · #26 Noyau économie (portefeuille + journal) (21 dépendants) · #88 Migrations versionnées (11 dépendants) · #36 Plafonds et cooldowns économiques (4 dépendants) · #39 XP et niveaux (11 dépendants) · #44 Succès et badges (6 dépendants) · #1 Garde staff centralisée (11 dépendants) · #50 Moteur de parties (18 dépendants) · #89 Routeur de composants (4 dépendants) · #30 Inventaire et objets (7 dépendants) · #60 Cartes à collectionner originales (4 dépendants) · #24 Salons de logs séparés (5 dépendants)

À ajouter aux fondations, bien qu'elles aient moins de 3 dépendants directs : #91 erreurs centralisées, #92 tests `node:test`, #93 RGPD par membre (exigé par chaque table personnelle).

### 4.5 Produits phares (module B)

Ce qui peut faire choisir ce bot plutôt qu'un concurrent :

1. **Boss de serveur coopératif (#67)** : tout le serveur se bat ensemble contre un boss hebdomadaire. C'est rare chez les bots généralistes, et ça crée un rendez-vous.
2. **Cartes originales + set du serveur (#60, #64)** : une collection gratuite, et surtout la possibilité pour chaque serveur de créer **ses propres cartes**. Différenciant, et naturellement premium serveur, sans toucher à la monnaie.
3. **Loup-garou (#56)** : les soirées de jeu de groupe font installer un bot. Tout se fait en boutons et en messages éphémères, sans salon vocal.
4. **L'Imposteur du mot (#57)** : un jeu à rôles cachés de 5 minutes, simple à lancer et très partageable.
5. **Objectif communautaire (#73)** : une barre de progression collective qui transforme l'activité normale du serveur en jeu.

---

## 5. Plan de réalisation

Estimation : E1 = ½ jour, E2 = 1 jour, E3 = 2,5 jours, E4 = 5 jours, E5 = 10 jours (jours de dev effectif, tests compris).

### Phase 0 : Fondations

- **Objectif** : séparer les modules, verrouiller le staff, versionner la base, préparer les tests et le RGPD par membre. Aucun changement visible pour les membres, sauf `/help` et `/config modules`.
- **Idées** : #1 Garde staff centralisée · #86 Loader par module · #87 /config modules · #88 Migrations versionnées · #89 Routeur de composants · #90 Cooldowns déclaratifs · #91 Erreurs centralisées avec numéro d'incident · #92 Tests node:test et couverture · #93 RGPD par membre · #95 /help par module, staff masqué · #96 Interrupteurs d'urgence

*11 idées, effort cumulé estimé ≈ 10,5 jours de dev.*
- **Critères d'acceptation** :
  - toutes les commandes existantes sont rangées dans `Moderation/`, `Communaute/` ou `General/`, et `npm run check` vérifie que chaque commande de `Moderation/` a une permission bigint et passe par la garde staff ;
  - un test `node:test` prouve qu'un membre sans permission ni rôle staff est refusé, pour **chaque** commande de modération ;
  - `/config modules` désactive un module : ses commandes répondent « module désactivé » (éphémère) et `/help` ne les montre plus ;
  - une copie de la base de prod actuelle migre jusqu'à la dernière version sans perte, rejouer les migrations ne change rien (idempotentes), et chaque `down` est testé ;
  - aucun bouton ni modal du module Modération ne fonctionne pour un non-staff (test sur le routeur) ;
  - `/privacy moi` exporte et efface selon le registre ; un test échoue si une colonne d'identifiant de membre (`user_id`, `author_id`, `target_id`, `moderator_id`…) appartient à une table non déclarée ;
  - l'interrupteur d'urgence (#96) coupe une fonction sans redéploiement ;
  - CI verte (Node 22 et 24, `npm audit`, image Docker qui charge toutes les commandes, y compris dans les sous-dossiers).
- **Risques** : régression du chargement (sous-dossiers oubliés par le `.dockerignore`, déjà arrivé au lot H bis) ; migration ratée en prod → sauvegarde vérifiée automatique avant toute migration.
- **Migrations** : `001-schema-initial` (reprise de l'existant), `002-modules` (`guild_modules`), `003-staff` (`guild_config.staff_role_id`).

### Phase 1 : Quick wins

- **Objectif** : gains rapides et visibles pour le staff, plus l'assistant d'installation.
- **Idées** : #3 Filtre des comptes récents · #6 AutoMod : préréglages et exemptions · #7 AutoMod relié aux dossiers · #8 Notes staff sur un membre · #10 Raisons prédéfinies en autocomplétion · #12 Modifier ou annuler une sanction · #20 Tickets : réponses prédéfinies · #22 Signaler un message au staff · #23 Menus contextuels staff · #24 Salons de logs séparés · #94 /setup guidé

*11 idées, effort cumulé estimé ≈ 10 jours de dev.*
- **Critères d'acceptation** : chaque commande staff a son test de refus ; le signalement répond en éphémère et ses boutons d'action refusent un non-staff ; au plus 5 menus contextuels par type ; les logs de jeux vont dans leur propre salon ; `/setup` refait de zéro configure un serveur de test en moins de 2 minutes.
- **Risques** : menus contextuels (#22, #23) : nouvelle forme de commande à gérer dans le déploiement ; filtre des comptes récents : faux positifs (action par défaut = rôle « en attente », pas l'expulsion).
- **Migrations** : `staff_notes`, `ticket_macros`, `log_channels`, `cases_edits`.

### Phase 2 : Modération avancée

- **Objectif** : un module A au niveau des meilleurs bots de modération : anti-raid, vérification, appels, statistiques.
- **Idées** : #2 Anti-raid avec verrouillage auto · #4 Vérification à l'arrivée (captcha boutons) · #5 Anti-phishing (domaines malveillants) · #9 Dossier membre unifié · #11 Appels de sanction · #13 Ban en masse anti-raid · #14 Quarantaine · #15 Journal d'audit consultable · #16 Statistiques de modération · #17 Rapport hebdomadaire staff · #18 Tickets : délai cible (SLA) · #19 Tickets : formulaires personnalisés · #21 Tickets : transfert et escalade · #25 Filtre de pseudos

*14 idées, effort cumulé estimé ≈ 21,5 jours de dev.*
- **Critères d'acceptation** : raid simulé (script dev qui génère des arrivées factices dans les tests) → mode raid en moins de 5 s et levée par bouton ; vérification : 3 échecs = pas de rôle, aucun contournement par double clic ; un appel ne peut être déposé qu'une fois par sanction ; `/massban` exige une confirmation et respecte la hiérarchie.
- **Risques** : mode raid déclenché à tort pendant un événement (seuils réglables, mode « alerte seulement ») ; quarantaine qui perd les rôles en cas de crash (rôles sauvegardés **avant** le retrait).
- **Migrations** : `raid_events`, `verification_config`, `appeals`, `quarantines`, `config_audit`, `ticket_fields`.

### Phase 3 : Cœur ludique

- **Objectif** : économie, XP, profil, premiers jeux, boutique. Le module B devient utilisable.
- **Idées** : #26 Noyau économie (portefeuille + journal) · #27 /daily avec série · #28 /travail et métiers · #29 Boutique du serveur · #30 Inventaire et objets · #32 /payer · #33 Classements du serveur · #35 Journal économique et gel staff · #36 Plafonds et cooldowns économiques · #38 Sanctionné = pas de jeux · #39 XP et niveaux · #40 Carte de rang en image · #41 Rôles par palier · #43 Bonus d'XP du serveur · #44 Succès et badges · #45 Quêtes du jour et de la semaine · #46 Quiz par thèmes · #47 Le Mot du jour · #48 Énigme du jour · #49 Pendu · #50 Moteur de parties · #51 Duel pierre-feuille-ciseaux · #52 Morpion · #55 Course de réaction · #72 Drops dans le chat · #76 Profil membre · #77 Réputation · #78 Anniversaires

*28 idées, effort cumulé estimé ≈ 34,5 jours de dev.*
- **Critères d'acceptation** :
  - test de **double dépense** : 50 achats simultanés avec un solde pour 1 seul → 1 succès, 49 refus, solde jamais négatif ;
  - toute variation de solde a sa ligne dans `eco_journal` (somme du journal = solde, vérifiée par un test) ;
  - un membre en timeout ne gagne ni XP ni monnaie et ne peut pas lancer de partie ;
  - boutons d'une partie expirée : réponse « partie terminée » ; abandon = défaite ; aucune mise possible tant que le module Casino est désactivé ;
  - un compte secondaire ne peut pas dépasser les plafonds de transfert en passant par un échange ou une vente (test) ;
  - un rôle avec une permission de modération ne peut pas être mis en boutique ;
  - gains d'un joueur simulé « très actif » sur 30 jours dans la fourchette d'[ECONOMIE.md](ECONOMIE.md).
- **Risques** : inflation (plafonds et puits dès le départ) ; charge en écriture de l'XP (gains regroupés en mémoire puis écrits par lots toutes les 30 s) ; intent `GuildMessages` à ajouter.
- **Migrations** : `eco_comptes`, `eco_journal`, `eco_metiers`, `inventaire`, `shop_items`, `xp`, `xp_paliers`, `succes`, `quetes`, `parties`, `profils`, `anniversaires`, `cooldowns`.

### Phase 4 : Jeux multijoueurs et produits phares

- **Objectif** : les 5 produits phares et les jeux de groupe qui donnent envie d'installer le bot.
- **Idées** : #31 Échanges entre membres · #37 Détection des transferts suspects · #53 Aligne-4 · #56 Loup-garou · #57 L'Imposteur du mot · #58 Quiz en équipes · #59 Tournois · #60 Cartes à collectionner originales · #61 Album et séries · #62 Fusion de doublons · #64 Set de cartes du serveur · #67 Boss de serveur coopératif · #73 Objectif communautaire · #74 Giveaways avancés

*14 idées, effort cumulé estimé ≈ 41,5 jours de dev.*
- **Critères d'acceptation** : loup-garou jouable de bout en bout à 6 comptes de test (nuit/jour, départ d'un joueur en cours de partie, timeout d'un vote) ; boss : 2 attaques au même instant ne font pas tomber les PV sous 0 et la récompense est versée une seule fois ; échange : un objet engagé dans une offre ne peut pas être vendu ailleurs ; aucune carte d'un set serveur ne s'affiche sur un autre serveur.
- **Risques** : complexité du loup-garou (effort 5, à découper en sous-tâches) ; contenu des sets serveur (filtre + signalement + suppression par le staff du bot) ; duplication d'objets par échange (verrou + transaction).
- **Migrations** : `tournois`, `cartes_joueurs`, `cartes_serveur`, `boss`, `boss_contributions`, `objectifs`, `echanges`, `alertes_triche`.

### Phase 5 : Monétisation

- **Objectif** : revenus via les seuls SKU de Discord, sans pay-to-win.
- **Idées** : #80 Premium utilisateur · #81 Premium serveur « Communauté » · #82 Cosmétiques à l'unité · #83 Parrainage du bot · #84 Récompenses de vote

*5 idées, effort cumulé estimé ≈ 8 jours de dev.*
- **Critères d'acceptation** : test qui active chaque avantage premium et vérifie que l'XP, la monnaie, l'inventaire, les tirages et les classements d'un joueur premium et d'un joueur gratuit restent identiques à activité égale ; `npm run premium:test` couvre les SKU utilisateur, serveur et durables ; `docs/monetisation.md` et `/premium` décrivent exactement l'offre ; un vote ne crédite qu'un seul serveur, dans le plafond quotidien ; le parrainage ne donne qu'un badge et un thème.
- **Risques** : refus de Discord si l'offre semble vendre un avantage de jeu (garder la liste « confort et cosmétique » dans la fiche) ; fraude au parrainage (serveurs vides : conditions d'activité réelle) ; webhook de vote (signature vérifiée, limite de débit).
- **Migrations** : `cosmetiques_possedes`, `parrainages`, `votes`.

### Phase 6 : Événements, saisons et scale

- **Objectif** : rythme sur l'année, configuration web, et tenir la charge.
- **Idées** : #34 Hôtel des ventes · #42 Saisons · #63 Cartes d'événement limitées · #69 Familiers · #75 Événements saisonniers · #85 Classement inter-serveurs · #97 Observabilité · #98 Dashboard Communauté · #99 Sauvegardes hors serveur chiffrées · #100 Prêt pour le sharding

*10 idées, effort cumulé estimé ≈ 28 jours de dev.*
- **Critères d'acceptation** : passage de saison testé (classement remis à zéro, podium archivé, niveau global conservé) ; événement saisonnier activé et désactivé par date sans redéploiement ; sauvegarde externe restaurée sur une machine vierge ; bot lancé en 2 shards en dev sans erreur `SQLITE_BUSY`.
- **Risques** : SQLite avec plusieurs processus (file d'écritures, `busy_timeout`) ; marché qui concentre la richesse (taxes, plafond d'annonces).
- **Migrations** : `saisons`, `saison_classements`, `market`, `familiers`, `evenements_saison`.

### Backlog (gardé, non planifié)

| # | Idée | Raison |
|---|---|---|
| 54 | Bataille navale | Effort 4 ; Aligne-4 et morpion couvrent déjà les duels de plateau |
| 65, 66, 68 | Classes, donjons, craft | Gros chantier RPG ; le boss coopératif (#67) suffit dans un premier temps |
| 70, 71 | Casino virtuel | Risque d'image et de conformité ; à ta décision (voir questions) |
| 79 | Confessions anonymes | Risque élevé (harcèlement, données sensibles) ; après une file de modération éprouvée |

---

## 6. Méthode d'implémentation (après validation)

Pour chaque idée, dans l'ordre du plan validé :
1. Branche `feat/<n°>-<slug>` (ou `fix/`, `chore/`) depuis `main`.
2. Code dans le bon module, style ESLint du projet, messages en français via i18n (FR + EN).
3. Commande de modération : `setDefaultMemberPermissions`, `setContexts(Guild)`, garde staff, test de refus.
4. Jeu : cooldown, interactions expirées, parties simultanées et abandons, transaction SQLite atomique contre la double dépense.
5. Schéma modifié : migration versionnée, idempotente, avec `down`.
6. `npm run lint` et `npm test` verts.
7. README (tableau par module), `/help`, `/privacy`, `PROGRESS.md`, case cochée ici.
8. Commits Conventional Commits (`feat(jeux): …`, `feat(moderation): …`), un sujet par PR.
9. Tests sur l'application **dev** seulement.
10. Récap à la fin de chaque phase ; les nouvelles idées vont au backlog.

Si l'effort réel dépasse l'estimation de plus de 2 points, on s'arrête et on en parle.

## 7. Suivi

| Phase | État |
|---|---|
| 0 – Fondations | ✅ codée (branche `phase-0/fondations`) : #86 ✅ · #88 ✅ · #92 ✅ · #91 ✅ · #90 ✅ · #1 ✅ · #89 ✅ · #87 ✅ · #96 ✅ · #95 ✅ · #93 ✅ ; tribunal de fin de jalon : **jalon validé**, corrections appliquées |
| 1 – Quick wins | ⏳ prochaine phase |
| 2 – Modération avancée | ⏳ |
| 3 – Cœur ludique | ⏳ |
| 4 – Multijoueur et phares | ⏳ |
| 5 – Monétisation | ⏳ |
| 6 – Événements, saisons, scale | ⏳ |
