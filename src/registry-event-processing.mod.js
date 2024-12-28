/**
 * @file Модуль обработки реестра регистрируемых событий
 * 
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

var eResolvers = require('registry-event-resolvers.mod');

/**
* Создание нового реестра событий
*
* @returns {Object} - Объект с методами для работы с реестром событий
*/
function createRegistryForEvents() {
  // Локальная структура объекта для хранения событий
  var registry = {};

  /**
  * Регистрирует событие для одного MQTT топика
  *
  * @param {string} topic - Имя MQTT топика
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
      log.error('Unknown eventType "' + eventType + '". Cannot register opposite');
      return;
    }

    if (!registry[topic]) {
      registry[topic] = {};
    }
  
    if (registry[topic][eventType]) {
      log.error(
        'Event "' + eventType + '" for topic "' + topic + '" is already registered. Will overwrite the callback'
      );
    }    

    // Сохраняем колбэк в объекте события
    registry[topic][eventType] = { callback: mainCallback };

    log.debug(
      'Event registered: topic="' + topic + '", type="' + eventType + '"'
    );
  }

  /**
   * Регистрирует противоположное событие для одного MQTT топика
   * 
   * @param {string} topic - Имя MQTT-топика
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
      log.error('Unknown eventType "' + eventType + '". Cannot register opposite');
      return;
    }

    // Берём имя «противоположного» события
    var oppEventName = eventInfo.resetResolverName;
    if (!oppEventName) {
      log.error("Event '" + eventType + "' does not have a resetResolverName. No opposite event can be registered.");
      return;
    }

    // Проверяем, действительно ли oppEventName существует в реестре
    if (!eResolvers.registryEventResolvers[oppEventName]) {
      log.error(
        "Opposite event name '" + oppEventName +
        "' not found in registryEventResolvers. Cannot register opposite."
      );
      return;
    }

    // Регистрируем «противоположное» событие
    registerSingleEvent(topic, oppEventName, oppositeCallback);
    log.debug("Opposite event registered: '" + oppEventName + "' for base '" + eventType + "'");
  }

  /**
   * Регистрирует основное и сразу противоположное событие для заданного топика.
   *
   * @param {string} topic - Имя MQTT-топика
   * @param {string} eventType - Тип основного события (например, "whenEnabled")
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
        "Topics must be an array of strings, current is: '" + typeof topics + "'"
      );
      return;
    }

    for (var i = 0; i < topics.length; i++) {
      var topic = topics[i];
      if (typeof topic !== "string") {
        log.error(
          "Invalid topic at index " + i + ": must be a string. Skipping."
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
        "Invalid topic data. mqttTopicName and behaviorType are required"
      );
      return;
    }
  
    // Проверка существования такого типа behaviorType в реестре событий
    var eventResolver = eResolvers.registryEventResolvers[behaviorType];
    if (!eventResolver) {
      log.error(
        "Unknown behaviorType '" + behaviorType + "'. Event not registered now"
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
        "Invalid topic data. mqttTopicName and behaviorType are required"
      );
      return;
    }

    // Проверка существования такого типа behaviorType в реестре событий
    var eventResolver = eResolvers.registryEventResolvers[behaviorType];
    if (!eventResolver) {
      log.error(
        "Unknown behaviorType '" + behaviorType + "'. Event not registered now"
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
      log.error("TopicsWithBehavior must be an array.");
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
      log.error("topicsWithBehavior must be an array.");
      return;
    }

    for (var i = 0; i < topicsWithBehavior.length; i++) {
      registerSingleEventWithBehaviorOpposite(topicsWithBehavior[i], mainCallback, oppCallback);
    }
  }

  /**
   * Обрабатывает все события для указанного топика, которые произошли
   *
   * @param {string} topic - Имя MQTT топика
   * @param {any} value - Новое значение топика
   * @returns {Object} - Статус обработки:
   *                     { 
   *                       status: "success" | "no_events_registered" | "topic_not_found",
   *                       message: string
   *                     }
   */
function processEvent(topic, value) {
  var res;
  var topicEvents = registry[topic];

  // Проверяем, существует ли указанный топик приведя к булевому типу
  var topicExists = !!topicEvents;
  if (!topicExists) {
    res = { status: "topic_not_found",
            message: "Topic '" + topic + "' not found in the registry" };
    return res;
  }

  var hasProcessed = false;

  for (var curEventType in topicEvents) {
    var resolver = eResolvers.registryEventResolvers[curEventType];
    var isResolverValid = resolver &&
                          typeof resolver.launchResolver === "function";

    if (!isResolverValid) {
      log.error("Resolver not found for event type '" + curEventType + "'");
      continue;
    }

    var isTriggered = resolver.launchResolver(value);
    if (!isTriggered) {
      // log.debug(
      //   "Resolver rejected event '" + curEventType +
      //   "' for topic '" + topic + "'"
      // );
      continue;
    }

    var eventObj = topicEvents[curEventType];
    var isCallbackValid = eventObj && typeof eventObj.callback === "function";

    if (isCallbackValid) {
      // log.debug(
      //   "Executing callback for topic '" + topic +
      //   "', event type '" + curEventType + "'"
      // );
      eventObj.callback(value);
      hasProcessed = true;
    } else {
      log.error(
        "Callback not found for topic '" + topic +
        "', event type '" + curEventType + "'"
      );
    }
  }

  if (hasProcessed) {
    res = { status: "success",
            message: "Events processed successfully" };
    return res;
  }

  res = { status: "no_events_registered",
          message: "No events were processed for the topic" };
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
          callbackName: registry[topic][curEventType].callback.name + "()" ||
            "anonymous()"
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
