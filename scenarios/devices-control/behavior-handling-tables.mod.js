/**
 * @file Модуль таблиц событий и действий для контролов
 * Описывает логику связи между событиями и действиями контролов, сохраняя их в единой таблице
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
 * Отключает контрол
 * @param {boolean} actualValue - Актуальное состояние контрола на данный момент
 * @returns {boolean} Всегда возвращает false
 */
function setDisable(actualValue) {
  var newControlValue = false;
  return newControlValue;
}

/**
 * Включает контрол
 * @param {boolean} actualValue - Актуальное состояние контрола на данный момент
 * @returns {boolean} Всегда возвращает true
 */
function setEnable(actualValue) {
  var newControlValue = true;
  return newControlValue;
}

/**
 * Переключает состояние контрола
 * @param {boolean} actualValue - Актуальное состояние контрола на данный момент
 * @returns {boolean} Возвращает противоположное текущему состояние контрола
 */
function toggle(actualValue) {
  var newControlValue = !actualValue;
  return newControlValue;
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
    reqCtrlTypes: ['switch'],
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
  }
};

exports.eventsTable = eventsTable;
exports.actionsTable = actionsTable;
