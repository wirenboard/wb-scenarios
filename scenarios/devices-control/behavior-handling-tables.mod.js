/**
 * @file Модуль таблиц событий и действий для контролов
 * Описывает регистрируемы события и действия над контролами,
 * сохраняя их в единой таблице
 * 
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

/**
 * Событие активации контрола
 * @param {boolean} newValue - Новое состояние контрола
 * @returns {boolean} Возвращает true, если контрол включен
 */
function whenEnabled(newValue) {
  var isEventTriggered = (newValue === true);
  return isEventTriggered;
}

/**
 * Событие деактивации контрола
 * @param {boolean} newValue - Новое состояние контрола
 * @returns {boolean} Возвращает true, если контрол выключен
 */
function whenDisabled(newValue) {
  var isEventTriggered = (newValue === false);
  return isEventTriggered;
}

/**
 * Событие изменения состояния контрола
 * @param {any} newValue - Новое состояние контрола
 * @returns {boolean} Всегда возвращает true
 */
function whenChange(newValue) {
  var isEventTriggered = true; // Всегда срабатывает при изменении
  return isEventTriggered;
}

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
* Таблицы событий и действий
* Так как логика подразумевает связь трех сущностей между собой
* Каждое событие или действие имеет ключ, который соответствует типу события/действия и
* включает параметры:
* @param {Array<string>} reqCtrlTypes - Required Control Types
*                     Разрешенные типы контрол топиков MQTT для данного
*                     события/действия
* @param {function} handler - Функция обработчика события или действия
* При изменении состояния любого из входных топиков, согласно настроенным событиям,
* все выходные топики изменяют своё состояние в соответствии с настроенным действием.
*/
var eventsTable = {
  'whenChange': {
    reqCtrlTypes: ['switch', 'value'],
    handler: whenChange
  },
  'whenDisabled': {
    reqCtrlTypes: ['switch'],
    handler: whenDisabled
  },
  'whenEnabled': {
    reqCtrlTypes: ['switch'],
    handler: whenEnabled
  }
};

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

exports.eventsTable = eventsTable;
exports.actionsTable = actionsTable;
