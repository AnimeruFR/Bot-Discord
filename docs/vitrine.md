# Vitrine du bot : top.gg, serveur de support, vérification

> Remplace `[NOM DU BOT]`, `[LIEN D'INVITATION]` (donné par `npm run invite`), `[LIEN DU SERVEUR DE SUPPORT]` et les liens des pages légales avant de publier.

## 1. Fiche top.gg (à copier-coller)

**Description courte (FR, ≤ 200 caractères)**
> Modération complète, tickets pro avec transcript, giveaways, rôles à boutons et sondages. Configuration en un menu (`/config`), en français et en anglais, sans permission Administrateur.

**Short description (EN)**
> Full moderation, pro tickets with transcripts, giveaways, button roles and polls. One-menu setup (`/config`), French and English, no Administrator permission needed.

**Description longue (FR)**

[NOM DU BOT] est un bot tout-en-un pensé pour les serveurs francophones, sécurisé de bout en bout.

- 🛡️ **Modération** : ban (avec confirmation), ban temporaire avec déban automatique, kick, mute, avertissements, historique complet par membre, sanctions automatiques (« au 3e warn, mute 1 h »), `/lock`, `/slowmode`, règles AutoMod natives.
- 🎫 **Tickets** : types de tickets (support, signalement…), formulaire à l'ouverture, prise en charge par le staff, ajout de membres, fermeture des tickets inactifs, transcript texte + HTML et pièces jointes dans les logs, note de 1 à 5 après la fermeture, statistiques.
- 🎉 **Animation** : giveaways (tirage équitable, survit aux redémarrages), rôles à boutons, sondages natifs, annonces programmées, messages de bienvenue.
- ⚙️ **Configuration** : tout se règle avec `/config` (langue, couleur, logs, tickets).
- 🔒 **Sécurité et vie privée** : hiérarchie des rôles revérifiée à chaque action, jamais de permission Administrateur, aucune mention @everyone, données effacées 30 jours après le départ du bot, `/privacy` pour tout voir ou tout effacer.

**Long description (EN)**

[NOM DU BOT] is an all-in-one bot built with security in mind.

- 🛡️ **Moderation**: ban (with confirmation), temporary bans with automatic unban, kick, mute, warnings, full per-member history, automatic sanctions ("on the 3rd warn, mute for 1 h"), `/lock`, `/slowmode`, native AutoMod rules.
- 🎫 **Tickets**: ticket types, a form when opening, staff claiming, adding members, auto-closing inactive tickets, text + HTML transcripts and attachments in the logs, 1–5 rating after closing, statistics.
- 🎉 **Community**: giveaways (fair draw, survives restarts), button roles, native polls, scheduled announcements, welcome messages.
- ⚙️ **Setup**: everything from `/config` (language, colour, logs, tickets).
- 🔒 **Security & privacy**: role hierarchy re-checked on every action, never the Administrator permission, no @everyone pings, data erased 30 days after the bot leaves, `/privacy` to see or erase everything.

**Tags conseillés** : Moderation, Tickets, Giveaway, Utility, Roles, French.

**Captures à joindre** : `/config`, un ticket ouvert avec son formulaire, l'aperçu du transcript (`docs/apercu-transcript.png`), un giveaway, `/historique`.

## 2. Serveur de support

Salons conseillés :
- `#annonces` (nouveautés, maintenance), `#règles`, `#faq`, `#aide` (ou tickets avec le bot lui-même), `#suggestions`, `#statut`.
- Un salon de test où les visiteurs peuvent essayer les commandes.

Puis renseigne `SUPPORT_URL` (lien d'invitation permanent du serveur de support) dans `.env.prod` : il apparaît dans `/invite` et `/about`.

## 3. Pages légales

Publie `docs/conditions.md` et `docs/confidentialite.md` (complétées) sur une page web (GitHub Pages par exemple), puis renseigne :
- `PRIVACY_URL` et `TERMS_URL` dans `.env.prod` (boutons de `/about`, lien de `/privacy`) ;
- les mêmes liens dans le Developer Portal (*General Information > Terms of Service URL / Privacy Policy URL*), obligatoires pour la vérification.

## 4. Vérification du bot (obligatoire à 100 serveurs)

- À demander dans le Developer Portal (*App Verification*) vers 75 serveurs : au-delà de 100 serveurs, un bot non vérifié ne peut plus être ajouté.
- Il faut : un compte Discord vérifié (pièce d'identité via le prestataire de Discord), une **équipe** propriétaire de l'application conseillée, les liens des conditions et de la politique de confidentialité.
- Intent privilégié **Server Members** : Discord demande pourquoi. Justification : messages de bienvenue / au revoir et vérification que les gagnants d'un giveaway sont toujours sur le serveur ; aucune donnée de membre n'est stockée en dehors des participations aux giveaways (effacées 30 jours après la fin).
- Message Content Intent : seulement si tu veux le texte des messages dans les transcripts de tickets (le bot fonctionne sans).

## 5. Lien d'invitation

`npm run invite` affiche le lien avec les **permissions minimales** (liste et raison de chacune). Ne donne jamais un lien avec « Administrateur ».
