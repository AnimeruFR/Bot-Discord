// node --disable-warning=ExperimentalWarning --test tests/migrations.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')
const { listerMigrations, migrer, annuler, etat, sauvegarderAvantMigration } = require('../Fonctions/migrations')

// Motif de rotation de Fonctions/backup.js (recopié : l'importer ouvrirait data/bot.db)
const MOTIF = /^bot-\d{8}-\d{6}\.db$/

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-migrations-'))
test.after(() => {
    for (const db of ouvertes) if (db.isOpen) db.close()
    fs.rmSync(racine, { recursive: true, force: true })
})

let compteur = 0
function nouveauDossier() {
    const dossier = path.join(racine, `d${++compteur}`)
    fs.mkdirSync(dossier)
    return dossier
}
const ouvertes = []
function ouvrir() {
    const db = new DatabaseSync(path.join(nouveauDossier(), 'test.db'))
    ouvertes.push(db)
    return db
}
const version = db => db.prepare("PRAGMA user_version").get().user_version
const tables = db => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(t => t.name)
const colonnes = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
const DERNIERE = listerMigrations().length

// Écrit des migrations factices dans un dossier temporaire : { "001-a.js": "corps de up", ... }
function dossierFactice(fichiers) {
    const dossier = nouveauDossier()
    for (const [nom, up] of Object.entries(fichiers)) {
        const table = nom.replace(/\W/g, '_')
        fs.writeFileSync(path.join(dossier, nom), `module.exports = {
            description: "factice",
            up(db) { ${up} },
            down(db) { db.exec("DROP TABLE IF EXISTS t_${table}") }
        }`)
    }
    return dossier
}

test('base neuve : migre jusqu\'à la dernière version', () => {
    const db = ouvrir()
    const resultat = migrer(db)
    assert.deepStrictEqual(resultat, { avant: 0, apres: DERNIERE, appliquees: Array.from({ length: DERNIERE }, (_, i) => i + 1) })
    assert.strictEqual(version(db), DERNIERE)
    assert.ok(tables(db).includes('cases') && tables(db).includes('guild_config'))
    assert.ok(colonnes(db, 'guild_config').includes('couleur'))
    assert.deepStrictEqual(etat(db), { actuelle: DERNIERE, derniere: DERNIERE, enAttente: [] })
})

test('relancer ne change rien', () => {
    const db = ouvrir()
    migrer(db)
    db.prepare("INSERT INTO guild_config (guild_id, log_channel_id) VALUES ('g', 'c')").run()
    const avant = tables(db)
    const resultat = migrer(db)
    assert.deepStrictEqual(resultat, { avant: DERNIERE, apres: DERNIERE, appliquees: [] })
    assert.deepStrictEqual(tables(db), avant)
    assert.strictEqual(db.prepare("SELECT log_channel_id FROM guild_config").get().log_channel_id, 'c')
})

test('ancienne base : migre sans perte et reprend les warns dans cases', () => {
    const db = ouvrir()
    // Base d'avant le lot C : guild_config sans les colonnes récentes, warns sans table cases
    db.exec(`
        CREATE TABLE warns (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
            moderator_id TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE guild_config (guild_id TEXT PRIMARY KEY, log_channel_id TEXT);
        INSERT INTO warns (guild_id, user_id, moderator_id, reason, created_at) VALUES ('g1', 'u1', 'm1', 'spam', 100), ('g1', 'u2', 'm1', 'insulte', 200);
        INSERT INTO guild_config (guild_id, log_channel_id) VALUES ('g1', 'salon-logs');
    `)
    assert.strictEqual(version(db), 0)

    migrer(db)
    assert.strictEqual(version(db), DERNIERE)
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM warns").get().n, 2)
    assert.strictEqual(db.prepare("SELECT log_channel_id FROM guild_config WHERE guild_id = 'g1'").get().log_channel_id, 'salon-logs')
    for (const colonne of ['ticket_category_id', 'ticket_inactivity_days', 'welcome_message', 'goodbye_channel_id', 'langue', 'couleur']) {
        assert.ok(colonnes(db, 'guild_config').includes(colonne), `colonne ${colonne} ajoutée`)
    }
    assert.strictEqual(db.prepare("SELECT ticket_inactivity_days FROM guild_config").get().ticket_inactivity_days, 0)
    const cases = db.prepare("SELECT type, reason, warn_id, created_at FROM cases ORDER BY id").all()
    assert.deepStrictEqual(cases.map(c => ({ ...c })), [
        { type: 'warn', reason: 'spam', warn_id: 1, created_at: 100 },
        { type: 'warn', reason: 'insulte', warn_id: 2, created_at: 200 }
    ])
})

test('base où cases existe déjà : les warns ne sont pas repris une seconde fois', () => {
    const db = ouvrir()
    migrer(db)
    db.exec(`INSERT INTO warns (guild_id, user_id, moderator_id, reason, created_at) VALUES ('g', 'u', 'm', 'x', 1)`)
    // Base créée par une version précédente du bot : tables là, mais user_version à 0
    db.exec("PRAGMA user_version = 0")
    migrer(db)
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM cases").get().n, 0)
    assert.strictEqual(version(db), DERNIERE)
})

test('base avec une partie des colonnes seulement', () => {
    const db = ouvrir()
    db.exec(`CREATE TABLE guild_config (guild_id TEXT PRIMARY KEY, log_channel_id TEXT, ticket_category_id TEXT, langue TEXT);
        INSERT INTO guild_config VALUES ('g', 'l', 'cat', 'en')`)
    migrer(db)
    const ligne = db.prepare("SELECT * FROM guild_config").get()
    assert.strictEqual(ligne.langue, 'en')
    assert.strictEqual(ligne.ticket_category_id, 'cat')
    assert.ok('couleur' in ligne && 'welcome_message' in ligne)
})

test('down puis up', () => {
    const db = ouvrir()
    migrer(db)
    db.prepare("INSERT INTO guild_config (guild_id, log_channel_id) VALUES ('g', 'c')").run()
    const complet = tables(db)

    const retour = annuler(db, 0)
    assert.deepStrictEqual(retour, { avant: DERNIERE, apres: 0, annulees: Array.from({ length: DERNIERE }, (_, i) => DERNIERE - i) })
    assert.strictEqual(version(db), 0)
    assert.deepStrictEqual(tables(db), [])

    migrer(db)
    assert.strictEqual(version(db), DERNIERE)
    assert.deepStrictEqual(tables(db), complet)
})

test('migration qui échoue : rollback, version inchangée, aucune table à moitié créée', () => {
    const db = ouvrir()
    const dossier = dossierFactice({
        '001-premiere.js': 'db.exec("CREATE TABLE ok (id INTEGER)")',
        '002-cassee.js': 'db.exec("CREATE TABLE a_moitie (id INTEGER)"); db.exec("INSERT INTO table_inexistante VALUES (1)")'
    })
    assert.throws(() => migrer(db, { dossier }), /002-cassee\.js/)
    assert.strictEqual(version(db), 1)
    assert.deepStrictEqual(tables(db), ['ok'])
    // La base reste utilisable (pas de transaction restée ouverte)
    db.exec("INSERT INTO ok VALUES (1)")
})

test('migration qui échoue aussi pendant down : rollback', () => {
    const db = ouvrir()
    const dossier = nouveauDossier()
    fs.writeFileSync(path.join(dossier, '001-a.js'), `module.exports = {
        up(db) { db.exec("CREATE TABLE a (id INTEGER)") },
        down(db) { db.exec("DROP TABLE a"); throw new Error("boum") }
    }`)
    migrer(db, { dossier })
    assert.throws(() => annuler(db, 0, { dossier }), /boum/)
    assert.strictEqual(version(db), 1)
    assert.deepStrictEqual(tables(db), ['a'])
})

test('trou, doublon ou nom invalide dans la numérotation = erreur', () => {
    const db = ouvrir()
    const trou = dossierFactice({ '001-a.js': '', '003-c.js': '' })
    assert.throws(() => listerMigrations(trou), /Trou/)
    assert.throws(() => migrer(db, { dossier: trou }), /Trou/)
    assert.strictEqual(version(db), 0)

    const commenceA2 = dossierFactice({ '002-b.js': '' })
    assert.throws(() => listerMigrations(commenceA2), /Trou/)

    const doublon = dossierFactice({ '001-a.js': '', '001-b.js': '' })
    assert.throws(() => listerMigrations(doublon), /double/)

    const invalide = dossierFactice({ '001-a.js': '', 'migration.js': '' })
    assert.throws(() => listerMigrations(invalide), /invalide/)
})

test('cible : migre jusqu\'à une version précise, refuse une cible hors limites', () => {
    const db = ouvrir()
    const dossier = dossierFactice({
        '001-a.js': 'db.exec("CREATE TABLE a (id INTEGER)")',
        '002-b.js': 'db.exec("CREATE TABLE b (id INTEGER)")'
    })
    assert.deepStrictEqual(migrer(db, { dossier, cible: 1 }), { avant: 0, apres: 1, appliquees: [1] })
    assert.deepStrictEqual(etat(db, { dossier }).enAttente.map(m => m.version), [2])
    assert.throws(() => migrer(db, { dossier, cible: 5 }), /cible/)
    assert.throws(() => annuler(db, 3, { dossier }), /cible/)
})

test('une base plus récente que le code est refusée', () => {
    const db = ouvrir()
    db.exec(`PRAGMA user_version = ${DERNIERE + 1}`)
    assert.throws(() => migrer(db), /plus récente/)
})

test('un autre processus a migré entre-temps : la migration n\'est pas rejouée', () => {
    const chemin = path.join(nouveauDossier(), 'partage.db')
    const a = new DatabaseSync(chemin)
    const b = new DatabaseSync(chemin)
    const dossier = dossierFactice({ '001-a.js': 'db.exec("CREATE TABLE a (id INTEGER)")' })
    // b a lu user_version = 0 ... puis a migre avant lui : sa transaction relit la version et ne rejoue pas up
    assert.strictEqual(version(b), 0)
    migrer(a, { dossier })
    assert.deepStrictEqual(migrer(b, { dossier }), { avant: 1, apres: 1, appliquees: [] })
    a.close()
    b.close()
})

test('sauvegarde avant migration : base remplie seulement, nom hors rotation', () => {
    const dossierBackups = nouveauDossier()

    const memoire = new DatabaseSync(':memory:')
    assert.strictEqual(sauvegarderAvantMigration(memoire, ':memory:', { dossier: dossierBackups }), null)

    const neuve = ouvrir()
    assert.strictEqual(sauvegarderAvantMigration(neuve, 'neuve.db', { dossier: dossierBackups }), null)
    assert.deepStrictEqual(fs.readdirSync(dossierBackups), [])

    const db = ouvrir()
    db.exec("CREATE TABLE guild_config (guild_id TEXT PRIMARY KEY, log_channel_id TEXT); INSERT INTO guild_config VALUES ('g', 'c')")
    const copie = sauvegarderAvantMigration(db, 'existante.db', { dossier: dossierBackups })
    const nom = path.basename(copie)
    assert.match(nom, /^avant-migration-v0-\d{8}-\d{6}\.db$/)
    assert.ok(!MOTIF.test(nom), 'ne doit pas être effacée par la rotation')
    assert.deepStrictEqual(fs.readdirSync(dossierBackups), [nom])
    const verif = new DatabaseSync(copie, { readOnly: true })
    assert.strictEqual(verif.prepare("SELECT log_channel_id FROM guild_config").get().log_channel_id, 'c')
    verif.close()
})
