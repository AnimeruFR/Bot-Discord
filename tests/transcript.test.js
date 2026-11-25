process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')
const assert = require('node:assert')
const Discord = require('discord.js')
const { buildTranscript, MAX_OCTETS_TRANSCRIPT, sendAttachments, echapper } = require('../Fonctions/transcript')

const U = "333333333333333333", MOD = "444444444444444444"

const faux = Array.from({ length: 250 }, (_, i) => ({
    id: String(1000 + i),
    content: i === 0 ? "premier\nsur deux lignes" : `message ${i}`,
    createdTimestamp: Date.UTC(2026, 0, 1) + i * 60000,
    author: { tag: "membre", id: U },
    attachments: new Discord.Collection(i === 5 ? [["a", { name: "preuve.png", url: "https://cdn.exemple/preuve.png" }]] : []),
    embeds: []
}))
const salonFactice = {
    name: "ticket-bob",
    createdTimestamp: Date.UTC(2026, 0, 1),
    client: { application: { fetch: async () => ({ flags: new Discord.ApplicationFlagsBitField(0) }) } },
    messages: {
        // Comme Discord : du plus récent au plus ancien, avant l'ID "before"
        fetch: async ({ limit, before }) => {
            const avant = faux.filter(m => !before || Number(m.id) < Number(before)).reverse().slice(0, limit)
            return new Discord.Collection(avant.map(m => [m.id, m]))
        }
    }
}

test("transcript", async () => {
    const { texte, nombre } = await buildTranscript(salonFactice, { fermePar: { tag: "modo", id: MOD }, auteurId: U })
        assert.strictEqual(nombre, 250, "toutes les pages sont lues")
        assert.ok(texte.indexOf("premier") < texte.indexOf("message 249"), "ordre chronologique")
        assert.ok(texte.includes("premier\n    sur deux lignes"), "lignes multiples indentées")
        assert.ok(texte.includes("[pièce jointe] preuve.png"), "pièces jointes listées")
        assert.ok(texte.includes("Message Content Intent"), "avertissement si l'intent est absent")
})

const enorme = Array.from({ length: 1000 }, (_, i) => ({
    id: String(10000 + i),
    content: `${i} ` + "😀".repeat(2000), // ~8 Ko par message, ~8 Mo au total
    createdTimestamp: Date.UTC(2026, 0, 1) + i * 1000,
    author: { tag: "membre", id: U },
    attachments: new Discord.Collection(),
    embeds: []
}))
const gros = { ...salonFactice, messages: { fetch: async ({ limit, before }) => {
    const avant = enorme.filter(m => !before || Number(m.id) < Number(before)).reverse().slice(0, limit)
    return new Discord.Collection(avant.map(m => [m.id, m]))
} } }

test("transcript tronqué sous la limite de taille", async () => {
    const { texte, nombre } = await buildTranscript(gros, { fermePar: { tag: "modo", id: MOD }, auteurId: U })
        assert.ok(Buffer.byteLength(texte, "utf8") <= MAX_OCTETS_TRANSCRIPT + 4096, "taille sous la limite")
        assert.ok(nombre < 1000 && texte.includes("999 "), "on garde les plus récents")
        assert.ok(texte.includes("tronqué"), "troncature signalée")
})

const envois = []
const logsFactice = { send: async m => envois.push(m) }

test("pièces jointes filtrées", async () => {
    const ignorees = await sendAttachments(logsFactice, [
        { name: "piege.png", url: "http://169.254.169.254/latest/meta-data", size: 10 },
        { name: "enorme.mp4", url: "https://cdn.discordapp.com/x/enorme.mp4", size: 50 * 1024 * 1024 }
    ], "ticket-bob")
        assert.deepStrictEqual(ignorees.sort(), ["enorme.mp4", "piege.png"], "hôte inconnu et fichier trop lourd ignorés")
        assert.strictEqual(envois.length, 0, "aucun téléchargement ni envoi")
})

test("téléchargement des pièces jointes (404, nouvel essai)", async () => {
    const appels = []
    const reponses = { "/supprime.png": [404], "/instable.png": [503, 200] }
    const fetchOriginal = global.fetch
    global.fetch = async (url, options) => {
        assert.strictEqual(options.redirect, "error", "pas de redirection suivie")
        appels.push(url.pathname)
        const status = reponses[url.pathname].shift()
        return { ok: status === 200, status, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(4) }
    }
    envois.length = 0
    try {
        const ignorees = await sendAttachments(logsFactice, [
            { name: "supprime.png", url: "https://cdn.discordapp.com/supprime.png", size: 4 },
            { name: "instable.png", url: "https://cdn.discordapp.com/instable.png", size: 4 }
        ], "ticket-bob")
        assert.deepStrictEqual(ignorees, ["supprime.png"], "fichier supprimé ignoré")
        assert.strictEqual(appels.filter(a => a === "/instable.png").length, 2, "erreur passagère retentée")
        assert.strictEqual(envois.length, 1, "fichier instable finalement envoyé")
    } finally {
        global.fetch = fetchOriginal // les tests suivants (tableau de bord) utilisent le vrai fetch
    }
})

test("transcript HTML (XSS échappé, CSP)", async () => {
    assert.strictEqual(echapper(`<img src=x onerror="alert('x')">&`), "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;")
    assert.strictEqual(echapper("abc‮def\u0000"), "abcdef", "caractères d'inversion et de contrôle retirés")
    assert.strictEqual(echapper(null), "")

    // Transcript HTML : rien de ce qu'écrit un membre ne devient du HTML
    const piege = [{
        id: "5000", content: "<script>alert(1)</script><img src=x onerror=alert(2)>", createdTimestamp: Date.UTC(2026, 0, 1),
        author: { tag: "\"><script>alert(3)</script>", id: U },
        attachments: new Discord.Collection([["a", { name: "<svg onload=alert(4)>.png", url: "https://cdn.discordapp.com/a.png" }]]), embeds: []
    }]
    const salonPiege = {
        ...salonFactice, name: "ticket-<b>bob</b>",
        messages: { fetch: async ({ before }) => new Discord.Collection(before ? [] : piege.map(m => [m.id, m])) }
    }
    const { html } = await buildTranscript(salonPiege, { fermePar: { tag: "<i>modo</i>", id: MOD }, auteurId: U })
    assert.ok(html.includes("Content-Security-Policy") && html.includes("default-src 'none'"), "CSP présente")
    const corps = html.slice(html.indexOf("<body>"))
    assert.ok(!/<(script|img|svg|iframe|a|i)\b/i.test(corps), "aucune balise venant des membres dans la page")
    assert.ok(!/<[^>]*\son\w+=/i.test(corps), "aucun attribut d'événement (onerror, onload…)")
    assert.ok(corps.includes("ticket-&lt;b&gt;bob&lt;/b&gt;") && corps.includes("&lt;i&gt;modo&lt;/i&gt;"), "nom du salon et pseudo échappés")
    assert.ok(corps.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "le texte reste lisible, échappé")

    // Le formulaire d'ouverture (embed du bot) est recopié dans les deux transcripts, échappé dans le HTML
    const formulaire = [{
        id: "6000", content: "", createdTimestamp: Date.UTC(2026, 0, 1), author: { tag: "bot", id: "1" }, attachments: new Discord.Collection(),
        embeds: [{ title: "Ticket : Support", description: "Bienvenue", fields: [{ name: "Sujet", value: "<b>rôle perdu</b>" }] }]
    }]
    const salonFormulaire = { ...salonFactice, messages: { fetch: async ({ before }) => new Discord.Collection(before ? [] : formulaire.map(m => [m.id, m])) } }
    const recu = await buildTranscript(salonFormulaire, { fermePar: { tag: "modo", id: MOD }, auteurId: U })
    assert.ok(recu.texte.includes("Sujet : <b>rôle perdu</b>"), "formulaire dans le .txt")
    assert.ok(recu.html.includes("Sujet : &lt;b&gt;rôle perdu&lt;/b&gt;"), "formulaire échappé dans le .html")
})
