/**
 * @file transliterate.mod.js
 * @description Module containing functions used for transliteration
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link JSDoc comments format <https://jsdoc.app/> - Google styleguide
 */

/**
 * Mapping of not latin characters to latin equivalents
 * @type {Object<string, string>}
 */
var map = {
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

  'А': 'a',
  'Б': 'b',
  'В': 'v',
  'Г': 'g',
  'Д': 'd',
  'Е': 'e',
  'Ё': 'e',
  'Ж': 'zh',
  'З': 'z',
  'И': 'i',
  'Й': 'y',
  'К': 'k',
  'Л': 'l',
  'М': 'm',
  'Н': 'n',
  'О': 'o',
  'П': 'p',
  'Р': 'r',
  'С': 's',
  'Т': 't',
  'У': 'u',
  'Ф': 'f',
  'Х': 'h',
  'Ц': 'ts',
  'Ч': 'ch',
  'Ш': 'sh',
  'Щ': 'sch',
  'Ъ': '',
  'Ы': 'y',
  'Ь': '',
  'Э': 'e',
  'Ю': 'yu',
  'Я': 'ya',
};
/**
 * Replaces a character based on the transliteration map
 *
 * @param {string} char The character to replace
 * @returns {string} The replaced character or the original if not found in the map
 */
function replaceChar(char) {
  return map[char] || char;
}

/**
 * Transliterates a given string:
 * - From not latin symbols to latin characters
 * - Converts the string to lowercase
 * - Replaces unsupported characters with underscores
 *
 * @param {string} input The input string to be transliterated
 * @returns {string} The transliterated string in lowercase
 *     with valid characters only
 */
function transliterate(input) {
  // Step 1: Replace not latin characters with latin equivalents
  var charArray = input.split('');
  var replacedArray = charArray.map(replaceChar);
  var result = replacedArray.join('');

  // Step 2: Convert the result to lowercase
  result = result.toLowerCase();

  // Step 3: Remove unsupported characters (allow only letters, digits, and underscores)
  // Note: Any unsupported characters (e.g., special symbols, emojis) will be replaced with underscores.
  result = result.replace(/[^a-z0-9_]/g, '_');

  // Return the final transliterated string
  return result;
}

exports.transliterate = function (input) {
  return transliterate(input);
};
