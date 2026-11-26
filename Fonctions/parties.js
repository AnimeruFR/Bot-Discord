const { sqlAll, sqlRun, transaction } = require('./db')
const { emettre } = require('./evenements')
const { t, langueDe } = require('./i18n')

// Moteur de parties (idée #50) : une seule partie en cours par joueur, état en JSON, fin unique.
// Les jeux sont écrits par-dessus : ils créent la partie, la modifient avec majPartie et la terminent avec terminerPartie.

const DUREE_DEFAUT = 15 * 60 * 1000
const INTERVALLE_EXPIRATION = 30 * 1000
const STATUTS_FIN = ["finie", "annulee", "expiree"]

// Récompenses : l'économie est branchée depuis l'extérieur (pas de dépendance au chargement, plus simple à tester)
let crediter = null
let botCourant = null

function configurerRecompenses(fn) {
    crediter = typeof fn === "function" ? fn : null
}

function lignePartie(ligne) {
    if (!ligne) return null
    return {
        id: ligne.id,
        guildId: ligne.guild_id,
        game: ligne.game,
        channelId: ligne.channel_id,
        messageId: ligne.message_id,
        players: JSON.parse(ligne.players),
        state: JSON.parse(ligne.state),
        status: ligne.status,
        expiresAt: ligne.expires_at,
        createdAt: ligne.created_at,
        updatedAt: ligne.updated_at
    }
}

function lirePartie(id) {
    return lignePartie(sqlAll("SELECT * FROM parties WHERE id = ?", [id])[0])
}

// Partie en cours d'un joueur sur un serveur (une partie dont la date est dépassée n'est plus « en cours »)
function partieEnCours(guildId, userId, maintenant = Date.now()) {
    const ligne = sqlAll(`SELECT * FROM parties WHERE guild_id = ? AND status = 'en_cours' AND expires_at > ?
        AND EXISTS (SELECT 1 FROM json_each(parties.players) WHERE value = ?) ORDER BY id LIMIT 1`, [guildId, maintenant, String(userId)])[0]
    return lignePartie(ligne)
}

// Vérification et écriture dans la même transaction : deux créations simultanées ne peuvent pas passer toutes les deux
function creerPartie({ guildId, game, channelId = null, players, state = {}, dureeMs = DUREE_DEFAUT }) {
    const joueurs = [...new Set((players ?? []).map(String))]
    if (!joueurs.length) throw new Error("creerPartie : aucun joueur")
    return transaction(() => {
        for (const joueur of joueurs) {
            const existante = partieEnCours(guildId, joueur)
            if (existante) return { ok: false, refus: "deja_en_partie", partieId: existante.id, userId: joueur }
        }
        const maintenant = Date.now()
        sqlRun(`INSERT INTO parties (guild_id, game, channel_id, players, state, status, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'en_cours', ?, ?, ?)`,
        [guildId, game, channelId, JSON.stringify(joueurs), JSON.stringify(state), maintenant + dureeMs, maintenant, maintenant])
        const id = sqlAll("SELECT last_insert_rowid() AS id")[0].id
        return { ok: true, partie: lirePartie(id) }
    })
}

// Garde le message (et le salon) du jeu : sert à éditer le message à l'expiration
function lierMessage(id, messageId, channelId = null) {
    return sqlRun("UPDATE parties SET message_id = ?, channel_id = COALESCE(?, channel_id) WHERE id = ?", [String(messageId), channelId, id]) > 0
}

// transformer(state, partie) est synchrone : il renvoie le nouvel état (ou modifie state et ne renvoie rien).
// Lecture et écriture se font dans une transaction : deux clics simultanés s'appliquent l'un après l'autre.
function majPartie(id, transformer, { prolongerMs = null } = {}) {
    return transaction(() => {
        const partie = lirePartie(id)
        if (!partie) return { ok: false, refus: "introuvable" }
        const maintenant = Date.now()
        if (partie.status !== "en_cours" || partie.expiresAt <= maintenant) return { ok: false, refus: "terminee" }
        const resultat = transformer(partie.state, partie)
        const etat = resultat === undefined ? partie.state : resultat
        const expiresAt = prolongerMs ? maintenant + prolongerMs : partie.expiresAt
        sqlRun("UPDATE parties SET state = ?, expires_at = ?, updated_at = ? WHERE id = ?", [JSON.stringify(etat), expiresAt, maintenant, id])
        return { ok: true, partie: lirePartie(id) }
    })
}

// Passe le statut une seule fois (UPDATE conditionnel). Récompenses et événements seulement pour une partie « finie ».
async function terminerPartie(id, { status = "finie", gagnants = [], recompenses = {} } = {}) {
    if (!STATUTS_FIN.includes(status)) throw new Error(`terminerPartie : statut inconnu « ${status} »`)
    const changements = sqlRun("UPDATE parties SET status = ?, updated_at = ? WHERE id = ? AND status = 'en_cours'", [status, Date.now(), id])
    if (!changements) return { ok: false, refus: lirePartie(id) ? "deja_terminee" : "introuvable" }
    const partie = lirePartie(id)
    if (status === "finie") {
        const guild = botCourant?.guilds?.cache?.get(partie.guildId) ?? { id: partie.guildId }
        for (const [userId, montant] of Object.entries(recompenses)) {
            if (!crediter || !(montant > 0)) continue
            try {
                await crediter(guild, userId, montant, { source: `partie:${partie.game}` })
            } catch (err) {
                console.error(`Récompense de la partie ${id} en échec (${userId}) :`, err.message)
            }
        }
        for (const userId of partie.players) emettre("partie:jouee", { guildId: partie.guildId, userId, game: partie.game })
        for (const userId of new Set(gagnants.map(String))) emettre("partie:gagnee", { guildId: partie.guildId, userId, game: partie.game })
    }
    return { ok: true, partie }
}

// Le joueur qui abandonne perd : les autres joueurs gagnent, sans récompense
async function abandonner(id, userId) {
    const partie = lirePartie(id)
    if (!partie) return { ok: false, refus: "introuvable" }
    if (!partie.players.includes(String(userId))) return { ok: false, refus: "pas_joueur" }
    const gagnants = partie.players.filter(joueur => joueur !== String(userId))
    return terminerPartie(id, { status: "finie", gagnants })
}

// Renvoie null si le clic est valable, sinon la clé de traduction du refus.
// state.tour : identifiant du joueur dont c'est le tour, ou son index dans players.
function verifierClic(interaction, partie) {
    if (!partie || partie.status !== "en_cours" || partie.expiresAt <= Date.now()) return "partie.terminee"
    const userId = interaction.user?.id ?? interaction.member?.id
    if (!partie.players.includes(String(userId))) return "partie.pas_joueur"
    const tour = partie.state?.tour
    if (tour !== undefined && tour !== null) {
        const attendu = typeof tour === "number" ? partie.players[tour] : String(tour)
        if (attendu !== String(userId)) return "partie.pas_ton_tour"
    }
    return null
}

// Boutons : "p:<id>:<action>:<arg>..." (100 caractères au plus, sans « : » dans les morceaux)
function customId(partieId, action, ...args) {
    const morceaux = [partieId, action, ...args].map(String)
    if (morceaux.some(morceau => morceau.includes(":"))) throw new Error("customId : « : » interdit dans l'identifiant, l'action et les arguments")
    const id = ["p", ...morceaux].join(":")
    if (id.length > 100) throw new Error(`customId trop long (${id.length} caractères)`)
    return id
}

function lireCustomId(id) {
    const morceaux = String(id).split(":")
    if (morceaux[0] !== "p" || morceaux.length < 3 || !/^\d+$/.test(morceaux[1])) return null
    return { partieId: Number(morceaux[1]), action: morceaux[2], args: morceaux.slice(3) }
}

// Expire les parties dont la date est dépassée (sans récompense) et retire les boutons de leur message
async function expirerParties(bot, maintenant = Date.now()) {
    const lignes = sqlAll("SELECT id FROM parties WHERE status = 'en_cours' AND expires_at <= ?", [maintenant])
    let total = 0
    for (const { id } of lignes) {
        const resultat = await terminerPartie(id, { status: "expiree" })
        if (!resultat.ok) continue
        total++
        const { partie } = resultat
        if (!bot || !partie.channelId || !partie.messageId) continue
        try {
            const salon = await bot.channels.fetch(partie.channelId)
            const message = await salon?.messages?.fetch(partie.messageId)
            const guild = bot.guilds?.cache?.get(partie.guildId)
            await message?.edit({ content: t(guild ? langueDe(guild) : "fr", "partie.expiree"), components: [] })
        } catch (err) {
            // Message supprimé ou salon inaccessible : la partie est de toute façon terminée
            console.warn(`Partie ${id} : message non modifié (${err.message})`)
        }
    }
    return total
}

function startPartiesSchedule(bot) {
    botCourant = bot
    const passer = () => expirerParties(bot).catch(err => console.error("Expiration des parties en échec :", err.message))
    passer()
    setInterval(passer, INTERVALLE_EXPIRATION).unref()
}

module.exports = {
    startPartiesSchedule, expirerParties, configurerRecompenses,
    creerPartie, lirePartie, majPartie, lierMessage, terminerPartie, abandonner, verifierClic, partieEnCours,
    customId, lireCustomId, DUREE_DEFAUT
}
