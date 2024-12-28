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
var registryEventResolvers = {
  'whenChange': {
    reqCtrlTypes: ['switch', 'value'],
    launchResolver: whenChange,
    resetResolverName: null, // Не существует противоположного события
    resetResolver: null // Не существует противоположного события
  },
  'whenDisabled': {
    reqCtrlTypes: ['switch'],
    launchResolver: whenDisabled,
    resetResolverName: 'whenEnabled',
    resetResolver: null // Вычисляется ниже динамически
  },
  'whenEnabled': {
    reqCtrlTypes: ['switch'],
    launchResolver: whenEnabled,
    resetResolverName: 'whenDisabled',
    resetResolver: null // Вычисляется ниже динамически
  }
};

// Вычисляем для всех типов действий resetResolver на основе resetResolverName
Object.keys(registryEventResolvers).forEach(function (key) {
  log.debug('+ Обработка ключа "' + key + '"');
  
  if (!registryEventResolvers[key].resetResolverName) {
    log.debug('resetResolverName для действия "' + key + '" не установлен');
    return;
  }
  if (!registryEventResolvers[registryEventResolvers[key].resetResolverName]) {
    log.debug('Ошибка: resetResolverName для действия "' +
      key + '" указан, но отсутствует в реестре действий');
    return;
  }
  log.debug('  - Текущее значение "' + registryEventResolvers[key].resetResolver + '"');
  log.debug('  - Установка "' + registryEventResolvers[registryEventResolvers[key].resetResolverName].launchResolver + '"');
  registryEventResolvers[key].resetResolver = registryEventResolvers[registryEventResolvers[key].resetResolverName].launchResolver;
  log.debug('  - Новое значение "' + registryEventResolvers[key].resetResolver + '"');
});

exports.registryEventResolvers = registryEventResolvers;
