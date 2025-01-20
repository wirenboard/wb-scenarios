/**
 * @file tm-event-resolvers.mod.js
 * @description Модуль таблицы регистрируемых событий над контролами
 * 
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

/**
 * Описание общих параметров:
 * @param {object} topic Объект информации о топике
 * @param {object} cfg Объект информации о настройках события
 * @param {object} ctx Объект контекста куда можно сохранять локальные данные
 */

/**
 * Событие активации контрола
 * @note параметры topic, cfg, ctx - описаны сверху в этом файле
 * @returns {boolean} Возвращает true, если контрол включен
 */
function whenEnabled(topic, cfg, ctx) {
  var isEventTriggered = (topic.val.new === true);
  return isEventTriggered;
}

/**
 * Событие деактивации контрола
 * @note параметры topic, cfg, ctx - описаны сверху в этом файле
 * @returns {boolean} Возвращает true, если контрол выключен
 */
function whenDisabled(topic, cfg, ctx) {
  var isEventTriggered = (topic.val.new === false);
  return isEventTriggered;
}

/**
 * Событие изменения состояния контрола
 * @note параметры topic, cfg, ctx - описаны сверху в этом файле
 * @returns {boolean} Всегда возвращает true
 */
function whenChange(topic, cfg, ctx) {
  var isEventTriggered = true; // Всегда срабатывает при изменении
  return isEventTriggered;
}

/**
 * Событие пересечения значением топика заданного значения вверх
 * @note параметры topic, cfg, ctx - описаны сверху в этом файле
 * @returns {boolean} Возвращает true в момент когда новое значение топика
 *     стало больше границы указанной пользователем в cfg.actionValue
 */
function whenCrossUpper(topic, cfg, ctx) {
  var isPrevTypeNumber = (typeof topic.val.prev === 'number');
  if (isPrevTypeNumber !== true) {
    // Если prev отсутствует (null) или имеет некорректный тип,
    // событие не может быть обработано
    return false;
  }

  var isEventTriggered = (topic.val.new > cfg.actionValue) &&
                         (topic.val.prev <= cfg.actionValue);

  return isEventTriggered;
}

/**
 * Событие пересечения значением топика заданного значения вниз
 * @note параметры topic, cfg, ctx - описаны сверху в этом файле
 * @returns {boolean} Возвращает true в момент когда новое значение топика
 *     стало меньше границы указанной пользователем в cfg.actionValue
 */
function whenCrossLower(topic, cfg, ctx) {
  var isPrevTypeNumber = (typeof topic.val.prev === 'number');
  if (isPrevTypeNumber !== true) {
    // Если prev отсутствует (null) или имеет некорректный тип,
    // событие не может быть обработано
    return false;
  }

  var isEventTriggered = (topic.val.new < cfg.actionValue) &&
                         (topic.val.prev >= cfg.actionValue);

  return isEventTriggered;
}

/**
* Таблица описания разных типов событий
* Содержит имя события и соответствующие ему:
* - reqCtrlTypes: Разрешенные типы контроллов с которыми может работать событие
* - launchResolver: Функция резолвера события - решает произошло ли собтие
* - resetResolverName: Строка имени обратного события
* - resetResolver: Функция обратного резолвера
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
  },
  'whenCrossUpper': {
    reqCtrlTypes: ['value'],
    launchResolver: whenCrossUpper,
    resetResolverName: 'whenCrossLower',
    resetResolver: null // Вычисляется ниже динамически
  },
  'whenCrossLower': {
    reqCtrlTypes: ['value'],
    launchResolver: whenCrossLower,
    resetResolverName: 'whenCrossUpper',
    resetResolver: null // Вычисляется ниже динамически
  }
  // @todo: add whileAbove, whileBelow
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
