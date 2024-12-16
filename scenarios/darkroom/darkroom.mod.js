/**
 * @file Модуль для инициализации алгоритма темной комнаты (darkroom)
 *
 * Основная идея:
 * - Датчики движения и открытия включают свет при срабатывании.
 * - Для каждого типа датчиков своя задержка выключения света:
 *    - delayByMotionSensors для датчиков движения
 *    - delayByOpeningSensors для датчиков открытия
 * - При срабатывании датчика обновляем таймер, по истечении которого свет гаснет, если нет новой активности.
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

var vdHelpers = require("virtual-device-helpers.mod");

/**
 * Инициализирует виртуальное устройство и определяет правило для работы
 * "темной комнаты"
 * @param {string} idPrefix - Префикс сценария, используемый для идентификации
 *                            виртуального устройства и правила
 * @param {string} deviceTitle - Имя виртуального девайса указанное
 *                               пользователем
 * @param {number} delayByMotionSensors - Задержка выключения света после
 *                                        срабатывания любого из датчиков
 *                                        движения (сек)
 * @param {number} delayByOpeningSensors - Задержка выключения света после
 *                                         срабатывания любого из датчиков
 *                                         открытия (сек)
 * @param {Array} motionSensors - Массив отслеживаемых контролов датчиков движения
 * @param {Array} openingSensors - Массив отслеживаемых контролов датчиков открытия
 * @param {Array} lightDevices - Массив управляемых устройств освещения
 * @returns {boolean} - Возвращает true, при успешной инициализации
 *                      иначе false
 */
function init(idPrefix,
              deviceTitle,
              delayByMotionSensors,
              delayByOpeningSensors,
              motionSensors,
              openingSensors,
              lightDevices) {

  var isAllArrays = (!Array.isArray(motionSensors) || !Array.isArray(openingSensors) || !Array.isArray(lightDevices));
  if (isAllArrays) {
    log.error("Darkroom initialization error: motionSensors, openingSensors, and lightDevices must be arrays.");
    return false;
  }

  var isLightDevicesEmpty = (lightDevices.length === 0);
  if (isLightDevicesEmpty) {
    log.error("Darkroom initialization error: no light devices specified.");
    return false;
  }

  var isAllSensorsEmpty = (motionSensors.length === 0 && openingSensors.length === 0);
  if (isAllSensorsEmpty) {
    log.error("Darkroom initialization error: no motion or opening sensors specified.");
    return false;
  }
  // @todo: Добавить проверку типов контролов - чтобы не запускать инит с типом датчика строка где обрабатывается только цифра

  log.debug("Darkroom initialization start with the following parameters:");
  log.debug("  - delayByMotionSensors: '" + JSON.stringify(delayByMotionSensors) + "'");
  log.debug("  - delayByOpeningSensors: '" + JSON.stringify(delayByOpeningSensors) + "'");
  log.debug("  - motionSensors: '" + JSON.stringify(motionSensors) + "'");
  log.debug("  - openingSensors: '" + JSON.stringify(openingSensors) + "'");
  log.debug("  - lightDevices: '" + JSON.stringify(lightDevices) + "'");

  var genVirtualDeviceName = "wbsc_" + idPrefix;
  var genRuleNameMotion = "wbru_" + "motion_" + idPrefix;
  var genRuleNameOpening = "wbru_" + "opening_" + idPrefix;

  var vDevObj = defineVirtualDevice(genVirtualDeviceName, {
                                  title: deviceTitle,
                                  cells: {
                                    active: {
                                      title: {en: 'Activate scenario rule', ru: 'Активировать правило сценария'},
                                      type: "switch",
                                      value: true
                                    },
                                  }
                                });
  if (!vDevObj) {
    log.debug("Error: Virtual device '" + deviceTitle + "' not created.");
    return false;
  }
  log.debug("Virtual device '" + deviceTitle + "' created successfully");

  // Добавляем обработчики для датчиков, связанных с виртуальным устройством
  for (var i = 0; i < motionSensors.length; i++) {
    var curMqttControl = motionSensors[i].mqttTopicName;
    var cellName = "motion_sensor_" + i;
    if (!vdHelpers.addLinkedControlRO(curMqttControl, vDevObj, genVirtualDeviceName, cellName, "value", "Motion:")) {
      log.error("Failed to add motion sensor control for " + curMqttControl);
    }
  }

  for (var i = 0; i < openingSensors.length; i++) {
    var curMqttControl = openingSensors[i].mqttTopicName;
    var cellName = "opening_sensor_" + i;
    if (!vdHelpers.addLinkedControlRO(curMqttControl, vDevObj, genVirtualDeviceName, cellName, "switch", "Opening:")) {
      log.error("Failed to add opening sensor control for " + curMqttControl);
    }
  }

  for (var i = 0; i < lightDevices.length; i++) {
    var curMqttControl = lightDevices[i].mqttTopicName;
    var cellName = "light_sensor_" + i;
    if (!vdHelpers.addLinkedControlRO(curMqttControl, vDevObj, genVirtualDeviceName, cellName, "switch", "Light:")) {
      log.error("Failed to add light device control for " + curMqttControl);
    }
  }

  // Переменная для хранения ID таймера выключения света
  var lightOffTimerId = null;
  // Время в будущем, когда таймер должен сработать
  var timerEndTime = null;

  // Текущая задержка, меняется в зависимости от последнего сработавшего типа датчика
  var currentDelayMs = delayByMotionSensors * 1000;

  // Включение/выключение всех световых устройств
  function setStateAllLightDevices(state) {
    for (var i = 0; i < lightDevices.length; i++) {
      var ld = lightDevices[i];
      if (ld && ld.mqttTopicName && typeof ld.mqttTopicName === 'string') {
        log.debug("Setting light device '" + ld.mqttTopicName + "' state to: " + (state ? "ON" : "OFF"));
        dev[ld.mqttTopicName] = state ? true : false;
      }
    }
  }

  // Функция обновления таймера:
  // @todo: Не устанавливать новую задержку, если текущее оставшееся время больше
  function setLightOffTimer(newDelayMs) {
    currentDelayMs = newDelayMs;
    if (lightOffTimerId) {
      clearTimeout(lightOffTimerId);
    }
    log.debug("Set new delay: " + (currentDelayMs / 1000) + " sec and set new timer");
    lightOffTimerId = setTimeout(function () {
      log.debug("No activity in the last " + (currentDelayMs / 1000) + " sec, turn lights off");
      setStateAllLightDevices(false);
      lightOffTimerId = null;
    }, currentDelayMs);
  }

  // Обработчик, вызываемый при срабатывании датчиков движения и открытия
  function sensorTriggeredHandler(newValue, devName, cellName, sensorType) {
    // log.debug("Handler started for WB-rule: '" + genRuleNameMotion + "'");
    // log.debug("  - devName: '" + devName + "'");
    // log.debug("  - cellName: '" + cellName + "'");
    // log.debug("  - newValue: '" + newValue + "'");
    // log.debug("  - sensorType: '" + sensorType + "'");
  
    var isActive = dev[genVirtualDeviceName + "/active"];
    if (!isActive) {
      // log.debug("Darkroom is disabled in virtual device - doing nothing");
      return true;
    }

    if (sensorType === 'motion') {
      // Найдем сенсор в списке по cellName
      var matchedSensor = null;
      for (var i = 0; i < motionSensors.length; i++) {
        if (motionSensors[i].mqttTopicName === (devName + '/' + cellName)) {
          matchedSensor = motionSensors[i];
          break;
        }
      }
      if (!matchedSensor) return false;

      /**
       * Нужно убедиться что сейчас произошло событие - триггер:
       *   - value - больше трешхолда
       *   - bool - что новое значение true
       *   - string - что новая строка 'true'
       */
      var sensorTriggered = false;
      if (matchedSensor.sensorDataType === "valueNumericMotSensor" && typeof newValue === "number" && newValue >= matchedSensor.thresholdMotionLevel) {
        sensorTriggered = true;
      } else if (matchedSensor.sensorDataType === "boolMotSensor" && newValue === true) {
        sensorTriggered = true;
      } else if (matchedSensor.sensorDataType === "stringMotSensor" && newValue === "true") {
        sensorTriggered = true;
      }

      if (sensorTriggered) {
        log.debug("Motion detected on sensor " + matchedSensor.mqttTopicName);
        setStateAllLightDevices(true);
        setLightOffTimer(delayByMotionSensors * 1000);
      }
    }

    if (sensorType === 'opening') {
      // Для датчика открытия считаем, что любое изменение на "открыто" запускает таймер
      if (newValue === true) {
        log.debug("Opening detected on sensor " + devName + "/" + cellName);
        setStateAllLightDevices(true);
        setLightOffTimer(delayByOpeningSensors * 1000);
      }
    }

    return true;
  }

  // Предварительно извлекаем имена контролов
  var motionSensorsControlNames = [];
  for (var i = 0; i < motionSensors.length; i++) {
    motionSensorsControlNames.push(motionSensors[i].mqttTopicName);
  }
  var openingSensorsControlNames = [];
  for (var i = 0; i < openingSensors.length; i++) {
    openingSensorsControlNames.push(openingSensors[i].mqttTopicName);
  }

  // Создаем правило для датчиков движения
  var ruleIdMotion = defineRule(genRuleNameMotion, {
                             whenChanged: motionSensorsControlNames,
                             then: function (newValue, devName, cellName) {
                               sensorTriggeredHandler(newValue, devName, cellName, 'motion');
                             }                        
                             });
  if (!ruleIdMotion) {
    log.error("Error: WB-rule '" + genRuleNameMotion + "' not created.");
    return false;
  }
  log.debug("WB-rule with IdNum '" + ruleIdMotion + "' was successfully created");

  // Создаем правило для датчиков открытия
  var ruleIdOpening = defineRule(genRuleNameOpening, {
                             whenChanged: openingSensorsControlNames,
                             then: function (newValue, devName, cellName) {
                               sensorTriggeredHandler(newValue, devName, cellName, 'opening');
                             }
                             });
  if (!ruleIdOpening) {
    log.error("Error: WB-rule '" + genRuleNameOpening + "' not created.");
    return false;
  }
  log.debug("WB-rule with IdNum '" + ruleIdOpening + "' was successfully created");

  log.debug("Darkroom initialization completed successfully");
  return true;
}

exports.init = function (idPrefix,
                         deviceTitle,
                         delayByMotionSensors,
                         delayByOpeningSensors,
                         motionSensors,
                         openingSensors,
                         lightDevices) {
  var res = init(idPrefix,
             deviceTitle,
             delayByMotionSensors,
             delayByOpeningSensors,
             motionSensors,
             openingSensors,
             lightDevices);
  return res;
};
