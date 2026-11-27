# Équilibrage économique du module Communauté

*Rédigé le 25/11/2026, en même temps que [PLAN-AMELIORATIONS.md](PLAN-AMELIORATIONS.md). Les valeurs sont des points de départ, à régler après 2 à 4 semaines de mesures sur de vrais serveurs.*

## 1. Principes

- **Une monnaie par serveur**, appelée « Éclats ✦ » par défaut (nom et emoji modifiables). Elle ne passe jamais d'un serveur à l'autre : un serveur ne peut pas en inonder un autre.
- **Aucune valeur réelle** : elle ne s'achète pas, ne se revend pas, ne se convertit pas. Le premium ne donne jamais de monnaie, de tirage ni d'objet échangeable.
- **Tout passe par le journal** (`eco_journal`) : chaque gain ou dépense a une ligne (source, montant, solde après). La somme du journal est égale au solde, et un test le vérifie.
- **Transactions atomiques** : `BEGIN IMMEDIATE`, solde vérifié dans la même transaction, jamais de solde négatif.
- **Le staff garde la main** : gel, remise à zéro et journal consultable (`/eco`, module Modération).

## 2. Sources de monnaie

Les montants sont pour un joueur qui n'a pas de sanction en cours. Pendant ses **7 premiers jours** sur le serveur, un membre gagne **50 %** de ces montants (rend les comptes secondaires inutiles).

| Source | Montant | Fréquence / limite | Dans le plafond quotidien ? |
|---|---|---|---|
| `/daily` | 100 + 15 × (jours de série − 1), série comptée jusqu'à 10 jours, soit 235 au maximum | 1 par jour (jour calendaire de Paris) ; la série continue seulement si le dernier daily date de la veille | Non |
| `/travail` | 30 à 60, + 3 par niveau de métier (niveau 10 max) | 1 par heure, 8 comptés par jour | Oui |
| Activité écrite | 1 ✦ par gain d'XP | 1 gain par minute au plus | Oui (100 par jour au plus) |
| Jeux solo (quiz, mot du jour, pendu, énigme) | 10 à 40 selon la difficulté | Cooldown par jeu | Oui |
| Duels sans mise | 15 au gagnant, 5 au perdant | 10 duels récompensés par jour | Oui |
| Duels avec mise | La mise de l'adversaire, moins 5 % de frais d'arène | **Seulement si le module Casino est activé** (désactivé par défaut) : mise max 500 et perte max par jour réglables | Non (somme nulle entre joueurs, sauf les frais), mais les gains comptent dans les plafonds de transfert |
| Quêtes du jour | 3 quêtes de 40 à 80 | 3 par jour | Non (bornées par conception) |
| Quête de la semaine | 600 | 1 par semaine | Non |
| Drops dans le chat | 25 à 100 | Environ 1 drop par heure d'activité dans le salon | Oui |
| Boss coopératif | 200 à 800 selon la contribution | 1 boss par semaine | Non |
| Succès | 50 à 1 000 | Une seule fois chacun | Non |
| Vote top.gg | 50 | Toutes les 12 h | Oui |
| Objectif communautaire | 300 à 1 000 à chaque participant | Selon l'objectif | Non |

**Plafond quotidien des gains « actifs »** (colonne « Oui ») : **800 ✦ par membre et par serveur**, réglable par l'admin entre 300 et 2 000. Au-delà, les jeux restent jouables mais ne rapportent plus rien jusqu'au lendemain (message clair, pas de perte silencieuse).

## 3. Gains moyens attendus par jour

| Profil | Ce qu'il fait | Gain moyen |
|---|---|---|
| Occasionnel | daily, 1 à 2 quêtes, quelques messages | ≈ 300 ✦ |
| Actif (1 à 2 h par jour) | daily (série), 5 travaux, 60 min de discussion, 6 jeux, 3 quêtes, 1 drop, part du boss et de la quête hebdo | ≈ 1 070 ✦ |
| Très actif (au plafond) | Tout ce qui précède, plus de jeux et de travaux jusqu'au plafond | ≈ 1 370 ✦ (800 plafonnés + 570 hors plafond) |

Détail du profil actif : daily 200 + travail 275 + discussion 60 + jeux 150 + quêtes 180 + quête hebdo 85 + drop 50 + boss 70 ≈ **1 070 ✦**. Ses gains plafonnables (travail, discussion, jeux, drop) font 535 ✦ : le plafond de 800 ne gêne que les très actifs et les tentatives de farm, c'est voulu.

Repères de prix qui en découlent (pour un joueur actif) :

| Objet | Prix | Soit |
|---|---|---|
| Tirage de carte | 150 | Environ 1/7 de journée |
| Rôle temporaire 7 jours | 2 000 | 2 jours |
| Couleur de pseudo | 3 000 | 3 jours |
| Rôle cosmétique permanent | 5 000 à 25 000 (fixé par l'admin) | 5 à 23 jours |
| Fond de profil débloquable | 2 000 à 10 000 | 2 à 9 jours |

Dans la boutique, le bot affiche à l'admin, à côté du prix qu'il saisit, « ≈ N jours de jeu actif » pour l'aider à fixer des prix cohérents.

## 4. Puits (ce qui retire la monnaie du circuit)

| Puits | Montant | Remarque |
|---|---|---|
| Boutique du serveur | Prix fixé par l'admin | Principal puits, piloté par chaque serveur |
| Tirages de cartes | 150 par tirage | 1 seul tirage gratuit par jour, pour que le tirage payant en monnaie reste un vrai puits |
| Fusion de doublons | 5 doublons + 100 × niveau de rareté | Puits de cartes et de monnaie |
| Frais de `/payer` | 2 % | Minimum 1 |
| Frais d'échange | 5 % de la monnaie échangée | Les objets seuls ne paient rien, mais leur valeur (prix plancher par rareté) compte dans les plafonds de transfert |
| Hôtel des ventes | 2 % au dépôt (non remboursé) + 8 % à la vente | 10 annonces par membre |
| Frais d'arène | 5 % des gains de duels avec mise | Seulement si le module Casino est activé |
| Boosts d'XP personnels | 500 (1 h, +25 %) | Consommable, non cumulable |
| Changement de métier | 1 000 | Le niveau du nouveau métier repart à 1 |
| Nourriture de familier | ≈ 30 par jour | Facultatif, cosmétique |
| Casino (s'il est activé) | Avantage maison de 2 à 5 % | Désactivé par défaut |

**Cible** : sur 7 jours glissants, les puits doivent retirer **70 à 90 %** de ce qui a été créé. En dessous de 50 %, l'inflation s'installe (voir alertes).

## 5. Mesures anti-inflation

1. **Plafond quotidien** sur les gains actifs, et gains réduits pendant les 7 premiers jours.
2. **Puits proportionnels** (frais en %) : ils grandissent avec la richesse qui circule.
3. **Pas de banque à intérêts** : écartée volontairement, car c'est une source de monnaie qui récompense ceux qui sont déjà riches.
4. **Plafond de solde** : 1 000 000 ✦. Au-delà, les gains sont refusés (message au joueur, alerte au staff).
5. **Transferts limités** : 2 000 ✦ envoyés et 5 000 reçus par jour, **toutes voies confondues** (`/payer`, monnaie et valeur des objets dans un échange, achats au marché, gains de mise). Un compte de moins de 7 jours sur le serveur ne peut ni envoyer ni recevoir par ces voies. Prix plancher par rareté au marché, pour qu'une carte ne puisse pas être « vendue » 1 ✦ à un compte principal.
6. **Monnaie d'événement séparée** : les événements saisonniers ont leur propre monnaie, qui expire à la fin et s'échange seulement contre des cosmétiques. Elle n'entre jamais dans la monnaie principale.
7. **Les saisons ne remettent pas la monnaie à zéro** (trop frustrant) : seuls les classements repartent de zéro.
8. **Indicateurs suivis** chaque jour par serveur et visibles par le staff dans `/eco stats` :
   - masse monétaire totale et médiane par membre actif ;
   - part détenue par le 1 % le plus riche ;
   - ratio puits / sources sur 7 jours.
   Alerte dans le salon de logs économie si le ratio passe sous 50 % ou si le 1 % le plus riche détient plus de 40 % de la masse.
9. **Réglages par serveur** : plafond quotidien, mise max, multiplicateur global des gains (0,5 à 2), pour qu'un admin corrige son économie sans attendre une mise à jour.

## 6. XP et niveaux

- **Gain** : 15 à 25 XP par message, au plus un gain par minute, et **3 000 XP par jour** au maximum (≈ 150 gains) : poster toute la journée ne sert à rien. Les salons exclus et les membres sanctionnés ne gagnent rien.
- **XP pour passer du niveau L au niveau L+1** : `100 + 40 × L + 4 × L²`.

| Niveau atteint | XP cumulée | Temps pour un membre actif (≈ 1 200 XP par jour) |
|---|---|---|
| 5 | 1 020 | ≈ 1 jour |
| 10 | 3 940 | ≈ 3 jours |
| 20 | 19 480 | ≈ 2 semaines |
| 30 | 54 620 | ≈ 1 mois et demi |
| 50 | 215 700 | ≈ 6 mois |

- **Bonus** : multiplicateurs de salon ou de rôle fixés par l'admin (×2 au plus), double XP le week-end s'il est programmé, boost personnel (+25 %, acheté en monnaie gagnée). Le total est plafonné à **×2,5**. Le premium ne donne **aucun** bonus d'XP : rien d'achetable ne pèse sur un classement, une saison ou un palier.

## 7. Anti-triche (rappel)

- Cooldowns centralisés et plafond quotidien.
- Détection des transferts suspects (toujours dans le même sens, compte récent qui donne tout, gains très au-dessus de la médiane) : **alerte** au staff, jamais de sanction automatique.
- Un membre en timeout, en quarantaine ou au compte gelé ne joue pas et ne reçoit rien.
- Journal des transactions consultable par le staff, gel et remise à zéro tracés dans les logs staff.

## 8. Ce qu'il faudra mesurer avant de toucher aux chiffres

- Le gain réel médian par jour des membres actifs (doit être proche de 1 000 ✦).
- Le temps moyen pour acheter le premier rôle de la boutique (cible : moins d'une semaine pour un actif).
- La part des joueurs qui atteignent le plafond quotidien (cible : moins de 10 %, sinon il est trop bas ou un farm existe).
- Le ratio puits / sources (cible : 70 à 90 %).
