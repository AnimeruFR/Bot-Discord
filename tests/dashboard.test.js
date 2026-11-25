process.env.DATABASE_PATH = ":memory:"

const { test } = require('node:test')

test("tableau de bord (discord-actions)", async () => {
    await require('../dashboard/tests/discord-actions.js').tester()
})

test("tableau de bord (pages)", async () => {
    await require('../dashboard/tests/pages.js').tester()
})

test("tableau de bord (serveur)", async () => {
    await require('../dashboard/tests/serveur.js').tester()
})
