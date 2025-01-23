/**
 * Read more about this file
 * https://eslint.org/docs/latest/use/configure/configuration-files
 * 
 * func-names - Need any functions have name - no anonymous
 * log - Hide error - 'log' is not defined.
 */

/**
 * Not use import - use only require() - becoase not have package.json file
 */
const prettierPlugin = require("eslint-plugin-prettier");

module.exports = [
  {
    files: ["**/*.js", "**/*.json"], // Какие файлы проверять
    languageOptions: {
      globals: { // Глобальные переменные чтобы не вызывали ошибок
        log: "readonly",
      },
    },
    rules: {
      "prettier/prettier": "error",
      "no-unused-vars": "warn",
      "no-console": "off",
      "func-names": "error",
      "no-process-exit": "off",
      "object-shorthand": "off",
      "class-methods-use-this": "off",
      indent: ["error", 2],
    },
    plugins: {
      prettier: prettierPlugin,
    },
    settings: {},
  }
];
