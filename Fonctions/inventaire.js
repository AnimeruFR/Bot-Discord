const db = require('./db')
const { peutJouer } = require('./economie')
const { emettre } = require('./evenements')
const { langueDe, LANGUES } = require('./i18n')
const catalogue = require('../data-statique/objets.json')

// Inventaire des membres (idée #30). Le catalogue des objets est versionné dans data-statique/objets.json :
// id, nom et description fr/en, type (consommable ou cosmétique), prix indicatif, effet.
//
// Les écritures sont des requêtes uniques et conditionnelles (jamais de quantité négative, même à deux en même
// temps) : elles peuvent être appelées depuis une transaction comme en dehors. utiliser() prend sa propre transaction.

const QUANTITE_MAX = 99
const STAT_BOOST = "boost_xp_jusqua"

const OBJETS = new Map(catalogue.objets.map(o => [o.id, Object.freeze(o)]))
const objets = () => [...OBJETS.values()]
const objet = id => OBJETS.get(id) ?? null

// Nom ou description d'un objet. cible : "fr", "en" ou une interaction.
function texteObjet(id, champ, cible = "fr") {
    const def = objet(id)
    if (!def) return String(id)
    const langue = LANGUES.includes(cible) ? cible : langueDe(cible)
    return def[champ][langue] ?? def[champ].fr
}
const nomObjet = (id, cible) => texteObjet(id, "nom", cible)
const descriptionObjet = (id, cible) => texteObjet(id, "description", cible)

function verifierObjet(id) {
    if (!OBJETS.has(id)) throw new RangeError(`Objet inconnu : ${id}`)
}

function verifierQuantite(quantite) {
    if (!Number.isSafeInteger(quantite) || quantite < 1 || quantite > QUANTITE_MAX) throw new RangeError(`Quantité invalide : ${quantite}`)
}

function quantite(guildId, userId, id) {
    return db.sqlAll("SELECT quantity FROM inventaire WHERE guild_id = ? AND user_id = ? AND item = ?", [guildId, userId, id])[0]?.quantity ?? 0
}

// Renvoie { ok, quantite }. Refusé (ok false) si le membre dépasserait QUANTITE_MAX exemplaires.
function ajouterObjet(guildId, userId, id, nombre = 1) {
    verifierObjet(id)
    verifierQuantite(nombre)
    const changes = db.sqlRun(`INSERT INTO inventaire (guild_id, user_id, item, quantity) VALUES (?, ?, ?, ?)
        ON CONFLICT (guild_id, user_id, item) DO UPDATE SET quantity = quantity + excluded.quantity
        WHERE quantity + excluded.quantity <= ?`, [guildId, userId, id, nombre, QUANTITE_MAX])
    return { ok: changes === 1, quantite: quantite(guildId, userId, id) }
}

// Renvoie { ok, quantite }. Refusé (ok false, rien retiré) s'il n'y en a pas assez : la quantité ne devient jamais négative.
function retirerObjet(guildId, userId, id, nombre = 1) {
    verifierObjet(id)
    verifierQuantite(nombre)
    const changes = db.sqlRun("UPDATE inventaire SET quantity = quantity - ? WHERE guild_id = ? AND user_id = ? AND item = ? AND quantity >= ?",
        [nombre, guildId, userId, id, nombre])
    if (changes) db.sqlRun("DELETE FROM inventaire WHERE guild_id = ? AND user_id = ? AND item = ? AND quantity <= 0", [guildId, userId, id])
    return { ok: changes === 1, quantite: quantite(guildId, userId, id) }
}

// [{ id, quantite }] dans l'ordre du catalogue
function lister(guildId, userId) {
    const lignes = new Map(db.sqlAll("SELECT item, quantity FROM inventaire WHERE guild_id = ? AND user_id = ? AND quantity > 0", [guildId, userId])
        .map(l => [l.item, l.quantity]))
    return objets().filter(o => lignes.has(o.id)).map(o => ({ id: o.id, quantite: lignes.get(o.id) }))
}

// --- Boost d'XP ------------------------------------------------------------------------------------------------

const MULTIPLICATEUR_BOOST = OBJETS.get("boost_xp").effet.multiplicateur

const finBoost = (guildId, userId) =>
    db.sqlAll("SELECT value FROM stats_joueur WHERE guild_id = ? AND user_id = ? AND stat = ?", [guildId, userId, STAT_BOOST])[0]?.value ?? 0

// Multiplicateur d'XP du membre : 1,25 tant que son boost court, sinon 1 (utilisé par Fonctions/xp.js)
function boostXp(guildId, userId, maintenant = Date.now()) {
    return finBoost(guildId, userId) > maintenant ? MULTIPLICATEUR_BOOST : 1
}

// Millisecondes restantes du boost (0 s'il n'y en a pas)
const boostRestant = (guildId, userId, maintenant = Date.now()) => Math.max(0, finBoost(guildId, userId) - maintenant)

// --- Utilisation -----------------------------------------------------------------------------------------------

// Effets des objets utilisables, par type d'effet. Renvoie { refus } sans rien changer, ou le résultat de l'effet.
// Un type d'effet sans entrée ici (ticket_tirage, réservé à la phase 4) n'est pas utilisable.
const EFFETS = {
    boost_xp(guildId, userId, def, maintenant) {
        if (finBoost(guildId, userId) > maintenant) return { refus: "boost_actif" }
        const jusqua = maintenant + def.effet.duree_s * 1000
        db.sqlRun(`INSERT INTO stats_joueur (guild_id, user_id, stat, value) VALUES (?, ?, ?, ?)
            ON CONFLICT (guild_id, user_id, stat) DO UPDATE SET value = excluded.value`, [guildId, userId, STAT_BOOST, jusqua])
        return { jusqua }
    }
}

// Consomme un exemplaire et applique l'effet, dans la même transaction : l'objet n'est jamais consommé sans effet,
// ni utilisé deux fois. Renvoie { ok: true, objet, jusqua } ou { ok: false, refus } :
// inconnu, inutilisable, absent, boost_actif, ou un refus de l'économie (module, gele, sanctionne).
function utiliser(member, id, maintenant = Date.now()) {
    const def = objet(id)
    if (!def) return { ok: false, refus: "inconnu" }
    const effet = EFFETS[def.effet.type]
    if (!effet) return { ok: false, refus: "inutilisable" }
    const refus = peutJouer(member)
    if (refus) return { ok: false, refus }

    const guildId = member.guild.id, userId = member.id
    const resultat = db.transaction(() => {
        if (quantite(guildId, userId, id) < 1) return { ok: false, refus: "absent" }
        const applique = effet(guildId, userId, def, maintenant)
        if (applique.refus) return { ok: false, refus: applique.refus }
        retirerObjet(guildId, userId, id)
        return { ok: true, objet: id, ...applique }
    })
    if (resultat.ok) emettre("objet:utilise", { guildId, userId, itemId: id })
    return resultat
}

module.exports = {
    QUANTITE_MAX, objets, objet, nomObjet, descriptionObjet,
    ajouterObjet, retirerObjet, quantite, lister, boostXp, boostRestant, utiliser
}
