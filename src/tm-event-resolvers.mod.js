/**
 * @file tm-event-resolvers.mod.js
 * @description Модуль таблицы регистрируемых событий над контролами
 * 
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

/**
 * Событие активации контрола
 * @param {boolean} topicObj - Новое состояние контрола
 * @returns {boolean} Возвращает true, если контрол включен
 */
function whenEnabled(topicObj, cfg, ctx) {
  var isEventTriggered = (topicObj.val.new === true);
  return isEventTriggered;
}

/**
 * Событие деактивации контрола
 * @param {boolean} topicObj - Новое состояние контрола
 * @returns {boolean} Возвращает true, если контрол выключен
 */
function whenDisabled(topicObj, cfg, ctx) {
  var isEventTriggered = (topicObj.val.new === false);
  return isEventTriggered;
}

/**
 * Событие изменения состояния контрола
 * @param {any} topicObj - Новое состояние контрола
 * @returns {boolean} Всегда возвращает true
 */
function whenChange(topicObj, cfg, ctx) {
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

/**
 * Автоматическое заполнение resetResolver
 * 
 * После базового заполнения структуры резолверов нужно вычислить
 * resetResolver для всех типов действий  на основе resetResolverName
 * и заполнить это поле
 */
Object.keys(registryEventResolvers).forEach(function (key) {
  var resolver = registryEventResolvers[key];
  if (!resolver.resetResolverName) {
    log.warning(
      'resetResolverName для действия "' +
      key + '" не установлен'
    );
    return;
  }
  if (!registryEventResolvers[resolver.resetResolverName]) {
    log.warning(
      'Ошибка: resetResolverName для действия "' +
      key + '" указан, но отсутствует в реестре действий'
    );
    return;
  }
  resolver.resetResolver = registryEventResolvers[resolver.resetResolverName].launchResolver;
});

exports.registryEventResolvers = registryEventResolvers;
