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
var aTable = require("registry-action-resolvers.mod");
var eventModule = require("registry-event-processing.mod");

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
              delayBlockAfterSwitch,
              lightDevices,
              motionSensors,
              openingSensors,
              lightSwitches) {

  if (delayByMotionSensors <= 0) {
    log.error("Invalid delayByMotionSensors: must be a positive number.");
    return false;
  }

  var isAllArrays =  (Array.isArray(lightDevices) &&
                      Array.isArray(motionSensors) &&
                      Array.isArray(openingSensors) &&
                      Array.isArray(lightSwitches));
  if (!isAllArrays) {
    log.error("Darkroom initialization error: lightDevices, motionSensors, openingSensors, and lightSwitches must be arrays.");
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

  var isLightSwitchesEmpty = (lightSwitches.length === 0);
  if (isLightSwitchesEmpty) {
    log.debug("Darkroom initialization error: no wall switches specified.");
    return false;
  }


  // @todo: Добавить проверку типов контролов - чтобы не запускать инит с типом датчика строка где обрабатывается только цифра

  log.debug("Darkroom initialization start with the following parameters:");
  log.debug("  - delayByMotionSensors: '" + JSON.stringify(delayByMotionSensors) + "'");
  log.debug("  - delayByOpeningSensors: '" + JSON.stringify(delayByOpeningSensors) + "'");
  log.debug("  - delayBlockAfterSwitch: '" + JSON.stringify(delayBlockAfterSwitch) + "'");
  log.debug("  - lightDevices: '" + JSON.stringify(lightDevices) + "'");
  log.debug("  - motionSensors: '" + JSON.stringify(motionSensors) + "'");
  log.debug("  - openingSensors: '" + JSON.stringify(openingSensors) + "'");
  log.debug("  - lightSwitches: '" + JSON.stringify(lightSwitches) + "'");

  var delimeter = "_";
  var scenarioPrefix = "wbsc";
  var rulePrefix = "wbru";
  var genVirtualDeviceName = scenarioPrefix + delimeter + idPrefix + delimeter;
  var genRuleNameMotionInProgress = rulePrefix + delimeter + "motionInProgress" + delimeter + idPrefix + delimeter;
  var genRuleNameLogicDisabledByWallSwitch = rulePrefix + delimeter + "logicDisabledByWallSwitch" + delimeter + idPrefix + delimeter;
  var genRuleNameMotion = rulePrefix + delimeter + "motion" + delimeter + idPrefix + delimeter;
  var genRuleNameOpening = rulePrefix + delimeter + "opening" + delimeter + idPrefix + delimeter;
  var genRuleNameSwitches = rulePrefix + delimeter + "switches" + delimeter + idPrefix + delimeter;

  var vDevObj = defineVirtualDevice(genVirtualDeviceName, {
                                  title: deviceTitle,
                                  cells: {
                                    active: {
                                      title: {en: 'Activate rule', ru: 'Активировать правило'},
                                      type: "switch",
                                      value: true
                                    },
                                    analazeTitle: {
                                      title: {en: '>  Progress info:', ru: '>  Информация о выполнении:'},
                                      type: "text",
                                      value: "",
                                      readonly: true,
                                    },
                                    motionInProgress: {
                                      title: {en: 'Motion in progress', ru: 'Движение в процессе'},
                                      type: "switch",
                                      value: false,
                                      readonly: true,
                                    },
                                    logicDisabledByWallSwitch: {
                                      title: {en: 'Disabled by switch', ru: 'Отключена выключателем'},
                                      type: "switch",
                                      value: false,
                                      readonly: true,
                                    },
                                    // Текущая задержка, меняется в зависимости от последнего сработавшего типа датчика
                                    curDisableLightTimerInSec: {
                                      title: {en: 'Disable timer (seconds)', ru: 'Таймер отключения (секунды)'},
                                      type: "value",
                                      value: 0,
                                      readonly: true,
                                    },
                                    // Текущая задержка отключенной логики
                                    curDisabledLogicTimerInSec: {
                                      title: {en: 'Disabled logic timer (seconds)', ru: 'Таймер отключенной логики (секунды)'},
                                      type: "value",
                                      value: 0,
                                      readonly: true,
                                    },
                                  }
                                });
  if (!vDevObj) {
    log.debug("Error: Virtual device '" + deviceTitle + "' not created.");
    return false;
  }
  log.debug("Virtual device '" + deviceTitle + "' created successfully");

  // Добавляем обработчики для датчиков, связанных с виртуальным устройством
  // @note: Если топик не существует в момент создания связи - то он не добавится
  //        в виртуальное устройство - это актуально при создании сценариев с
  //        использованием других сценариев и других виртуальных устройств
  //        если реальные устройства создаются и существуют постоянно - то
  //        wb-rules не гарантирует порядок инициализации виртуальных устройств
  // @fixme: попробовать это как то поправить
  vdHelpers.addGroupTitleRO(vDevObj,
    genVirtualDeviceName,
    "lightDevicesTitle",
    "Устройства освещения",
    "Light devices");
  for (var i = 0; i < lightDevices.length; i++) {
    var curMqttControl = lightDevices[i].mqttTopicName;
    var cellName = "light_sensor_" + i;
    if (!vdHelpers.addLinkedControlRO(curMqttControl, vDevObj, genVirtualDeviceName, cellName, "switch", "")) {
      log.error("Failed to add light device control for " + curMqttControl);
    }
  }

  vdHelpers.addGroupTitleRO(vDevObj,
                            genVirtualDeviceName,
                            "motionSensorsTitle",
                            "Датчики движения",
                            "Motion sensors");
  for (var i = 0; i < motionSensors.length; i++) {
    var curMqttControl = motionSensors[i].mqttTopicName;
    var cellName = "motion_sensor_" + i;
    if (!vdHelpers.addLinkedControlRO(curMqttControl, vDevObj, genVirtualDeviceName, cellName, "value", "")) {
      log.error("Failed to add motion sensor control for " + curMqttControl);
    }
  }

  vdHelpers.addGroupTitleRO(vDevObj,
    genVirtualDeviceName,
    "openingSensorsTitle",
    "Датчики открытия",
    "Opening sensors");
  for (var i = 0; i < openingSensors.length; i++) {
    var curMqttControl = openingSensors[i].mqttTopicName;
    var cellName = "opening_sensor_" + i;
    if (!vdHelpers.addLinkedControlRO(curMqttControl, vDevObj, genVirtualDeviceName, cellName, "switch", "")) {
      log.error("Failed to add opening sensor control for " + curMqttControl);
    }
  }

  vdHelpers.addGroupTitleRO(vDevObj,
    genVirtualDeviceName,
    "lightSwitchesTitle",
    "Выключатели света",
    "Light switches");
  for (var i = 0; i < lightSwitches.length; i++) {
    var curMqttControl = lightSwitches[i].mqttTopicName;
    var cellName = "light_switch_" + i;
    if (!vdHelpers.addLinkedControlRO(curMqttControl, vDevObj, genVirtualDeviceName, cellName, "switch", "")) {
      log.error("Failed to add light switch control for " + curMqttControl);
    }
  }

  var eventRegistry = eventModule.createRegistryForEvents();
  // Переменная для хранения ID таймера выключения света
  var lightOffTimerId = null;
  // Переменная для хранения ID таймера выключения логики сценария
  var logicEnableTimerId = null;
  // Время в будущем, когда таймер должен сработать
  // @todo:vg Доделать
  var timerEndTime = null;

  /**Включение/выключение всех устройств в массиве согласно указанному типу поведения
   * @param {Array} actionControlsArr - Массив контролов с указанием типа поведения и значений
   * @param {boolean} state - Состояние для применения (true - разрешить, false - сбросить)
   */
  function setValueAllDevicesByBehavior(actionControlsArr, state) {
    for (var i = 0; i < actionControlsArr.length; i++) {
      //@todo:vg добавить проверку топиков выше
      //проверить сработает ли typeof ld.mqttTopicName === 'string' и что будет в мета

      // Выполняем действия на выходных контролах
      // Не усложняем проверками так как проверили все заранее в инициализации
      var curMqttTopicName = actionControlsArr[i].mqttTopicName;
      var curUserAction = actionControlsArr[i].behaviorType;
      var curActionValue = actionControlsArr[i].actionValue;
      var actualValue = dev[curMqttTopicName];
      var newCtrlValue;
      if (state === true) {
        newCtrlValue = aTable.actionsTable[curUserAction].launchResolver(actualValue, curActionValue);
      } else {
        newCtrlValue = aTable.actionsTable[curUserAction].resetResolver(actualValue, curActionValue);
      }
      
      log.debug("Control " + curMqttTopicName + " will updated to state: " + newCtrlValue);
      // log.debug("Setting light device '" + ld.mqttTopicName + "' state to: " + (state ? "ON" : "OFF"));
      dev[curMqttTopicName] = newCtrlValue;
      // dev[ld.mqttTopicName] = state ? true : false;
      log.debug("Control " + curMqttTopicName + " successfull updated");
    }
  }

  function resetLightOffTimer() {
    lightOffTimerId = null;
    dev[genVirtualDeviceName + "/curDisableLightTimerInSec"] = 0;
  }

  function resetLogicEnableTimer() {
    logicEnableTimerId = null;
    dev[genVirtualDeviceName + "/curDisabledLogicTimerInSec"] = 0;
  }

  // Функция обновления таймера:
  // @todo: Не устанавливать новую задержку, если текущее оставшееся время больше
  function setLightOffTimer(newDelayMs) {
    dev[genVirtualDeviceName + "/curDisableLightTimerInSec"] = newDelayMs / 1000;
    if (lightOffTimerId) {
      clearTimeout(lightOffTimerId);
    }
    log.debug("Set new delay: " + (newDelayMs / 1000) + " sec and set new timer");
    lightOffTimerId = setTimeout(function () {
      log.debug("No activity in the last " + (newDelayMs / 1000) + " sec, turn lights off");
      setValueAllDevicesByBehavior(lightDevices, false);
      resetLightOffTimer();
    }, newDelayMs);
  }

  function setLogicEnableTimer(newDelayMs) {
    dev[genVirtualDeviceName + "/curDisabledLogicTimerInSec"] = newDelayMs / 1000;
    if (logicEnableTimerId) {
      clearTimeout(logicEnableTimerId);
    }
    log.debug("Set new delay: " + (newDelayMs / 1000) + " sec and set new timer");
    logicEnableTimerId = setTimeout(function () {
      log.debug("No activity in the last " + (newDelayMs / 1000) + " sec, turn logic on");
      dev[genVirtualDeviceName + "/logicDisabledByWallSwitch"] = false;
      resetLogicEnableTimer();
    }, newDelayMs);
  }

  /**
   * Проверка состояния всех датчиков
   */
  function checkAllMotionSensorsInactive() {
    // Проверяем, все ли датчики движения находятся в пассивном состоянии
    for (var i = 0; i < motionSensors.length; i++) {
      var sensorState = dev[motionSensors[i].mqttTopicName];
      if (sensorState === true || sensorState === "true") {
        return false; // Если хотя бы один датчик активен, возвращаем false
      }
    }
    return true; // Все датчики пассивны
  }
  

  // Функция которая следит за датчиками движения и устанавливает статус свича
  // в виртуальном девайсе сценария
  // Этот свич нужен для двух целей:
  //   - Необходим для запуска таймера в конце детектирования движения
  //   - Полезен для отладки и слежением за состоянием сценария в реальном времени
  function motionInProgressSetter(newValue, devName, cellName) {
    // log.debug("~ Motion status changed");

    if (newValue === true) {
      // log.debug("~ Motion detected - enable light and remove old timer!");
      if (lightOffTimerId) {
        clearTimeout(lightOffTimerId);
      }
      resetLightOffTimer();
      setValueAllDevicesByBehavior(lightDevices, true);
    } else {
      // log.debug("~ Motion end detected - set timer for disable light!");
      setLightOffTimer(delayByMotionSensors * 1000);
    }
  }

  function logicDisabledByWallSwitchSetter(newValue, devName, cellName) {
    if (lightOffTimerId) {
      clearTimeout(lightOffTimerId);
    }
    if (logicEnableTimerId) {
      clearTimeout(logicEnableTimerId);
    }
    if (newValue === true) {
      resetLightOffTimer();
      setValueAllDevicesByBehavior(lightDevices, true);
      setLightOffTimer(delayBlockAfterSwitch * 1000);

      resetLogicEnableTimer();
      setLogicEnableTimer(delayBlockAfterSwitch * 1000);
    } else {
      resetLightOffTimer();
      setValueAllDevicesByBehavior(lightDevices, false);

      resetLogicEnableTimer();
    }
  }

  function lightSwitchUsed(newValue, devName, cellName) {
    // Для выключателей считаем, что любое изменение (не важно какое)
    // - Меняет состояние переключателя отключения логики сценария
    log.debug("Использован выключатель");
    var curValue = dev[genVirtualDeviceName + "/logicDisabledByWallSwitch"];
    dev[genVirtualDeviceName + "/logicDisabledByWallSwitch"] = !curValue;
  }

  function openingSensorTriggered(newValue, devName, cellName) {
    // Тригерит только изменение выбранное пользователем
    // log.debug("Opening detected on sensor " + devName + "/" + cellName);
    setValueAllDevicesByBehavior(lightDevices, true);
    setLightOffTimer(delayByOpeningSensors * 1000);
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
  var lightSwitchesControlNames = [];
  for (var i = 0; i < lightSwitches.length; i++) {
    lightSwitchesControlNames.push(lightSwitches[i].mqttTopicName);
  }



  // @todo:vg осталось переделать кроме свичей еще датчики
  eventRegistry.registerSingleEvent(genVirtualDeviceName + "/logicDisabledByWallSwitch",
                                    "whenChange",
                                    logicDisabledByWallSwitchSetter);
  eventRegistry.registerMultipleEvents(lightSwitchesControlNames,
                                       "whenChange",
                                       lightSwitchUsed);
  eventRegistry.registerMultipleEventsWithBehavior(openingSensors,
                                                   openingSensorTriggered);

  // Обработчик, вызываемый при срабатывании датчиков движения и открытия
  function sensorTriggeredHandler(newValue, devName, cellName, sensorType) {
    // log.debug("Handler started for WB-rule: '" + genRuleNameMotion + "'");
    // log.debug("  - devName: '" + devName + "'");
    // log.debug("  - cellName: '" + cellName + "'");
    // log.debug("  - newValue: '" + newValue + "'");
    // log.debug("  - sensorType: '" + sensorType + "'");
  
    var isActive = dev[genVirtualDeviceName + "/active"];
    if (isActive === false) {
      // log.debug("Darkroom is disabled in virtual device - doing nothing");
      return true;
    }

    var isSwitchUsed = dev[genVirtualDeviceName + "/logicDisabledByWallSwitch"];
    if (isSwitchUsed === true) {
      // log.debug("Darkroom is disabled after used wall switch - doing nothing");
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
      if (matchedSensor.behaviorType === "whileValueHigherThanThreshold") {
            if (newValue >= matchedSensor.actionValue) {
              // log.debug("Motion start on sensor " + matchedSensor.mqttTopicName);
              sensorTriggered = true;
            } else if (newValue < matchedSensor.actionValue) {
              // log.debug("Motion stop on sensor " + matchedSensor.mqttTopicName);
              sensorTriggered = false;
            }
      } else if (matchedSensor.behaviorType === "whenEnabled") {
        if (newValue === true) {
          // log.debug("Motion sensor type - bool");
          sensorTriggered = true;
        } else if (newValue === "true") {
          // log.debug("Motion sensor type - string");
          sensorTriggered = true;
        } else if (newValue === false || newValue === "false") {
          // log.debug("Motion sensor type correct and disabled");
          sensorTriggered = false;
        } else {
          // log.error("Motion sensor have not correct value: '" + newValue + "'");
          sensorTriggered = false;
        }
      }

      if (sensorTriggered === true) {
        // log.debug("Motion detected on sensor " + matchedSensor.mqttTopicName);
        dev[genVirtualDeviceName + "/motionInProgress"] = true;
      } else if (sensorTriggered === false) {

        if (checkAllMotionSensorsInactive()) {
          // log.debug("~ All motion sensors inactive");
          dev[genVirtualDeviceName + "/motionInProgress"] = false;
        } else {
          // log.debug("~ Some motion sensors are still active - keeping lights on.");
        }
      }
    }

    // @note: Через реестр событий пока работают два типа датчиков
    if (sensorType === 'opening' || sensorType === 'switches') {
      eventRegistry.processEvent(devName + '/' + cellName, newValue);
    }

    return true;
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

  // Создаем правило для выключателей света
  var ruleIdSwitches = defineRule(genRuleNameSwitches, {
                              whenChanged: lightSwitchesControlNames,
                              then: function (newValue, devName, cellName) {
                                sensorTriggeredHandler(newValue, devName, cellName, 'switches');
                              }
                            });
    if (!ruleIdSwitches) {
    log.error("Error: WB-rule '" + genRuleNameSwitches + "' not created.");
    return false;
    }
    log.debug("WB-rule with IdNum '" + ruleIdSwitches + "' was successfully created");

    log.debug("Darkroom initialization completed successfully");


  // Создаем правило следящее за движением
  // Оно нужно для приведения всех датчиков движения к одному типу switch
  //   - Тип датчиков value приведется к типу switch
  //   - Тип датчиков switch не изменится
  var ruleIdMotionInProgress = defineRule(genRuleNameMotionInProgress, {
                             whenChanged: [genVirtualDeviceName + "/motionInProgress"],             
                             then: function (newValue, devName, cellName) {
                              motionInProgressSetter(newValue, devName, cellName);
                            }
                            });
  if (!ruleIdMotionInProgress) {
    log.error("Error: WB-rule '" + genRuleNameMotionInProgress + "' not created.");
    return false;
  }
  log.debug("WB-rule with IdNum '" + genRuleNameMotionInProgress + "' was successfully created");

  // Правило следящее за отключением логики сценария
  var ruleIdLogicDisabledByWallSwitch = defineRule(genRuleNameLogicDisabledByWallSwitch, {
                             whenChanged: [genVirtualDeviceName + "/logicDisabledByWallSwitch"],             
                             then: function (newValue, devName, cellName) {
                              logicDisabledByWallSwitchSetter(newValue, devName, cellName);
                            }
                            });
  if (!ruleIdLogicDisabledByWallSwitch) {
    log.error("Error: WB-rule '" + genRuleNameLogicDisabledByWallSwitch + "' not created.");
    return false;
  }
  log.debug("WB-rule with IdNum '" + genRuleNameLogicDisabledByWallSwitch + "' was successfully created");


  return true;
}

exports.init = function (idPrefix,
                         deviceTitle,
                         delayByMotionSensors,
                         delayByOpeningSensors,
                         delayBlockAfterSwitch,
                         lightDevices,
                         motionSensors,
                         openingSensors,
                         lightSwitches) {
  var res = init(idPrefix,
                 deviceTitle,
                 delayByMotionSensors,
                 delayByOpeningSensors,
                 delayBlockAfterSwitch,
                 lightDevices,
                 motionSensors,
                 openingSensors,
                 lightSwitches);
  return res;
};
