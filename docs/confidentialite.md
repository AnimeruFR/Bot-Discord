# Politique de confidentialité de [NOM DU BOT]

> **À compléter avant publication**
> Remplacer les espaces réservés suivants :
> - `[NOM DU BOT]`
> - `[NOM OU PSEUDO DE L'OPÉRATEUR]`
> - `[E-MAIL DE CONTACT]`
> - `[LIEN DU SERVEUR DE SUPPORT]`
> - `[DATE]`

Dernière mise à jour : [DATE]

## 1. Qui est responsable ?

Le bot est géré par [NOM OU PSEUDO DE L'OPÉRATEUR], un particulier (étudiant, en France). Contact : [E-MAIL DE CONTACT]. Support : [LIEN DU SERVEUR DE SUPPORT].

## 2. Ce que fait le bot (et ne fait pas)

[NOM DU BOT] fonctionne avec des slash commandes et des boutons. Il **ne lit pas** le contenu des messages : il n'a pas l'intent « Message Content ».

Il a l'intent **Guild Messages** : Discord lui signale chaque message envoyé sur le serveur (auteur, salon, date), ce qui sert à compter l'XP et à faire apparaître les coffres (drops). Le texte du message n'est ni lu ni enregistré ; seuls le total d'XP, le niveau et la date du dernier gain sont gardés.

## 3. Données stockées

Les données sont dans une base SQLite, sur le serveur qui héberge le bot. Elles sont séparées par serveur Discord. Les identifiants Discord sont de simples nombres.

| Donnée | Contenu | Pourquoi |
|---|---|---|
| Avertissements (`/warn`) | ID du serveur, ID du membre averti, ID du modérateur, raison écrite par le modérateur, date | Suivi des sanctions par le staff |
| Historique des sanctions | ID du serveur, ID du membre, ID du modérateur, type (avertissement, mute, kick, ban, déban…), raison, durée, date | Suivi des sanctions par le staff (`/historique`). Gardé 2 ans au plus. La raison d'un avertissement retiré est effacée |
| Bans temporaires en cours | ID du serveur, ID du membre, date de fin | Lever le ban à la date prévue. Effacé dès que le ban est levé |
| Configuration du serveur | ID du salon de logs, ID de la catégorie et du rôle staff des tickets, seuils de sanctions automatiques, permissions d'un salon avant `/lock` | Faire fonctionner le bot |
| Suivi des tickets | ID du serveur, du salon, de l'auteur et du membre du staff qui l'a pris en charge, type, dates (ouverture, prise en charge, fermeture), note de 1 à 5 donnée par l'auteur | Prise en charge, fermeture des tickets inactifs, statistiques (`/stats`). Le contenu du formulaire et des messages n'est **pas** enregistré par le bot. Effacé 90 jours après la suppression du ticket |
| Types de tickets | Nom, description, ID de la catégorie et du rôle staff | Faire fonctionner le bot |
| Giveaways | ID du serveur, du salon, de l'organisateur, des participants et des gagnants, prix, dates | Tirer au sort et publier le résultat. Effacé 30 jours après la fin du giveaway |
| Annonces programmées | ID du serveur, du salon et de l'auteur, texte de l'annonce, date d'envoi | Publier l'annonce à la date prévue. Effacé dès l'envoi (ou l'annulation) |
| Apparence et langue | Langue choisie, couleur des embeds, titre et texte du panneau de tickets | Faire fonctionner le bot |
| Panneaux de rôles, bienvenue | ID des messages, salons et rôles, titres et textes écrits par les administrateurs | Faire fonctionner le bot |
| Délai entre deux tickets | ID du serveur, ID du membre, date de la dernière ouverture | Éviter le spam. Expiré après 10 minutes, effacé automatiquement dans les 24 h environ. Non effacé par `/privacy moi effacer` (sinon il permettrait de contourner la limite) |
| Départ du bot | Date à laquelle le bot a quitté un serveur | Suppression différée (voir plus bas) |
| Notes du staff | ID du serveur, du membre et de l'auteur, texte écrit par le staff, date | Contexte de modération, jamais montré au membre. Effacées au bout de 2 ans, comme l'historique |
| Modifications de sanctions | ID de la sanction et de l'auteur de la modification, ancienne et nouvelle raison, date | Trace des corrections (`/case`). Effacées avec la sanction |
| Appels de sanction | ID du serveur, du membre, de la sanction et du membre du staff qui a tranché, texte de l'appel écrit par le membre, décision, dates | Traiter l'appel. Effacé avec la sanction (2 ans au plus) |
| Quarantaine en cours | ID du serveur, du membre et du modérateur, rôles retirés, raison, date | Rendre ses rôles au membre à la levée. Effacée dès la levée |
| Essais de vérification | ID du serveur et du membre, nombre d'erreurs, fin du blocage | Limiter les essais du défi « Je ne suis pas un robot ». Effacés au bout d'un jour. Non effacés par `/privacy moi effacer` (sinon ils permettraient de contourner la limite) |
| Journal de configuration | ID du serveur et de l'auteur, description du changement, date | Journal consultable par le staff (`/journal`). Effacé au bout de 2 ans |
| Raids détectés | ID du serveur, dates, nombre d'arrivées, ID de qui a levé le mode raid | Historique des raids. Effacé 1 an après la levée |
| Trace des tickets | ID du salon et de l'auteur de l'action (transfert, alerte de délai), date | Suivi des tickets. Effacée avec le suivi du ticket |
| Réglages de modération | Raisons prédéfinies, réponses prédéfinies des tickets, salons de logs par famille, filtre des comptes récents, anti-raid, vérification, mots interdits dans les pseudos, rôle de quarantaine, domaines autorisés | Faire fonctionner le bot |

**Données de jeu (économie, niveaux, jeux).** La monnaie du bot n'a aucune valeur réelle et ne s'achète pas.

| Donnée | Contenu | Pourquoi et combien de temps |
|---|---|---|
| Portefeuille | ID du serveur et du membre, solde, série de daily, date du dernier daily, gel éventuel par le staff, date de création | Jeux et boutique du serveur. Effacé avec les autres données de jeu après 1 an sans activité |
| Journal du portefeuille | Chaque gain ou dépense : montant, solde après, origine (daily, jeu, achat…), ID de l'autre membre pour un paiement, date | Vérifier les soldes, enquête du staff en cas de triche. 1 an sans activité |
| Compteurs du jour | Gains, envois, réceptions et travaux du jour ; limites des jeux du jour | Plafonds quotidiens (anti-abus). **2 jours** |
| XP et niveau | XP, niveau, XP du jour, date du dernier gain (jamais le texte des messages) | Niveaux et rôles de palier. 1 an sans activité |
| Métier, inventaire | Métier, niveau de métier, date du dernier travail ; objets achetés | Jeux et boutique. 1 an sans activité |
| Succès et statistiques | Succès obtenus (date, récompense versée), compteurs (parties gagnées, daily…) | Succès et classements. 1 an sans activité |
| Quêtes | Quêtes du jour et de la semaine, progression, récompense réclamée | Quêtes. **30 jours** |
| Profil, réputation | Bio, thème, badge mis en avant ; total de réputation reçue ; qui a donné une réputation à qui aujourd'hui | Profil (`/profil`). Réputation donnée : **2 jours** (une par jour) ; le reste : 1 an sans activité |
| Anniversaire | Jour et mois (jamais l'année), date du dernier changement ; rôle du jour donné par le bot | Souhaiter l'anniversaire. Rôle : retiré le lendemain |
| Parties | Jeu, joueurs, état de la partie, dates | Parties en cours (duels, pendu, quiz). Effacées **30 jours** après la fin. L'état d'une partie en cours (mot à deviner, ordre des réponses) n'est jamais exporté avant la fin |
| Jeux du jour | Essais du mot du jour, de l'énigme et du quiz du jour | Une partie par jour. **30 jours** |
| Traces anti-farm | Paires de membres déjà comptées aujourd'hui ou cette semaine (paiements, réputation, victoires, duels) | Empêcher deux comptes de se renvoyer des gains. **2 jours** (8 jours pour une semaine) |

Membre sans activité depuis **1 an** sur un serveur : ses données de jeu sont effacées automatiquement. Le bot ne sait pas qui a quitté le serveur, la règle est donc la date de dernière activité connue (création du portefeuille, daily, mouvement du portefeuille, gain d'XP, succès, travail, jeu du jour). Exceptions : un compte gelé par le staff est gardé tant que le gel dure ; un membre sans aucune date connue (par exemple un anniversaire seul) garde ses données jusqu'à ce qu'il les efface ou que le bot quitte le serveur.

Le bot ne collecte rien d'autre.

Les arrivées et départs de membres sont reçus par le bot (pour les messages de bienvenue et d'au revoir), mais rien n'en est enregistré.

## 4. Tickets et logs de modération

- Le bot **ne stocke pas** le contenu des tickets (ni le formulaire rempli à l'ouverture, qui est seulement affiché dans le salon du ticket).
- Après la suppression d'un ticket, son auteur peut donner une note de 1 à 5 en message privé (facultatif). La note est enregistrée et signalée dans le salon de logs du serveur.
- Quand un membre du staff supprime un ticket, le bot envoie un transcript (texte des messages s'il y a accès, auteurs, dates) et une copie des pièces jointes dans le salon de logs choisi par les administrateurs du serveur. Ces données sont alors dans Discord, sous la responsabilité du serveur.
- Les actions de modération (ban, kick, mute, etc.) sont résumées dans ce même salon de logs, s'il est configuré.

## 5. Base légale

Intérêt légitime (article 6.1.f du RGPD) : assurer la modération demandée par les administrateurs du serveur, faire fonctionner les jeux et l'économie qu'ils ont activés, et prévenir la triche (plafonds du jour, traces anti-farm, empreinte gardée après un effacement, voir plus bas).

## 6. Partage des données

Je ne vends rien, je ne fais pas de publicité et je ne partage pas vos données avec des tiers. Seuls interviennent :

- **Discord**, qui fait fonctionner la plateforme et a sa propre [politique de confidentialité](https://discord.com/privacy) ;
- **l'hébergeur technique** du serveur sur lequel tourne le bot.

## 7. Durée de conservation

- Tant que le bot est sur un serveur, ses données sont conservées, sauf l'historique des sanctions et les avertissements, effacés automatiquement au bout de **2 ans**, et les données de jeu, qui ont leurs propres durées (tableau de la partie 3, au plus 1 an sans activité).
- Quand le bot quitte un serveur (expulsé ou retiré), toutes les données de ce serveur sont **supprimées automatiquement 30 jours plus tard**. Ce délai permet de réinviter le bot par erreur sans rien perdre.
- Un administrateur peut tout supprimer **tout de suite** avec la commande `/privacy supprimer:True` (une confirmation par bouton est demandée).
- Sauvegardes : une copie de la base est faite chaque jour et seules les plus récentes sont gardées (7 par défaut), les plus anciennes étant remplacées. Une donnée effacée disparaît donc aussi des sauvegardes, en général sous 7 jours. Ce délai peut être un peu plus long si le bot est arrêté ou si une sauvegarde échoue, ainsi que pour les éventuelles copies de sauvegarde conservées hors du serveur. Ces copies sont soumises aux mêmes règles et protégées de la même façon.
- Les données effacées sont réellement écrasées dans le fichier de la base, et pas seulement marquées comme supprimées.

## 8. Vos droits

Vous pouvez demander :

- l'accès à vos données ;
- leur rectification ;
- leur effacement ;
- de vous opposer à leur traitement.

Pour cela, écrivez à [E-MAIL DE CONTACT]. Par exemple, un membre peut demander l'effacement de ses avertissements. Je réponds sous 30 jours. Merci d'indiquer votre identifiant Discord et le serveur concerné.

Si vous pensez que vos droits ne sont pas respectés, vous pouvez porter réclamation auprès de la CNIL : [https://www.cnil.fr](https://www.cnil.fr).

### Accès et effacement par vous-même

Sans m'écrire, chaque membre peut agir seul, **serveur par serveur**, avec la commande `/privacy moi` :

- `exporter` : le bot vous envoie (message visible de vous seul) un fichier JSON de toutes les données qui vous concernent sur ce serveur ;
- `effacer` : après confirmation par bouton, le bot applique le traitement ci-dessous. Un résumé chiffré (jamais le contenu) est écrit dans le salon de logs du serveur, avec votre identifiant.

| Traitement | Données concernées | Détail |
|---|---|---|
| **Effacer** | Participations aux giveaways ; journal du portefeuille, inventaire, profil et bio, anniversaire, réputation reçue, statistiques de jeu | La ligne est supprimée |
| **Anonymiser** | Auteur et membre du staff d'un ticket, organisateur et gagnants d'un giveaway, auteur d'une annonce programmée, modérateur d'un avertissement ou d'une sanction, joueur d'une partie, autre membre d'un paiement, membre à qui vous avez donné une réputation | Votre identifiant est remplacé par `0`, le reste de la ligne est gardé car il sert à d'autres membres ou au staff |
| **Remettre à zéro** | Solde (0), série de daily (0), XP (ramenée au seuil de votre niveau), niveau de métier (1) | La ligne reste, sans valeur de jeu |
| **Conserver** (empreinte anti-abus) | Gel du compte, date du dernier daily, succès déjà obtenus, niveau atteint, délai entre deux travaux | **1 an** après votre dernière activité. Sans cela, effacer ses données permettrait de rejouer des récompenses déjà versées ou de lever un gel |
| **Conserver** (empreinte anti-abus) | Quêtes de la période en cours et de la précédente, jeux du jour et de la veille, compteurs et limites du jour, traces anti-farm, réputation donnée aujourd'hui | **2 à 30 jours** selon la donnée (voir la partie 3) |
| **Différer** | Portefeuille (solde et journal) d'un compte gelé par le staff | Tant que le gel dure ; le reste est effacé. Relancez la commande après le dégel |
| **Conserver** | Avertissements et sanctions dont vous avez fait l'objet | **2 ans** au plus, intérêt légitime de modération (voir la durée de conservation) |
| **Conserver** | Délai entre deux tickets | **10 minutes** au plus (anti-spam) |
| **Conserver** | Ban temporaire en cours | Jusqu'à la fin du ban, sinon il ne pourrait pas être levé |
| **Conserver** | Notes du staff et appels vous concernant | **2 ans** au plus, comme l'historique des sanctions |
| **Conserver** | Quarantaine en cours | Jusqu'à sa levée, sinon vos rôles ne pourraient pas vous être rendus |
| **Conserver** | Essais de vérification | **1 jour** au plus (anti-contournement) |
| **Conserver** | Rôle temporaire acheté, rôle d'anniversaire du jour | Jusqu'à son retrait, sinon le bot ne pourrait plus le retirer |

L'empreinte anti-abus ne contient aucun texte écrit par vous : seulement des identifiants de succès ou de quêtes, des dates et des nombres.

Avant une mise à jour du schéma de la base, le bot fait une copie de sécurité (`avant-migration-*.db`) : elle est supprimée automatiquement au bout de **30 jours** (vérifié au démarrage puis chaque jour). L'export `/privacy moi exporter` ne contient, pour les lignes où vous apparaissez seulement comme auteur d'une action (modérateur, organisateur, membre du staff), que l'identifiant de la ligne, ses dates et votre rôle. `/privacy moi effacer` est limité à une fois par heure.

Les sauvegardes de la base tournent sur 7 jours : une donnée effacée ou anonymisée peut encore y figurer jusqu'à 7 jours, puis disparaît quand la sauvegarde est remplacée. Si une partie de l'effacement est différée (compte gelé), le bot vous le dit avant la confirmation et dans sa réponse.

Pour ce qui concerne le contenu des transcripts dans le salon de logs d'un serveur, adressez-vous d'abord aux administrateurs de ce serveur.

## 9. Résumé dans Discord

La commande `/privacy` affiche un résumé de ces informations directement dans Discord.

## 10. Modifications

Cette politique peut évoluer. La date de dernière mise à jour est en haut de la page. Les conditions d'utilisation sont dans [conditions.md](conditions.md).
