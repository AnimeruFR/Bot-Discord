const Discord = require('discord.js')
const crypto = require('crypto')
const db = require('./db')
const { sendModLog } = require('./logs')
const { t } = require('./i18n')

const EPHEMERAL = Discord.MessageFlags.Ephemeral

// Tirage équitable (crypto.randomInt) de n gagnants parmi les participants, sans ceux à exclure
function tirer(participants, n, exclure = []) {
    const urne = participants.filter(id => !exclure.includes(id))
    // Mélange de Fisher-Yates partiel : seules les n premières places comptent
    for (let i = 0; i < Math.min(n, urne.length); i++) {
        const j = i + crypto.randomInt(urne.length - i)
        const memo = urne[i]
        urne[i] = urne[j]
        urne[j] = memo
    }
    return urne.slice(0, n)
}

// Tire n gagnants ENCORE présents sur le serveur : on mélange tout le monde, puis on vérifie un par un
// (requête REST par candidat, pas de limite de la gateway) jusqu'à en avoir n. Les membres partis sont aussi
// retirés dès leur départ (événement guildMemberRemove). Erreur passagère de Discord : le candidat est gardé.
async function choisirGagnants(guild, participants, n, exclure = []) {
    const ordre = tirer(participants, participants.length, exclure)
    const gagnants = []
    let verifications = 0
    for (const id of ordre) {
        if (gagnants.length >= n || verifications >= n + 50) break
        verifications++
        const present = await guild.members.fetch({ user: id, force: true }).then(() => true).catch(err =>
            err.code === Discord.RESTJSONErrorCodes.UnknownMember || err.code === Discord.RESTJSONErrorCodes.UnknownUser ? false : true)
        if (present) gagnants.push(id)
    }
    return gagnants
}

// Message du giveaway (le prix est écrit par un modérateur : échappé, et aucune mention n'est jamais active)
// guild : pour la langue du serveur (message public)
function contenuGiveaway(g, { termine = false, gagnants = [], guild = null } = {}) {
    const prix = Discord.escapeMarkdown(g.prix)
    const l = guild ?? "fr"
    const embed = new Discord.EmbedBuilder()
        .setColor(termine ? 0x95A5A6 : 0xF1C40F)
        .setTitle(t(l, "giveaway.titre", { prix }).slice(0, 256))
        .setDescription(termine
            ? (gagnants.length ? t(l, "giveaway.termine", { gagnants: gagnants.map(id => `<@${id}>`).join(", ") }) : t(l, "giveaway.termine_vide"))
            : t(l, "giveaway.en_cours", { fin: `<t:${Math.floor(g.ends_at / 1000)}:R>`, gagnants: g.gagnants }))
        .setFooter({ text: t(l, "giveaway.pied", { id: g.id }) })
    const bouton = new Discord.ButtonBuilder().setCustomId(`giveaway:${g.id}`).setLabel(t(l, "giveaway.bouton")).setEmoji("🎉")
        .setStyle(Discord.ButtonStyle.Primary).setDisabled(termine)
    return { embeds: [embed], components: [new Discord.ActionRowBuilder().addComponents(bouton)] }
}

// Tire les gagnants d'un giveaway arrivé à échéance (ou terminé à la main), puis publie le résultat
async function terminer(bot, g) {
    const guild = bot.guilds.cache.get(g.guild_id)
    if (!guild?.available) return false // serveur absent de ce processus ou en panne : on réessaiera
    const gagnants = await choisirGagnants(guild, db.listEntries(g.id), g.gagnants)
    // Fin et gagnants écrits ensemble, seulement si le giveaway était encore en cours : jamais deux tirages
    if (!db.endGiveaway(g.id, gagnants)) return false
    await publier(bot, db.getGiveawayById(g.id))
    return true
}

// Publie le résultat (annonce + message mis à jour). Rejouée au passage suivant si le bot s'arrête avant la fin.
// La publication est réservée en base : la commande et la tâche de fond ne publient jamais deux fois.
async function publier(bot, g) {
    const guild = bot.guilds.cache.get(g.guild_id)
    if (!guild?.available) return
    if (!db.reserveGiveawayAnnounce(g.id)) return
    const gagnants = JSON.parse(g.winners)
    const channel = guild.channels.cache.get(g.channel_id)
    if (channel) {
        if (g.message_id) {
            const message = await channel.messages.fetch(g.message_id).catch(() => null)
            await message?.edit(contenuGiveaway(g, { termine: true, gagnants, guild })).catch(() => {})
        }
        const prix = Discord.escapeMarkdown(g.prix)
        const texte = gagnants.length
            ? t(guild, "giveaway.felicitations", { gagnants: gagnants.map(id => `<@${id}>`).join(", "), prix, id: g.id })
            : t(guild, "giveaway.sans_gagnant", { prix, id: g.id })
        // Seuls les gagnants sont mentionnés (jamais @everyone ni un rôle, même écrit dans le prix)
        await channel.send({ content: texte, allowedMentions: { parse: [], users: gagnants } }).catch(err => {
            console.error(`Annonce du giveaway ${g.id} impossible :`, err.message)
        })
    }
    db.setGiveawayAnnounced(g.id)
    await sendModLog({ guild, user: bot.user }, { action: "giveaway", details: `Giveaway n°${g.id} terminé : ${gagnants.length ? gagnants.map(id => `<@${id}>`).join(", ") : "aucun gagnant"}` })
}

// Nouveau tirage parmi les participants, sans AUCUN des gagnants précédents. Renvoie les nouveaux gagnants
// ([] : plus personne, rien n'est changé ni publié ; null : serveur indisponible).
async function relancer(bot, g) {
    const guild = bot.guilds.cache.get(g.guild_id)
    if (!guild?.available) return null
    const anciens = [...new Set([...JSON.parse(g.previous_winners), ...JSON.parse(g.winners)])]
    const gagnants = await choisirGagnants(guild, db.listEntries(g.id), g.gagnants, anciens)
    if (gagnants.length === 0) return []
    if (!db.setGiveawayWinners(g.id, gagnants, anciens)) return null
    await publier(bot, db.getGiveawayById(g.id))
    return gagnants
}

// Bouton « Participer » : tout est relu en base (le giveaway doit correspondre à CE message et être en cours)
async function onClicGiveaway(bot, interaction) {
    if (!interaction.inCachedGuild()) return
    const id = Number(interaction.customId.slice("giveaway:".length))
    const g = Number.isInteger(id) ? db.getGiveaway(interaction.guild.id, id) : null
    if (!g || g.message_id !== interaction.message.id) return interaction.reply({ content: t(interaction, "giveaway.inexistant"), flags: EPHEMERAL })
    if (g.status !== "en_cours" || g.ends_at <= Date.now()) return interaction.reply({ content: t(interaction, "giveaway.fini"), flags: EPHEMERAL })

    if (db.addEntry(g.id, interaction.user.id)) {
        return interaction.reply({ content: t(interaction, "giveaway.participe", { nombre: db.countEntries(g.id) }), flags: EPHEMERAL })
    }
    db.removeEntry(g.id, interaction.user.id)
    return interaction.reply({ content: t(interaction, "giveaway.retire"), flags: EPHEMERAL })
}

module.exports = { tirer, choisirGagnants, contenuGiveaway, terminer, publier, relancer, onClicGiveaway }
