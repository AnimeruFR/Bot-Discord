const { verifierAcces } = require('./staff')

// Routeur des composants persistants (idée #89) : boutons, menus déroulants et formulaires (modals).
// Chaque commande déclare les siens dans `composants`, le loader les enregistre ici :
//   composants: [{ id: "close", types: ["bouton"], gestionnaire: (bot, interaction) => … }]
//   composants: [{ prefixe: "jeu:", types: ["bouton", "menu"], gestionnaire }]
// Un composant hérite du module et des droits de sa commande (permission, roleStaffSuffit, acces) :
// dans le module Modération, il passe donc par la garde staff comme la commande. Les composants
// cliqués par les membres (ouvrir un ticket…) le déclarent avec `public: true` et vérifient eux-mêmes leurs droits.
// Les boutons de confirmation attendus par une commande (awaitMessageComponent) ne sont pas enregistrés :
// le routeur les ignore.

const TYPES = {
    bouton: i => i.isButton(),
    menu: i => i.isAnySelectMenu(),
    modal: i => i.isModalSubmit()
}

function creerRouteur() {
    const routes = []

    function enregistrer(route) {
        const nom = route.id ?? route.prefixe
        if ((route.id === undefined) === (route.prefixe === undefined)) throw new Error(`Composant ${nom} : il faut soit un id, soit un prefixe`)
        if (typeof route.gestionnaire !== "function") throw new Error(`Composant ${nom} : gestionnaire manquant`)
        if (!Array.isArray(route.types) || !route.types.length || route.types.some(t => !TYPES[t])) throw new Error(`Composant ${nom} : types invalides`)
        if (route.prefixe !== undefined && !/^[a-z0-9-]+:$/.test(route.prefixe)) throw new Error(`Composant ${nom} : un préfixe finit par « : »`)
        for (const autre of routes) {
            const memeType = autre.types.some(t => route.types.includes(t))
            const collision = route.id !== undefined
                ? (autre.id === route.id || (autre.prefixe && route.id.startsWith(autre.prefixe)))
                : (autre.id?.startsWith(route.prefixe) || autre.prefixe?.startsWith(route.prefixe) || route.prefixe.startsWith(autre.prefixe ?? "\0"))
            if (memeType && collision) throw new Error(`Composant ${nom} : déjà pris par ${autre.id ?? autre.prefixe} (${autre.source ?? "?"})`)
        }
        routes.push(route)
    }

    // Enregistre les composants déclarés par une commande
    function enregistrerCommande(command) {
        for (const c of command.composants ?? []) {
            enregistrer({
                module: command.module, permission: command.permission, roleStaffSuffit: command.roleStaffSuffit,
                acces: command.acces, name: command.name, source: command.name, ...c
            })
        }
    }

    const trouver = interaction => routes.find(r =>
        r.types.some(t => TYPES[t](interaction))
        && (r.id !== undefined ? interaction.customId === r.id : interaction.customId.startsWith(r.prefixe)))

    // Traite le composant. Renvoie false s'il n'est pas enregistré (laissé à un collecteur ou ignoré).
    async function router(bot, interaction, refuser) {
        if (!interaction.isButton() && !interaction.isAnySelectMenu() && !interaction.isModalSubmit()) return false
        const route = trouver(interaction)
        if (!route) return false
        if (!route.public && !await verifierAcces(interaction, route)) {
            await refuser(interaction)
            return true
        }
        await route.gestionnaire(bot, interaction)
        return true
    }

    return { enregistrer, enregistrerCommande, router, routes }
}

module.exports = { creerRouteur, TYPES }
