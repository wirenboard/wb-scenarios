/**
 * @file Модуль таблицы содержашей описание выходных воздействий
 *         Описывает действия над контролами в зависимости
 *         от выбранного типа поведения
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

function resetEnable(actualValue, actionValue) {
  var newCtrlValue = false;
  return newCtrlValue;
}

/**
 * Действие установки значения контрола величиной в actionValue
 * @param {number} actualValue - Актуальное состояние контрола на данный момент
 * @param {number} actionValue - Значение заданное пользователем
 * @returns {number} Возвращает новое значение контрола
 */
function setValueNumeric(actualValue, actionValue) {
  // Игнорируем actualValue, просто ставим actionValue
  var newCtrlValue = actionValue;
  return newCtrlValue;
}

function resetValueNumeric(actualValue, actionValue) {
  var newCtrlValue = 0;
  return newCtrlValue;
}

/**
* Таблица действий
* Содержит имя действия и соответствующие ему:
* - Разрешенные типы контрола
* - Обработчик
*/
var actionsTable = {
  'setEnable': {
    reqCtrlTypes: ['switch'],
    launchResolver: setEnable,
    resetResolver: resetEnable
  },
  'setValueNumeric': {
    reqCtrlTypes: ['value'],
    launchResolver: setValueNumeric,
    resetResolver: resetValueNumeric
  }
};

exports.actionsTable = actionsTable;
