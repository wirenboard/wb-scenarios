/**
 * @file Модуль для инициализации алгоритма управления светом в общем
 *     и темной комнатой (darkroom) в частности
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

var vdHelpers = require('virtual-device-helpers.mod');
var aTable = require('registry-action-resolvers.mod');

var TopicManager = require('tm-main.mod').TopicManager;
var eventPlugin = require('tm-event-main.mod').eventPlugin;
var historyPlugin = require('tm-history-main.mod').historyPlugin;

var tm = new TopicManager();
tm.installPlugin(historyPlugin);
tm.installPlugin(eventPlugin);

/**
 * Инициализирует виртуальное устройство и определяет правило для управления
 * и автоматизацией в зависимости от пользовательских настроек
 * 
 * @param {string} idPrefix Префикс сценария, используемый для идентификации
 *     виртуального устройства и правила
 * @param {string} deviceTitle Имя виртуального девайса указанное
 *     пользователем
 * @param {boolean} isDebugEnabled Включение дополнительного отображения
 *     состояния всех подключенных устройств в виртуальном девайсе
 * @param {number} delayByMotionSensors Задержка выключения света после
 *     срабатывания любого из датчиков движения (сек)
 * @param {number} delayByOpeningSensors Задержка выключения света после
 *     срабатывания любого из датчиков открытия (сек)
 * @param {boolean} isDelayEnabledAfterSwitch Включение/выключение наличия
 *     задержки после ручного нажатия выключателя:
 *     - false: Задержка не используется.
 *       Свет выкл и автоматизация вкл только при повторном нажатии
 *     - true: Активирует задержку.
 *       Свет выкл и автоматизация вкл автоматически через данное время
 * @param {number} delayBlockAfterSwitch Задержка (сек) блокировки логики
 *после ручного переключения света
 * @param {Array} lightDevices Массив управляемых устройств освещения
 * @param {Array} motionSensors Массив отслеживаемых контролов датчиков движения
 * @param {Array} openingSensors Массив отслеживаемых контролов датчиков открытия
 * @param {Array} lightSwitches Массив выключателей света
 * @returns {boolean} Результат инициализации (true, если успешно)
 */
function init(
  idPrefix,
  deviceTitle,
  isDebugEnabled,
  delayByMotionSensors,
  delayByOpeningSensors,
  isDelayEnabledAfterSwitch,
  delayBlockAfterSwitch,
  lightDevices,
  motionSensors,
  openingSensors,
  lightSwitches
) {
  var isAllArrays =
    Array.isArray(lightDevices) &&
    Array.isArray(motionSensors) &&
    Array.isArray(openingSensors) &&
    Array.isArray(lightSwitches);
  if (!isAllArrays) {
    log.error(
      'Light-control initialization error: lightDevices, motionSensors, openingSensors, and lightSwitches must be arrays'
    );
    return false;
  }

  var genNames = generateNames(idPrefix);
  var vDevObj = defineVirtualDevice(genNames.vDevice, {
    title: deviceTitle,
    cells: buildVirtualDeviceCells(),
  });
  if (!vDevObj) {
    log.error('Error: Virtual device "' + deviceTitle + '" not created');
    return false;
  }
  log.debug('Virtual device "' + deviceTitle + '" created successfully');

  var isAllDelayValid =
    delayByMotionSensors > 0 &&
    delayByOpeningSensors > 0 &&
    (isDelayEnabledAfterSwitch === false || delayBlockAfterSwitch > 0);
  if (!isAllDelayValid) {
    // prettier-ignore
    var curDelays = 
      '[' + delayByMotionSensors + '], ' + 
      '[' + delayByOpeningSensors + '], ' +
      '[' + delayBlockAfterSwitch + ']';

    setError('Invalid delay - must be a positive number ' + curDelays);
    return false;
  }

  var isLightDevicesEmpty = lightDevices.length === 0;
  if (isLightDevicesEmpty) {
    setError('Light-control initialization error: no light devices specified');
    return false;
  }

  // Проверяем что хотябы один тип триггера заполнен
  var isAllTriggersEmpty =
    motionSensors.length === 0 &&
    openingSensors.length === 0 &&
    lightSwitches.length === 0;
  if (isAllTriggersEmpty) {
    setError(
      'Light-control initialization error: no motion, ' +
        'opening sensors and wall switches specified'
    );
    return false;
  }

  // @todo: Добавить проверку типов контролов - чтобы не запускать init
  //        с типом датчика строка где обрабатывается только цифра

  log.debug('All checks pass successfuly!');
  if (isDebugEnabled === true) {
    // Нужна задержка чтобы успели создаться все используемые нами девайсы
    // ДО того как мы будем создавать связь на них
    // Значение 100мс бывает мало, поэтому установлено 1000мс = 1с
    setTimeout(addAllLinkedDevicesToVd, 1000)
  } else {
    log.debug('Debug disabled and have value: "' + isDebugEnabled + '"');
  }

  log.debug('Start rules creation');
  var lightOffTimerId = null;
  var logicEnableTimerId = null;

  // Предварительно извлекаем имена контролов
  var motionSensorsControlNames = extractControlNames(motionSensors);
  var openingSensorsControlNames = extractControlNames(openingSensors);
  var lightSwitchesControlNames = extractControlNames(lightSwitches);

   tm.registerSingleEvent(
    genNames.vDevice + '/logicDisabledByWallSwitch',
    'whenChange',
    logicDisabledCb
  );
   tm.registerSingleEvent(
    genNames.vDevice + '/doorOpen',
    'whenChange',
    doorOpenCb
  );
   tm.registerSingleEvent(
    genNames.vDevice + '/remainingTimeToLightOffInSec',
    'whenChange',
    remainingTimeToLightOffCb
  );
   tm.registerSingleEvent(
    genNames.vDevice + '/remainingTimeToLogicEnableInSec',
    'whenChange',
    remainingTimeToLogicEnableCb
  );
   tm.registerSingleEvent(
    genNames.vDevice + '/lightOn',
    'whenChange',
    lightOnCb
  );
   tm.registerMultipleEvents(
    lightSwitchesControlNames,
    'whenChange',
    lightSwitchUsedCb
  );

  /**
   * Для датчиков открытия пользователь может выбрать у каждого датчика
   * разную логику срабатывания - поэтому регистрируем два противоположных
   * обработчика.
   */
   tm.registerMultipleEventsWithBehaviorOpposite(
    openingSensors,
    openingSensorTriggeredLaunchCb,
    openingSensorTriggeredResetCb
  );

  tm.initRulesForAllTopics('light_control_rule_' + idPrefix);

  // Создаем правило для датчиков движения
  var ruleIdMotion = defineRule(genNames.ruleMotion, {
    whenChanged: motionSensorsControlNames,
    then: function (newValue, devName, cellName) {
      sensorTriggeredHandler(newValue, devName, cellName, 'motion');
    },
  });
  if (!ruleIdMotion) {
    setError('WB-rule "' + genNames.ruleMotion + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' + ruleIdMotion + '" was successfully created'
  );

  // Создаем правило для датчиков открытия
  var ruleIdOpening = defineRule(genNames.ruleOpening, {
    whenChanged: openingSensorsControlNames,
    then: function (newValue, devName, cellName) {
      sensorTriggeredHandler(newValue, devName, cellName, 'opening');
    },
  });
  if (!ruleIdOpening) {
    setError('WB-rule "' + genNames.ruleOpening + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' + ruleIdOpening + '" was successfully created'
  );

  // Создаем правило следящее за движением
  // Оно нужно для приведения всех датчиков движения к одному типу switch
  //   - Тип датчиков value приведется к типу switch
  //   - Тип датчиков switch не изменится
  var ruleIdMotionInProgress = defineRule(genNames.ruleMotionInProgress, {
    whenChanged: [genNames.vDevice + '/motionInProgress'],
    then: function (newValue, devName, cellName) {
      motionInProgressHandler(newValue, devName, cellName);
    },
  });
  if (!ruleIdMotionInProgress) {
    setError('WB-rule "' + genNames.ruleMotionInProgress + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' +
      genNames.ruleMotionInProgress +
      '" was successfully created'
  );

  // Правило следящее за изменением значения задержки до включения логики сценария
  var ruleIdRemainingTimeToLogicEnableInSec = defineRule(
    genNames.ruleRemainingTimeToLogicEnableInSec,
    {
      whenChanged: [genNames.vDevice + '/remainingTimeToLogicEnableInSec'],
      then: function (newValue, devName, cellName) {
         tm.processEvent(devName + '/' + cellName, newValue);
      },
    }
  );
  if (!ruleIdRemainingTimeToLogicEnableInSec) {
    setError(
      'WB-rule "' + genNames.ruleRemainingTimeToLogicEnableInSec + '" not created'
    );
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' +
      genNames.ruleRemainingTimeToLogicEnableInSec +
      '" was successfully created'
  );

  log.debug('Light-control initialization completed successfully');
  return true;



  // ======================================================
  //                  Определения функций
  // ======================================================

  function generateNames(idPrefix) {
    var delimeter = '_';
    var scenarioPrefix = 'wbsc' + delimeter;
    var rulePrefix = 'wbru' + delimeter;
    var postfix = delimeter + idPrefix + delimeter;

    return {
      vDevice: scenarioPrefix + idPrefix,
      ruleMotionInProgress: rulePrefix + 'motionInProgress' + postfix,
      ruleDoorOpen: rulePrefix + 'doorOpen' + postfix,
      ruleLightOn: rulePrefix + 'lightOn' + postfix,
      ruleLogicDisabledByWallSwitch:
        rulePrefix + 'logicDisabledByWallSwitch' + postfix,
      ruleRemainingTimeToLightOffInSec:
        rulePrefix + 'remainingTimeToLightOffInSec' + postfix,
      ruleRemainingTimeToLogicEnableInSec:
        rulePrefix + 'remainingTimeToLogicEnableInSec' + postfix,
      ruleMotion: rulePrefix + 'motion' + postfix,
      ruleOpening: rulePrefix + 'opening' + postfix,
      ruleSwitches: rulePrefix + 'switches' + postfix,
    };
  }

  function buildVirtualDeviceCells() {
    var cells = {
      ruleEnabled: {
        title: { en: 'Enable rule', ru: 'Включить правило' },
        type: 'switch',
        value: true,
        order: 1,
      },
      remainingTimeToLightOffInSec: {
        title: {
          en: 'Light off in',
          ru: 'Отключение света через',
        },
        units: 's',
        type: 'value',
        value: 0,
        readonly: true,
        order: 2,
      },
      lightOn: {
        title: { en: 'Light on', ru: 'Освещение включено' },
        type: 'switch',
        value: false,
        readonly: true,
        order: 6,
      },
    };

    // Условное добавление полей в зависимости от конфигурации
    if (motionSensors.length > 0) {
      cells.motionInProgress = {
        title: {
          en: 'Motion in progress',
          ru: 'Есть движение'
        },
        type: 'switch',
        value: false,
        readonly: true,
        order: 4,
      };
    }


    if(openingSensors.length > 0) {
      cells.doorOpen = {
        title: {
          en: 'Door open',
          ru: 'Дверь открыта'
        },
        type: 'switch',
        value: false,
        readonly: true,
        order: 5,
      };
    }

    if (lightSwitches.length > 0) {
      cells.remainingTimeToLogicEnableInSec = {
        title: {
          en: 'Automation activation in',
          ru: 'Активация автоматики через',
        },
        units: 's',
        type: 'value',
        value: 0,
        readonly: true,
        order: 3,
      };

      cells.logicDisabledByWallSwitch = {
        title: {
          en: 'Disabled manually by switch',
          ru: 'Отключено ручным выключателем',
        },
        type: 'switch',
        value: false,
        readonly: true,
        order: 7,
      };
    }

    return cells;
  }

  /**
   * Добавление к виртуальному устройству список связанных виртуальных
   * контролов, которые полезны для отслеживания состояния связанных
   * с данным виртуальным устройством контролов
   */
  function addLinkedControlsArray(arrayOfControls, cellPrefix) {
    for (var i = 0; i < arrayOfControls.length; i++) {
      var curMqttControl = arrayOfControls[i].mqttTopicName;
      var cellName = cellPrefix + '_' + i;
      var vdControlCreated = vdHelpers.addLinkedControlRO(
        curMqttControl,
        vDevObj,
        genNames.vDevice,
        cellName,
        ''
      );
      if (!vdControlCreated) {
        setError(
          'Failed to add ' + cellPrefix + ' ctrl for ' + curMqttControl
        );
      }
      log.debug(
        'Success add ' + cellPrefix + ' ctrl for ' + curMqttControl
      );
    }
  }

  /**
   * Добавление отображения текущего статуса датчиков связанных
   * с виртуальным устройством
   *
   * @note: Если топик не существует в момент создания связи - то он не добавится
   *        в виртуальное устройство - это актуально при создании сценариев с
   *        использованием других сценариев и других виртуальных устройств
   *        если реальные устройства создаются и существуют постоянно - то
   *        wb-rules не гарантирует порядок инициализации виртуальных устройств
   * @fixme: попробовать это как то поправить
   */
  function addAllLinkedDevicesToVd() {
    // Текущая задержка, меняется в зависимости от последнего
    // сработавшего типа датчика
    vDevObj.addControl('curValDisableLightTimerInSec', {
      title: {
        en: 'Dbg: Disable timer',
        ru: 'Dbg: Таймер отключения',
      },
      units: 's',
      type: 'value',
      value: 0,
      readonly: true,
      value: '',
    });

    // Текущая задержка отключенной логики
    vDevObj.addControl('curValDisabledLogicTimerInSec', {
      title: {
        en: 'Dbg: Disabled logic timer',
        ru: 'Dbg: Таймер отключенной логики',
      },
      units: 's',
      type: 'value',
      value: 0,
      readonly: true,
      value: '',
    });

    if(lightDevices.length > 0) {
      addLinkedControlsArray(lightDevices, 'light_device');
    }

    if(motionSensors.length > 0) {
      addLinkedControlsArray(motionSensors, 'motion_sensor');
    }

    if(openingSensors.length > 0) {
      addLinkedControlsArray(openingSensors, 'opening_sensor');
    }

    if(lightSwitches.length > 0) {
      addLinkedControlsArray(lightSwitches, 'light_switch');
    }
  }

  /**
   * Установка ошибки
   * 
   * @note Данный метод можно использовать только после инициализации
   *     минимального виртуального устройства
   */
  function setError(errorString) {
    log.error('ERROR Init: ' + errorString);

    vDevObj.controlsList().forEach(function(ctrl) {
      ctrl.setError('Error-see log')
    });
  }

  /**
   * Обновление содержашейся в контроле цифры оставшегося времени
   * до отключения света каждую секунду
   */
  function updateRemainingLightOffTime() {
    var remainingTime = dev[genNames.vDevice + '/remainingTimeToLightOffInSec'];
    if (remainingTime >= 1) {
      dev[genNames.vDevice + '/remainingTimeToLightOffInSec'] = remainingTime - 1;
    }
  }

  /**
   * Обновление содержашейся в контроле цифры оставшегося времени
   * до активации логики каждую секунду
   */
  function updateRemainingLogicEnableTime() {
    var remainingTime = dev[genNames.vDevice + '/remainingTimeToLogicEnableInSec'];
    if (remainingTime >= 1) {
      dev[genNames.vDevice + '/remainingTimeToLogicEnableInSec'] = remainingTime - 1;
    }
  }

  /**
   * Запуск таймера отключения света
   * @param {number} newDelayMs - Задержка в миллисекундах
   */
  function startLightOffTimer(newDelayMs) {
    var newDelaySec = newDelayMs / 1000;
    dev[genNames.vDevice + '/remainingTimeToLightOffInSec'] = newDelaySec;

    if (isDebugEnabled === true) {
      dev[genNames.vDevice + '/curValDisableLightTimerInSec'] = newDelaySec;
    }
    // @note: Таймер автоматически запускает обратный отсчет при установке
    //        нового значения в контрол таймера.
  }

  /**
   * Запуск таймер включения логики
   * @param {number} newDelayMs Задержка в миллисекундах
   */
  function startLogicEnableTimer(newDelayMs) {
    var newDelaySec = newDelayMs / 1000;
    dev[genNames.vDevice + '/remainingTimeToLogicEnableInSec'] = newDelaySec;

    if (isDebugEnabled === true) {
      dev[genNames.vDevice + '/curValDisabledLogicTimerInSec'] = newDelaySec;
    }
    // @note: Таймер автоматически запускает обратный отсчет при установке
    //        нового значения в контрол таймера
  }

  /**
   * Выключение освещения
   */
  function turnOffLightsByTimeout() {
    dev[genNames.vDevice + '/lightOn'] = false;
    resetLightOffTimer();
  }

  /**
   * Активация логики сценария
   */
  function enableLogicByTimeout() {
    dev[genNames.vDevice + '/logicDisabledByWallSwitch'] = false;
    resetLogicEnableTimer();
  }

  /**
   * Включение/выключение всех устройств в массиве согласно указанному типу поведения
   * @param {Array} actionControlsArr Массив контролов с указанием
   *     типа поведения и значений
   * @param {boolean} state Состояние для применения
   *     (true - разрешить, false - сбросить)
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
        newCtrlValue = aTable.actionsTable[curUserAction].launchResolver(
          actualValue,
          curActionValue
        );
      } else {
        newCtrlValue = aTable.actionsTable[curUserAction].resetResolver(
          actualValue,
          curActionValue
        );
      }
      dev[curMqttTopicName] = newCtrlValue;
    }
  }

  function resetLightOffTimer() {
    lightOffTimerId = null;
    dev[genNames.vDevice + '/remainingTimeToLightOffInSec'] = 0;

    if (isDebugEnabled === true) {
      dev[genNames.vDevice + '/curValDisableLightTimerInSec'] = 0;
    }
  }

  function resetLogicEnableTimer() {
    logicEnableTimerId = null;
    dev[genNames.vDevice + '/remainingTimeToLogicEnableInSec'] = 0;

    if (isDebugEnabled === true) {
      dev[genNames.vDevice + '/curValDisabledLogicTimerInSec'] = 0;
    }
  }

  /**
   * Проверка - находится ли датчик в активном состоянии
   *   У разных типов контролов будет разная логика определения
   *   'активного' состояния:
   *     - value - больше трешхолда
   *     - bool - что новое значение true
   *     - string - что новая строка 'true'
   *     - ... другие типы можно добавить при необходимости, например 0 и 1 и тд
   * @param {Object} sensorWithBehavior Объект датчика
   *     (содержит behaviorType, actionValue и другие свойства)
   * @param {any} newValue Текущее состояние датчика
   * @returns {boolean} true, если датчик активен, иначе false
   */
  function isMotionSensorActiveByBehavior(sensorWithBehavior, newValue) {
    var sensorTriggered = false;
    if (
      sensorWithBehavior.behaviorType === 'whileValueHigherThanThreshold'
    ) {
      var isMotionStart = newValue >= sensorWithBehavior.actionValue;
      if (isMotionStart) {
        sensorTriggered = true;
      } else {
        sensorTriggered = false;
      }
    } else if (sensorWithBehavior.behaviorType === 'whenEnabled') {
      if (newValue === true) {
        sensorTriggered = true;
      } else if (newValue === 'true') {
        sensorTriggered = true;
      } else if (newValue === false || newValue === 'false') {
        sensorTriggered = false;
      } else {
        setError('Motion sensor have not correct value: "' + newValue + '"');
        sensorTriggered = false;
      }
    } else {
      log.error(
        'Unknown behavior type for sensor: ' +
          sensorWithBehavior.mqttTopicName
      );
      sensorTriggered = false; // Считаем неизвестное поведение неактивным
    }
    return sensorTriggered;
  }

  /**
   * Проверка - активен ли датчик открытия (дверь открыта или закрыта)
   *     на основе поведения
   *
   * @param {Object} sensorWithBehavior Объект датчика
   *     (содержит behaviorType и другие свойства)
   * @param {any} newValue Текущее состояние датчика
   * @returns {boolean} true, если датчик активен (дверь открыта), иначе false
   */
  function isOpeningSensorOpenedByBehavior(sensorWithBehavior, newValue) {
    if (sensorWithBehavior.behaviorType === 'whenDisabled') {
      /**
       * Датчик нормально замкнутый:
       *   - При закрытой двери - нормальное состояние true
       *   - Когда дверь открыта - разомкнут, состояние false
       */
      return newValue === false || newValue === 'false';
    } else if (sensorWithBehavior.behaviorType === 'whenEnabled') {
      /**
       * Датчик нормально разомкнутый:
       *   - При закрытой двери - нормальное состояние false
       *   - Когда дверь открыта - замыкается, состояние true
       */
      return newValue === true || newValue === 'true';
    } else {
      log.error(
        'Unknown behavior type for sensor: ' +
          sensorWithBehavior.mqttTopicName
      );
      return false; // Считаем неизвестное поведение неактивным
    }
  }

  /**
   * Проверка - все ли датчики открытия замкнуты (двери закрыты)
   *
   * @returns {boolean} true, если все датчики показывают,
   *     что двери закрыты, иначе false
   */
  function checkAllOpeningSensorsClose() {
    for (var i = 0; i < openingSensors.length; i++) {
      var curSensor = openingSensors[i];
      var curSensorState = dev[curSensor.mqttTopicName];

      // Проверяем активность датчика с учетом его поведения
      var isOpen = isOpeningSensorOpenedByBehavior(
        curSensor,
        curSensorState
      );
      if (isOpen === true) {
        // Если хотя бы один датчик активен (дверь открыта), возвращаем false
        return false;
      }
    }
    return true; // Все датчики пассивны (двери закрыты)
  }

  /**
   * Проверка - все ли датчики движения находятся в пассивном состоянии
   *
   * @returns {boolean} true, если все датчики показывают,
   *     что движения нет, иначе false
   */
  function checkAllMotionSensorsInactive() {
    for (var i = 0; i < motionSensors.length; i++) {
      var curSensorState = dev[motionSensors[i].mqttTopicName];
      var isActive = isMotionSensorActiveByBehavior(
        motionSensors[i],
        curSensorState
      );
      if (isActive === true) {
        return false; // Если хотя бы один датчик активен, возвращаем false
      }
    }
    return true; // Все датчики пассивны
  }

  /**
   * Обработчик выключения логики автоматики при использовании выключателя
   *
   * @param {boolean} topicObj.val.new Новое значение состояния логики:
   *     true - включает логику и запускает таймеры (если разрешено)
   *     false - выключает логику и отключает свет.
   * @returns {boolean} Callback возвращает true при успехе
   */
  function logicDisabledCb(topicObj) {
    if (lightOffTimerId) {
      clearTimeout(lightOffTimerId);
      resetLightOffTimer();
    }
    if (logicEnableTimerId) {
      clearTimeout(logicEnableTimerId);
      resetLogicEnableTimer();
    }

    if (topicObj.val.new === false) {
      dev[genNames.vDevice + '/lightOn'] = false;
      return true;
    }

    // Если значение true, включаем свет
    dev[genNames.vDevice + '/lightOn'] = true;
    if (isDelayEnabledAfterSwitch === true) {
      startLightOffTimer(delayBlockAfterSwitch * 1000);
      startLogicEnableTimer(delayBlockAfterSwitch * 1000);
    }
    return true;
  }

  function doorOpenCb(topicObj) {
    var isDoorOpened = (topicObj.val.new === true);
    var isDoorClosed = (topicObj.val.new === false);

    if (isDoorOpened) {
      dev[genNames.vDevice + '/lightOn'] = true;
      startLightOffTimer(delayByOpeningSensors * 1000);
    } else if (isDoorClosed) {
      // Do nothing
    } else {
      log.error('Door status - have not correct type');
    }

    return true;
  }

  function lightOnCb(topicObj) {
    var isLightSwitchedOn = (topicObj.val.new === true)
    var isLightSwitchedOff = (topicObj.val.new === false)

    if (isLightSwitchedOn) {
      setValueAllDevicesByBehavior(lightDevices, true);
    } else if (isLightSwitchedOff) {
      setValueAllDevicesByBehavior(lightDevices, false);
    } else {
      log.error('Light on - have not correct type');
    }

    return true;
  }

  function remainingTimeToLightOffCb(topicObj) {
    /**
     * Значение таймера отключения света может стать нулем в двух случаях:
     * 1 - Таймер дошел до конца без новых внешних воздействи
     * 2 - Таймер был обнулен так как движение снова появилось
     */
    var curMotionStatus = dev[genNames.vDevice + '/motionInProgress'];
    if (topicObj.val.new === 0 && curMotionStatus === true) {
      /* Ничего не делаем если при движении обнулился таймер */
      return true;
    }

    if (topicObj.val.new === 0) {
      turnOffLightsByTimeout();
    } else if (topicObj.val.new >= 1) {
      // Recharge timer
      if (lightOffTimerId) {
        clearTimeout(lightOffTimerId);
      }
      lightOffTimerId = setTimeout(updateRemainingLightOffTime, 1000);
    } else {
      log.error('Remaining time to light enable: have not correct value:' + topicObj.val.new);
    }

    return true;
  }

  function remainingTimeToLogicEnableCb(topicObj) {
    if (topicObj.val.new === 0) {
      enableLogicByTimeout();
    } else if (topicObj.val.new >= 1) {
      // Recharge timer
      if (logicEnableTimerId) {
        clearTimeout(logicEnableTimerId);
      }
      logicEnableTimerId = setTimeout(updateRemainingLogicEnableTime, 1000);
    } else {
      log.error('Remaining time to logic enable: have not correct value:' + topicObj.val.new);
    }

    return true;
  }

  function lightSwitchUsedCb(topicObj) {
    // Для выключателей считаем, что любое изменение (не важно какое)
    // - Меняет состояние переключателя отключения логики сценария
    var curValue = dev[genNames.vDevice + '/logicDisabledByWallSwitch'];
    dev[genNames.vDevice + '/logicDisabledByWallSwitch'] = !curValue;

    return true;
  }

  function openingSensorTriggeredLaunchCb(topicObj) {
    // Тригерит только изменение выбранное пользователем
    dev[genNames.vDevice + '/doorOpen'] = true;

    return true;
  }

  function openingSensorTriggeredResetCb(topicObj) {
    // Тригерит только противоположное действие
    if (checkAllOpeningSensorsClose()) {
      dev[genNames.vDevice + '/doorOpen'] = false;
    } else {
      // Если некоторые двери еще открыты - то ничего не делаем
    }

    return true;
  }

  //Извлечение имен контролов (mqttTopicName) из массива
  function extractControlNames(devices) {
    var result = [];
    for (var i = 0; i < devices.length; i++) {
      result.push(devices[i].mqttTopicName);
    }
    return result;
  }

  // Функция которая следит за датчиками движения и устанавливает статус свича
  // в виртуальном девайсе сценария
  // Этот свич нужен для двух целей:
  //   - Необходим для запуска таймера в конце детектирования движения
  //   - Полезен для отладки и слежением за состоянием сценария в реальном времени
  function motionInProgressHandler(newValue, devName, cellName) {
    var isMotionDetected = (newValue === true);

    if (isMotionDetected) {
      if (lightOffTimerId) {
        clearTimeout(lightOffTimerId);
      }
      resetLightOffTimer();
      dev[genNames.vDevice + '/lightOn'] = true;
    } else {
      // Detected motion end
      startLightOffTimer(delayByMotionSensors * 1000);
    }
  }

  // Обработчик, вызываемый при срабатывании датчиков движения и открытия
  function sensorTriggeredHandler(newValue, devName, cellName, sensorType) {
    var isRuleActive = dev[genNames.vDevice + '/ruleEnabled'];

    if (isRuleActive === false) {
      // log.debug('Light-control is disabled in virtual device - doing nothing');
      return true;
    }

    var isSwitchUsed = dev[genNames.vDevice + '/logicDisabledByWallSwitch'];
    if (isSwitchUsed === true) {
      // log.debug('Light-control is disabled after used wall switch - doing nothing');
      return true;
    }

    if (sensorType === 'motion') {
      // Найдем сенсор в списке по cellName
      var matchedSensor = null;
      for (var i = 0; i < motionSensors.length; i++) {
        if (motionSensors[i].mqttTopicName === devName + '/' + cellName) {
          matchedSensor = motionSensors[i];
          break;
        }
      }
      if (!matchedSensor) return false;

      // Нужно убедиться что произошло именно событие являющееся тригером:
      var sensorTriggered = isMotionSensorActiveByBehavior(
        matchedSensor,
        newValue
      );
      // log.debug('sensorTriggered = ' + sensorTriggered);
      if (sensorTriggered === true) {
        // log.debug('Motion detected on sensor ' + matchedSensor.mqttTopicName);
        dev[genNames.vDevice + '/motionInProgress'] = true;
      } else if (sensorTriggered === false) {
        if (checkAllMotionSensorsInactive()) {
          // log.debug('~ All motion sensors inactive');
          dev[genNames.vDevice + '/motionInProgress'] = false;
        } else {
          // log.debug('~ Some motion sensors are still active - keeping lights on');
        }
      }
    }

    if (sensorType === 'opening') {
      var res =  tm.processEvent(
        devName + '/' + cellName,
        newValue
      );
      log.debug('opening res = ' + JSON.stringify(res));
    }

    return true;
  }
}

exports.init = function (
  idPrefix,
  deviceTitle,
  isDebugEnabled,
  delayByMotionSensors,
  delayByOpeningSensors,
  isDelayEnabledAfterSwitch,
  delayBlockAfterSwitch,
  lightDevices,
  motionSensors,
  openingSensors,
  lightSwitches
) {
  var res = init(
    idPrefix,
    deviceTitle,
    isDebugEnabled,
    delayByMotionSensors,
    delayByOpeningSensors,
    isDelayEnabledAfterSwitch,
    delayBlockAfterSwitch,
    lightDevices,
    motionSensors,
    openingSensors,
    lightSwitches
  );
  return res;
};
