# Monétisation : abonnement premium par serveur

Guide pour proposer un abonnement premium (par serveur) sur le bot Discord.

## 1. Ce qui est payant / gratuit

**Premium = confort seulement :**
- types de tickets (`/tickettype`)
- transcript HTML
- statistiques (`/stats`)
- couleur des embeds et texte du panneau de tickets (`/config`)

**Toujours gratuit :**
- toute la modération
- les tickets de base, avec transcript texte
- la sécurité
- la confidentialité (`/privacy`)

Sans `PREMIUM_SKU_ID` dans le `.env`, tout est gratuit (bot auto-hébergé).

## 2. Conditions de Discord

Source : https://docs.discord.com/developers/monetization/enabling-monetization.md

- Application vérifiée, possédée par une équipe dont le propriétaire a 18 ans ou plus.
- E-mails vérifiés et 2FA pour les membres de l'équipe.
- Le bot utilise des slash commandes.
- Liens vers les conditions d'utilisation et la politique de confidentialité.
- Contenu correct.
- Acceptation des Monetization Terms et de la Developer Policy (à lire avant de choisir ce qui est payant).
- Versements via Stripe, pour une équipe basée aux US, dans l'UE ou au UK.
- 100 $ de gains minimum avant le premier versement, avec une revue avant ce premier versement.

Commission de Discord : à vérifier dans les Monetization Terms (non trouvée dans la documentation).

## 3. Mise en place pas à pas

1. Créer une équipe dans le Developer Portal et y transférer l'application.
2. Faire vérifier l'application.
3. Developer Portal > Monetization > accepter les conditions.
4. Créer un SKU de type « Subscription » avec le flag « Guild Subscription » (abonnement serveur mensuel). Choisir le nom et le prix.
5. Copier l'ID du SKU dans `PREMIUM_SKU_ID` du `.env.prod`.
6. Lancer `npm run deploy:prod`.
7. Vérifier avec `/premium`.

## 4. Tester sans payer

- Créer un entitlement de test (sans date de fin) :
  `npm run premium:test -- --env=dev --guild ID_SERVEUR`
- Le retirer :
  `npm run premium:test -- --env=dev --guild ID_SERVEUR --supprimer`
- Recharger Discord (Ctrl+R) pour voir le changement.
- Les membres de l'équipe voient aussi 100 % de réduction au paiement réel. Un abonnement réel ne peut qu'être annulé.
- `PREMIUM_GUILD_IDS` (ID séparés par des virgules) donne le premium gratuitement à des serveurs : les tiens, des partenaires.

## 5. Côté légal en France

À vérifier, ce n'est pas un conseil juridique.

- Il faut un statut pour encaisser (micro-entreprise le plus souvent).
- Vérifier la compatibilité avec le contrat d'alternance (clause d'exclusivité éventuelle) et en parler à l'employeur et à l'école.
- Déclarer le chiffre d'affaires (URSSAF).
- TVA : franchise en base selon les seuils, à vérifier.
- Ajouter des conditions générales de vente aux pages légales.
- Se renseigner auprès d'un expert-comptable ou de l'URSSAF.

## 6. Alternative sans vérification

Ko-fi ou Patreon, avec un rôle « premium » sur le serveur de support. Tu ajoutes ensuite à la main l'ID du serveur dans `PREMIUM_GUILD_IDS`.

Plus simple à lancer, mais manuel, et pas de paiement dans Discord.

## 7. Fin d'un abonnement

Quand un abonnement se termine, le serveur ne peut plus **modifier** les fonctions premium (créer ou modifier un type de ticket, changer la couleur ou le texte du panneau, `/stats`, transcript HTML). Ce qui a déjà été configuré (types existants, couleur, texte du panneau) reste en place : c'est un choix volontairement généreux, à revoir si des serveurs en abusent.
