/**
 * @file translit.mod.js
 * @description Module containing functions used for transliteration
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link JSDoc comments format <https://jsdoc.app/> - Google styleguide
 */

/**
 * Mapping of non-Latin characters to latin equivalents
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
  var res;
  var mappedChar = translitMap[char];

  if (mappedChar !== undefined) {
    res = mappedChar;
  } else {
    res = char;
  }

  return res;
}

/**
 * Transliterates a given string:
 * - Converts the string to lowercase
 * - Replaces non-Latin symbols to latin characters
 * - Replaces unsupported characters with underscores
 *
 * @param {string} input The input string to be transliterated
 * @returns {string} The transliterated string in lowercase
 *     with valid characters only
 */
function translit(input) {
  // Step 1: Convert the input to lowercase
  var lowerCased = input.toLowerCase();

  // Step 2: Replace non-Latin characters with latin equivalents
  var charArray = lowerCased.split('');
  var replacedArray = charArray.map(replaceChar);
  var transliteratedString = replacedArray.join('');

  // Step 3: Replace unsupported characters with underscores
  //         Allow only letters, digits, and underscores
  var res = transliteratedString.replace(/[^a-z0-9_]/g, '_');

  return res;
}

exports.translit = function (input) {
  return translit(input);
};
