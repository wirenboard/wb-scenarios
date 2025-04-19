/**
 * @file translit.mod.js
 * @description Module containing functions used for transliteration
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link JSDoc comments format <https://jsdoc.app/> - Google styleguide
 */

/**
 * Mapping of non-Latin characters to latin equivalents
 *
 * @type {Object<string, string>}
 */
var translitMap = {
  'а': 'a',
  'б': 'b',
  'в': 'v',
  'г': 'g',
  'д': 'd',
  'е': 'e',
  'ё': 'e',
  'ж': 'zh',
  'з': 'z',
  'и': 'i',
  'й': 'y',
  'к': 'k',
  'л': 'l',
  'м': 'm',
  'н': 'n',
  'о': 'o',
  'п': 'p',
  'р': 'r',
  'с': 's',
  'т': 't',
  'у': 'u',
  'ф': 'f',
  'х': 'h',
  'ц': 'ts',
  'ч': 'ch',
  'ш': 'sh',
  'щ': 'sch',
  'ъ': '',
  'ы': 'y',
  'ь': '',
  'э': 'e',
  'ю': 'yu',
  'я': 'ya',
};

/**
 * Replaces a character based on the transliteration map
 *
 * @param {string} char The character to replace
 * @returns {string} The replaced character or original if not found in map
 */
function replaceChar(char) {
  var mappedChar = translitMap[char];
  return mappedChar !== undefined ? mappedChar : char;
}

/**
 * Transliterates a given string
 *
 * @param {string} input The input string to be transliterated
 * @returns {string} The transliterated string in lowercase
 *     with valid characters only
 */
function translit(input) {
  id = input
    .toLowerCase()
    .split('')
    .map(replaceChar)             // Replaces non-Latin symbols to latin char
    .join('')
    .replace(/[^a-z0-9_]/g, '_')  // Replaces unsupported characters with '_'
    .replace(/_+/g, '_')          // Replace multiple '_' with a single one
    .replace(/^_+|_+$/g, '');     // Remove leading and trailing '_'

  // Default ID if empty after processing
  log.error(
    'Transliteration failed for input "{}" — fallback to "scenario"',
    input
  );
  if (!id) id = 'scenario';
  
  return id;
}

exports.translit = function (input) {
  return translit(input);
};
