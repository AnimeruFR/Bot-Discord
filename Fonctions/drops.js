const Discord = require('discord.js')
const db = require('./db')
const economie = require('./economie')
const { motifIndisponible, moduleActif } = require('./modules')
const { emettre } = require('./evenements')
const { refuser } = require('./erreurs')
const { t } = require('./i18n')

// Drops dans le chat (idée #72). Contrat : peutEtreDrop(message) est appelé à chaque message (Events/messageCreate.js)
// et fait parfois apparaître un coffre dans un salon choisi par l'admin (/drops).
//   - fréquence liée à l'activité : chaque minute où le salon est actif (au moins un message) donne 1 chance sur 60
//     de faire apparaître un coffre, soit environ 1 drop par heure d'activité ;
//   - au plus 1 drop toutes les 20 minutes par salon ;
//   - le premier qui clique gagne 25 à 100 ✦ (gain « actif » : plafond du jour et réduction des nouveaux comptes) ;
//   - le coffre se referme au bout de 2 minutes. Il n'est gardé qu'en mémoire (collecteur sur le message) : un
//     redémarrage du bot referme les coffres ouverts, sans rien de perdu. Le bouton des coffres d'avant le redémarrage
//     (identifiant « drop: ») est repris par une route persistante qui répond « coffre fermé » (coffreFerme) ;
//     les nouveaux coffres ont un autre identifiant (« coffre: »), pour ne pas passer par cette route.
// Événement émis : "drop:ramasse" ({ guildId, userId, channelId, amount }).

const ID_COFFRE = "coffre:ouvrir"
const PREFIXE_ANCIEN_COFFRE = "drop:"
const CHANCE_PAR_MINUTE = 1 / 60
const INTERVALLE_MIN_MS = 20 * 60 * 1000
const DUREE_COFFRE_MS = 2 * 60 * 1000
const GAIN_MIN = 25
const GAIN_MAX = 100
const MAX_SALONS = 25
const DUREE_CACHE_MS = 60 * 1000
const MAX_ENTREES = 1000 // bornes des tables en mémoire

const cacheConfig = new Map() // serveur -> { salons, jusqua }
const activite = new Map() // salon -> { minute, dernierDrop }

// --- Configuration (table drops_config) ------------------------------------------------------------------------

function salonsDrops(guildId, maintenant = Date.now()) {
    const connu = cacheConfig.get(guildId)
    if (connu && connu.jusqua > maintenant) return connu.salons
    const ligne = db.sqlAll("SELECT channels FROM drops_config WHERE guild_id = ?", [guildId])[0]
    let salons = []
    try { salons = ligne ? JSON.parse(ligne.channels) : [] } catch { /* liste illisible : aucun salon */ }
    if (cacheConfig.size >= MAX_ENTREES) cacheConfig.clear()
    cacheConfig.set(guildId, { salons, jusqua: maintenant + DUREE_CACHE_MS })
    return salons
}

// Remplace la liste des salons (liste vide : drops désactivés). Lève une RangeError si la liste est invalide.
function definirSalonsDrops(guildId, salons) {
    const ids = [...new Set(salons.map(String))]
    if (ids.length > MAX_SALONS || ids.some(id => !/^\d{5,25}$/.test(id))) throw new RangeError(`salons : ${MAX_SALONS} identifiants de salon au plus`)
    db.sqlRun(`INSERT INTO drops_config (guild_id, channels) VALUES (?, ?)
        ON CONFLICT (guild_id) DO UPDATE SET channels = excluded.channels`, [guildId, JSON.stringify(ids)])
    cacheConfig.delete(guildId)
    return ids
}

// --- Apparition ------------------------------------------------------------------------------------------------

const montantAleatoire = (aleatoire = Math.random) => GAIN_MIN + Math.floor(aleatoire() * (GAIN_MAX - GAIN_MIN + 1))

function etatSalon(channelId) {
    let etat = activite.get(channelId)
    if (!etat) {
        if (activite.size >= MAX_ENTREES) activite.delete(activite.keys().next().value)
        etat = { minute: null, dernierDrop: 0, enCours: false }
        activite.set(channelId, etat)
    }
    return etat
}

// Un message est écrit dans un salon : renvoie true si un coffre est apparu.
// options (tests) : aleatoire() renvoie un nombre de [0, 1[, maintenant est l'instant du message.
async function peutEtreDrop(message, { aleatoire = Math.random, maintenant = Date.now() } = {}) {
    const guild = message.guild
    if (!guild || message.author?.bot || message.webhookId) return false
    if (!salonsDrops(guild.id, maintenant).includes(message.channel.id)) return false
    if (!moduleActif(guild.id, "communaute.jeux")) return false

    // Une seule chance par minute active : écrire vite et beaucoup ne fait pas apparaître plus de coffres
    const etat = etatSalon(message.channel.id)
    const minute = Math.floor(maintenant / 60000)
    if (etat.minute === minute) return false
    etat.minute = minute
    if (etat.enCours || maintenant - etat.dernierDrop < INTERVALLE_MIN_MS) return false
    if (aleatoire() >= CHANCE_PAR_MINUTE) return false
    // Le délai de 20 minutes ne démarre qu'une fois le coffre réellement posté : un envoi raté ne bloque pas le salon
    etat.enCours = true
    try {
        await poserCoffre(message.channel, guild, { montant: montantAleatoire(aleatoire) })
    } catch (err) {
        console.warn(`Drop : coffre non posté dans ${message.channel.id} (${err.message})`)
        return false
    } finally {
        etat.enCours = false
    }
    etat.dernierDrop = maintenant
    return true
}

async function poserCoffre(salon, guild, { montant }) {
    const bouton = new Discord.ButtonBuilder().setCustomId(ID_COFFRE).setLabel(t(guild, "duels.drop.bouton")).setEmoji("🎁").setStyle(Discord.ButtonStyle.Success)
    const message = await salon.send({
        content: t(guild, "duels.drop.apparait", { min: GAIN_MIN, max: GAIN_MAX, monnaie: economie.monnaie(guild.id).emoji, minutes: DUREE_COFFRE_MS / 60000 }),
        components: [new Discord.ActionRowBuilder().addComponents(bouton)]
    })
    const coffre = { guildId: guild.id, channelId: salon.id, montant, pris: false }
    // Collecteur sur le message : pas de passage par la garde des salons de jeux (le coffre est dans le salon choisi par l'admin)
    const collecteur = message.createMessageComponentCollector({ componentType: Discord.ComponentType.Button, time: DUREE_COFFRE_MS })
    collecteur.on("collect", async interaction => {
        try {
            if (await ramasserCoffre(coffre, interaction)) collecteur.stop("ramasse")
        } catch (err) {
            console.error("Drop : ramassage en échec :", err.message)
        }
    })
    collecteur.on("end", async (_, raison) => {
        if (raison === "ramasse") return
        await message.edit({ content: t(guild, "duels.drop.expire"), components: [] }).catch(() => {})
    })
    return message
}

// Clic sur le coffre. Renvoie true si le coffre a été ouvert (le collecteur s'arrête).
// Aucun « await » entre le test de « pris » et le crédit : deux clics simultanés ne peuvent pas gagner tous les deux.
// Si l'économie refuse (compte gelé, plafond du jour atteint…), le coffre reste fermé pour les autres.
async function ramasserCoffre(coffre, interaction) {
    const member = interaction.member
    const monnaie = economie.monnaie(coffre.guildId)
    const refus = async texte => {
        await refuser(interaction, texte)
        return false
    }
    if (coffre.pris) return refus(t(interaction, "duels.drop.deja"))
    const motif = motifIndisponible(coffre.guildId, { module: "communaute", sousModule: "jeux", name: "drops" })
    if (motif) return refus(t(interaction, `modules.${motif}`))
    const motifEco = economie.peutJouer(member)
    if (motifEco) return refus(t(interaction, `eco.refus.${motifEco}`, { monnaie: monnaie.nom }))

    coffre.pris = true
    const resultat = economie.crediter(member, coffre.montant, { source: "drop", actif: true, details: { salon: coffre.channelId } })
    if (!resultat.ok || resultat.credite === 0) {
        coffre.pris = false
        const texte = resultat.ok ? t(interaction, "eco.plafonne", { monnaie: monnaie.nom }) : t(interaction, `eco.refus.${resultat.refus}`, { monnaie: monnaie.nom })
        return refus(texte)
    }
    emettre("drop:ramasse", { guildId: coffre.guildId, userId: member.id, channelId: coffre.channelId, amount: resultat.credite })
    await interaction.update({
        content: t(interaction, "duels.drop.ouvert", { user: `<@${member.id}>`, gain: economie.formater(coffre.guildId, resultat.credite) }),
        components: []
    }).catch(err => console.warn(`Drop : message non modifié (${err.message})`))
    return true
}

// Bouton d'un coffre posé avant un redémarrage : plus personne ne l'écoute, on l'explique et on retire le bouton
async function coffreFerme(bot, interaction) {
    await refuser(interaction, t(interaction, "duels.drop.ferme"))
    await interaction.message?.edit?.({ content: t(interaction, "duels.drop.expire"), components: [] }).catch(() => {})
}

module.exports = {
    ID_COFFRE, PREFIXE_ANCIEN_COFFRE, coffreFerme, peutEtreDrop, poserCoffre, ramasserCoffre, salonsDrops, definirSalonsDrops, montantAleatoire,
    GAIN_MIN, GAIN_MAX, INTERVALLE_MIN_MS, DUREE_COFFRE_MS, MAX_SALONS
}
