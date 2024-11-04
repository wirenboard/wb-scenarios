/**
 * @file Модуль таблицы регистрируемых событий над контролами
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
* Таблица событий
* Содержит имя события и соответствующие ему:
* - Разрешенные типы контрола
* - Обработчик
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

exports.eventsTable = eventsTable;
