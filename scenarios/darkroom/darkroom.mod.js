/**
 * @file Модуль для инициализации алгоритма темной комнаты (darkroom)
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

var vdHelpers = require('virtual-device-helpers.mod');
var aTable = require('registry-action-resolvers.mod');
var eventModule = require('registry-event-processing.mod');

/**
 * Инициализирует виртуальное устройство и определяет правило для работы
 * 'темной комнаты'
 * @param {string} idPrefix Префикс сценария, используемый для идентификации
 *     виртуального устройства и правила
 * @param {string} deviceTitle Имя виртуального девайса указанное
 *     пользователем
 * @param {number} delayByMotionSensors Задержка выключения света после
 *     срабатывания любого из датчиков движения (сек)
 * @param {number} delayByOpeningSensors Задержка выключения света после
 *     срабатывания любого из датчиков открытия (сек)
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
      'Darkroom initialization error: lightDevices, motionSensors, openingSensors, and lightSwitches must be arrays'
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
    delayBlockAfterSwitch > 0;
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
    setError('Darkroom initialization error: no light devices specified');
    return false;
  }

  // Проверяем что хотябы один тип триггера заполнен
  var isAllTriggersEmpty =
    motionSensors.length === 0 &&
    openingSensors.length === 0 &&
    lightSwitches.length === 0;
  if (isAllTriggersEmpty) {
    setError(
      'Darkroom initialization error: no motion, ' +
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
    setTimeout(addAllLinkedDevicesToVd, 1000)
  } else {
    log.debug('Debug disabled and have value: "' + isDebugEnabled + '"');
  }

  log.debug('Start rules creation');
  var eventRegistry = eventModule.createRegistryForEvents();
  var lightOffTimerId = null;
  var logicEnableTimerId = null;

  // Предварительно извлекаем имена контролов
  var motionSensorsControlNames = extractControlNames(motionSensors);
  var openingSensorsControlNames = extractControlNames(openingSensors);
  var lightSwitchesControlNames = extractControlNames(lightSwitches);

  eventRegistry.registerSingleEvent(
    genNames.vDevice + '/logicDisabledByWallSwitch',
    'whenChange',
    logicDisabledCb
  );
  eventRegistry.registerSingleEvent(
    genNames.vDevice + '/doorOpen',
    'whenChange',
    doorOpenCb
  );
  eventRegistry.registerSingleEvent(
    genNames.vDevice + '/lightOn',
    'whenChange',
    lightOnCb
  );
  eventRegistry.registerMultipleEvents(
    lightSwitchesControlNames,
    'whenChange',
    lightSwitchUsedCb
  );
  eventRegistry.registerMultipleEventsWithBehaviorOpposite(
    openingSensors,
    openingSensorTriggeredLaunchCb,
    openingSensorTriggeredResetCb
  );

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

  // Создаем правило для выключателей света
  var ruleIdSwitches = defineRule(genNames.ruleSwitches, {
    whenChanged: lightSwitchesControlNames,
    then: function (newValue, devName, cellName) {
      switchTriggeredHandler(newValue, devName, cellName);
    },
  });
  if (!ruleIdSwitches) {
    setError('WB-rule "' + genNames.ruleSwitches + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' + ruleIdSwitches + '" was successfully created'
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

  // Правило следящее за состоянием дверей
  var ruleIdDoorOpen = defineRule(genNames.ruleDoorOpen, {
    whenChanged: [genNames.vDevice + '/doorOpen'],
    then: function (newValue, devName, cellName) {
      doorOpenHandler(newValue, devName, cellName);
    },
  });
  if (!ruleIdDoorOpen) {
    setError('WB-rule "' + genNames.ruleDoorOpen + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' +
      genNames.ruleDoorOpen +
      '" was successfully created'
  );

  // Правило следящее за состоянием света
  var ruleIdLightOn = defineRule(genNames.ruleLightOn, {
    whenChanged: [genNames.vDevice + '/lightOn'],
    then: function (newValue, devName, cellName) {
      lightOnHandler(newValue, devName, cellName);
    },
  });
  if (!ruleIdLightOn) {
    setError('WB-rule "' + genNames.ruleLightOn + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' +
      genNames.ruleLightOn +
      '" was successfully created'
  );

  // Правило следящее за отключением логики сценария
  var ruleIdLogicDisabledByWallSwitch = defineRule(
    genNames.ruleLogicDisabledByWallSwitch,
    {
      whenChanged: [genNames.vDevice + '/logicDisabledByWallSwitch'],
      then: function (newValue, devName, cellName) {
        logicDisabledBySwitchHandler(newValue, devName, cellName);
      },
    }
  );
  if (!ruleIdLogicDisabledByWallSwitch) {
    setError(
      'WB-rule "' + genNames.ruleLogicDisabledByWallSwitch + '" not created'
    );
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' +
      genNames.ruleLogicDisabledByWallSwitch +
      '" was successfully created'
  );

  log.debug('Darkroom initialization completed successfully');
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
      ruleMotion: rulePrefix + 'motion' + postfix,
      ruleOpening: rulePrefix + 'opening' + postfix,
      ruleSwitches: rulePrefix + 'switches' + postfix,
    };
  }

  function buildVirtualDeviceCells() {
    var cells = {
      active: {
        title: { en: 'Activate rule?', ru: 'Активировать правило?' },
        type: 'switch',
        value: true,
        order: 1,
      },
      // Текущая задержка, меняется в зависимости от последнего
      // сработавшего типа датчика
      curDisableLightTimerInSec: {
        title: {
          en: 'Disable timer (seconds)',
          ru: 'Таймер отключения (секунды)',
        },
        type: 'value',
        value: 0,
        readonly: true,
        order: 2,
      },
      // Текущая задержка отключенной логики
      curDisabledLogicTimerInSec: {
        title: {
          en: 'Disabled logic timer (seconds)',
          ru: 'Таймер отключенной логики (секунды)',
        },
        type: 'value',
        value: 0,
        readonly: true,
        order: 3,
      },
      motionInProgress: {
        title: { en: 'Motion in progress', ru: 'Есть движение' },
        type: 'switch',
        value: false,
        readonly: true,
        order: 4,
      },
      doorOpen: {
        title: { en: 'Door open', ru: 'Дверь открыта' },
        type: 'switch',
        value: false,
        // readonly: true,
        order: 5,
      },
      lightOn: {
        title: { en: 'Light on', ru: 'Освещение включено' },
        type: 'switch',
        value: false,
        // readonly: true,
        order: 6,
      },
      logicDisabledByWallSwitch: {
        title: {
          en: 'Disabled manually by switch',
          ru: 'Отключено ручным выключателем',
        },
        type: 'switch',
        value: false,
        readonly: true,
        order: 7,
      },
    };
    return cells;
  }

  /**
   * Добавляет к виртуальному устройству список связанных виртуальных
   * контролов, которые полезны для отслеживания состояния связанных
   * с данным виртуальным устройством контролов
   */
  function addLinkedControlsArray(arrayOfControls, cellPrefix) {
    log.debug('  - Start add ' + cellPrefix + ' ctrl. Array lenght {}', arrayOfControls.length);
    for (var i = 0; i < arrayOfControls.length; i++) {
      var curMqttControl = arrayOfControls[i].mqttTopicName;
      var cellName = cellPrefix + '_' + i;
      log.debug('    ... Processing ' + cellName + ' ctrl');
      var vdControlCreated = vdHelpers.addLinkedControlRO(
        curMqttControl,
        vDevObj,
        genNames.vDevice,
        cellName,
        ''
      );
      if (!vdControlCreated) {
        setError(
          '  - Failed to add ' + cellPrefix + ' ctrl for ' + curMqttControl
        );
      }
      log.debug(
        '  - Success add ' + cellPrefix + ' ctrl for ' + curMqttControl
      );
    }
  }

  function addAllLinkedDevicesToVd() {
    /** Добавляем отображение текущего статуса датчиков связанных
     * с виртуальным устройством
     *
     * @note: Если топик не существует в момент создания связи - то он не добавится
     *        в виртуальное устройство - это актуально при создании сценариев с
     *        использованием других сценариев и других виртуальных устройств
     *        если реальные устройства создаются и существуют постоянно - то
     *        wb-rules не гарантирует порядок инициализации виртуальных устройств
     * @fixme: попробовать это как то поправить
     */
    log.debug('Debug enabled - create additional controls in VD');

    var titlePrefix = '▼  ';
    var titlePostfix = ':';

    vdHelpers.addGroupTitleRO(
      vDevObj,
      genNames.vDevice,
      'debugTitle',
      '☢ ☢ Debug info ☢ ☢',
      '☢ ☢ Отладочная информация ☢ ☢'
    );

    if(lightDevices.length > 0) {
      vdHelpers.addGroupTitleRO(
        vDevObj,
        genNames.vDevice,
        'lightDevicesTitle',
        titlePrefix + 'Устройства освещения' + titlePostfix,
        titlePrefix + 'Light devices' + titlePostfix
      );
      addLinkedControlsArray(lightDevices, 'light_sensor');
    }

    if(motionSensors.length > 0) {
      vdHelpers.addGroupTitleRO(
        vDevObj,
        genNames.vDevice,
        'motionSensorsTitle',
        titlePrefix + 'Датчики движения' + titlePostfix,
        titlePrefix + 'Motion sensors' + titlePostfix
      );
      addLinkedControlsArray(motionSensors, 'motion_sensor');
    }

    if(openingSensors.length > 0) {
      vdHelpers.addGroupTitleRO(
        vDevObj,
        genNames.vDevice,
        'openingSensorsTitle',
        titlePrefix + 'Датчики открытия' + titlePostfix,
        titlePrefix + 'Opening sensors' + titlePostfix
      );
      addLinkedControlsArray(openingSensors, 'opening_sensor');
    }

    if(lightSwitches.length > 0) {
      vdHelpers.addGroupTitleRO(
        vDevObj,
        genNames.vDevice,
        'lightSwitchesTitle',
        titlePrefix + 'Выключатели света' + titlePostfix,
        titlePrefix + 'Light switches' + titlePostfix
      );
      addLinkedControlsArray(lightSwitches, 'light_switch');
    }
  }


  // Данный метод можно использовать только после инициализации
  // минимального виртуального устройства
  function setError(errorString) {
    log.error('ERROR Init: ' + errorString);
    vdHelpers.addAlarm(
      vDevObj,
      'processErrorAlarm',
      'Ошибка - смотрите лог',
      'Error - see log'
    );
  }

  /**Включение/выключение всех устройств в массиве согласно указанному типу поведения
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

      // log.debug('Control ' + curMqttTopicName + ' will updated to state: ' + newCtrlValue);
      dev[curMqttTopicName] = newCtrlValue;
      // log.debug('Control ' + curMqttTopicName + ' successfull updated');
    }
  }

  function resetLightOffTimer() {
    lightOffTimerId = null;
    dev[genNames.vDevice + '/curDisableLightTimerInSec'] = 0;
  }

  function resetLogicEnableTimer() {
    logicEnableTimerId = null;
    dev[genNames.vDevice + '/curDisabledLogicTimerInSec'] = 0;
  }

  // Функция обновления таймера:
  function setLightOffTimer(newDelayMs) {
    dev[genNames.vDevice + '/curDisableLightTimerInSec'] = newDelayMs / 1000;
    if (lightOffTimerId) {
      clearTimeout(lightOffTimerId);
    }
    // log.debug('Set new delay: ' + (newDelayMs / 1000) + ' sec and set new timer');
    lightOffTimerId = setTimeout(function () {
      // log.debug('No activity in the last ' + (newDelayMs / 1000) + ' sec, turn lights off');
      dev[genNames.vDevice + '/lightOn'] = false;
      resetLightOffTimer();
    }, newDelayMs);
  }

  function setLogicEnableTimer(newDelayMs) {
    dev[genNames.vDevice + '/curDisabledLogicTimerInSec'] =
      newDelayMs / 1000;
    if (logicEnableTimerId) {
      clearTimeout(logicEnableTimerId);
    }
    // log.debug('Set new delay: ' + (newDelayMs / 1000) + ' sec and set new timer');
    logicEnableTimerId = setTimeout(function () {
      // log.debug('No activity in the last ' + (newDelayMs / 1000) + ' sec, turn logic on');
      dev[genNames.vDevice + '/logicDisabledByWallSwitch'] = false;
      resetLogicEnableTimer();
    }, newDelayMs);
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
      if (newValue >= sensorWithBehavior.actionValue) {
        // log.debug('Motion start on sensor ' + sensorWithBehavior.mqttTopicName);
        sensorTriggered = true;
      } else if (newValue < sensorWithBehavior.actionValue) {
        // log.debug('Motion stop on sensor ' + sensorWithBehavior.mqttTopicName);
        sensorTriggered = false;
      }
    } else if (sensorWithBehavior.behaviorType === 'whenEnabled') {
      if (newValue === true) {
        // log.debug('Motion sensor type - bool');
        sensorTriggered = true;
      } else if (newValue === 'true') {
        // log.debug('Motion sensor type - string');
        sensorTriggered = true;
      } else if (newValue === false || newValue === 'false') {
        // log.debug('Motion sensor type correct and disabled');
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
   * Проверяет, активен ли датчик открытия (дверь открыта или закрыта) на основе поведения
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
   * Проверяет, все ли датчики открытия замкнуты (двери закрыты)
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

  function checkAllMotionSensorsInactive() {
    // Проверяем, все ли датчики движения находятся в пассивном состоянии
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

  // Обработчик выключения логики автоматики при использовании выключателя
  function logicDisabledCb(newValue) {
    if (lightOffTimerId) {
      clearTimeout(lightOffTimerId);
      resetLightOffTimer();
    }
    if (logicEnableTimerId) {
      clearTimeout(logicEnableTimerId);
      resetLogicEnableTimer();
    }
    if (newValue === true) {
      dev[genNames.vDevice + '/lightOn'] = true;
      setLightOffTimer(delayBlockAfterSwitch * 1000);
      setLogicEnableTimer(delayBlockAfterSwitch * 1000);
    } else {
      dev[genNames.vDevice + '/lightOn'] = false;
    }
  }

  function doorOpenCb(newValue) {
    if (newValue === true) {
      // log.debug('Minimum one door is open');
      dev[genNames.vDevice + '/lightOn'] = true;
      setLightOffTimer(delayByOpeningSensors * 1000);
    } else if (newValue === false) {
      // log.debug('All doors is close');
    } else {
      log.error('Door status - have not correct type');
    }
  }

  function lightOnCb(newValue) {
    if (newValue === true) {
      // log.debug('Light on');
      setValueAllDevicesByBehavior(lightDevices, true);
    } else if (newValue === false) {
      // log.debug('Light off');
      setValueAllDevicesByBehavior(lightDevices, false);
    } else {
      log.error('Light on - have not correct type');
    }
  }

  function lightSwitchUsedCb(newValue) {
    // Для выключателей считаем, что любое изменение (не важно какое)
    // - Меняет состояние переключателя отключения логики сценария
    // log.debug('Использован выключатель');
    var curValue = dev[genNames.vDevice + '/logicDisabledByWallSwitch'];
    dev[genNames.vDevice + '/logicDisabledByWallSwitch'] = !curValue;
  }

  function openingSensorTriggeredLaunchCb(newValue) {
    // Тригерит только изменение выбранное пользователем
    // log.debug('Opening detected on sensor ' + devName + '/' + cellName);
    // log.debug('Одна из дверей открыта');
    dev[genNames.vDevice + '/doorOpen'] = true;
  }

  function openingSensorTriggeredResetCb(newValue) {
    // Тригерит только противоположное действие
    // log.debug('Opening detected on sensor ' + devName + '/' + cellName);
    // log.debug('Одна из дверей закрыта');
    if (checkAllOpeningSensorsClose()) {
      // log.debug('~ All opening sensors inactive');
      dev[genNames.vDevice + '/doorOpen'] = false;
    } else {
      // log.debug('~ Some opening sensors are still active - do nothing');
    }
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
    // log.debug('~ Motion status changed');

    if (newValue === true) {
      // log.debug('~ Motion detected - enable light and remove old timer!');
      if (lightOffTimerId) {
        clearTimeout(lightOffTimerId);
      }
      resetLightOffTimer();
      dev[genNames.vDevice + '/lightOn'] = true;
    } else {
      // log.debug('~ Motion end detected - set timer for disable light!');
      setLightOffTimer(delayByMotionSensors * 1000);
    }
  }

  // Обработчик, вызываемый при срабатывании датчиков движения и открытия
  function sensorTriggeredHandler(newValue, devName, cellName, sensorType) {
    var isActive = dev[genNames.vDevice + '/active'];
    if (isActive === false) {
      // log.debug('Darkroom is disabled in virtual device - doing nothing');
      return true;
    }

    var isSwitchUsed = dev[genNames.vDevice + '/logicDisabledByWallSwitch'];
    if (isSwitchUsed === true) {
      // log.debug('Darkroom is disabled after used wall switch - doing nothing');
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
      var res = eventRegistry.processEvent(
        devName + '/' + cellName,
        newValue
      );
      log.debug('opening res = ' + JSON.stringify(res));
    }

    return true;
  }

  function switchTriggeredHandler(newValue, devName, cellName) {
    var res = eventRegistry.processEvent(devName + '/' + cellName, newValue);
    log.debug('switchTriggeredHandler res = ' + JSON.stringify(res));
  }

  function doorOpenHandler(newValue, devName, cellName) {
    var res = eventRegistry.processEvent(devName + '/' + cellName, newValue);
    log.debug('doorOpenHandler res = ' + JSON.stringify(res));
  }

  function lightOnHandler(newValue, devName, cellName) {
    eventRegistry.processEvent(devName + '/' + cellName, newValue);
  }

  function logicDisabledBySwitchHandler(newValue, devName, cellName) {
    eventRegistry.processEvent(devName + '/' + cellName, newValue);
  }
}

exports.init = function (
  idPrefix,
  deviceTitle,
  isDebugEnabled,
  delayByMotionSensors,
  delayByOpeningSensors,
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
    delayBlockAfterSwitch,
    lightDevices,
    motionSensors,
    openingSensors,
    lightSwitches
  );
  return res;
};
