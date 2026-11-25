const Discord = require('discord.js')

const { Flags } = Discord.PermissionsBitField

// Permissions MINIMALES dont le bot a besoin, avec la fonction qui les utilise.
// Jamais « Administrateur » : un bot compromis ne doit pas pouvoir tout faire sur le serveur.
const PERMISSIONS = [
    [Flags.ViewChannel, "voir les salons (tous)"],
    [Flags.SendMessages, "répondre, panneaux, logs, annonces"],
    [Flags.EmbedLinks, "embeds (logs, tickets, giveaways)"],
    [Flags.AttachFiles, "transcripts et pièces jointes des tickets"],
    [Flags.ReadMessageHistory, "transcripts, inactivité des tickets"],
    [Flags.ManageMessages, "/clear"],
    [Flags.ManageChannels, "tickets, /lock, /slowmode"],
    [Flags.ManageRoles, "tickets (permissions des salons), rôles à boutons, /lock"],
    [Flags.KickMembers, "/kick, sanctions automatiques"],
    [Flags.BanMembers, "/ban, /tempban, /unban"],
    [Flags.ModerateMembers, "/mute, /unmute"],
    [Flags.ManageGuild, "/automod (règles AutoMod natives)"],
    [Flags.SendPolls, "/sondage"],
    // /lock retire ces droits à @everyone : Discord exige que le bot les ait lui-même
    [Flags.SendMessagesInThreads, "/lock"],
    [Flags.CreatePublicThreads, "/lock"],
    [Flags.CreatePrivateThreads, "/lock"],
    [Flags.AddReactions, "/lock"]
]

const permissionsMinimales = () => new Discord.PermissionsBitField(PERMISSIONS.map(([flag]) => flag))

// Lien d'invitation (installation sur un serveur, avec les slash commandes)
function lienInvitation(clientId) {
    if (!/^\d{17,20}$/.test(String(clientId))) throw new Error("ID d'application invalide")
    const params = new URLSearchParams({
        client_id: String(clientId),
        scope: "bot applications.commands",
        permissions: permissionsMinimales().bitfield.toString(),
        integration_type: "0"
    })
    return `https://discord.com/oauth2/authorize?${params}`
}

// Lien https valide ou null (les liens du .env sont affichés sur des boutons)
function lienValide(texte) {
    if (!texte || !URL.canParse(texte)) return null
    const url = new URL(texte)
    // 512 caractères au plus : Discord refuse un bouton lien plus long (et toute la réponse avec)
    return url.protocol === "https:" && url.toString().length <= 512 ? url.toString() : null
}

module.exports = { PERMISSIONS, permissionsMinimales, lienInvitation, lienValide }
