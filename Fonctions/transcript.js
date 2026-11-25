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

// Texte d'un embed (titre, description, champs) : le formulaire d'ouverture d'un ticket n'existe que là
function texteEmbed(embed) {
    const lignes = []
    if (embed.title) lignes.push(`[${embed.title}]`)
    if (embed.description) lignes.push(embed.description)
    for (const champ of embed.fields ?? []) lignes.push(`${champ.name} : ${champ.value}`)
    return lignes.length ? lignes : ["[embed sans texte]"]
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
        for (const embed of message.embeds) lignes.push(...texteEmbed(embed).map(l => `    | ${l.replace(/\n/g, "\n    | ")}`))
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
    const gardes = messages.slice(messages.length - garde)

    // Version HTML (plus lisible) : seulement si elle tient aussi sous la limite d'envoi
    let html = buildHtml(channel, gardes, { fermePar, auteurId, tronque, contenu })
    if (Buffer.byteLength(html, "utf8") > MAX_OCTETS_TRANSCRIPT) html = null

    return { texte: entete.concat(blocs.slice(blocs.length - garde)).join("\n"), html, nombre: garde, pieces }
}

// Tout ce qui vient de Discord (pseudos, messages, noms de fichiers) passe par ici : aucun HTML brut
// d'un membre ne peut arriver dans la page (pas de balise, pas d'attribut, pas de script).
// Les caractères invisibles d'inversion de sens (U+202E…) et de contrôle sont retirés : ils servent à maquiller un texte.
function echapper(texte) {
    return String(texte ?? "")
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‎‏‪-‮⁦-⁩]/g, "")
        .replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
}

// Page autonome : aucune ressource externe (ni image, ni police, ni script). La politique de sécurité
// (CSP) interdit en plus tout chargement et tout script, même si un échappement venait à manquer.
function buildHtml(channel, messages, { fermePar, auteurId, tronque, contenu }) {
    const lignes = messages.map(message => {
        const pieces = [...message.attachments.values()].map(f => `<li>📎 ${echapper(f.name)}</li>`).join("")
        const embeds = message.embeds.map(e => `<li class="embed">${texteEmbed(e).map(echapper).join("<br>")}</li>`).join("")
        const auteur = message.author.id === auteurId ? " auteur" : ""
        return `<article class="msg${auteur}"><header><b>${echapper(message.author.tag)}</b> <small>${echapper(message.author.id)} · ${echapper(date(message.createdTimestamp))}</small></header>`
            + `<p>${echapper(message.content)}</p>${pieces || embeds ? `<ul>${pieces}${embeds}</ul>` : ""}</article>`
    })
    const avertissements = [
        tronque ? "<p class=\"alerte\">Transcript tronqué : seuls les messages les plus récents sont gardés.</p>" : "",
        contenu ? "" : "<p class=\"alerte\">Le Message Content Intent n'est pas activé : le texte des messages des membres est vide.</p>"
    ].join("")
    return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; script-src 'none'; form-action 'none'; base-uri 'none'">
<meta name="referrer" content="no-referrer">
<title>Ticket #${echapper(channel.name)}</title>
<style>
body{font-family:Segoe UI,Arial,sans-serif;background:#313338;color:#dbdee1;max-width:900px;margin:24px auto;padding:0 16px}
h1{font-size:20px;color:#fff}dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;background:#2b2d31;padding:12px;border-radius:8px}
dt{color:#949ba4}.msg{background:#2b2d31;border-left:3px solid #4e5058;border-radius:6px;padding:8px 12px;margin:8px 0}
.msg.auteur{border-left-color:#5865f2}.msg small{color:#949ba4}.msg p{white-space:pre-wrap;word-wrap:break-word;margin:4px 0}
.msg ul{margin:4px 0;padding-left:18px;color:#b5bac1}.embed{list-style:none;margin-left:-18px;border-left:3px solid #5865f2;background:#232428;padding:6px 10px;border-radius:4px;white-space:pre-wrap}.alerte{background:#4a3c1d;padding:8px;border-radius:6px}
</style></head><body>
<h1>Transcript du ticket #${echapper(channel.name)}</h1>
<dl><dt>Auteur</dt><dd>${echapper(auteurId)}</dd><dt>Créé le</dt><dd>${echapper(date(channel.createdTimestamp))}</dd>
<dt>Supprimé le</dt><dd>${echapper(date(Date.now()))} par ${echapper(fermePar.tag)} (${echapper(fermePar.id)})</dd>
<dt>Messages</dt><dd>${messages.length}</dd></dl>
${avertissements}
${lignes.join("\n")}
</body></html>`
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

module.exports = { buildTranscript, sendAttachments, messageContentActive, echapper, MAX_OCTETS_TRANSCRIPT }
