/**
 * @file Модуль таблицы производимых над контролами действий для сценария schedule
 * @author Ivan Praulov <ivan.praulov@wirenboard.com>
 */

/**
 * Действие отключения контрола
 * @param {boolean} actualValue - Актуальное состояние контрола на данный момент
 * @returns {boolean} Всегда возвращает false
 */
function setDisable(actualValue, actionValue) {
  var newCtrlValue = false;
  return newCtrlValue;
}

/**
 * Действие включения контрола
 * @param {boolean} actualValue - Актуальное состояние контрола на данный момент
 * @returns {boolean} Всегда возвращает true
 */
function setEnable(actualValue, actionValue) {
  var newCtrlValue = true;
  return newCtrlValue;
}

/**
 * Действие переключения состояния контрола
 * @param {boolean} actualValue - Актуальное состояние контрола на данный момент
 * @returns {boolean} Возвращает противоположное текущему состоянию контрола
 */
function toggle(actualValue, actionValue) {
  var newCtrlValue = !actualValue;
  return newCtrlValue;
}

/**
 * Действие установки значения контрола величиной в actionValue
 * @param {number} actualValue - Актуальное состояние контрола на данный момент
 * @param {number} actionValue - Значение заданное пользователем
 * @returns {number} Возвращает новое значение контрола
 */
function setValue(actualValue, actionValue) {
  var newCtrlValue = actionValue;
  return newCtrlValue;
}

/**
 * Действие увеличения значения контрола на величину в actionValue
 * @param {number} actualValue - Актуальное состояние контрола на данный момент
 * @param {number} actionValue - Значение заданное пользователем
 * @returns {number} Возвращает новое значение контрола
 */
function increaseValueBy(actualValue, actionValue) {
  var newCtrlValue = actualValue + actionValue;
  return newCtrlValue;
}

/**
 * Действие уменьшения значения контрола на величину в actionValue
 * @param {number} actualValue - Актуальное состояние контрола на данный момент
 * @param {number} actionValue - Значение заданное пользователем
 * @returns {number} Возвращает новое значение контрола
 */
function decreaseValueBy(actualValue, actionValue) {
  var newCtrlValue = actualValue - actionValue;
  return newCtrlValue;
}

/**
* Таблица действий
* Содержит имя действия и соответствующие ему:
* - Разрешенные типы контрола
* - Обработчик
*/
var actionsTable = {
  'toggle': {
    reqCtrlTypes: ['switch'],
    handler: toggle
  },
  'setEnable': {
    reqCtrlTypes: ['switch'],
    handler: setEnable
  },
  'setDisable': {
    reqCtrlTypes: ['switch'],
    handler: setDisable
  },
  'setValue': {
    reqCtrlTypes: ['value'],
    handler: setValue
  },
  'increaseValueBy': {
    reqCtrlTypes: ['value'],
    handler: increaseValueBy
  },
  'decreaseValueBy': {
    reqCtrlTypes: ['value'],
    handler: decreaseValueBy
  }
};

exports.actionsTable = actionsTable;
