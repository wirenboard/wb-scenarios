/**
 * @file Модуль с реестром регистрируемых событий и методами
 *       для его обработки
 * 
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

var eResolvers = require('registry-event-resolvers.mod');

/**
* Создание нового реестра событий
*
* @returns {Object} - Объект с реестром событий и методами для работы с ним
*/
function createRegistryForEvents() {
  var registry = {};

  /**
  * Регистрирует событие для одного MQTT топика
  *
  * @param {string} topic - Имя MQTT-топика вида "device/control"
  * @param {string} eventType - Тип события
  * @param {function} mainCallback - Обратный вызов для события
  */
  function registerSingleEvent(topic, eventType, mainCallback) {
    if (typeof mainCallback !== 'function') {
      log.error('Callback должен быть функцией');
      return;
    }

    // Смотрим что в реестре событий есть описание указанного EventType
    var eventInfo = eResolvers.registryEventResolvers[eventType];
    if (!eventInfo) {
      log.error(
        'Неизвестный eventType "' + eventType + '".' +
        'Не возможно зарегистрировать данное событие');
      return;
    }

    if (!registry[topic]) {
      registry[topic] = {};
    }

    if (registry[topic][eventType]) {
      log.error(
        'Событие "' + eventType + '" для топика "' + topic + '"' +
        'уже зарегистрировано. Callback будет перезаписан'
      );
    }

    // Сохраняем колбэк в объекте события
    registry[topic][eventType] = { callback: mainCallback };

    log.debug(
      'Событие зарегистрировано: topic="' + topic + '",' +
      'type="' + eventType + '"'
    );
  }

  /**
   * Регистрирует противоположное событие для одного MQTT топика
   * 
   * @param {string} topic - Имя MQTT-топика вида "device/control"
   * @param {string} eventType - Тип основного события (например, 'whenEnabled')
   * @param {Function} oppositeCallback - Колбэк для противоположного события
   */
  function registerOppositeEvent(topic, eventType, oppositeCallback) {
    if (typeof oppositeCallback !== 'function') {
      log.error('Callback должен быть функцией');
      return;
    }

    // Смотрим что в реестре событий есть описание указанного EventType
    var eventInfo = eResolvers.registryEventResolvers[eventType];
    if (!eventInfo) {
      log.error(
        'Неизвестный eventType "' + eventType + '".' +
        'Невозможно зарегистрировать противоположное событие'
      );
      return;
    }

    // Берём имя «противоположного» события
    var oppEventName = eventInfo.resetResolverName;
    if (!oppEventName) {
      log.error(
        'Событие "' + eventType + '" не имеет resetResolverName.' +
        'Невозможно зарегистрировать противоположное событие'
      );
      return;
    }

    // Проверяем, действительно ли oppEventName существует в реестре
    if (!eResolvers.registryEventResolvers[oppEventName]) {
      log.error(
        'Имя противоположного события "' + oppEventName + '" ' +
        'не найдено в registryEventResolvers.' +
        'Невозможно зарегистрировать противоположное событие'
      );
      return;
    }

    // Регистрируем «противоположное» событие
    registerSingleEvent(topic, oppEventName, oppositeCallback);
    log.debug(
      'Противоположное событие с именем "' + oppEventName + '"' +
      'зарегистрировано для базового события "' + eventType + '"'
    );
  }

  /**
   * Регистрирует основное и сразу противоположное событие для заданного топика.
   *
   * @param {string} topic - Имя MQTT-топика вида "device/control"
   * @param {string} eventType - Тип основного события (например, 'whenEnabled')
   * @param {function} mainCallback - Обратный вызов для события
   * @param {Function} oppositeCallback - Колбэк для противоположного события
   */
  function registerBothEvents(topic, eventType, mainCallback, oppositeCallback) {
    // Сначала регистрируем основное
    registerSingleEvent(topic, eventType, mainCallback);

    // Затем регистрируем противоположное
    registerOppositeEvent(topic, eventType, oppositeCallback);
  }

  /**
   * Регистрирует события для массива MQTT топиков
   *
   * @param {Array<string>} topics - Массив имен MQTT топиков
   * @param {string} eventType - Тип события
   * @param {function} callback - Обратный вызов для событий
   */
  function registerMultipleEvents(topics, eventType, callback) {
    if (!Array.isArray(topics)) {
      log.error(
        'Параметр "topics" должен быть массивом строк,' +
        'но текущий тип: "' + typeof topics + '"'
      );
      return;
    }

    for (var i = 0; i < topics.length; i++) {
      var topic = topics[i];
      if (typeof topic !== 'string') {
        log.error(
          'Пропуск не корректного топика, индекс "' + i + '":' +
          'должен быть строкой.'
        );
        continue;
      }
      registerSingleEvent(topic, eventType, callback);
    }
  }

  /**
   * Регистрирует события для одного объекта с настройками MQTT-топиков,
   * основываясь на behaviorType
   *
   * @param {Array} topicWithBehavior  - Один топик с настройками поведения
   * @param {function} callback - Обратный вызов для событий
   */
  function registerSingleEventWithBehavior(topicWithBehavior, callback) {
    var mqttTopicName = topicWithBehavior.mqttTopicName;
    var behaviorType = topicWithBehavior.behaviorType;

    if (!mqttTopicName || !behaviorType) {
      log.error(
        'Не корректные данные объекта топика. ' +
        'mqttTopicName и behaviorType должны быть заданы'
      );
      return;
    }

    // Проверка существования такого типа behaviorType в реестре событий
    var eventResolver = eResolvers.registryEventResolvers[behaviorType];
    if (!eventResolver) {
      log.error(
        'Неизвестный behaviorType "' + behaviorType + '".' +
        'Такое событие еще не зарегистрированно в регистре описания событий'
      );
      return;
    }

    registerSingleEvent(mqttTopicName, behaviorType, callback);
  }

  /**
   * Регистрирует основное И противоположное событие для одного объекта с настройками,
   * основываясь на behaviorType.
   *
   * @param {Object} topicWithBehavior - Объект вида { mqttTopicName: string, behaviorType: string }
   * @param {Function} mainCallback - Колбэк для основного события
   * @param {Function} oppCallback - Колбэк для противоположного события
   */
  function registerSingleEventWithBehaviorOpposite(topicWithBehavior, mainCallback, oppCallback) {
    var mqttTopicName = topicWithBehavior.mqttTopicName;
    var behaviorType = topicWithBehavior.behaviorType;

    if (!mqttTopicName || !behaviorType) {
      log.error(
        'Не корректные данные объекта топика. ' +
        'mqttTopicName и behaviorType должны быть заданы'
      );
      return;
    }

    // Проверка существования такого типа behaviorType в реестре событий
    var eventResolver = eResolvers.registryEventResolvers[behaviorType];
    if (!eventResolver) {
      log.error(
        'Неизвестный behaviorType "' + behaviorType + '".' +
        'Такое событие еще не зарегистрированно в регистре описания событий'
      );
      return;
    }

    // Вызываем уже имеющуюся функцию, которая регистрирует основное + противоположное
    registerBothEvents(mqttTopicName, behaviorType, mainCallback, oppCallback);
  }

  /**
   * Регистрирует для массива объектов с настройками MQTT-топиков основное
   * событие, основываясь на behaviorType
   *
   * @param {Array} topicsWithBehavior - Массив топиков с настройками поведения
   * @param {function} mainCallback - Колбэк для основного события
   */
  function registerMultipleEventsWithBehavior(topicsWithBehavior, mainCallback) {
    if (!Array.isArray(topicsWithBehavior)) {
      log.error('TopicsWithBehavior должен быть массивом');
      return;
    }

    for (var i = 0; i < topicsWithBehavior.length; i++) {
      registerSingleEventWithBehavior(topicsWithBehavior[i], mainCallback);
    }
  }

  /**
   * Регистрирует для массива объектов с настройками MQTT-топиков и основное,
   * и противоположное событие, основываясь на behaviorType
   *
   * @param {Array} topicsWithBehavior - Массив топиков с настройками поведения
   * @param {Function} mainCallback - Колбэк для основного события
   * @param {Function} oppCallback - Колбэк для противоположного события
   */
  function registerMultipleEventsWithBehaviorOpposite(topicsWithBehavior, mainCallback, oppCallback) {
    if (!Array.isArray(topicsWithBehavior)) {
      log.error('topicsWithBehavior должен быть массивом');
      return;
    }

    for (var i = 0; i < topicsWithBehavior.length; i++) {
      registerSingleEventWithBehaviorOpposite(topicsWithBehavior[i], mainCallback, oppCallback);
    }
  }

  /**
   * Обрабатывает все события для указанного топика, которые произошли
   *
   * @param {string} topic - Имя MQTT-топика вида "device/control"
   * @param {any} value - Новое значение топика
   * @returns {Object} - Статус обработки:
   *                     { 
   *                       status: 'success' | 'no_events_registered' | 'topic_not_found',
   *                       message: string
   *                     }
   */
  function processEvent(topic, value) {
    var res;
    var topicEvents = registry[topic];

    // Проверяем, существует ли указанный топик приведя к булевому типу
    var topicExists = !!topicEvents;
    if (!topicExists) {
      res = {
        status: 'topic_not_found',
        message: 'Топик "' + topic + '" не найден в регистре'
      };
      return res;
    }

    var hasProcessed = false;

    for (var curEventType in topicEvents) {
      var resolver = eResolvers.registryEventResolvers[curEventType];
      var isResolverValid = resolver &&
        typeof resolver.launchResolver === 'function';

      if (!isResolverValid) {
        log.error('Для события "' + curEventType + '" не найден Resolver');
        continue;
      }

      var isTriggered = resolver.launchResolver(value);
      if (!isTriggered) {
        // log.debug(
        //   'Resolver "' + curEventType + 'не подтвердил событие'
        //   '" для топика "' + topic + '"'
        // );
        continue;
      }

      var eventObj = topicEvents[curEventType];
      var isCallbackValid = eventObj && typeof eventObj.callback === 'function';

      if (isCallbackValid) {
        // log.debug(
        //   'Выполнение callback для топика "' + topic +
        //   '", тип события "' + curEventType + '"'
        // );
        eventObj.callback(value);
        hasProcessed = true;
      } else {
        log.error(
          'Callback не найден для топика "' + topic +
          '", тип события "' + curEventType + '"'
        );
      }
    }

    if (hasProcessed) {
      res = {
        status: 'success',
        message: 'Событие обработано успешно'
      };
      return res;
    }

    res = {
      status: 'no_events_registered',
      message: 'Нет обрабатываемых событий для данного топика'
    };
    return res;
  }

  /**
  * Возвращает отладочное представление реестра
  *
  * @returns {Object} - Структура реестра для отладки
  */
  function getRegistryDebugView() {
    var debugView = {};
    for (var topic in registry) {
      debugView[topic] = {};
      for (var curEventType in registry[topic]) {
        // Анонимные функции отображаются просто как {} - чтобы было понятнее
        // обработаем явно вывод имени функции
        debugView[topic][curEventType] = {
          callbackName: registry[topic][curEventType].callback.name + '()' ||
            'anonymous()'
        };
      }
    }
    return debugView;
  }

  // Возвращаем набор методов наружу
  return {
    // Базовые методы
    registerSingleEvent: registerSingleEvent,
    registerOppositeEvent: registerOppositeEvent,
    registerBothEvents: registerBothEvents,

    // Для массивов топиков
    registerMultipleEvents: registerMultipleEvents,

    // Для topicWithBehavior
    registerSingleEventWithBehavior: registerSingleEventWithBehavior,
    registerMultipleEventsWithBehavior: registerMultipleEventsWithBehavior,
    registerMultipleEventsWithBehaviorOpposite: registerMultipleEventsWithBehaviorOpposite,

    // Обработка приходящих значений
    processEvent: processEvent,

    // Отладка
    getRegistryDebugView: getRegistryDebugView
  };
}

exports.createRegistryForEvents = createRegistryForEvents;
