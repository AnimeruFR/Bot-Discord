const Discord = require('discord.js')
const db = require('../../Fonctions/db')
const { sendModLog } = require('../../Fonctions/logs')
const { t, langueDe } = require('../../Fonctions/i18n')
const { couleur } = require('../../Fonctions/apparence')
const { peutConfigurerStaff, peutConfigurerModules, changerSalonLogs, changerRoleStaff, changerModules, changerSalonsJeux } = require('../../Fonctions/config')
const { LANGUES } = require('../../Fonctions/constantes')
const { modulesConnus, nomModule } = require('../../Fonctions/modules')
const { refuser } = require('../../Fonctions/erreurs')

const { Flags } = Discord.PermissionsBitField
const EPHEMERAL = Discord.MessageFlags.Ephemeral
const DUREE_SESSION = 10 * 60 * 1000
const ETAPES = ["langue", "logs", "staff", "modules", "jeux"]

// Chaque choix est appliqué tout de suite (et tracé dans les logs), pas à la fin : si la session expire
// au milieu, ce qui a été validé est conservé. Relancer /setup repart des valeurs enregistrées.

// Une seule fenêtre /setup par membre et par serveur
const sessions = new Map()

const row = (...composants) => new Discord.ActionRowBuilder().addComponents(...composants)
const bouton = (id, texte, style = Discord.ButtonStyle.Secondary) => new Discord.ButtonBuilder().setCustomId(id).setLabel(texte).setStyle(style)

// Réglages actuels, relus dans la base à chaque affichage
function lireEtat(i) {
    const guild = i.guild
    const L = langueDe(i)
    const connus = modulesConnus(i.client.commands?.values() ?? [])
    const reglages = db.getModules(guild.id)
    const logs = db.getLogChannel(guild.id)
    const staff = db.getStaffRole(guild.id)
    const salons = db.getSalonsJeux(guild.id)
    return {
        L, connus, reglages, logs, staff, salons,
        langue: db.getApparence(guild.id).langue,
        texteLogs: logs ? `<#${logs}>` : t(L, "config.aucun"),
        texteStaff: staff ? `<@&${staff}>` : t(L, "config.aucun"),
        texteSalons: salons.length ? salons.map(id => `<#${id}>`).join(", ") : t(L, "config.modules_partout"),
        listeModules: connus.map(m => `${reglages[m] === false ? "❌" : "✅"} ${nomModule(L, m)}`).join("\n")
    }
}

// Rangée de navigation : Précédent, puis Passer (étape non modifiée) ou Suivant (étape validée), puis Terminer à la fin
function navigation(L, etape, fait) {
    const derniere = etape === ETAPES.length - 1
    const texte = derniere ? "setup.bouton_terminer" : (fait ? "setup.bouton_suivant" : "setup.bouton_passer")
    return row(
        bouton("setup-prec", t(L, "setup.bouton_prec")).setDisabled(etape === 0),
        bouton("setup-suiv", t(L, texte), fait || derniere ? Discord.ButtonStyle.Primary : Discord.ButtonStyle.Secondary)
    )
}

// Message d'une étape (0 à 4). faits : étapes déjà validées pendant cette session.
function vueEtape(i, etape, faits = new Set()) {
    const e = lireEtat(i)
    const { L } = e
    const nom = ETAPES[etape]
    const embed = new Discord.EmbedBuilder().setColor(couleur(i.guild))
        .setTitle(t(L, "setup.etape", { n: etape + 1, total: ETAPES.length, nom: t(L, `setup.nom_${nom}`) }).slice(0, 256))
    const lignes = []

    if (nom === "langue") {
        embed.setDescription(t(L, "setup.intro_langue", { langue: t(L, `config.langue_${e.langue}`) }))
        lignes.push(row(new Discord.StringSelectMenuBuilder().setCustomId("setup-langue").setPlaceholder(t(L, "config.langue"))
            .addOptions(LANGUES.map(l => ({ label: t(L, `config.langue_${l}`), value: l, default: l === e.langue })))))
    } else if (nom === "logs") {
        embed.setDescription(t(L, "setup.intro_logs", { salon: e.texteLogs }))
        const choix = new Discord.ChannelSelectMenuBuilder().setCustomId("setup-logs").setPlaceholder(t(L, "config.logs_choisir"))
            .setChannelTypes(Discord.ChannelType.GuildText)
        if (e.logs && i.guild.channels.cache.has(e.logs)) choix.setDefaultChannels(e.logs)
        lignes.push(row(choix))
        if (e.logs) lignes.push(row(bouton("setup-logs-off", t(L, "config.bouton_desactiver_logs"), Discord.ButtonStyle.Danger)))
    } else if (nom === "staff") {
        embed.setDescription(t(L, "setup.intro_staff", { role: e.texteStaff }) + (peutConfigurerStaff(i) ? "" : `\n\n⚠️ ${t(L, "config.staff_permission")}`))
        if (peutConfigurerStaff(i)) {
            const choix = new Discord.RoleSelectMenuBuilder().setCustomId("setup-staff").setPlaceholder(t(L, "config.choisir_role_staff"))
            if (e.staff && i.guild.roles.cache.has(e.staff)) choix.setDefaultRoles(e.staff)
            lignes.push(row(choix))
            if (e.staff) lignes.push(row(bouton("setup-staff-off", t(L, "config.bouton_retirer_staff"), Discord.ButtonStyle.Danger)))
        }
    } else if (nom === "modules") {
        embed.setDescription(t(L, "setup.intro_modules", { liste: e.listeModules }) + (peutConfigurerModules(i) ? "" : `\n\n⚠️ ${t(L, "config.modules_permission")}`))
        if (peutConfigurerModules(i)) {
            lignes.push(row(new Discord.StringSelectMenuBuilder().setCustomId("setup-modules").setPlaceholder(t(L, "config.choisir_modules"))
                .setMinValues(0).setMaxValues(e.connus.length)
                .addOptions(e.connus.map(m => ({ label: nomModule(L, m).slice(0, 100), value: m, default: e.reglages[m] !== false })))))
        }
    } else {
        embed.setDescription(t(L, "setup.intro_jeux", { salons: e.texteSalons }) + (peutConfigurerModules(i) ? "" : `\n\n⚠️ ${t(L, "config.modules_permission")}`))
        if (peutConfigurerModules(i)) {
            const choix = new Discord.ChannelSelectMenuBuilder().setCustomId("setup-jeux").setPlaceholder(t(L, "config.choisir_salons_jeux"))
                .setChannelTypes(Discord.ChannelType.GuildText).setMinValues(1).setMaxValues(25)
            const presents = e.salons.filter(id => i.guild.channels.cache.has(id))
            if (presents.length) choix.setDefaultChannels(...presents)
            lignes.push(row(choix))
            if (e.salons.length) lignes.push(row(bouton("setup-jeux-tous", t(L, "config.bouton_jeux_partout"))))
        }
    }
    lignes.push(navigation(L, etape, faits.has(nom)))
    return { embeds: [embed], components: lignes }
}

// Récapitulatif de fin : les réglages réellement enregistrés
function vueRecap(i) {
    const e = lireEtat(i)
    const embed = new Discord.EmbedBuilder().setColor(couleur(i.guild)).setTitle(t(e.L, "setup.recap_titre"))
        .setDescription(t(e.L, "setup.recap", {
            langue: t(e.L, `config.langue_${e.langue}`), logs: e.texteLogs, staff: e.texteStaff, modules: e.listeModules, jeux: e.texteSalons
        }) + `\n\n${t(e.L, "setup.recap_suite")}`)
    return { embeds: [embed], components: [] }
}

module.exports = {
    name: "setup",
    description: "Assistant de configuration guidé : langue, logs, rôle staff, modules et salons de jeux",
    permission: Discord.PermissionFlagsBits.ManageGuild,
    dm: false,
    category: "Configuration",
    options: [],
    vueEtape,
    vueRecap,

    async run(bot, message) {
        const cle = `${message.guild.id}-${message.user.id}`
        sessions.get(cle)?.stop("remplacee")
        // Place réservée tout de suite : deux /setup lancés presque en même temps -> seul le dernier reste ouvert
        const jeton = { stop: () => { jeton.remplace = true } }
        sessions.set(cle, jeton)

        let etape = 0
        const faits = new Set()
        const reponse = await message.reply({ ...vueEtape(message, etape, faits), flags: EPHEMERAL, withResponse: true })
        const fenetre = reponse.resource.message

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
                console.error("Erreur dans /setup :", err)
                const contenu = { content: t(i, "commun.erreur"), flags: EPHEMERAL }
                if (i.replied || i.deferred) await i.followUp(contenu).catch(() => {})
                else await i.reply(contenu).catch(() => {})
            }
        })
        collecteur.on("end", (_, raison) => {
            if (sessions.get(cle) === collecteur) sessions.delete(cle)
            if (raison === "permission" || raison === "fin") return // message déjà remplacé par le clic
            const texte = t(message, raison === "remplacee" ? "setup.ancienne_session" : "setup.expiree")
            message.editReply({ content: texte, embeds: [], components: [] }).catch(() => {})
        })

        // Applique un changement (partagé avec /config et les commandes), puis réaffiche l'étape
        const appliquer = async (i, nom, action) => {
            await i.deferUpdate()
            const resultat = await action()
            if (resultat.ok || resultat.inchange) faits.add(nom)
            await i.editReply({ ...vueEtape(i, etape, faits), content: resultat.ok ? t(i, "config.enregistre") : "" })
            if (resultat.erreur) await i.followUp({ content: resultat.erreur, flags: EPHEMERAL })
        }

        async function traiter(i) {
            if (!i.inCachedGuild()) return refuser(i, t(i, "commun.erreur"))
            // Permission revérifiée à CHAQUE clic, avec les droits du moment
            if (!i.memberPermissions.has(Flags.ManageGuild)) {
                collecteur.stop("permission")
                return i.update({ content: t(i, "config.plus_permission"), embeds: [], components: [] })
            }
            const guild = i.guild

            switch (i.customId) {
                case "setup-prec":
                    etape = Math.max(0, etape - 1)
                    return i.update({ ...vueEtape(i, etape, faits), content: "" })

                case "setup-suiv":
                    if (etape >= ETAPES.length - 1) {
                        collecteur.stop("fin")
                        return i.update({ ...vueRecap(i), content: "" })
                    }
                    etape++
                    return i.update({ ...vueEtape(i, etape, faits), content: "" })

                case "setup-langue":
                    return appliquer(i, "langue", async () => {
                        const langue = LANGUES.includes(i.values[0]) ? i.values[0] : "auto"
                        db.setLangue(guild.id, langue)
                        await sendModLog(i, { action: "config", details: `Langue du bot : ${langue}` })
                        return { ok: true }
                    })

                case "setup-logs":
                case "setup-logs-off": {
                    const salon = i.customId === "setup-logs" ? guild.channels.cache.get(i.values[0]) : null
                    if (i.customId === "setup-logs" && !salon) return refuser(i, t(i, "tk.salon_introuvable"))
                    return appliquer(i, "logs", () => changerSalonLogs(i, salon))
                }

                case "setup-staff":
                case "setup-staff-off": {
                    const role = i.customId === "setup-staff" ? guild.roles.cache.get(i.values[0]) : null
                    if (i.customId === "setup-staff" && !role) return refuser(i, t(i, "tk.role_introuvable"))
                    return appliquer(i, "staff", () => changerRoleStaff(i, role))
                }

                case "setup-modules":
                    return appliquer(i, "modules", () => changerModules(i, modulesConnus(i.client.commands?.values() ?? []), i.values))

                case "setup-jeux":
                case "setup-jeux-tous":
                    return appliquer(i, "jeux", () => changerSalonsJeux(i, i.customId === "setup-jeux" ? i.values : []))
            }
        }
    }
}
