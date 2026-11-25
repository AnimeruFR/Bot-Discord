// Registre RGPD : pour chaque table de la base, les colonnes qui identifient un membre
// et ce qu'on en fait quand le membre demande l'effacement de ses données.
//
// Traitements :
// - effacer    : la ligne entière est supprimée ;
// - anonymiser : la colonne est remplacée par "0" (la ligne sert à d'autres membres ou au staff) ;
// - conserver  : rien n'est touché, avec un motif et une durée (affichés dans l'export et la page de confidentialité).
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
    automod_config: { serveur: "guild_id", aucune: "Réglage AutoMod du serveur (#7), aucune donnée de membre" }
}

const TRAITEMENTS = ["effacer", "anonymiser", "conserver"]

// Vérifie la forme du registre (appelée au chargement et par les tests) ; renvoie la liste des erreurs
function verifier(registre = REGISTRE) {
    const erreurs = []
    for (const [table, def] of Object.entries(registre)) {
        if (!def.serveur) erreurs.push(`${table} : serveur manquant`)
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
        }
    }
    return erreurs
}

const erreurs = verifier()
if (erreurs.length) throw new Error(`Registre RGPD invalide : ${erreurs.join(" ; ")}`)

module.exports = { REGISTRE, ANONYME, TRAITEMENTS, verifier }
