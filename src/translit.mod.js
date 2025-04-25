/**
 * @file translit.mod.js - ES5 module for wb-rules v2.28
 * @description Module containing functions used for transliteration
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
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

  // If result empty after processing - set default ID
  // Example: if input is two underscope '__':
  //   - scenario_qmbg561hkx
  //   - scenario_gstcqtgwpi
  if (!id) {
    log.warning(
      'Translit warning: Empty ID generated from input "{}", using random ID',
       input
      );
    id = 'scenario_' + Math.random().toString(36).substring(2, 10);
  }

  return id;
}

exports.translit = function (input) {
  return translit(input);
};
