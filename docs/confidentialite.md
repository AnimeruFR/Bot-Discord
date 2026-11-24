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

[NOM DU BOT] utilise uniquement des slash commandes. Il **ne lit pas** le contenu des messages en continu.

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
| Panneaux de rôles, bienvenue | ID des messages, salons et rôles, titres et textes écrits par les administrateurs | Faire fonctionner le bot |
| Délai entre deux tickets | ID du serveur, ID du membre, date de la dernière ouverture | Éviter le spam. Expiré après 10 minutes, effacé automatiquement dans les 24 h environ |
| Départ du bot | Date à laquelle le bot a quitté un serveur | Suppression différée (voir plus bas) |

Le bot ne collecte rien d'autre.

Les arrivées et départs de membres sont reçus par le bot (pour les messages de bienvenue et d'au revoir), mais rien n'en est enregistré.

## 4. Tickets et logs de modération

- Le bot **ne stocke pas** le contenu des tickets (ni le formulaire rempli à l'ouverture, qui est seulement affiché dans le salon du ticket).
- Après la suppression d'un ticket, son auteur peut donner une note de 1 à 5 en message privé (facultatif). La note est enregistrée et signalée dans le salon de logs du serveur.
- Quand un membre du staff supprime un ticket, le bot envoie un transcript (texte des messages s'il y a accès, auteurs, dates) et une copie des pièces jointes dans le salon de logs choisi par les administrateurs du serveur. Ces données sont alors dans Discord, sous la responsabilité du serveur.
- Les actions de modération (ban, kick, mute, etc.) sont résumées dans ce même salon de logs, s'il est configuré.

## 5. Base légale

Intérêt légitime : assurer la modération demandée par les administrateurs du serveur (article 6.1.f du RGPD).

## 6. Partage des données

Je ne vends rien, je ne fais pas de publicité et je ne partage pas vos données avec des tiers. Seuls interviennent :

- **Discord**, qui fait fonctionner la plateforme et a sa propre [politique de confidentialité](https://discord.com/privacy) ;
- **l'hébergeur technique** du serveur sur lequel tourne le bot.

## 7. Durée de conservation

- Tant que le bot est sur un serveur, ses données sont conservées, sauf l'historique des sanctions, effacé automatiquement au bout de **2 ans**.
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

Pour ce qui concerne le contenu des transcripts dans le salon de logs d'un serveur, adressez-vous d'abord aux administrateurs de ce serveur.

## 9. Résumé dans Discord

La commande `/privacy` affiche un résumé de ces informations directement dans Discord.

## 10. Modifications

Cette politique peut évoluer. La date de dernière mise à jour est en haut de la page. Les conditions d'utilisation sont dans [conditions.md](conditions.md).
