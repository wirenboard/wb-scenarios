/**
 * @file Модуль обработки реестра регистрируемых событий
 * 
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

var eResolvers = require("registry-event-resolvers.mod");

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
  * @param {function} callback - Обратный вызов для события
  */
  function registerSingleEvent(topic, eventType, callback) {
    if (typeof callback !== "function") {
      log.error("Callback must be a function.");
      return;
    }

    if (!registry[topic]) {
      registry[topic] = {};
    }

    registry[topic][eventType] = { callback: callback };
    log.debug(
      "Event registered: topic='" + topic + "', type='" + eventType + "'"
    );
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
        "Topics must be an array strings, curent is: '" + typeof topic + "'"
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
        "Invalid topic data. mqttTopicName and behaviorType are required."
      );
      return;
    }
  
    // Проверка существования такого типа события в регистре событий
    var eventResolver = eResolvers.registryEventResolvers[behaviorType];
    if (!eventResolver) {
      log.error(
        "Unknown behaviorType '" + behaviorType + "'. Event not registered now"
      );
      return;
    }

    registerSingleEvent(mqttTopicName, behaviorType, callback);
  }
   

    // @todo  
  /**
   * Регистрирует события для массива объектов с настройками MQTT-топиков,
   * основываясь на behaviorType
   *
   * @param {Array} topicsWithBehavior  - Массив топиков с настройками поведения
   * @param {function} callback - Обратный вызов для событий
   */
  function registerMultipleEventsWithBehavior(topicsWithBehavior, callback) {
    if (!Array.isArray(topicsWithBehavior)) {
      log.error("TopicsWithBehavior must be an array.");
      return;
    }

    for (var i = 0; i < topicsWithBehavior.length; i++) {
      registerSingleEventWithBehavior(topicsWithBehavior[i], callback);
    }  
  }
  
  /**
  * Обрабатывает все события для указанного топика, которые произошли
  *
  * @param {string} topic - Имя MQTT топика
  * @param {any} value - Новое значение топика
  */
  function processEvent(topic, value) {
    var topicEvents = registry[topic];
    var topicExists = !!topicEvents;
    if (!topicExists) {
      log.debug("No events registered for topic '" + topic + "'");
      return;
    }

    for (var curEventType in topicEvents) {
      var resolver = eResolvers.registryEventResolvers[curEventType];
      var isResolverValid = resolver && typeof resolver.launchResolver ===
        "function";

      if (!isResolverValid) {
        log.error("Resolver not found for event type '" + curEventType + "'");
        continue;
      }

      var isTriggered = resolver.launchResolver(value);
      if (!isTriggered) {
        log.debug(
          "Resolver rejected event '" + curEventType + "' for topic '" + topic
          + "'"
        );
        continue;
      }

      var event = topicEvents[curEventType];
      var isCallbackValid = event && typeof event.callback === "function";

      if (isCallbackValid) {
        log.debug(
          "Executing callback for topic '" +
          topic +
          "', event type '" +
          curEventType +
          "'"
        );
        event.callback(value);
      } else {
        log.error(
          "Callback not found for topic '" + topic + "', event type '" +
          curEventType + "'"
        );
      }
    }
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

  return {
    registerSingleEvent: registerSingleEvent,
    registerMultipleEvents: registerMultipleEvents,
    registerSingleEventWithBehavior: registerSingleEventWithBehavior,
    registerMultipleEventsWithBehavior: registerMultipleEventsWithBehavior,
    processEvent: processEvent,
    getRegistryDebugView: getRegistryDebugView
  };
}

exports.createRegistryForEvents = createRegistryForEvents;
