const Discord = require('discord.js')
const db = require('../../Fonctions/db')
const { exigerPremium } = require('../../Fonctions/premium')
const { sendModLog, FAMILLES, SANS_REPLI, salonsFamilles } = require('../../Fonctions/logs')
const { getFiltreComptes } = require('../../Fonctions/antiraid')
const { t, langueDe } = require('../../Fonctions/i18n')
const { couleur, lireCouleur, formatCouleur } = require('../../Fonctions/apparence')
const { peutConfigurerTickets, changerSalonLogs, changerSalonFamille, refusCategorie, refusRoleStaff, refusRoleFiltre, changerRoleStaff, changerModules, changerSalonsJeux, changerFiltreComptes, AGES_FILTRE } = require('../../Fonctions/config')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral
const DUREE_SESSION = 5 * 60 * 1000
const { INACTIVITES, LANGUES } = require('../../Fonctions/constantes')
const { modulesConnus, nomModule } = require('../../Fonctions/modules')
const SECTIONS = ["resume", "general", "modules", "staff", "logs", "filtre", "tickets", "panneau"]

// Réglage de départ du filtre (rien n'est appliqué tant qu'on n'a pas activé le filtre)
const BROUILLON_FILTRE = { minAgeJours: 7, action: "role", roleId: null }

// Une seule fenêtre /config par membre et par serveur : ouvrir la 2e ferme la 1re (pas d'état périmé)
const sessions = new Map()

const row = (...composants) => new Discord.ActionRowBuilder().addComponents(...composants)
const bouton = (id, texte, style = Discord.ButtonStyle.Secondary) => new Discord.ButtonBuilder().setCustomId(id).setLabel(texte).setStyle(style)

// Message de /config pour une section, construit à partir de la base (toujours relue : jamais de valeur périmée)
// etat : famille de logs en cours de réglage ("general" ou une famille) et brouillon du filtre des comptes récents
function vue(i, section, etat = {}) {
    const guild = i.guild
    const L = langueDe(i)
    const app = db.getApparence(guild.id)
    const embed = new Discord.EmbedBuilder().setColor(couleur(guild)).setTitle(t(L, "config.titre", { serveur: guild.name }).slice(0, 256))

    const menu = new Discord.StringSelectMenuBuilder().setCustomId("cfg-section").setPlaceholder(t(L, "config.choisir"))
        .addOptions(SECTIONS.map(s => ({ label: t(L, `config.section_${s}`).slice(0, 100), value: s, default: s === section })))
    const lignes = [row(menu)]

    if (section === "general") {
        embed.setDescription(`**${t(L, "config.langue")}** : ${t(L, `config.langue_${app.langue}`)}\n**${t(L, "config.couleur")}** : ${app.couleur === null ? t(L, "config.couleur_defaut") : formatCouleur(app.couleur)}`)
        lignes.push(row(new Discord.StringSelectMenuBuilder().setCustomId("cfg-langue")
            .addOptions(LANGUES.map(l => ({ label: t(L, `config.langue_${l}`), value: l, default: l === app.langue })))))
        lignes.push(row(bouton("cfg-couleur", t(L, "config.bouton_couleur"), Discord.ButtonStyle.Primary), bouton("cfg-couleur-defaut", t(L, "config.bouton_couleur_defaut"))))
    } else if (section === "modules") {
        const reglages = db.getModules(guild.id)
        const connus = modulesConnus(i.client.commands?.values() ?? [])
        const salons = db.getSalonsJeux(guild.id)
        embed.setDescription([
            t(L, "config.modules_etat", { liste: connus.map(m => `${reglages[m] === false ? "❌" : "✅"} ${nomModule(L, m)}`).join("\n") }),
            t(L, "config.modules_salons", { salons: salons.length ? salons.map(id => `<#${id}>`).join(", ") : t(L, "config.modules_partout") }),
            "", `-# ${t(L, "config.modules_note")}`
        ].join("\n"))
        lignes.push(row(new Discord.StringSelectMenuBuilder().setCustomId("cfg-modules").setPlaceholder(t(L, "config.choisir_modules"))
            .setMinValues(0).setMaxValues(connus.length)
            .addOptions(connus.map(m => ({ label: nomModule(L, m).slice(0, 100), value: m, default: reglages[m] !== false })))))
        const choix = new Discord.ChannelSelectMenuBuilder().setCustomId("cfg-salons-jeux").setPlaceholder(t(L, "config.choisir_salons_jeux"))
            .setChannelTypes(Discord.ChannelType.GuildText).setMinValues(1).setMaxValues(25)
        const presents = salons.filter(id => guild.channels.cache.has(id))
        if (presents.length) choix.setDefaultChannels(...presents)
        lignes.push(row(choix))
        if (salons.length) lignes.push(row(bouton("cfg-salons-jeux-tous", t(L, "config.bouton_jeux_partout"))))
    } else if (section === "staff") {
        const actuel = db.getStaffRole(guild.id)
        embed.setDescription([
            t(L, "config.staff_actuel", { role: actuel ? `<@&${actuel}>` : t(L, "config.aucun") }),
            "", `-# ${t(L, "config.staff_note")}`
        ].join("\n"))
        const choix = new Discord.RoleSelectMenuBuilder().setCustomId("cfg-role-staff").setPlaceholder(t(L, "config.choisir_role_staff"))
        if (actuel && guild.roles.cache.has(actuel)) choix.setDefaultRoles(actuel)
        lignes.push(row(choix))
        if (actuel) lignes.push(row(bouton("cfg-role-staff-off", t(L, "config.bouton_retirer_staff"), Discord.ButtonStyle.Danger)))
    } else if (section === "logs") {
        const general = db.getLogChannel(guild.id)
        const parFamille = salonsFamilles(guild.id)
        const cible = FAMILLES.includes(etat.famille) ? etat.famille : "general"
        const lignesFamilles = FAMILLES.map(f => t(L, "config.logs_famille_ligne", {
            famille: t(L, `config.famille_${f}`),
            salon: parFamille[f] ? `<#${parFamille[f]}>` : t(L, SANS_REPLI.includes(f) ? "config.logs_famille_sans" : "config.logs_famille_suit")
        }))
        embed.setDescription([
            t(L, "config.logs_general_actuel", { salon: general ? `<#${general}>` : t(L, "config.aucun") }),
            ...lignesFamilles, "",
            t(L, "config.logs_cible", { cible: cible === "general" ? t(L, "config.logs_cible_general") : t(L, `config.famille_${cible}`) }),
            `-# ${t(L, "config.logs_note")}`
        ].join("\n"))
        lignes.push(row(new Discord.StringSelectMenuBuilder().setCustomId("cfg-logs-famille").setPlaceholder(t(L, "config.choisir_famille_logs"))
            .addOptions([{ label: t(L, "config.logs_option_general"), value: "general", default: cible === "general" },
                ...FAMILLES.map(f => ({ label: t(L, `config.famille_${f}`), value: f, default: cible === f }))])))
        const actuel = cible === "general" ? general : parFamille[cible]
        const choix = new Discord.ChannelSelectMenuBuilder().setCustomId("cfg-logs").setPlaceholder(t(L, "config.logs_choisir"))
            .setChannelTypes(Discord.ChannelType.GuildText)
        if (actuel && guild.channels.cache.has(actuel)) choix.setDefaultChannels(actuel)
        lignes.push(row(choix))
        if (actuel) lignes.push(row(bouton("cfg-logs-off", t(L, cible === "general" ? "config.bouton_desactiver_logs" : "config.bouton_retirer_famille"), Discord.ButtonStyle.Danger)))
    } else if (section === "filtre") {
        const reel = getFiltreComptes(guild.id)
        const b = etat.brouillon ?? reel ?? BROUILLON_FILTRE
        const decrire = r => t(L, r.action === "role" ? "config.filtre_action_role" : "config.filtre_action_kick", { role: r.roleId ? `<@&${r.roleId}>` : t(L, "config.aucun") })
        const texte = [reel
            ? t(L, "config.filtre_actif", { jours: reel.minAgeJours, action: decrire(reel) })
            : t(L, "config.filtre_inactif")]
        // Le brouillon n'est montré que s'il diffère de ce qui est enregistré
        if (!reel || reel.minAgeJours !== b.minAgeJours || reel.action !== b.action || reel.roleId !== (b.action === "role" ? b.roleId : null)) {
            texte.push(t(L, "config.filtre_brouillon", { jours: b.minAgeJours, action: decrire(b) }))
            if (b.action === "role" && !b.roleId) texte.push(t(L, "config.filtre_attente_role"))
        }
        embed.setDescription([...texte, "", `-# ${t(L, "config.filtre_note")}`].join("\n"))
        const ages = AGES_FILTRE.includes(b.minAgeJours) ? AGES_FILTRE : [...AGES_FILTRE, b.minAgeJours].sort((x, y) => x - y)
        lignes.push(row(new Discord.StringSelectMenuBuilder().setCustomId("cfg-filtre-age").setPlaceholder(t(L, "config.choisir_age_filtre"))
            .addOptions(ages.map(j => ({ label: t(L, "config.filtre_age_option", { jours: j }), value: String(j), default: j === b.minAgeJours })))))
        lignes.push(row(new Discord.StringSelectMenuBuilder().setCustomId("cfg-filtre-action").setPlaceholder(t(L, "config.choisir_action_filtre"))
            .addOptions(["role", "kick"].map(a => ({ label: t(L, `config.filtre_option_${a}`), value: a, default: a === b.action })))))
        if (b.action === "role") {
            const choixRole = new Discord.RoleSelectMenuBuilder().setCustomId("cfg-filtre-role").setPlaceholder(t(L, "config.choisir_role_filtre"))
            if (b.roleId && guild.roles.cache.has(b.roleId)) choixRole.setDefaultRoles(b.roleId)
            lignes.push(row(choixRole))
        }
        lignes.push(row(reel
            ? bouton("cfg-filtre-off", t(L, "config.bouton_filtre_off"), Discord.ButtonStyle.Danger)
            : bouton("cfg-filtre-on", t(L, "config.bouton_filtre_on"), Discord.ButtonStyle.Success)))
    } else if (section === "tickets") {
        const { categoryId, staffRoleId } = db.getTicketConfig(guild.id)
        const jours = db.getTicketInactivity(guild.id)
        embed.setDescription([
            t(L, "config.tickets_categorie", { categorie: categoryId ? `<#${categoryId}>` : t(L, "config.par_defaut") }),
            t(L, "config.tickets_staff", { role: staffRoleId ? `<@&${staffRoleId}>` : t(L, "config.par_defaut") }),
            t(L, "config.tickets_inactivite", { jours: jours ? t(L, "config.jours", { jours }) : t(L, "config.jamais") })
        ].join("\n"))
        const categorie = new Discord.ChannelSelectMenuBuilder().setCustomId("cfg-categorie").setPlaceholder(t(L, "config.choisir_categorie"))
            .setChannelTypes(Discord.ChannelType.GuildCategory)
        if (categoryId && guild.channels.cache.has(categoryId)) categorie.setDefaultChannels(categoryId)
        const staff = new Discord.RoleSelectMenuBuilder().setCustomId("cfg-staff").setPlaceholder(t(L, "config.choisir_staff"))
        if (staffRoleId && guild.roles.cache.has(staffRoleId)) staff.setDefaultRoles(staffRoleId)
        const inactivite = new Discord.StringSelectMenuBuilder().setCustomId("cfg-inactivite").setPlaceholder(t(L, "config.choisir_inactivite"))
            .addOptions(INACTIVITES.map(j => ({ label: j ? t(L, "config.inactivite_jours", { jours: j }) : t(L, "config.inactivite_jamais"), value: String(j), default: j === jours })))
        lignes.push(row(categorie), row(staff), row(inactivite))
    } else if (section === "panneau") {
        embed.setDescription([
            t(L, "config.panneau_titre", { titre: app.panneauTitre ?? t(L, "config.par_defaut") }),
            t(L, "config.panneau_texte", { texte: (app.panneauTexte ?? t(L, "config.par_defaut")).slice(0, 1500) }),
            "", `-# ${t(L, "config.panneau_note")}`
        ].join("\n"))
        lignes.push(row(bouton("cfg-panneau", t(L, "config.bouton_panneau"), Discord.ButtonStyle.Primary), bouton("cfg-panneau-defaut", t(L, "config.bouton_panneau_defaut"))))
    } else {
        const accueil = db.getWelcome(guild.id)
        embed.setDescription(t(L, "config.resume", {
            sanctions: db.listThresholds(guild.id).length,
            bienvenue: t(L, accueil.bienvenue ? "config.active" : "config.desactive"),
            aurevoir: t(L, accueil.aurevoir ? "config.active" : "config.desactive"),
            types: db.listTicketTypes(guild.id).length
        }))
    }
    return { embeds: [embed], components: lignes }
}

// Formulaire (modal) ouvert depuis un bouton, attendu sur place (pas de route globale : personne d'autre ne peut le soumettre)
async function demander(i, { titre, champs }) {
    const id = `cfg-modal-${i.id}`
    const modal = new Discord.ModalBuilder().setCustomId(id).setTitle(titre.slice(0, 45))
        .addComponents(champs.map(c => row(new Discord.TextInputBuilder().setCustomId(c.id).setLabel(c.label.slice(0, 45))
            .setStyle(c.long ? Discord.TextInputStyle.Paragraph : Discord.TextInputStyle.Short)
            .setRequired(c.requis ?? false).setMaxLength(c.max))))
    // Préremplissage seulement s'il y a une valeur (Discord peut refuser une valeur vide)
    champs.forEach((c, n) => { if (c.valeur) modal.components[n].components[0].setValue(c.valeur) })
    await i.showModal(modal)
    return i.awaitModalSubmit({ filter: m => m.customId === id && m.user.id === i.user.id, time: DUREE_SESSION }).catch(() => null)
}

module.exports = {
    name: "config",
    description: "Configuration interactive du bot (logs, tickets, langue, apparence)",
    permission: Discord.PermissionFlagsBits.ManageGuild,
    dm: false,
    category: "Configuration",
    options: [],

    async run(bot, message) {
        const cle = `${message.guild.id}-${message.user.id}`
        sessions.get(cle)?.stop("remplacee")
        // Place réservée tout de suite : deux /config lancés presque en même temps -> seul le dernier reste ouvert
        const jeton = { stop: () => { jeton.remplace = true } }
        sessions.set(cle, jeton)

        const reponse = await message.reply({ ...vue(message, "resume"), flags: EPHEMERAL, withResponse: true })
        const fenetre = reponse.resource.message
        let section = "resume"
        let familleLogs = "general"
        let brouillon = { ...(getFiltreComptes(message.guild.id) ?? BROUILLON_FILTRE) }
        const voir = x => vue(x, section, { famille: familleLogs, brouillon })

        // Seul l'auteur, seulement sur CE message
        const collecteur = fenetre.createMessageComponentCollector({
            filter: i => i.user.id === message.user.id && i.message.id === fenetre.id,
            time: DUREE_SESSION
        })
        if (jeton.remplace || sessions.get(cle) !== jeton) collecteur.stop("remplacee")
        else sessions.set(cle, collecteur)

        collecteur.on("collect", async i => {
            try {
                await traiter(i)
            } catch (err) {
                console.error("Erreur dans /config :", err)
                const contenu = { content: t(i, "commun.erreur"), flags: EPHEMERAL }
                if (i.replied || i.deferred) await i.followUp(contenu).catch(() => {})
                else await i.reply(contenu).catch(() => {})
            }
        })
        collecteur.on("end", (_, raison) => {
            if (sessions.get(cle) === collecteur) sessions.delete(cle)
            if (raison === "permission") return // message déjà affiché par le clic
            const texte = t(message, raison === "remplacee" ? "config.ancienne_session" : "config.expiree")
            message.editReply({ content: texte, components: [] }).catch(() => {})
        })

        // Choix refusé : le menu revient à la valeur réellement enregistrée, puis le motif est affiché
        const refuser = async (i, motif) => {
            await i.update({ ...voir(i), content: "" })
            return i.followUp({ content: motif, flags: EPHEMERAL })
        }

        // Applique un changement puis réaffiche la section (réponse au clic d'abord, log ensuite : délai de 3 s)
        const afficher = async (i, note) => {
            const contenu = voir(i)
            if (note) contenu.content = note
            else contenu.content = ""
            await i.update(contenu)
        }

        // Applique un changement partagé avec les commandes : réponse au clic d'abord (les logs prennent du temps), refus en éphémère
        const appliquer = async (i, action) => {
            await i.deferUpdate()
            const resultat = await action()
            await i.editReply({ ...voir(i), content: resultat.erreur || resultat.inchange ? "" : t(i, "config.enregistre") })
            if (resultat.erreur) await i.followUp({ content: resultat.erreur, flags: EPHEMERAL })
        }

        async function traiter(i) {
            if (!i.inCachedGuild()) return i.reply({ content: t(i, "commun.erreur"), flags: EPHEMERAL })
            // Permission revérifiée à CHAQUE action, avec les droits du clic (à jour)
            if (!i.memberPermissions.has(Flags.ManageGuild)) {
                collecteur.stop("permission")
                return i.update({ content: t(i, "config.plus_permission"), embeds: [], components: [] })
            }
            const guild = i.guild

            switch (i.customId) {
                case "cfg-section":
                    section = SECTIONS.includes(i.values[0]) ? i.values[0] : "resume"
                    if (section === "filtre") brouillon = { ...(getFiltreComptes(guild.id) ?? brouillon) }
                    return afficher(i)

                case "cfg-langue": {
                    const langue = LANGUES.includes(i.values[0]) ? i.values[0] : "auto"
                    db.setLangue(guild.id, langue)
                    await afficher(i, t(i, "config.enregistre"))
                    return sendModLog(i, { action: "config", details: `Langue du bot : ${langue}` })
                }

                case "cfg-couleur": {
                    if (!await exigerPremium(i, "apparence")) return
                    const app = db.getApparence(guild.id)
                    const m = await demander(i, { titre: t(i, "config.modal_couleur"), champs: [{ id: "couleur", label: t(i, "config.modal_couleur_champ"), requis: true, max: 7, valeur: app.couleur === null ? "" : formatCouleur(app.couleur) }] })
                    if (!m) return
                    if (collecteur.ended) return m.reply({ content: t(m, "commun.session_expiree"), flags: EPHEMERAL })
                    if (!m.memberPermissions.has(Flags.ManageGuild)) return m.reply({ content: t(m, "config.plus_permission"), flags: EPHEMERAL })
                    const valeur = lireCouleur(m.fields.getTextInputValue("couleur"))
                    if (valeur === null) return m.reply({ content: t(m, "config.couleur_invalide"), flags: EPHEMERAL })
                    db.setCouleur(guild.id, valeur)
                    await m.update({ ...voir(m), content: t(m, "config.enregistre") })
                    return sendModLog(m, { action: "config", details: `Couleur des embeds : ${formatCouleur(valeur)}` })
                }
                case "cfg-couleur-defaut":
                    db.setCouleur(guild.id, null)
                    await afficher(i, t(i, "config.enregistre"))
                    return sendModLog(i, { action: "config", details: "Couleur des embeds : par défaut" })

                case "cfg-modules":
                case "cfg-salons-jeux":
                case "cfg-salons-jeux-tous": {
                    // « Admin uniquement » : couper un module change ce que tout le serveur peut faire (vérifié dans changerModules)
                    const connus = modulesConnus(i.client.commands?.values() ?? [])
                    return appliquer(i, () => {
                        if (i.customId === "cfg-modules") return changerModules(i, connus, i.values)
                        return changerSalonsJeux(i, i.customId === "cfg-salons-jeux" ? i.values : [])
                    })
                }

                case "cfg-role-staff":
                case "cfg-role-staff-off": {
                    // Donner le rôle staff délègue des droits de modération : il faut les avoir soi-même (vérifié dans changerRoleStaff)
                    const role = i.customId === "cfg-role-staff" ? guild.roles.cache.get(i.values[0]) : null
                    if (i.customId === "cfg-role-staff" && !role) return refuser(i, t(i, "tk.role_introuvable"))
                    return appliquer(i, () => changerRoleStaff(i, role))
                }

                case "cfg-logs-famille":
                    familleLogs = i.values[0] === "general" || FAMILLES.includes(i.values[0]) ? i.values[0] : "general"
                    return afficher(i)

                case "cfg-logs":
                case "cfg-logs-off": {
                    const salon = i.customId === "cfg-logs" ? guild.channels.cache.get(i.values[0]) : null
                    if (i.customId === "cfg-logs" && !salon) return refuser(i, t(i, "tk.salon_introuvable"))
                    // Validation et double traçage partagés avec /setlogs
                    return appliquer(i, () => familleLogs === "general" ? changerSalonLogs(i, salon) : changerSalonFamille(i, familleLogs, salon))
                }

                case "cfg-filtre-age":
                case "cfg-filtre-action":
                case "cfg-filtre-role":
                case "cfg-filtre-on":
                case "cfg-filtre-off": {
                    if (i.customId === "cfg-filtre-role") {
                        const role = guild.roles.cache.get(i.values[0])
                        const refus = role ? refusRoleFiltre(i, role) : t(i, "tk.role_introuvable")
                        if (refus) return refuser(i, refus)
                    }
                    if (i.customId === "cfg-filtre-age") brouillon.minAgeJours = Number(i.values[0])
                    else if (i.customId === "cfg-filtre-action") brouillon.action = i.values[0] === "kick" ? "kick" : "role"
                    else if (i.customId === "cfg-filtre-role") brouillon.roleId = i.values[0]
                    const actif = Boolean(getFiltreComptes(guild.id))
                    // Filtre déjà actif : chaque changement s'applique tout de suite, sauf un rôle encore manquant (le brouillon attend)
                    return appliquer(i, async () => {
                        if (i.customId === "cfg-filtre-off") return changerFiltreComptes(i, null)
                        if (!actif && i.customId !== "cfg-filtre-on") return { inchange: true }
                        if (actif && brouillon.action === "role" && !brouillon.roleId) return { inchange: true }
                        return changerFiltreComptes(i, brouillon)
                    })
                }

                case "cfg-categorie":
                case "cfg-staff":
                case "cfg-inactivite": {
                    // Même permission que /setticket (Gérer le serveur + les salons + les rôles)
                    if (!peutConfigurerTickets(i)) return i.reply({ content: t(i, "config.tickets_permission"), flags: EPHEMERAL })
                    let details
                    if (i.customId === "cfg-categorie") {
                        const categorie = guild.channels.cache.get(i.values[0])
                        const refus = categorie ? refusCategorie(categorie, i) : t(i, "tk.categorie_introuvable")
                        if (refus) return refuser(i, refus)
                        db.setTicketConfig(guild.id, categorie.id, null)
                        details = `Catégorie des tickets : ${categorie}`
                    } else if (i.customId === "cfg-staff") {
                        const role = guild.roles.cache.get(i.values[0])
                        const refus = role ? refusRoleStaff(i, role) : t(i, "tk.role_introuvable")
                        if (refus) return refuser(i, refus)
                        db.setTicketConfig(guild.id, null, role.id)
                        details = `Rôle staff des tickets : ${role}`
                    } else {
                        const jours = Number(i.values[0])
                        if (!INACTIVITES.includes(jours)) return i.reply({ content: t(i, "commun.erreur"), flags: EPHEMERAL })
                        db.setTicketInactivity(guild.id, jours)
                        details = jours ? `Tickets fermés après ${jours} jour(s) d'inactivité` : "Fermeture des tickets inactifs désactivée"
                    }
                    await afficher(i, t(i, "config.enregistre"))
                    return sendModLog(i, { action: "config", details })
                }

                case "cfg-panneau": {
                    if (!await exigerPremium(i, "apparence")) return
                    const app = db.getApparence(guild.id)
                    const m = await demander(i, {
                        titre: t(i, "config.modal_panneau"),
                        champs: [
                            { id: "titre", label: t(i, "config.modal_panneau_titre"), max: 256, valeur: app.panneauTitre ?? "" },
                            { id: "texte", label: t(i, "config.modal_panneau_texte"), max: 2000, long: true, valeur: app.panneauTexte ?? "" }
                        ]
                    })
                    if (!m) return
                    if (collecteur.ended) return m.reply({ content: t(m, "commun.session_expiree"), flags: EPHEMERAL })
                    if (!m.memberPermissions.has(Flags.ManageGuild)) return m.reply({ content: t(m, "config.plus_permission"), flags: EPHEMERAL })
                    const titre = m.fields.getTextInputValue("titre").trim()
                    const texte = m.fields.getTextInputValue("texte").trim()
                    db.setPanneauTicket(guild.id, titre, texte)
                    await m.update({ ...voir(m), content: t(m, "config.enregistre") })
                    // Texte tronqué dans le log (limite d'un champ d'embed)
                    return sendModLog(m, { action: "config", details: `Panneau de tickets : « ${titre || "titre par défaut"} » – ${(texte || "texte par défaut").slice(0, 300)}` })
                }
                case "cfg-panneau-defaut":
                    db.setPanneauTicket(guild.id, null, null)
                    await afficher(i, t(i, "config.enregistre"))
                    return sendModLog(i, { action: "config", details: "Panneau de tickets : texte par défaut" })
            }
        }
    }
}
