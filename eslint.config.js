const js = require('@eslint/js')
const globals = require('globals')

module.exports = [
    { ignores: ["node_modules/"] },
    js.configs.recommended,
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "commonjs",
            globals: globals.node
        },
        rules: {
            // Les commandes reçoivent toujours (bot, message, args) même si elles n'utilisent pas tout
            "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
            "eqeqeq": ["error", "always"],
            "prefer-const": "error",
            "no-var": "error",
            // Interdit eval et consorts (exécution de code arbitraire)
            "no-eval": "error",
            "no-implied-eval": "error",
            "no-new-func": "error"
        }
    }
]
