// Registre RGPD : pour chaque table de la base, les colonnes qui identifient un membre
// et ce qu'on en fait quand le membre demande l'effacement de ses données.
//
// Traitements :
// - effacer    : la ligne entière est supprimée ;
// - anonymiser : la colonne est remplacée par "0" (la ligne sert à d'autres membres ou au staff) ;
// - conserver  : rien n'est touché, avec un motif et une durée (affichés dans l'export et la page de confidentialité) ;
// - reinitialiser : empreinte anti-abus. Les lignes du membre qui vérifient `garder` restent (les autres sont effacées),
//               et les colonnes de `valeurs` y reçoivent une valeur fixe (expression SQL écrite ici). Motif et durée obligatoires.
//               garder(periodes) renvoie { sql, params } ; periodes = { jour, hier, semaine, semainePrecedente } (Paris).
//
// Options d'une table : differeSiGele (compte gelé par le staff : la table n'est pas touchée tant que le gel dure),
// secret : { colonne, si: { colonne, valeur } } (colonne masquée à l'export tant que la condition est vraie).
//
// Autres suppressions automatiques hors registre : sauvegardes avant-migration-*.db de BACKUP_DIR, effacées après 30 jours
// (Fonctions/migrations.js, lancé par startPrivacySchedule) ; elles contiennent une copie de la base.
//
// Pour ajouter une table (économie, XP…) : l'ajouter ici avec ses colonnes de membre, ou avec `aucune`
// si elle n'en a pas. Le test tests/rgpd-membre.test.js échoue si une table ou une colonne
// d'identifiant de membre manque. Les noms de table et de colonne viennent uniquement de ce fichier.
//
// Forme d'une table :
//   serveur : colonne du serveur ("guild_id"), ou { colonne, parent, cle, parentServeur } quand la table
//             n'a pas de guild_id et se rattache à une table parente (ex. giveaway_entries -> giveaways)
//   colonnes : { nom_de_colonne: { traitement, motif, duree?, liste? } }
//   auteur: true : la colonne désigne l'auteur d'une action sur la ligne d'un autre (modérateur, organisateur…) ;
//             l'export d'un membre trouvé seulement par ces colonnes est réduit (id, dates, rôle), sans tiers
//   liste: true : la colonne contient une liste JSON d'identifiants (l'identifiant est remplacé dans la liste)
//   rattachee : { colonne, parent, cle, parentServeur, parentMembre, traitement, motif, duree } : lignes qui visent un membre
//             seulement par leur ligne parente (ex. case_edits -> cases.user_id). Elles sont ajoutées, en entier, à l'export du
//             membre visé ; elles ne changent rien à l'effacement (la conservation suit celle de la ligne parente)
//   aucune : motif (table sans donnée de membre)

const ANONYME = "0"

const REGISTRE = {
    // Sanctionné : conservé 2 ans (modération). Modérateur : c'est un membre du staff, la ligne sert au serveur.
    warns: {
        serveur: "guild_id",
        colonnes: {
            user_id: { traitement: "conserver", motif: "Intérêt légitime de modération (suivi des sanctions, purgé automatiquement)", duree: "2 ans" },
            moderator_id: { traitement: "anonymiser", auteur: true, motif: "La sanction reste utile au serveur, le modérateur n'est plus identifié" }
        }
    },
    // Configuration du serveur : salons, rôles et textes, aucun membre.
    guild_config: { serveur: "guild_id", aucune: "Configuration du serveur, aucune donnée de membre" },
    guild_modules: { serveur: "guild_id", aucune: "Modules activés du serveur (#87), aucune donnée de membre" },
    guild_salons_jeux: { serveur: "guild_id", aucune: "Salons de jeux du serveur (#87), aucune donnée de membre" },
    // Délai anti-spam : gardé 10 min puis purgé (effacer le délai permettrait de contourner la limite).
    ticket_cooldowns: {
        serveur: "guild_id",
        colonnes: { user_id: { traitement: "conserver", motif: "Délai anti-spam entre deux tickets (un effacement permettrait de le contourner)", duree: "10 min" } }
    },
    // Date de départ du bot d'un serveur.
    guild_left: { serveur: "guild_id", aucune: "Concerne le serveur, pas un membre" },
    // Historique des sanctions : même logique que warns.
    cases: {
        serveur: "guild_id",
        colonnes: {
            user_id: { traitement: "conserver", motif: "Intérêt légitime de modération (historique des sanctions, purgé automatiquement)", duree: "2 ans" },
            moderator_id: { traitement: "anonymiser", auteur: true, motif: "La sanction reste utile au serveur, le modérateur n'est plus identifié" }
        }
    },
    // Ban temporaire en cours : sans cette ligne, le ban ne serait jamais levé. Disparaît à la levée du ban.
    tempbans: {
        serveur: "guild_id",
        colonnes: { user_id: { traitement: "conserver", motif: "Nécessaire pour lever le ban à la date prévue", duree: "jusqu'à la fin du ban" } }
    },
    sanction_thresholds: { serveur: "guild_id", aucune: "Réglages du serveur, aucune donnée de membre" },
    channel_locks: { serveur: "guild_id", aucune: "Permissions d'un salon, aucune donnée de membre" },
    ticket_types: { serveur: "guild_id", aucune: "Réglages du serveur, aucune donnée de membre" },
    // Ticket : la ligne sert aux statistiques du serveur et au suivi du salon, on la garde sans identifier personne.
    tickets: {
        serveur: "guild_id",
        colonnes: {
            owner_id: { traitement: "anonymiser", motif: "Le ticket (dates, note) reste dans les statistiques du serveur sans l'auteur" },
            claimed_by: { traitement: "anonymiser", auteur: true, motif: "Le ticket sert à l'auteur et au serveur, le membre du staff n'est plus identifié" }
        }
    },
    role_panels: { serveur: "guild_id", aucune: "Panneau de rôles du serveur, aucune donnée de membre" },
    role_panel_buttons: { serveur: "guild_id", aucune: "Boutons d'un panneau, aucune donnée de membre" },
    // Giveaway : il sert aux autres participants (tirage, relance). Organisateur et gagnants sont anonymisés.
    giveaways: {
        serveur: "guild_id",
        colonnes: {
            host_id: { traitement: "anonymiser", auteur: true, motif: "Le giveaway concerne d'autres participants, l'organisateur n'est plus identifié" },
            winners: { traitement: "anonymiser", liste: true, motif: "Le tirage reste valable, la place du gagnant est conservée sous forme anonyme" },
            previous_winners: { traitement: "anonymiser", liste: true, motif: "Les anciens gagnants restent exclus des relances, sans identifier le membre" }
        }
    },
    // Participation à un giveaway : sans valeur à conserver, on efface (table sans guild_id, rattachée à giveaways).
    giveaway_entries: {
        serveur: { colonne: "giveaway_id", parent: "giveaways", cle: "id", parentServeur: "guild_id" },
        colonnes: { user_id: { traitement: "effacer", motif: "Participation sans valeur à conserver" } }
    },
    // Annonce programmée : elle doit partir quand même (supprimée une fois envoyée), seul l'auteur est retiré.
    announcements: {
        serveur: "guild_id",
        colonnes: { author_id: { traitement: "anonymiser", auteur: true, motif: "L'annonce doit être publiée, l'auteur n'est plus identifié" } }
    },
    // Phase 1
    log_channels: { serveur: "guild_id", aucune: "Salons de logs du serveur (#24), aucune donnée de membre" },
    // Note du staff (#8) : même logique que l'historique des sanctions, jamais montrée au membre concerné.
    staff_notes: {
        serveur: "guild_id",
        colonnes: {
            user_id: { traitement: "conserver", motif: "Intérêt légitime de modération (contexte du staff, purgé avec l'historique)", duree: "2 ans" },
            author_id: { traitement: "anonymiser", auteur: true, motif: "La note reste utile au staff, son auteur n'est plus identifié" }
        }
    },
    mod_reasons: { serveur: "guild_id", aucune: "Raisons de sanction prédéfinies (#10), aucune donnée de membre" },
    // Trace des modifications d'une sanction (#12) : elle suit la sanction (purgée avec elle).
    case_edits: {
        serveur: "guild_id",
        colonnes: { editor_id: { traitement: "anonymiser", auteur: true, motif: "La trace reste utile au staff, son auteur n'est plus identifié" } },
        // Les modifications d'une sanction concernent aussi le membre sanctionné (raison avant / après)
        rattachee: {
            colonne: "case_id", parent: "cases", cle: "id", parentServeur: "guild_id", parentMembre: "user_id",
            traitement: "conserver", motif: "Trace des modifications de la sanction du membre, purgée avec elle", duree: "2 ans"
        }
    },
    // Réponse prédéfinie (#20) : texte du serveur, l'auteur n'est plus identifié.
    ticket_macros: {
        serveur: "guild_id",
        colonnes: { author_id: { traitement: "anonymiser", auteur: true, motif: "La réponse sert au staff du serveur, son auteur n'est plus identifié" } }
    },
    account_filter: { serveur: "guild_id", aucune: "Réglage du filtre des comptes récents (#3), aucune donnée de membre" },
    automod_config: { serveur: "guild_id", aucune: "Réglage AutoMod du serveur (#7), aucune donnée de membre" },
    // Phase 2
    raid_config: { serveur: "guild_id", aucune: "Seuils anti-raid du serveur (#2), aucune donnée de membre" },
    raid_events: {
        serveur: "guild_id",
        colonnes: { lifted_by: { traitement: "anonymiser", auteur: true, motif: "Le raid reste dans l'historique du serveur, celui qui l'a levé n'est plus identifié ; raid effacé 1 an après sa levée" } }
    },
    verification_config: { serveur: "guild_id", aucune: "Réglage de la vérification (#4), aucune donnée de membre" },
    // Filtre de pseudos (#25) : configured_by limite le pouvoir du bot à celui de qui l'a activé (tribunal S1).
    nick_filter: {
        serveur: "guild_id",
        colonnes: { configured_by: { traitement: "anonymiser", auteur: true, motif: "Le filtre reste actif, son auteur n'est plus identifié (le bot ne renomme alors plus personne)" } }
    },
    // Appel (#11) : texte écrit par le membre. Il suit la sanction (même durée), le staff qui a tranché est anonymisé.
    appeals: {
        serveur: "guild_id",
        colonnes: {
            user_id: { traitement: "conserver", motif: "Suivi de la sanction contestée (un appel par sanction)", duree: "2 ans" },
            decided_by: { traitement: "anonymiser", auteur: true, motif: "La décision reste valable, le membre du staff n'est plus identifié" }
        }
    },
    quarantine_config: { serveur: "guild_id", aucune: "Rôle de quarantaine du serveur (#14), aucune donnée de membre" },
    // Quarantaine en cours : sans la ligne, les rôles du membre ne pourraient pas lui être rendus.
    quarantines: {
        serveur: "guild_id",
        colonnes: {
            user_id: { traitement: "conserver", motif: "Nécessaire pour rendre ses rôles au membre à la levée", duree: "jusqu'à la levée de la quarantaine (un membre parti la retrouve s'il revient)" },
            moderator_id: { traitement: "anonymiser", auteur: true, motif: "La quarantaine reste en place, le modérateur n'est plus identifié" }
        }
    },
    // Journal de configuration (#15) : réglages du serveur, l'auteur du changement est un membre du staff.
    config_audit: {
        serveur: "guild_id",
        colonnes: { moderator_id: { traitement: "anonymiser", auteur: true, motif: "Le changement reste dans le journal du serveur, son auteur n'est plus identifié ; ligne effacée après 2 ans" } }
    },
    ticket_fields: { serveur: "guild_id", aucune: "Champs des formulaires de tickets (#19), aucune donnée de membre" },
    // Trace d'un ticket (#21) : transfert, alerte de délai… sans contenu de message.
    ticket_events: {
        serveur: "guild_id",
        colonnes: { actor_id: { traitement: "anonymiser", auteur: true, motif: "La trace reste utile au staff, son auteur n'est plus identifié ; effacée avec le suivi du ticket (90 jours après sa suppression)" } }
    },
    phishing_whitelist: { serveur: "guild_id", aucune: "Domaines autorisés du serveur (#5), aucune donnée de membre" },
    // Phase 3 : données de jeu d'un membre. Elles n'ont de valeur que pour lui : effacées à sa demande, sauf une
    // « empreinte anti-abus » réduite (intérêt légitime : prévention de la fraude), sans contenu, qui empêche de rejouer
    // des récompenses déjà versées ou de lever un gel en effaçant ses données. Membre sans activité depuis 1 an : voir INACTIVITE.
    eco_config: { serveur: "guild_id", aucune: "Réglages de l'économie du serveur, aucune donnée de membre" },
    // Solde et série remis à 0 ; restent le gel du staff et la date du dernier daily (un seul daily par jour).
    // Compte gelé : le portefeuille (solde et journal) n'est pas effacé tant que le gel dure.
    eco_comptes: {
        serveur: "guild_id",
        differeSiGele: true,
        colonnes: {
            user_id: {
                traitement: "reinitialiser", valeurs: { balance: "0", streak: "0" },
                motif: "Empreinte anti-abus : gel du compte et date du dernier daily gardés, solde remis à 0", duree: "1 an après la dernière activité"
            }
        }
    },
    eco_journal: {
        serveur: "guild_id",
        differeSiGele: true,
        colonnes: {
            user_id: { traitement: "effacer", motif: "Historique de votre portefeuille de jeu" },
            other_id: { traitement: "anonymiser", motif: "La transaction reste dans le journal de l'autre membre, vous n'y êtes plus identifié" }
        }
    },
    // Compteurs du jour : sans eux, effacer ses données remettrait les plafonds à zéro (gains, transferts, travaux).
    eco_compteurs: { serveur: "guild_id", colonnes: { user_id: { traitement: "conserver", motif: "Plafonds quotidiens de l'économie (un effacement permettrait de les contourner)", duree: "2 jours" } } },
    // Métier gardé au niveau 1 : le délai d'une heure entre deux travaux reste valable.
    eco_metiers: {
        serveur: "guild_id",
        colonnes: {
            user_id: {
                traitement: "reinitialiser", valeurs: { level: "1", job_xp: "0" },
                motif: "Empreinte anti-abus : délai entre deux travaux gardé, niveau de métier remis à 1", duree: "1 an après la dernière activité"
            }
        }
    },
    inventaire: { serveur: "guild_id", colonnes: { user_id: { traitement: "effacer", motif: "Objets de jeu" } } },
    shop_items: { serveur: "guild_id", aucune: "Articles de la boutique du serveur, aucune donnée de membre" },
    // Rôle temporaire acheté : sans la ligne, le rôle ne serait jamais retiré.
    shop_roles_temp: { serveur: "guild_id", colonnes: { user_id: { traitement: "conserver", motif: "Nécessaire pour retirer le rôle temporaire à l'échéance", duree: "jusqu'à l'échéance du rôle" } } },
    // Niveau gardé, XP ramenée au seuil de ce niveau (même formule que xpCumulee dans Fonctions/xp.js) : les paliers déjà
    // atteints ne sont pas payés une deuxième fois. Le plafond d'XP du jour (day, day_xp) et le délai d'une minute restent.
    xp: {
        serveur: "guild_id",
        colonnes: {
            user_id: {
                traitement: "reinitialiser",
                valeurs: { xp: "100 * level + 20 * level * (level - 1) + 4 * (level - 1) * level * (2 * level - 1) / 6" },
                motif: "Empreinte anti-abus : niveau atteint gardé (paliers déjà payés), XP au-delà du niveau effacée", duree: "1 an après la dernière activité"
            }
        }
    },
    xp_config: { serveur: "guild_id", aucune: "Réglages de l'XP du serveur, aucune donnée de membre" },
    xp_bonus: { serveur: "guild_id", aucune: "Bonus d'XP par salon ou rôle, aucune donnée de membre" },
    xp_paliers: { serveur: "guild_id", aucune: "Rôles par niveau, aucune donnée de membre" },
    // Identifiants des succès obtenus et récompense versée : un succès n'est jamais payé deux fois.
    succes: { serveur: "guild_id", colonnes: { user_id: { traitement: "conserver", motif: "Empreinte anti-abus : succès déjà obtenus (récompense déjà versée)", duree: "1 an après la dernière activité" } } },
    // Quêtes de la période en cours et de la précédente (claimed) : une quête réclamée ne l'est pas deux fois.
    // Les périodes AAAA-MM-JJ et AAAA-Wnn ne se comparent pas entre elles : chaque format a sa limite.
    quetes: {
        serveur: "guild_id",
        colonnes: {
            user_id: {
                traitement: "reinitialiser",
                garder: p => ({ sql: "((period LIKE '%-W%' AND period >= ?) OR (period NOT LIKE '%-W%' AND period >= ?))", params: [p.semainePrecedente, p.hier] }),
                motif: "Empreinte anti-abus : quêtes du jour et de la semaine en cours et précédentes gardées, les autres effacées", duree: "30 jours"
            }
        }
    },
    // Statistiques effacées, sauf les limites du jour (clé finissant par « _jour ») et les traces anti-farm (« paire:… »,
    // « duels_contre:… ») : elles empêchent de rejouer les gains du jour. Un module qui ajoute une limite du jour suit cette règle de nom.
    stats_joueur: {
        serveur: "guild_id",
        colonnes: {
            user_id: {
                traitement: "reinitialiser",
                garder: () => ({ sql: "(stat LIKE '%\\_jour' ESCAPE '\\' OR stat LIKE 'paire:%' OR stat LIKE 'duels_contre:%')", params: [] }),
                motif: "Empreinte anti-abus : limites du jour et traces anti-farm gardées, statistiques effacées", duree: "2 jours (traces de la semaine : 8 jours)"
            }
        }
    },
    profils: { serveur: "guild_id", colonnes: { user_id: { traitement: "effacer", motif: "Profil (bio, thème)" } } },
    reputation: { serveur: "guild_id", colonnes: { user_id: { traitement: "effacer", motif: "Points de réputation reçus" } } },
    // Réputation donnée : garder qui a donné aujourd'hui empêche d'en redonner en effaçant ses données.
    rep_donnees: {
        serveur: "guild_id",
        colonnes: {
            giver_id: { traitement: "conserver", motif: "Limite d'une réputation par jour (un effacement permettrait de la contourner)", duree: "2 jours" },
            receiver_id: { traitement: "anonymiser", motif: "La limite de celui qui a donné reste valable, vous n'êtes plus identifié" }
        }
    },
    anniversaires: { serveur: "guild_id", colonnes: { user_id: { traitement: "effacer", motif: "Jour et mois d'anniversaire" } } },
    anniv_config: { serveur: "guild_id", aucune: "Salon et rôle d'anniversaire du serveur, aucune donnée de membre" },
    // Rôle d'anniversaire donné par le bot (migration 023). Conservé plutôt qu'effacé : sans la ligne, le bot ne saurait
    // plus qu'il doit retirer le rôle, et le membre le garderait. La ligne disparaît au retrait (le lendemain).
    // Note : anniversaires.changed_at (délai de 30 jours entre deux changements de date) part avec la date à l'effacement ;
    // le garder demanderait de garder la date elle-même. Contournement limité par le délai d'une heure entre deux effacements.
    anniv_roles_donnes: {
        serveur: "guild_id",
        colonnes: { user_id: { traitement: "conserver", motif: "Rôle d'anniversaire donné par le bot, retiré le lendemain", duree: "jusqu'au lendemain" } }
    },
    // Partie : elle concerne les autres joueurs ; votre place est gardée sous forme anonyme. Effacée 30 jours après la fin.
    // L'état d'une partie en cours (mot du pendu, ordre du quiz) n'est jamais exporté : il reste secret jusqu'à la fin.
    parties: {
        serveur: "guild_id",
        secret: { colonne: "state", si: { colonne: "status", valeur: "en_cours" } },
        colonnes: { players: { traitement: "anonymiser", liste: true, motif: "La partie concerne d'autres joueurs, votre place reste anonyme (effacée 30 jours après la fin)" } }
    },
    // Jeux du jour J et J-1 gardés (mot du jour, énigme, quiz) : une partie finie ne se rejoue pas.
    jeux_quotidiens: {
        serveur: "guild_id",
        colonnes: {
            user_id: {
                traitement: "reinitialiser",
                garder: p => ({ sql: "day >= ?", params: [p.hier] }),
                motif: "Empreinte anti-abus : jeux du jour et de la veille gardés, les autres effacés", duree: "30 jours"
            }
        }
    },
    drops_config: { serveur: "guild_id", aucune: "Salons des drops du serveur, aucune donnée de membre" },
    // Essais de vérification (#4) : sans eux, un membre pourrait réessayer sans fin ; effacés après 1 jour.
    verification_attempts: {
        serveur: "guild_id",
        colonnes: { user_id: { traitement: "conserver", motif: "Limite d'essais de la vérification (un effacement permettrait de la contourner)", duree: "1 jour" } }
    }
}

// Membre sans activité depuis 1 an sur un serveur (souvent parti) : ses données de jeu sont effacées par la purge
// quotidienne (Fonctions/privacy.js, db.purgeMembresInactifs). Le bot ne sait pas qui a quitté le serveur : la règle
// est la date de dernière activité connue, la plus récente des colonnes de `dates` (millisecondes).
// Exceptions : un compte gelé par le staff (gardé tant que le gel dure) et un membre sans aucune date connue
// (seulement un profil ou un anniversaire) : ce dernier garde ses données jusqu'à son effacement ou au départ du bot.
const INACTIVITE = {
    duree: "1 an sans activité",
    jours: 365,
    tables: ["eco_comptes", "eco_journal", "eco_compteurs", "eco_metiers", "inventaire", "xp", "succes", "quetes",
        "stats_joueur", "profils", "reputation", "anniversaires", "jeux_quotidiens"],
    dates: [["eco_comptes", "created_at"], ["eco_comptes", "last_daily_at"], ["eco_journal", "created_at"], ["xp", "last_gain_at"],
        ["succes", "earned_at"], ["eco_metiers", "last_work_at"], ["jeux_quotidiens", "finished_at"]]
}

const TRAITEMENTS = ["effacer", "anonymiser", "conserver", "reinitialiser"]

// Vérifie la forme du registre (appelée au chargement et par les tests) ; renvoie la liste des erreurs
function verifier(registre = REGISTRE, inactivite = INACTIVITE) {
    const erreurs = []
    for (const table of inactivite.tables) {
        if (!registre[table]?.colonnes?.user_id) erreurs.push(`INACTIVITE : ${table} sans colonne user_id dans le registre`)
    }
    for (const [table] of inactivite.dates) {
        if (!inactivite.tables.includes(table)) erreurs.push(`INACTIVITE : date de ${table} hors des tables purgées`)
    }
    for (const [table, def] of Object.entries(registre)) {
        if (!def.serveur) erreurs.push(`${table} : serveur manquant`)
        if (def.secret && !(def.secret.colonne && def.secret.si?.colonne)) erreurs.push(`${table}.secret : colonne ou condition manquante`)
        if (def.aucune !== undefined) {
            if (!def.aucune) erreurs.push(`${table} : motif de "aucune" vide`)
            continue
        }
        if (def.rattachee) {
            for (const champ of ["colonne", "parent", "cle", "parentServeur", "parentMembre", "motif"]) {
                if (!def.rattachee[champ]) erreurs.push(`${table}.rattachee : ${champ} manquant`)
            }
            if (def.rattachee.traitement === "conserver" && !def.rattachee.duree) erreurs.push(`${table}.rattachee : durée manquante`)
        }
        if (!def.colonnes || !Object.keys(def.colonnes).length) erreurs.push(`${table} : colonnes manquantes (ou "aucune")`)
        for (const [colonne, c] of Object.entries(def.colonnes ?? {})) {
            if (!TRAITEMENTS.includes(c.traitement)) erreurs.push(`${table}.${colonne} : traitement inconnu`)
            if (!c.motif) erreurs.push(`${table}.${colonne} : motif manquant`)
            if (c.traitement === "conserver" && !c.duree) erreurs.push(`${table}.${colonne} : durée manquante`)
            if (c.liste && c.traitement === "effacer") erreurs.push(`${table}.${colonne} : une liste ne peut pas être effacée (anonymiser)`)
            if (c.traitement === "reinitialiser") {
                if (!c.duree) erreurs.push(`${table}.${colonne} : durée manquante`)
                if (!c.valeurs && typeof c.garder !== "function") erreurs.push(`${table}.${colonne} : reinitialiser sans valeurs ni garder`)
                if (c.liste) erreurs.push(`${table}.${colonne} : une liste ne peut pas être réinitialisée (anonymiser)`)
            }
        }
    }
    return erreurs
}

const erreurs = verifier()
if (erreurs.length) throw new Error(`Registre RGPD invalide : ${erreurs.join(" ; ")}`)

module.exports = { REGISTRE, ANONYME, TRAITEMENTS, INACTIVITE, verifier }
