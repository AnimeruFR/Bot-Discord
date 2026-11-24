// Healthcheck Docker : réussit si le bot a écrit son heartbeat il y a moins de 90 s.
const fs = require('fs')

const fichier = process.env.HEARTBEAT_FILE
const AGE_MAX = 90 * 1000

try {
    const age = Date.now() - Number(fs.readFileSync(fichier, "utf8"))
    if (!Number.isFinite(age) || age > AGE_MAX) {
        console.error(`Heartbeat trop ancien (${Math.round(age / 1000)} s)`)
        process.exit(1)
    }
} catch (err) {
    console.error("Heartbeat illisible :", err.message)
    process.exit(1)
}
