const crypto = require('crypto')
const Discord = require('discord.js')
const db = require('./db')
const { t } = require('./i18n')
const { couleur } = require('./apparence')
const { moduleActif } = require('./modules')
const { sendModLog, envoyerLog } = require('./logs')
const { refusRole } = require('./rolesBoutons')
const { refusSalonLogs } = require('./config')

// Vérification à l'arrivée (idée #4) : un panneau avec un bouton « Je ne suis pas un robot », puis un défi en
// boutons d'emojis (éphémère). Le bon choix donne le rôle « vérifié ». Le serveur règle lui-même les salons
// visibles sans ce rôle : le bot ne touche à aucune permission de salon.
//
// customId (préfixe « verif: », composant public) :
//   verif:ouvrir                          bouton du panneau
//   verif:r:<membre>:<jeton>:<n°>         réponse n° 0 à 4 du défi de ce membre

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral

const NB_CHOIX = 5
const MAX_ERREURS = 3
const DUREE_BLOCAGE = 10 * 60 * 1000
const FENETRE_ERREURS = 10 * 60 * 1000 // des erreurs espacées de plus de 10 minutes ne s'additionnent pas
const DUREE_DEFI = 5 * 60 * 1000
const MAX_SUIVIS = 5000 // taille maximale de chaque table en mémoire
const MP_PAR_MINUTE = 20 // MP de bienvenue : au plus 20 par minute et par serveur (raid, arrivées en masse)

// [identifiant de traduction (verif.emoji.<id>), emoji]
const EMOJIS = [["pomme", "🍎"], ["chat", "🐱"], ["voiture", "🚗"], ["etoile", "⭐"], ["cactus", "🌵"],
    ["de", "🎲"], ["cle", "🔑"], ["lune", "🌙"], ["pizza", "🍕"], ["poisson", "🐟"]]

// État en mémoire (perdu au redémarrage : un défi se refait en un clic). Chaque entrée porte sa date d'`expire`.
const defis = new Map() // "serveur:membre" -> { jeton, choix, bon, expire }
const etats = new Map() // "serveur:membre" -> { erreurs, bloqueJusqua, expire }
const enCours = new Set() // vérifications en cours (deux clics rapides = un seul rôle)
const alertes = new Map() // serveur -> date de la dernière alerte « rôle inutilisable »
const envoisMp = new Map() // serveur -> { debut, n }

// Ajoute une entrée en gardant la table bornée : d'abord les entrées expirées, puis les plus anciennes
function borner(table, cle, valeur) {
    table.delete(cle)
    table.set(cle, valeur)
    if (table.size <= MAX_SUIVIS) return
    const maintenant = Date.now()
    for (const [k, v] of table) if (v.expire <= maintenant) table.delete(k)
    while (table.size > MAX_SUIVIS) table.delete(table.keys().next().value)
}

// --- Réglage du serveur (table verification_config) ---

function lireConfig(guildId) {
    return db.sqlAll("SELECT * FROM verification_config WHERE guild_id = ?", [guildId])[0] ?? null
}

// Choisit le rôle (le panneau déjà posé est gardé). salonId : salon du panneau, s'il est précisé.
function definirRole(guildId, roleId, salonId = null) {
    db.sqlRun(`INSERT INTO verification_config (guild_id, role_id, channel_id) VALUES (?, ?, ?)
        ON CONFLICT (guild_id) DO UPDATE SET role_id = excluded.role_id, channel_id = COALESCE(excluded.channel_id, channel_id)`, [guildId, roleId, salonId])
}

function definirPanneau(guildId, salonId, messageId) {
    db.sqlRun("UPDATE verification_config SET channel_id = ?, message_id = ? WHERE guild_id = ?", [salonId, messageId, guildId])
}

function supprimerConfig(guildId) {
    return db.sqlRun("DELETE FROM verification_config WHERE guild_id = ?", [guildId]) > 0
}

// --- Rôle « vérifié » ---

// Le bot peut-il donner ce rôle à n'importe quel nouveau membre ? Renvoie un message d'erreur, ou null.
// Jamais de rôle à permissions de modération (même dans un seul salon), ni au-dessus du bot.
// Revérifié à chaque clic : le rôle a pu gagner une permission ou monter depuis la configuration.
function refusRoleClic(guild, role, cible = null, configurateur = null) {
    const refus = refusRole(guild, role, configurateur, cible)
    if (refus) return refus
    if (!guild.members.me?.permissions.has(Flags.ManageRoles)) return t(cible ?? "fr", "verif.bot_roles")
    return null
}

// Même règle pour celui qui configure : jamais plus de pouvoir par le bot que lui n'en a.
// Il lui faut « Gérer les rôles » et le rôle doit être strictement sous son rôle le plus haut (sauf propriétaire).
function refusRoleConfig(interaction, role) {
    const guild = interaction.guild
    if (interaction.user.id !== guild.ownerId && !interaction.memberPermissions?.has(Flags.ManageRoles)) return t(interaction, "config.filtre_roles_membre")
    return refusRoleClic(guild, role, interaction, interaction.member)
}

// --- Commande /verification ---

// Renvoie { erreur } ou { ok, salonInvisible }
async function configurer(interaction, role, salon) {
    const guild = interaction.guild
    if (!role) return { erreur: t(interaction, "verif.role_requis") }
    const refus = refusRoleConfig(interaction, role)
    if (refus) return { erreur: refus }
    if (salon) {
        const erreur = refusSalonLogs(guild, salon, interaction)
        if (erreur) return { erreur }
    }
    definirRole(guild.id, role.id, salon?.id ?? null)
    await sendModLog(interaction, { action: "config", details: `Vérification à l'arrivée : rôle ${role}${salon ? `, panneau dans ${salon}` : ""}` })
    return { ok: true }
}

function contenuPanneau(guild) {
    const embed = new Discord.EmbedBuilder()
        .setColor(couleur(guild))
        .setTitle(t(guild, "verif.panneau_titre"))
        .setDescription(t(guild, "verif.panneau_texte"))
    const bouton = new Discord.ButtonBuilder().setCustomId("verif:ouvrir").setLabel(t(guild, "verif.panneau_bouton")).setStyle(Discord.ButtonStyle.Success)
    return { embeds: [embed], components: [new Discord.ActionRowBuilder().addComponents(bouton)] }
}

// Supprime le message du panneau s'il existe encore (déjà supprimé ou salon disparu : rien à faire)
async function retirerPanneau(guild, config) {
    if (!config.message_id || !config.channel_id) return
    try {
        await guild.channels.cache.get(config.channel_id)?.messages.delete(config.message_id)
    } catch { /* déjà supprimé */ }
}

// Poste le panneau (et retire l'ancien). Renvoie { erreur } ou { ok, salon, salonInvisible }.
async function poserPanneau(interaction, salonChoisi) {
    const guild = interaction.guild
    const config = lireConfig(guild.id)
    if (!config) return { erreur: t(interaction, "verif.config_manquante") }
    // Le rôle est revérifié ici aussi : il a pu changer depuis /verification config
    const refus = refusRoleConfig(interaction, guild.roles.cache.get(config.role_id))
    if (refus) return { erreur: refus }
    const salon = salonChoisi ?? (config.channel_id ? guild.channels.cache.get(config.channel_id) : null) ?? interaction.channel
    const erreur = salon ? refusSalonLogs(guild, salon, interaction) : t(interaction, "verif.salon_manquant")
    if (erreur) return { erreur }

    const message = await salon.send(contenuPanneau(guild))
    // L'ancien panneau disparaît (un seul bouton actif) ; s'il est déjà supprimé, tant mieux
    await retirerPanneau(guild, config)
    definirPanneau(guild.id, salon.id, message.id)
    await sendModLog(interaction, { action: "verification", details: `Panneau de vérification posté dans ${salon}` })
    const visible = Boolean(salon.permissionsFor(guild.roles.everyone)?.has(Flags.ViewChannel))
    return { ok: true, salon, salonInvisible: !visible }
}

// Renvoie { inchange } ou { ok }
async function desactiver(interaction) {
    const guild = interaction.guild
    const config = lireConfig(guild.id)
    if (!config) return { inchange: true }
    supprimerConfig(guild.id)
    await retirerPanneau(guild, config)
    await sendModLog(interaction, { action: "config", details: "Vérification à l'arrivée : désactivée" })
    return { ok: true }
}

// --- Défi ---

const aleatoire = n => crypto.randomInt(n)

function melanger(liste) {
    const copie = [...liste]
    for (let i = copie.length - 1; i > 0; i--) {
        const j = aleatoire(i + 1);
        [copie[i], copie[j]] = [copie[j], copie[i]]
    }
    return copie
}

function creerDefi(cle) {
    const defi = {
        jeton: crypto.randomBytes(6).toString("hex"),
        choix: melanger(EMOJIS).slice(0, NB_CHOIX),
        bon: aleatoire(NB_CHOIX),
        expire: Date.now() + DUREE_DEFI
    }
    borner(defis, cle, defi)
    return defi
}

function contenuDefi(interaction, defi, userId, debut = "") {
    const nom = t(interaction, `verif.emoji.${defi.choix[defi.bon][0]}`)
    const boutons = defi.choix.map(([, emoji], i) => new Discord.ButtonBuilder()
        .setCustomId(`verif:r:${userId}:${defi.jeton}:${i}`).setEmoji(emoji).setStyle(Discord.ButtonStyle.Secondary))
    return { content: debut + t(interaction, "verif.defi", { nom }), components: [new Discord.ActionRowBuilder().addComponents(boutons)] }
}

const repondreEph = (interaction, cle, variables) => interaction.reply({ content: t(interaction, cle, variables), flags: EPHEMERAL })
const quand = jusqua => `<t:${Math.ceil(jusqua / 1000)}:R>`

function blocage(cle) {
    const etat = etats.get(cle)
    return etat && etat.bloqueJusqua > Date.now() ? etat.bloqueJusqua : 0
}

// Rôle inutilisable (permission ajoutée, rôle supprimé ou monté) : une seule alerte par heure et par serveur dans les logs
async function alerter(bot, guild, raison) {
    if (Date.now() - (alertes.get(guild.id) ?? 0) < 3600000) return
    alertes.set(guild.id, Date.now())
    if (alertes.size > MAX_SUIVIS) alertes.delete(alertes.keys().next().value)
    await sendModLog({ guild, user: bot.user }, { action: "verification", details: `Vérification impossible : ${raison}` })
}

async function ouvrir(bot, interaction) {
    const guild = interaction.guild
    const config = lireConfig(guild.id)
    if (!config) return repondreEph(interaction, "verif.inactif")
    if (interaction.member.roles.cache.has(config.role_id)) return repondreEph(interaction, "verif.deja")

    const refus = refusRoleClic(guild, guild.roles.cache.get(config.role_id), "fr")
    if (refus) {
        await repondreEph(interaction, "verif.indisponible")
        return alerter(bot, guild, refus)
    }
    const cle = `${guild.id}:${interaction.user.id}`
    const jusqua = blocage(cle)
    if (jusqua) return repondreEph(interaction, "verif.bloque", { quand: quand(jusqua) })
    // Un seul défi par membre : en ouvrir un deuxième remplace le premier (les anciens boutons ne servent plus)
    return interaction.reply({ ...contenuDefi(interaction, creerDefi(cle), interaction.user.id), flags: EPHEMERAL })
}

async function reussir(bot, interaction, config, cle) {
    const guild = interaction.guild
    enCours.add(cle)
    defis.delete(cle)
    etats.delete(cle)
    try {
        await interaction.deferUpdate()
        const role = guild.roles.cache.get(config.role_id)
        const refus = refusRoleClic(guild, role, "fr")
        if (refus) {
            await interaction.editReply({ content: t(interaction, "verif.indisponible"), components: [] })
            return alerter(bot, guild, refus)
        }
        await interaction.member.roles.add(role.id, "Vérification à l'arrivée (captcha)")
        await interaction.editReply({ content: t(interaction, "verif.reussi", { role }), components: [] })
        const embed = new Discord.EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle("Membre vérifié")
            .addFields({ name: "Membre", value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true }, { name: "Rôle", value: `${role}`, inline: true })
            .setTimestamp()
        await envoyerLog(guild, "membres", embed)
    } finally {
        enCours.delete(cle)
    }
}

function rater(interaction, cle, userId) {
    const maintenant = Date.now()
    let etat = etats.get(cle)
    if (!etat || etat.expire <= maintenant) etat = { erreurs: 0, bloqueJusqua: 0 }
    etat.erreurs++
    if (etat.erreurs >= MAX_ERREURS) etat.bloqueJusqua = maintenant + DUREE_BLOCAGE
    etat.expire = Math.max(etat.bloqueJusqua, maintenant + FENETRE_ERREURS)
    borner(etats, cle, etat)
    if (etat.bloqueJusqua) {
        defis.delete(cle)
        return interaction.update({ content: t(interaction, "verif.bloque", { quand: quand(etat.bloqueJusqua) }), components: [] })
    }
    // Nouveau défi à chaque erreur : on ne peut pas essayer les 5 boutons d'une même grille
    const debut = t(interaction, "verif.mauvais", { erreurs: etat.erreurs, max: MAX_ERREURS }) + "\n"
    return interaction.update(contenuDefi(interaction, creerDefi(cle), userId, debut))
}

async function repondre(bot, interaction, { userId, jeton, numero }) {
    // Le défi est lié au membre : un autre membre ne peut pas répondre à sa place
    if (userId !== interaction.user.id) return repondreEph(interaction, "verif.pas_le_votre")
    const config = lireConfig(interaction.guild.id)
    if (!config) return repondreEph(interaction, "verif.inactif")
    if (interaction.member.roles.cache.has(config.role_id)) return repondreEph(interaction, "verif.deja")

    const cle = `${interaction.guild.id}:${interaction.user.id}`
    if (enCours.has(cle)) return repondreEph(interaction, "verif.encours")
    const defi = defis.get(cle)
    if (!defi || defi.jeton !== jeton || defi.expire <= Date.now() || !Number.isInteger(numero) || numero < 0 || numero >= NB_CHOIX) {
        return repondreEph(interaction, "verif.expire")
    }
    const jusqua = blocage(cle)
    if (jusqua) return repondreEph(interaction, "verif.bloque", { quand: quand(jusqua) })

    // Tout ce qui précède est synchrone : deux clics simultanés ne passent jamais tous les deux ici
    if (numero === defi.bon) return reussir(bot, interaction, config, cle)
    return rater(interaction, cle, interaction.user.id)
}

// Boutons de la vérification (composant public : cliqué par les nouveaux membres)
async function onClicVerification(bot, interaction) {
    if (!interaction.guild || !interaction.member) return
    const [, action, userId, jeton, numero] = interaction.customId.split(":")
    if (action === "ouvrir") return ouvrir(bot, interaction)
    if (action === "r") return repondre(bot, interaction, { userId, jeton, numero: Number(numero) })
    return repondreEph(interaction, "verif.expire")
}

// --- Arrivée d'un membre ---

function mpAutorise(guildId) {
    const maintenant = Date.now()
    const suivi = envoisMp.get(guildId)
    if (!suivi || maintenant - suivi.debut > 60000) {
        envoisMp.set(guildId, { debut: maintenant, n: 1 })
        if (envoisMp.size > MAX_SUIVIS) envoisMp.delete(envoisMp.keys().next().value)
        return true
    }
    return ++suivi.n <= MP_PAR_MINUTE
}

// Rien d'obligatoire à l'arrivée (le serveur règle lui-même les salons visibles sans le rôle).
// Si la vérification est en place, un MP court pointe vers le panneau ; un MP fermé n'est pas une erreur.
async function accueillir(member) {
    const guild = member?.guild
    if (!guild || member.user?.bot) return null
    if (!moduleActif(guild.id, "moderation")) return null
    const config = lireConfig(guild.id)
    if (!config?.channel_id || !config.message_id) return null
    if (member.roles?.cache?.has(config.role_id) || !mpAutorise(guild.id)) return null
    const lien = `https://discord.com/channels/${guild.id}/${config.channel_id}/${config.message_id}`
    // Sans attendre : un MP lent ne doit pas retarder le message de bienvenue
    Promise.resolve().then(() => member.send(t(guild, "verif.mp", { serveur: guild.name, lien }))).catch(() => {})
    return { mp: true }
}

module.exports = {
    accueillir, onClicVerification, configurer, poserPanneau, desactiver, lireConfig, refusRoleClic, refusRoleConfig,
    MAX_ERREURS, DUREE_BLOCAGE
}
