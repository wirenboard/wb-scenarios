/**
 * @file Модуль реестра, содержащего описание выходных воздействий
 *       Описывает действия над контролами в зависимости
 *       от выбранного типа поведения
 * 
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

/**
 * Действие включения контрола
 * @param {boolean} actualValue - Актуальное состояние контрола на данный момент
 * @returns {boolean} Всегда возвращает true
 */
function setEnable(actualValue, actionValue) {
  var newCtrlValue = true;
  return newCtrlValue;
}

function setDisable(actualValue, actionValue) {
  var newCtrlValue = false;
  return newCtrlValue;
}

/**
 * Действие установки значения контрола величиной в actionValue
 * @param {number} actualValue - Актуальное состояние контрола на данный момент
 * @param {number} actionValue - Значение заданное пользователем
 * @returns {number} Возвращает новое значение контрола
 */
function setValueNumericInput(actualValue, actionValue) {
  // Игнорируем actualValue, просто ставим actionValue
  var newCtrlValue = actionValue;
  return newCtrlValue;
}

function setValueNumericZero(actualValue, actionValue) {
  var newCtrlValue = 0;
  return newCtrlValue;
}

/**
 * Реестр действий
 *
 * Содержит имя действия и соответствующие ему:
 * - Разрешенные типы контролов для данного действия
 * - Функция-обработчик данного действия
 * - Имя действия для ресета (используется в коде при отмене действия)
 * - Обработчик ресета (вычисляется динамически в конце после чтения всего файла)
 */
var actionsTable = {
  'setEnable': {
    reqCtrlTypes: ['switch'],
    launchResolver: setEnable,
    resetResolverName: 'setDisable',
    resetResolver: null // Вычисляется ниже динамически
  },
  'setDisable': {
    reqCtrlTypes: ['switch'],
    launchResolver: setDisable,
    resetResolverName: 'setEnable',
    resetResolver: null // Вычисляется ниже динамически
  },
  'setValueNumericInput': {
    reqCtrlTypes: ['value'],
    launchResolver: setValueNumericInput,
    resetResolverName: 'setValueNumericZero',
    resetResolver: null // Вычисляется ниже динамически
  },
  'setValueNumericZero': {
    reqCtrlTypes: ['value'],
    launchResolver: setValueNumericZero,
    resetResolverName: null, // Не может быть ресета
    resetResolver: null // Не может быть ресета
  },
};

// Вычисляем для всех типов действий resetResolver на основе resetResolverName
Object.keys(actionsTable).forEach(function (key) {
  log.debug('+ Обработка ключа "' + key + '"');
  
  if (!actionsTable[key].resetResolverName) {
    log.debug('resetResolverName для действия "' + key + '" не установлен');
    return;
  }
  if (!actionsTable[actionsTable[key].resetResolverName]) {
    log.debug('Ошибка: resetResolverName для действия "' +
      key + '" указан, но отсутствует в реестре действий');
    return;
  }
  log.debug('  - Текущее значение "' + actionsTable[key].resetResolver + '"');
  log.debug('  - Установка "' + actionsTable[actionsTable[key].resetResolverName].launchResolver + '"');
  actionsTable[key].resetResolver = actionsTable[actionsTable[key].resetResolverName].launchResolver;
  log.debug('  - Новое значение "' + actionsTable[key].resetResolver + '"');
});

exports.actionsTable = actionsTable;




// // Вывод текущего состояния реестра для отладки
// log.debug("Состояние actionsTable после вычисления (custom):");
// log.debug(stringifyWithFunctions(actionsTable));

// /**
//  * Преобразует объект в JSON-строку, включая функции
//  * @param {Object} obj - Объект для преобразования
//  * @param {number} spacing - Отступ для форматирования (если не указан, равен 2)
//  * @returns {string} - JSON-строка, включая функции
//  */
// function stringifyWithFunctions(obj, spacing) {
//   // Устанавливаем значение по умолчанию для spacing
//   spacing = typeof spacing !== "undefined" ? spacing : 2;

//   // Функция replacer для JSON.stringify
//   function replacer(key, value) {
//     if (typeof value === "function") {
//       return value.toString();
//     }
//     return value;
//   }

//   return JSON.stringify(obj, replacer, spacing);
// }

//  = = Пример изменения структуры = =

// Состояние actionsTable до вычисления (custom):
// {
//   "setEnable": {
//     "reqCtrlTypes": [
//       "switch"
//     ],
//     "launchResolver": "function setEnable() {/* source code */}",
//     "resetResolverName": "setDisable",
//     "resetResolver": null
//   },
//   "setDisable": {
//     "reqCtrlTypes": [
//       "switch"
//     ],
//     "launchResolver": "function setDisable() {/* source code */}",
//     "resetResolverName": "setEnable",
//     "resetResolver": null
//   },
//   "setValueNumericInput": {
//     "reqCtrlTypes": [
//       "value"
//     ],
//     "launchResolver": "function setValueNumericInput() {/* source code */}",
//     "resetResolverName": "setValueNumericZero",
//     "resetResolver": null
//   },
//   "setValueNumericZero": {
//     "reqCtrlTypes": [
//       "value"
//     ],
//     "launchResolver": "function setValueNumericZero() {/* source code */}",
//     "resetResolverName": null,
//     "resetResolver": null
//   }
// }
// + Обработка ключа "setEnable"
//   - Текущее значение "null"
//   - Установка "function setDisable() {/* source code */}"
//   - Новое значение "function setDisable() {/* source code */}"
// + Обработка ключа "setDisable"
//   - Текущее значение "null"
//   - Установка "function setEnable() {/* source code */}"
//   - Новое значение "function setEnable() {/* source code */}"
// + Обработка ключа "setValueNumericInput"
//   - Текущее значение "null"
//   - Установка "function setValueNumericZero() {/* source code */}"
//   - Новое значение "function setValueNumericZero() {/* source code */}"
// + Обработка ключа "setValueNumericZero"
// resetResolverName для действия "setValueNumericZero" не установлен
// Состояние actionsTable после вычисления (custom):
// {
//   "setEnable": {
//     "reqCtrlTypes": [
//       "switch"
//     ],
//     "launchResolver": "function setEnable() {/* source code */}",
//     "resetResolverName": "setDisable",
//     "resetResolver": "function setDisable() {/* source code */}"
//   },
//   "setDisable": {
//     "reqCtrlTypes": [
//       "switch"
//     ],
//     "launchResolver": "function setDisable() {/* source code */}",
//     "resetResolverName": "setEnable",
//     "resetResolver": "function setEnable() {/* source code */}"
//   },
//   "setValueNumericInput": {
//     "reqCtrlTypes": [
//       "value"
//     ],
//     "launchResolver": "function setValueNumericInput() {/* source code */}",
//     "resetResolverName": "setValueNumericZero",
//     "resetResolver": "function setValueNumericZero() {/* source code */}"
//   },
//   "setValueNumericZero": {
//     "reqCtrlTypes": [
//       "value"
//     ],
//     "launchResolver": "function setValueNumericZero() {/* source code */}",
//     "resetResolverName": null,
//     "resetResolver": null
//   }
// }
