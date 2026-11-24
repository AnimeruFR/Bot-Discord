const Discord = require('discord.js')

const MAX_MESSAGES = 1000 // au-delà, le transcript est tronqué (évite de bloquer le bot sur un énorme salon)
const MAX_OCTETS_TRANSCRIPT = 7 * 1024 * 1024 // limite d'envoi de fichier de Discord : 10 Mio sans boost
const MAX_OCTETS_ENVOI = 8 * 1024 * 1024 // pièces jointes : par message envoyé
const MAX_OCTETS_PIECES = 40 * 1024 * 1024 // pièces jointes : au total pour un ticket
const HOTES_CDN = ["cdn.discordapp.com", "media.discordapp.net"]

let contenuDisponible = null

// Sans le "Message Content Intent" (Developer Portal > Bot), Discord renvoie les messages sans leur texte
async function messageContentActive(client) {
    if (contenuDisponible === null) {
        try {
            const application = await client.application.fetch()
            const { GatewayMessageContent, GatewayMessageContentLimited } = Discord.ApplicationFlagsBitField.Flags
            contenuDisponible = application.flags.any(GatewayMessageContent | GatewayMessageContentLimited)
        } catch (err) {
            // Inconnu : on prévient par précaution, et on réessaiera la prochaine fois
            console.error("Impossible de lire les réglages de l'application :", err.message)
            return false
        }
    }
    return contenuDisponible
}

function date(timestamp) {
    return new Date(timestamp).toISOString().replace("T", " ").slice(0, 16) + " UTC"
}

async function fetchMessages(channel) {
    const messages = []
    let before
    while (messages.length < MAX_MESSAGES) {
        const lot = await channel.messages.fetch({ limit: 100, before, cache: false })
        if (lot.size === 0) break
        messages.push(...lot.values())
        before = lot.lastKey()
        if (lot.size < 100) break
    }
    return messages.reverse() // du plus ancien au plus récent
}

// Construit le transcript texte d'un salon. Renvoie { texte, nombre, pieces }.
async function buildTranscript(channel, { fermePar, auteurId }) {
    const messages = await fetchMessages(channel)
    const contenu = await messageContentActive(channel.client)

    // Un bloc de texte par message ; on garde les plus récents si le fichier dépasse la limite de Discord
    const blocs = messages.map(message => {
        const lignes = [`[${date(message.createdTimestamp)}] ${message.author.tag} (${message.author.id}) : ${message.content ? message.content.replace(/\n/g, "\n    ") : ""}`]
        for (const fichier of message.attachments.values()) lignes.push(`    [pièce jointe] ${fichier.name}`)
        if (message.embeds.length) lignes.push(`    [${message.embeds.length} embed(s)]`)
        return lignes.join("\n")
    })
    let octets = 0
    let garde = 0
    for (let i = blocs.length - 1; i >= 0; i--) {
        const taille = Buffer.byteLength(blocs[i], "utf8") + 1
        if (octets + taille > MAX_OCTETS_TRANSCRIPT) break
        octets += taille
        garde++
    }
    const tronque = garde < blocs.length || messages.length >= MAX_MESSAGES

    const entete = [
        `Transcript du ticket #${channel.name}`,
        `Auteur du ticket : ${auteurId}`,
        `Créé le : ${date(channel.createdTimestamp)}`,
        `Supprimé le : ${date(Date.now())} par ${fermePar.tag} (${fermePar.id})`,
        `Messages : ${garde}${tronque ? " (transcript tronqué : seuls les messages les plus récents sont gardés)" : ""}`
    ]
    if (!contenu) entete.push("ATTENTION : le Message Content Intent n'est pas activé, le texte des messages des membres est vide.")
    entete.push("=".repeat(60), "")

    const pieces = messages.flatMap(message => [...message.attachments.values()])

    return { texte: entete.concat(blocs.slice(blocs.length - garde)).join("\n"), nombre: garde, pieces }
}

// Télécharge un fichier du CDN de Discord. Renvoie null s'il n'existe plus (404/403).
// Une erreur passagère (429, 5xx) est retentée, puis lève une erreur : la suppression du ticket est alors annulée.
async function telecharger(url, essais = 3) {
    for (let essai = 1; essai <= essais; essai++) {
        // redirect "error" : on ne suit pas une redirection vers un autre hôte que le CDN vérifié
        const reponse = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30000) })
        if (reponse.ok) {
            const taille = Number(reponse.headers.get("content-length") ?? 0)
            if (taille > MAX_OCTETS_ENVOI) return null
            return Buffer.from(await reponse.arrayBuffer())
        }
        if (reponse.status === 404 || reponse.status === 403) return null
        if (essai < essais) await new Promise(r => setTimeout(r, 2000 * essai))
    }
    throw new Error(`Téléchargement impossible : ${url.pathname}`)
}

// Télécharge les pièces jointes (elles disparaissent du CDN de Discord une fois le salon supprimé)
// et les renvoie dans le salon de logs par paquets. Renvoie la liste de celles qui n'ont pas pu être gardées.
async function sendAttachments(logs, pieces, nomTicket) {
    const ignorees = []
    let total = 0
    let paquet = []
    let taillePaquet = 0

    const envoyer = async () => {
        if (paquet.length === 0) return
        await logs.send({ content: `Pièces jointes du ticket \`#${nomTicket}\``, files: paquet })
        paquet = []
        taillePaquet = 0
    }

    // Les plus récentes d'abord : si le plafond total est atteint, ce sont les plus anciennes qui sautent
    const ordre = [...pieces.entries()].reverse()
    for (const [index, piece] of ordre) {
        const url = URL.canParse(piece.url) ? new URL(piece.url) : null
        if (!url || url.protocol !== "https:" || !HOTES_CDN.includes(url.hostname) || piece.size > MAX_OCTETS_ENVOI || total + piece.size > MAX_OCTETS_PIECES) {
            ignorees.push(piece.name)
            continue
        }
        const contenu = await telecharger(url)
        if (!contenu || contenu.length > MAX_OCTETS_ENVOI || total + contenu.length > MAX_OCTETS_PIECES) {
            ignorees.push(piece.name)
            continue
        }

        if (paquet.length === 10 || taillePaquet + contenu.length > MAX_OCTETS_ENVOI) await envoyer()
        paquet.push(new Discord.AttachmentBuilder(contenu, { name: `${index + 1}-${piece.name}` }))
        taillePaquet += contenu.length
        total += contenu.length
    }
    await envoyer()
    return ignorees
}

module.exports = { buildTranscript, sendAttachments, messageContentActive, MAX_OCTETS_TRANSCRIPT }
