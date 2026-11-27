const Discord = require('discord.js')
const db = require('./db')
const eco = require('./economie')
const inventaire = require('./inventaire')
const { emettre } = require('./evenements')
const { peutDonnerRole, fetchMember } = require('./moderation')
const { PERMISSIONS_INTERDITES, salonDangereux, refusRoleCommunaute } = require('./rolesCommunaute')

// Boutique du serveur (idée #29). Chiffres : docs/ECONOMIE.md. Quatre types d'articles :
//   role (permanent), role_temp (durée de 1 h à 90 jours), couleur (rôle de couleur sans aucune permission),
//   objet (du catalogue data-statique/objets.json).
//
// INVARIANT : la boutique ne distribue jamais un rôle qui donne un pouvoir de modération ou un pouvoir dangereux,
// ni au niveau du serveur ni par une surcharge de salon, ni un rôle réservé (staff, tickets, quarantaine, vérification).
// Vérifié à l'ajout de l'article ET à chaque achat, par le contrôle commun de rolesCommunaute.js.

const { Flags } = Discord.PermissionsBitField

const TYPES = ["role", "role_temp", "couleur", "objet"]
const PRIX_MIN = 1
const PRIX_MAX = 1000000
const STOCK_MAX = 1000000
const ARTICLES_MAX = 25
const NOM_MAX = 50
const DUREE_MIN = 3600
const DUREE_MAX = 90 * 24 * 3600
const GAIN_JOUR_ACTIF = 1070 // docs/ECONOMIE.md, profil « actif »
const INTERVALLE_RETRAIT = 5 * 60 * 1000

// Refus venus de l'économie (peutJouer, debiter) : leur texte est dans eco.refus.<refus>
const REFUS_ECONOMIE = ["module", "gele", "sanctionne", "plafond_solde", "solde"]

// Nombre de jours de jeu actif pour gagner ce prix (1 décimale), pour aider l'admin à fixer des prix cohérents
const joursDeJeu = prix => Math.round(prix / GAIN_JOUR_ACTIF * 10) / 10

// --- Rôles -----------------------------------------------------------------------------------------------------

// Le rôle peut-il être vendu ? Renvoie le motif du refus (code court, ou clé i18n « rolecom.refus.* »), ou null.
// admin : le membre qui ajoute l'article (il doit pouvoir donner ce rôle lui-même) ; absent à l'achat.
// couleur : rôle de couleur, sans aucune permission.
function refusRole(guild, role, { admin = null, couleur = false } = {}) {
    if (!role) return "inexistant"
    if (role.id === guild.id) return "everyone"
    if (role.managed) return "gere"
    if (role.permissions.any(PERMISSIONS_INTERDITES)) return "dangereux"
    if (salonDangereux(guild, role)) return "dangereux_salon"
    if (couleur) {
        if (role.permissions.bitfield !== 0n) return "couleur_permissions"
        if (!role.color) return "couleur_sans_couleur"
    }
    // Le bot doit pouvoir donner ce rôle : « Gérer les rôles » et un rôle plus haut que lui
    const moi = guild.members.me
    if (!moi?.permissions.has(Flags.ManageRoles) || role.comparePositionTo(moi.roles.highest) >= 0) return "bot_sous_role"
    if (admin && !peutDonnerRole(admin, role)) return "admin_sous_role"
    // Contrôle commun : rôle réservé (staff, tickets, quarantaine, vérification), pouvoirs, hiérarchie
    return refusRoleCommunaute(guild, role, admin)
}

// --- Articles --------------------------------------------------------------------------------------------------

function article(ligne) {
    if (!ligne) return null
    return {
        id: ligne.id, guildId: ligne.guild_id, type: ligne.kind, nom: ligne.name, prix: ligne.price, stock: ligne.stock,
        roleId: ligne.role_id, dureeS: ligne.duration_s, objet: ligne.item, actif: ligne.active === 1
    }
}

const articles = guildId =>
    db.sqlAll("SELECT * FROM shop_items WHERE guild_id = ? AND active = 1 ORDER BY id", [guildId]).map(article)

const lireArticle = (guildId, id) =>
    article(db.sqlAll("SELECT * FROM shop_items WHERE guild_id = ? AND id = ? AND active = 1", [guildId, id])[0])

const prixValide = prix => Number.isSafeInteger(prix) && prix >= PRIX_MIN && prix <= PRIX_MAX
const nomValide = nom => typeof nom === "string" && nom.trim().length >= 1 && nom.trim().length <= NOM_MAX
const stockValide = (stock, min) => stock === null || (Number.isSafeInteger(stock) && stock >= min && stock <= STOCK_MAX)

// Ajoute un article. admin : le membre qui l'ajoute. Renvoie { ok: true, article, jours } ou { ok: false, refus }.
// refus : type, nom, prix, stock, duree, objet_inconnu, objet_non_vendable, doublon, plein, ou un motif de refusRole.
function ajouterArticle(guild, admin, { type, nom = null, prix = null, stock = null, role = null, dureeS = null, objet = null }) {
    if (!TYPES.includes(type)) return { ok: false, refus: "type" }
    const estRole = type !== "objet"
    let roleId = null, item = null, duree = null, nomFinal = nom, prixFinal = prix

    if (estRole) {
        const refus = refusRole(guild, role, { admin, couleur: type === "couleur" })
        if (refus) return { ok: false, refus }
        roleId = role.id
        nomFinal ??= role.name
        if (type === "role_temp") {
            if (!Number.isSafeInteger(dureeS) || dureeS < DUREE_MIN || dureeS > DUREE_MAX) return { ok: false, refus: "duree" }
            duree = dureeS
        }
    } else {
        const def = inventaire.objet(objet)
        if (!def) return { ok: false, refus: "objet_inconnu" }
        if (!def.vendable) return { ok: false, refus: "objet_non_vendable" }
        item = def.id
        nomFinal ??= def.nom.fr
        prixFinal ??= def.prix // prix indicatif du catalogue
    }
    if (!nomValide(nomFinal)) return { ok: false, refus: "nom" }
    if (!prixValide(prixFinal)) return { ok: false, refus: "prix" }
    if (!stockValide(stock, 1)) return { ok: false, refus: "stock" }

    // Comptage, contrôle du doublon et insertion dans la même transaction : deux ajouts simultanés ne dépassent pas la limite
    return db.transaction(() => {
        const actifs = articles(guild.id)
        if (actifs.length >= ARTICLES_MAX) return { ok: false, refus: "plein" }
        if (actifs.some(a => estRole ? a.roleId === roleId : a.objet === item)) return { ok: false, refus: "doublon" }
        const id = Number(db.sqlAll(`INSERT INTO shop_items (guild_id, kind, name, price, stock, role_id, duration_s, item)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, [guild.id, type, nomFinal.trim(), prixFinal, stock, roleId, duree, item])[0].id)
        return { ok: true, article: lireArticle(guild.id, id), jours: joursDeJeu(prixFinal) }
    })
}

// Retire l'article de la boutique (il n'est plus proposé ni achetable). Renvoie true s'il existait.
const retirerArticle = (guildId, id) =>
    db.sqlRun("UPDATE shop_items SET active = 0 WHERE guild_id = ? AND id = ? AND active = 1", [guildId, id]) === 1

// Modifie le nom, le prix ou le stock (null : stock illimité ; 0 : épuisé). Renvoie { ok, article, jours } ou { ok: false, refus }.
function modifierArticle(guildId, id, { nom, prix, stock } = {}) {
    if (nom !== undefined && !nomValide(nom)) return { ok: false, refus: "nom" }
    if (prix !== undefined && !prixValide(prix)) return { ok: false, refus: "prix" }
    if (stock !== undefined && !stockValide(stock, 0)) return { ok: false, refus: "stock" }
    const champs = []
    const valeurs = []
    if (nom !== undefined) { champs.push("name = ?"); valeurs.push(nom.trim()) }
    if (prix !== undefined) { champs.push("price = ?"); valeurs.push(prix) }
    if (stock !== undefined) { champs.push("stock = ?"); valeurs.push(stock) }
    if (!champs.length) return { ok: false, refus: "rien" }
    // Les colonnes viennent de la liste ci-dessus, jamais de l'appelant
    const changes = db.sqlRun(`UPDATE shop_items SET ${champs.join(", ")} WHERE guild_id = ? AND id = ? AND active = 1`, [...valeurs, guildId, id])
    if (!changes) return { ok: false, refus: "inconnu" }
    const modifie = lireArticle(guildId, id)
    return { ok: true, article: modifie, jours: joursDeJeu(modifie.prix) }
}

// --- Achat -----------------------------------------------------------------------------------------------------

// Achats en cours, par membre et par article : un double clic ne paie pas deux fois (le rôle est donné après un await)
const achatsEnCours = new Set()

// Prend un exemplaire du stock (si l'article en a un) au prix lu : une seule requête, donc deux achats simultanés du
// dernier exemplaire ne passent jamais tous les deux. Renvoie null si c'est pris, sinon le motif du refus.
function reserverStock(a) {
    const changes = db.sqlRun(`UPDATE shop_items SET stock = stock - 1 WHERE guild_id = ? AND id = ? AND active = 1 AND price = ?
        AND (stock IS NULL OR stock > 0)`, [a.guildId, a.id, a.prix])
    if (changes) return null
    const actuel = lireArticle(a.guildId, a.id)
    if (!actuel) return "inconnu"
    return actuel.prix !== a.prix ? "prix_change" : "rupture"
}

const rendreStock = a =>
    db.sqlRun("UPDATE shop_items SET stock = stock + 1 WHERE guild_id = ? AND id = ? AND stock IS NOT NULL", [a.guildId, a.id])

// Rend la monnaie (eco.rembourser : sans contrôle de droits, hors plafond du jour, sans réduction « nouveau membre »).
// true si tout est revenu ; si le solde maximum a rogné le crédit, c'est écrit dans les logs et le résultat est false.
function rembourser(member, a, motif) {
    try {
        const r = eco.rembourser(member.guild.id, member.id, a.prix, { source: "remboursement", details: { article: a.id, motif } })
        if (r.credite === a.prix) return true
        console.error(`Remboursement incomplet (serveur ${member.guild.id}, membre ${member.id}, article ${a.id}) :`, JSON.stringify(r))
    } catch (err) {
        console.error(`Remboursement impossible (serveur ${member.guild.id}, membre ${member.id}, article ${a.id}) :`, err.message)
    }
    return false
}

// Après un échec de roles.add, le rôle a pu être donné quand même (réponse perdue). Relit le membre :
// "possede" (rôle bien là), "absent" (rôle pas donné, ou membre parti), "inconnu" (relecture impossible).
async function etatLivraison(guild, userId, roleId) {
    try {
        const frais = await fetchMember(guild, userId)
        return frais?.roles.cache.has(roleId) ? "possede" : "absent"
    } catch (err) {
        console.error(`Relecture du membre impossible (serveur ${guild.id}, membre ${userId}) :`, err.message)
        return "inconnu"
    }
}

// Achat d'un article par un membre. Renvoie { ok: true, article, solde, expireA } ou { ok: false, refus, roleId?, rembourse? } :
//   refus de l'économie (REFUS_ECONOMIE), ou inconnu, rupture, prix_change, deja_possede, en_cours, inventaire_plein,
//   un motif de refusRole (rôle devenu dangereux ou trop haut), ou role_impossible (Discord a refusé : monnaie rendue).
// Ordre : refus sans effet, stock pris, débit, livraison. Si la livraison échoue, la monnaie et le stock sont rendus.
// Livraison ambiguë (échec de roles.add mais le rôle est bien là, ou relecture impossible) : pas de remboursement.
// (Le débit prend sa propre transaction et SQLite n'accepte pas les transactions imbriquées : le stock est donc pris
// juste avant, par une requête atomique, et rendu si le débit est refusé.)
async function acheter(member, id) {
    const guild = member.guild
    const a = lireArticle(guild.id, id)
    if (!a) return { ok: false, refus: "inconnu" }
    const refusJeu = eco.peutJouer(member)
    if (refusJeu) return { ok: false, refus: refusJeu }

    const cle = `${guild.id}:${member.id}:${a.id}`
    if (achatsEnCours.has(cle)) return { ok: false, refus: "en_cours" }
    achatsEnCours.add(cle)
    try {
        const estRole = a.type !== "objet"
        const role = estRole ? guild.roles.cache.get(a.roleId) : null
        if (estRole) {
            if (!role) return { ok: false, refus: "inexistant", roleId: a.roleId }
            const refus = refusRole(guild, role, { couleur: a.type === "couleur" })
            if (refus) return { ok: false, refus, roleId: role.id }
            if (member.roles.cache.has(role.id)) return { ok: false, refus: "deja_possede", roleId: role.id }
        } else if (inventaire.quantite(guild.id, member.id, a.objet) >= inventaire.QUANTITE_MAX) {
            return { ok: false, refus: "inventaire_plein" }
        }

        const refusStock = reserverStock(a)
        if (refusStock) return { ok: false, refus: refusStock }
        let debit
        try {
            debit = eco.debiter(guild.id, member.id, a.prix, { source: "boutique", details: { article: a.id, nom: a.nom } })
        } catch (err) {
            rendreStock(a)
            throw err
        }
        if (!debit.ok) {
            rendreStock(a)
            return { ok: false, refus: debit.refus }
        }

        // Livraison : en cas d'échec, tout est rendu
        let expireA = null
        try {
            if (a.type === "objet") {
                if (!inventaire.ajouterObjet(guild.id, member.id, a.objet).ok) throw new Error("inventaire plein")
            } else {
                if (a.type === "role_temp") {
                    // Ligne écrite avant le rôle : si le bot s'arrête entre les deux, le rôle sera quand même retiré
                    expireA = Date.now() + a.dureeS * 1000
                    db.sqlRun("INSERT OR REPLACE INTO shop_roles_temp (guild_id, user_id, role_id, expires_at) VALUES (?, ?, ?, ?)",
                        [guild.id, member.id, role.id, expireA])
                }
                await member.roles.add(role, `Boutique : ${a.nom}`.slice(0, 500))
            }
        } catch (err) {
            console.error(`Livraison impossible (serveur ${guild.id}, membre ${member.id}, article ${a.id}) :`, err.message)
            const etat = estRole ? await etatLivraison(guild, member.id, role.id) : "absent"
            if (etat === "possede") {
                // Le rôle est livré malgré l'erreur : l'achat vaut, la ligne du rôle temporaire reste pour le retrait
                emettre("achat", { guildId: guild.id, userId: member.id, itemId: a.id, type: a.type, price: a.prix })
                return { ok: true, article: a, solde: debit.solde, expireA }
            }
            if (etat === "inconnu") return { ok: false, refus: "role_impossible", rembourse: false }
            if (expireA) db.sqlRun("DELETE FROM shop_roles_temp WHERE guild_id = ? AND user_id = ? AND role_id = ?", [guild.id, member.id, role.id])
            const rembourse = rembourser(member, a, "livraison")
            rendreStock(a)
            return { ok: false, refus: "role_impossible", rembourse }
        }

        emettre("achat", { guildId: guild.id, userId: member.id, itemId: a.id, type: a.type, price: a.prix })
        return { ok: true, article: a, solde: debit.solde, expireA }
    } finally {
        achatsEnCours.delete(cle)
    }
}

// --- Rôles temporaires -----------------------------------------------------------------------------------------

const dejaSignale = new Set() // retraits en échec déjà écrits dans les logs (un seul message par rôle)
const ESSAIS_MAX = 5 // échecs de retrait avant d'abandonner la ligne
const ABANDON_APRES = 7 * 24 * 3600 * 1000 // ou 7 jours après l'échéance

// Une autre source donne-t-elle ce rôle de façon durable (palier de niveau, bouton de rôle, rôle d'anniversaire) ?
// On ne peut pas savoir si le membre l'a obtenu autrement entre-temps : dans ce cas on ne le retire pas, car le retirer
// reprendrait un rôle gagné par ailleurs. (La boutique elle-même ne vend jamais deux fois le même rôle : doublon.)
const autreSourceDuRole = (guildId, roleId) =>
    ["SELECT 1 FROM xp_paliers WHERE guild_id = ? AND role_id = ?",
        "SELECT 1 FROM role_panel_buttons WHERE guild_id = ? AND role_id = ?",
        "SELECT 1 FROM anniv_config WHERE guild_id = ? AND role_id = ?"]
        .some(requete => db.sqlAll(requete, [guildId, roleId]).length > 0)

// Retire les rôles temporaires arrivés à échéance. Renvoie le nombre de lignes traitées.
// Une ligne existe seulement si le bot a donné le rôle par un achat (l'achat est refusé si le membre l'a déjà).
// Elle reste tant que le retrait n'a pas réussi (erreur réseau, permission), puis est abandonnée avec un message dans les
// logs après ESSAIS_MAX échecs ou 7 jours après l'échéance. Elle disparaît si le serveur, le membre ou le rôle n'existent plus.
async function retirerExpires(bot, maintenant = Date.now()) {
    const lignes = db.sqlAll("SELECT * FROM shop_roles_temp WHERE expires_at <= ?", [maintenant])
    let traites = 0
    const supprimer = l => db.sqlRun("DELETE FROM shop_roles_temp WHERE guild_id = ? AND user_id = ? AND role_id = ?", [l.guild_id, l.user_id, l.role_id])
    for (const l of lignes) {
        const cle = `${l.guild_id}:${l.user_id}:${l.role_id}`
        try {
            const guild = bot.guilds.cache.get(l.guild_id)
            if (guild && guild.available === false) continue // serveur indisponible : on réessaie plus tard
            const membre = guild ? await fetchMember(guild, l.user_id) : null
            if (membre && membre.roles.cache.has(l.role_id) && !autreSourceDuRole(l.guild_id, l.role_id)) {
                await membre.roles.remove(l.role_id, "Boutique : rôle temporaire expiré")
            }
            supprimer(l)
            dejaSignale.delete(cle)
            traites++
        } catch (err) {
            if (err.code === Discord.RESTJSONErrorCodes.UnknownRole) {
                supprimer(l)
                traites++
                continue
            }
            const echecs = l.failures + 1
            if (echecs >= ESSAIS_MAX || maintenant - l.expires_at >= ABANDON_APRES) {
                console.error(`Retrait du rôle temporaire ${l.role_id} abandonné après ${echecs} échec(s) (serveur ${l.guild_id}, membre ${l.user_id}) : le rôle reste au membre :`, err.message)
                supprimer(l)
                dejaSignale.delete(cle)
                traites++
                continue
            }
            db.sqlRun("UPDATE shop_roles_temp SET failures = ? WHERE guild_id = ? AND user_id = ? AND role_id = ?", [echecs, l.guild_id, l.user_id, l.role_id])
            if (!dejaSignale.has(cle)) {
                dejaSignale.add(cle)
                console.error(`Retrait du rôle temporaire ${l.role_id} impossible (serveur ${l.guild_id}, membre ${l.user_id}), nouvel essai plus tard :`, err.message)
            }
        }
    }
    return traites
}

let enCours = false

function startBoutiqueSchedule(bot) {
    const passer = async () => {
        if (enCours) return
        enCours = true
        try {
            await retirerExpires(bot)
        } catch (err) {
            console.error("Retrait des rôles temporaires en échec :", err.message)
        } finally {
            enCours = false
        }
    }
    passer()
    setInterval(passer, INTERVALLE_RETRAIT).unref()
}

module.exports = {
    TYPES, PRIX_MIN, PRIX_MAX, ARTICLES_MAX, DUREE_MIN, DUREE_MAX, REFUS_ECONOMIE,
    joursDeJeu, refusRole, articles, lireArticle, ajouterArticle, retirerArticle, modifierArticle, acheter, retirerExpires, startBoutiqueSchedule
}
