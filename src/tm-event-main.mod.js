/**
 * @file tm-event-main.mod.js
 * @description Плагин TM для обработки разных именованных событий топиков
 */

var eventResolvers = require('tm-event-resolvers.mod').registryEventResolvers;

/**
 * Устанавливает плагин событий
 * 
 * @param {Object} manager Экземпляр TopicManager
 * @param {Object} [options] Опциональные параметры
 */
function install(manager, options) {

  /**
   * Регистрирует событие для одного MQTT топика
   * 
   * @param {string} topic Имя MQTT-топика (вид "device/control")
   * @param {string} eventType Тип события
   * @param {function} mainCallback Обратный вызов вызываемый при событии
   */
  function registerSingleEvent(topic, eventType, mainCallback) {
    if (typeof mainCallback !== 'function') {
      log.error('Callback должен быть функцией');
      return;
    }

    // Смотрим что в реестре событий есть описание указанного EventType
    var resolver = eventResolvers[eventType];
    if (!resolver) {
      log.error(
        'Неизвестный eventType "' + eventType + '".' +
        'Невозможно зарегистрировать данное событие'
      );
      return;
    }

    if (!manager.registry[topic]) {
      manager.registry[topic] = {};
    }
    if (!manager.registry[topic].events) {
      manager.registry[topic].events = {};
    }
    
    var topicEvents = manager.registry[topic].events;
    
    if (topicEvents[eventType]) {
      log.warn(
        'Событие "' + eventType + '" для топика "' + topic + '"' +
        'уже зарегистрировано. Callback будет перезаписан'
      );
    }

    // Сохраняем колбэк в объекте события
    topicEvents[eventType] = { callback: mainCallback };

    log.debug(
      'Событие зарегистрировано: topic="' + topic + '",' +
      'type="' + eventType + '"'
    );
  }

  /**
   * Регистрирует противоположное событие для одного MQTT топика
   * 
   * @param {string} topic Имя MQTT-топика вида "device/control"
   * @param {string} eventType Тип основного события (например, 'whenEnabled')
   * @param {Function} oppositeCallback Колбэк для противоположного события
   */
  function registerOppositeEvent(topic, eventType, oppositeCallback) {
    if (typeof oppositeCallback !== 'function') {
      log.error('Callback должен быть функцией');
      return;
    }

    // Смотрим что в реестре событий есть описание указанного EventType
    var resolver = eventResolvers[eventType];
    if (!resolver) {
      log.error(
        'Неизвестный eventType "' + eventType + '".' +
        'Невозможно зарегистрировать противоположное событие'
      );
      return;
    }

    // Берём имя "противоположного" события
    var oppEventName = resolver.resetResolverName;
    if (!oppEventName) {
      log.error(
        'Событие "' + eventType + '" не имеет resetResolverName.' +
        'Невозможно зарегистрировать противоположное событие'
      );
      return;
    }

    // Проверяем, действительно ли oppEventName существует в реестре
    if (!eventResolvers[oppEventName]) {
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
   * Регистрирует сразу основное и противоположное событие для топика
   *
   * @param {string} topic Имя MQTT-топика вида "device/control"
   * @param {string} eventType Тип основного события (например, 'whenEnabled')
   * @param {function} mainCallback Колбэк для события
   * @param {Function} oppositeCallback Колбэк для противоположного события
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
   * @param {Array<string>} topics Массив имен MQTT топиков
   * @param {string} eventType Тип события
   * @param {function} callback Обратный вызов для событий
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
   * @param {Array} topicWithBehavior Один топик с настройками поведения
   * @param {function} callback Обратный вызов для событий
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
    var eventResolver = eventResolvers[behaviorType];
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
   * @param {Object} topicWithBehavior Объект вида { mqttTopicName: string, behaviorType: string }
   * @param {Function} mainCallback Колбэк для основного события
   * @param {Function} oppCallback Колбэк для противоположного события
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
    var eventResolver = eventResolvers[behaviorType];
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
   * @param {Array} topicsWithBehavior Массив топиков с настройками поведения
   * @param {function} mainCallback Колбэк для основного события
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
   * @param {Array} topicsWithBehavior Массив топиков с настройками поведения
   * @param {Function} mainCallback Колбэк для основного события
   * @param {Function} oppCallback Колбэк для противоположного события
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
   * Поиск и обработка всех зарегистрированных и произошедших событий
   * для указанного топика
   *
   * @param {string} topic Имя MQTT-топика (вида "device/control")
   * @param {any} newValue Новое значение топика
   * @returns {Object} Статус результата обработки:
   *     Содержит общий статус обработки (status) и если есть сработавшие
   *     события, то содержит подробности по их результатам (details).
   *     Пример структуры:
   *         {
   *           "status": "processed_with_issue",
   *           "message": "События обработаны, но минимум один callback с ошибкой",
   *           "details": [
   *             {
   *               "eventType": "whenEnabled",
   *               "status": "failure"
   *             },
   *             {
   *               "eventType": "whenChange",
   *               "status": "success"
   *             }
   *           ]
   *         }
   */
  function processEvent(topic, newValue) {
    var res;
    var results = [];

    // Проверяем, существует ли указанный топик приведя к булевому типу
    var topicObj = manager.registry[topic];
    var topicExists = !!topicObj;
    if (!topicExists) {
      res = {
        status: 'topic_not_found',
        message: 'Топик "' + topic + '" не найден в реестре',
        details: results
      };
      return res;
    }

    var topicEvents = manager.registry[topic].events;
    var hasProcessed = false;
    var cbRes;
    // Обрабатываем каждое зарегистрированное событие для топика
    for (var curEventType in topicEvents) {
      var resolver = eventResolvers[curEventType];
      var isResolverValid = resolver &&
        typeof resolver.launchResolver === 'function';

      if (!isResolverValid) {
        log.error(
          'Не корректная структура события "' + curEventType + '":' +
          'не найден корректный Resolver'
        );
        continue;
      }

      // Проверяем, сработал ли текущий резолвер события
      var isTriggered = resolver.launchResolver(newValue);
      if (!isTriggered) {
        // log.debug(
        //   'Resolver "' + curEventType + 'не подтвердил событие'
        //   '" для топика "' + topic + '"'
        // );
        continue;
      }

      var eventObj = topicEvents[curEventType];
      var isCallbackValid = eventObj &&
                            typeof eventObj.callback === 'function';

      var retStatus;
      // Вызываем колбэк
      if (isCallbackValid) {
        // log.debug(
        //   'Выполнение callback для топика "' + topic +
        //   '", тип события "' + curEventType + '"'
        // );
        cbRes = eventObj.callback(newValue);

        if (cbRes === undefined) {
          retStatus = 'processed_without_res';
          log.warning(
            'Callback для "' + topic + '" и типа события "' + curEventType +
            '" выполнен успешно, но ничего не вернул. Ожидается возврат bool.'
          );
        } else if (cbRes === true) {
          retStatus = 'success';
        } else {
          retStatus = 'failure';
        }
        hasProcessed = true;
      } else {
        retStatus = 'callback_missing';
        log.error(
          'Для события "' + curEventType + '" не найден  Callback."' +
          ' (topic: "' + topic + '")'
        );
      }

      results.push({
        eventType: curEventType,
        status: retStatus
      });
    } /* for */

    // Общий статус обработки
    var genStatus;
    var genMessage;
    var hasFailure = results.some(function(r) { return r.status !== 'success'; });
    if (hasProcessed === true && hasFailure !== true) {
      genStatus = 'processed_success';
      genMessage = 'Все события обработаны успешно';
    } else if (hasProcessed === true && hasFailure === true) {
      genStatus = 'processed_with_issue';
      genMessage = 'События обработаны, но минимум один callback с ошибкой';
    } else {
      genStatus = 'no_events_registered';
      genMessage = 'Нет обрабатываемых событий для данного топика';
    }

    res = {
      status: genStatus,
      message: genMessage,
      details: results
    };
    return res;
  }


  /**
   * Добавляем методы в экземпляр
   */

  // Базовые методы
  manager.registerSingleEvent = registerSingleEvent;
  manager.registerOppositeEvent = registerOppositeEvent;
  manager.registerBothEvents = registerBothEvents;

  // Для массивов топиков
  manager.registerMultipleEvents = registerMultipleEvents;

  // Для topicWithBehavior
  manager.registerSingleEventWithBehavior = registerSingleEventWithBehavior;
  manager.registerMultipleEventsWithBehavior = registerMultipleEventsWithBehavior;
  manager.registerMultipleEventsWithBehaviorOpposite = registerMultipleEventsWithBehaviorOpposite;

  // Обработка приходящих значений
  manager.processEvent = processEvent;

  var priority = 5;
  manager.addProcessor(processEvent, priority);

  log.debug('Event plugin successfully installed');
}

exports.eventPlugin = {
  name: 'eventPlugin',
  install: install
};
