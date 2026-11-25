const crypto = require('crypto')
const Discord = require('discord.js')

const EPHEMERAL = Discord.MessageFlags.Ephemeral

// Erreur « attendue » : un refus normal (solde insuffisant, partie déjà en cours…).
// Le membre reçoit le message traduit, et rien n'est écrit dans les logs comme un bug.
class ErreurUtilisateur extends Error {
    constructor(cle, variables = {}) {
        super(cle)
        this.name = "ErreurUtilisateur"
        this.cle = cle
        this.variables = variables
    }
}

// Numéro d'incident court, montré au membre et écrit dans les logs : « erreur #A7F3C2 » suffit pour retrouver la trace
const numeroIncident = () => crypto.randomBytes(3).toString("hex").toUpperCase()

// Nom lisible de ce qui a échoué (commande, bouton, menu…)
const decrire = interaction => interaction?.commandName ? `/${interaction.commandName}` : (interaction?.customId ?? interaction?.type ?? "?")

// Répond à une interaction qui a échoué, sans jamais lever d'erreur à son tour.
// Renvoie le numéro d'incident (null pour une ErreurUtilisateur).
async function traiterErreur(interaction, err, journal = console) {
    const attendue = err instanceof ErreurUtilisateur
    const incident = attendue ? null : numeroIncident()
    if (!attendue) journal.error(`[incident ${incident}] Erreur sur ${decrire(interaction)} :`, err)
    if (!interaction?.isRepliable?.()) return incident

    // Sans traduction possible (base indisponible…), message en français
    let texte = attendue ? err.cle : `Une erreur est survenue (incident #${incident}).`
    try {
        const { t } = require('./i18n')
        texte = attendue ? t(interaction, err.cle, err.variables) : t(interaction, "commun.erreur_incident", { incident })
    } catch { /* repli ci-dessus */ }

    const reponse = { content: texte, flags: EPHEMERAL }
    if (interaction.replied || interaction.deferred) await interaction.followUp(reponse).catch(() => {})
    else await interaction.reply(reponse).catch(() => {})
    return incident
}

module.exports = { ErreurUtilisateur, traiterErreur, numeroIncident }
