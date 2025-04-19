/**
 * @file light-control.mod.js - module for WirenBoard wb-rules v2.28.4
 * @description Light‑control scenario class (extends ScenarioBase)
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

var ScenarioBase = require('scenario-base.mod').ScenarioBase;
var vdHelpers = require('virtual-device-helpers.mod');
var aTable = require('registry-action-resolvers.mod');
var Logger = require('logger.mod').Logger;

var log = new Logger('WBSC‑light');


var lastActionType = {
  NOT_USED       : 0, // Not used yet (set immediately after start)
  RULE_ON        : 1, // Scenario turned everything on
  RULE_OFF       : 2, // Scenario turned everything off
  EXT_ON         : 3, // Externally turned everything on
  EXT_OFF        : 4, // Externally turned everything off
  PARTIAL_EXT    : 5, // Partially changed by external actions
  PARTIAL_BY_RULE: 6  // Partially changed by Scenario
};

function LightControlScenario() { ScenarioBase.call(this); }
LightControlScenario.prototype = Object.create(ScenarioBase.prototype);
LightControlScenario.prototype.constructor = LightControlScenario;

LightControlScenario.prototype.generateNames = function (prefix) {
  var delimeter = '_';
  var scenarioPrefix = 'wbsc' + delimeter;
  var rulePrefix = 'wbru' + delimeter;
  var postfix = delimeter + prefix + delimeter;

  return {
    vDevice: scenarioPrefix + prefix,
    ruleLightDevsChange: rulePrefix + 'lightDevsChange' + postfix,
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
};

LightControlScenario.prototype.validateCfg = function (cfg) {
  var isAllArrays =
    Array.isArray(cfg.lightDevices) &&
    Array.isArray(cfg.motionSensors) &&
    Array.isArray(cfg.openingSensors) &&
    Array.isArray(cfg.lightSwitches);
  if (!isAllArrays) {
    log.error(
      'Light-control initialization error: cfg.lightDevices, cfg.motionSensors, cfg.openingSensors, and cfg.lightSwitches must be arrays'
    );
    return false;
  }

  var isAllDelayValid =
    cfg.delayByMotionSensors > 0 &&
    cfg.delayByOpeningSensors > 0 &&
    (cfg.isDelayEnabledAfterSwitch === false ||
      cfg.delayBlockAfterSwitch > 0);
  if (!isAllDelayValid) {
    // prettier-ignore
    var curDelays =
      '[' + cfg.delayByMotionSensors + '], ' +
      '[' + cfg.delayByOpeningSensors + '], ' +
      '[' + cfg.delayBlockAfterSwitch + ']';

    setTotalError('Invalid delay - must be a positive number ' + curDelays);
    return false;
  }

  var isLightDevicesEmpty = cfg.lightDevices.length === 0;
  if (isLightDevicesEmpty) {
    setTotalError(
      'Light-control initialization error: no light devices specified'
    );
    return false;
  }

  // Проверяем что хотябы один тип триггера заполнен
  var isAllTriggersEmpty =
    cfg.motionSensors.length === 0 &&
    cfg.openingSensors.length === 0 &&
    cfg.lightSwitches.length === 0;
  if (isAllTriggersEmpty) {
    setTotalError(
      'Light-control initialization error: no motion, ' +
        'opening sensors and wall switches specified'
    );
    return false;
  }

  // @todo: Добавить проверку типов контролов - чтобы не запускать init
  //        с типом датчика строка где обрабатывается только цифра

  return true;
};


/**
 * Инициализирует виртуальное устройство и определяет правило для управления
 * и автоматизацией в зависимости от пользовательских настроек
 *
 * @param {string} deviceTitle Имя виртуального девайса указанное
 *     пользователем
 * @param {string} cfg.idPrefix Префикс сценария, используемый для идентификации
 *     виртуального устройства и правила
 * @param {boolean} cfg.isDebugEnabled Включение дополнительного отображения
 *     состояния всех подключенных устройств в виртуальном девайсе
 * @param {number} cfg.delayByMotionSensors Задержка выключения света после
 *     срабатывания любого из датчиков движения (сек)
 * @param {number} cfg.delayByOpeningSensors Задержка выключения света после
 *     срабатывания любого из датчиков открытия (сек)
 * @param {boolean} cfg.isDelayEnabledAfterSwitch Включение/выключение наличия
 *     задержки после ручного нажатия выключателя:
 *     - false: Задержка не используется.
 *       Свет выкл и автоматизация вкл только при повторном нажатии
 *     - true: Активирует задержку.
 *       Свет выкл и автоматизация вкл автоматически через данное время
 * @param {number} cfg.delayBlockAfterSwitch Задержка (сек) блокировки логики
 *после ручного переключения света
 * @param {Array} cfg.lightDevices Массив управляемых устройств освещения
 * @param {Array} cfg.motionSensors Массив отслеживаемых контролов датчиков движения
 * @param {Array} cfg.openingSensors Массив отслеживаемых контролов датчиков открытия
 * @param {Array} cfg.lightSwitches Массив выключателей света
 * @returns {boolean} Результат инициализации (true, если успешно)
 */

LightControlScenario.prototype.initSpecific = function (deviceTitle, cfg) {

  // = = = = = = Init local context = = = = = =
  var self = this;
  var addRule = this.addRule.bind(this);
  var setTotalError = this.setTotalError.bind(this);

  var ruleActionInProgress = false;  // сценарий прямо сейчас меняет лампы
  var ruleTargetState = null;   // true ⇢ должны включиться, false ⇢ выключиться

  // Флаг нужный для того чтобы /lightOn не реагировал при синхронизации и не включал свою логику
  var syncingLightOn = false;  // true ⇒ мы сами синхронизируем индикатор

  var lightOffTimerId = null;
  var logicEnableTimerId = null;

  // = = = = = = Init logic = = = = = = 

  if (cfg.isDebugEnabled === true) {
    // Нужна задержка чтобы успели создаться все используемые нами девайсы
    // ДО того как мы будем создавать связь на них
    // Значение 100мс бывает мало, поэтому установлено 1000мс = 1с
    setTimeout(addAllLinkedDevicesToVd, 1000);
  } else {
    log.debug('Debug disabled and have value: "' + cfg.isDebugEnabled + '"');
  }

  log.debug('Start rules creation');
  addCustomCellsToVd();

  var lightDevTopics = extractMqttTopics(cfg.lightDevices);
  var motionTopics = extractMqttTopics(cfg.motionSensors);
  var openingTopics = extractMqttTopics(cfg.openingSensors);
  var switchTopics = extractMqttTopics(cfg.lightSwitches);
  var ruleName = '';
  
  ruleName = self.genNames.ruleLightDevsChange;
  var ruleIdLightDevsChange = defineRule(ruleName, {
    whenChanged: lightDevTopics,
    then: function (newValue, devName, cellName) {
      lightDevicesHandler(newValue, devName, cellName);
    },
  });
  if (!ruleIdLightDevsChange) {
    setTotalError('WB-rule "' + ruleName + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' + ruleIdLightDevsChange + '" was successfully created'
  );
  addRule(ruleIdLightDevsChange);

  tm.registerSingleEvent(
    self.genNames.vDevice + '/lastSwitchAction',
    'whenChange',
    lastSwitchActionCb
  );
  tm.registerSingleEvent(
    self.genNames.vDevice + '/logicDisabledByWallSwitch',
    'whenChange',
    logicDisabledCb
  );
  tm.registerSingleEvent(
    self.genNames.vDevice + '/doorOpen',
    'whenChange',
    doorOpenCb
  );
  tm.registerSingleEvent(
    self.genNames.vDevice + '/remainingTimeToLightOffInSec',
    'whenChange',
    remainingTimeToLightOffCb
  );
  tm.registerSingleEvent(
    self.genNames.vDevice + '/remainingTimeToLogicEnableInSec',
    'whenChange',
    remainingTimeToLogicEnableCb
  );
  tm.registerSingleEvent(
    self.genNames.vDevice + '/lightOn',
    'whenChange',
    lightOnCb
  );
  tm.registerMultipleEvents(
    switchTopics,
    'whenChange',
    lightSwitchUsedCb
  );

  /**
   * Для датчиков открытия пользователь может выбрать у каждого датчика
   * разную логику срабатывания - поэтому регистрируем два противоположных
   * обработчика.
   */
  tm.registerMultipleEventsWithBehaviorOpposite(
    cfg.openingSensors,
    openingSensorTriggeredLaunchCb,
    openingSensorTriggeredResetCb
  );

  tm.initRulesForAllTopics('light_control_rule_' + cfg.idPrefix);

  // Создаем правило для датчиков движения
  var ruleIdMotion = defineRule(self.genNames.ruleMotion, {
    whenChanged: motionTopics,
    then: function (newValue, devName, cellName) {
      sensorTriggeredHandler(newValue, devName, cellName, 'motion');
    },
  });
  if (!ruleIdMotion) {
    setTotalError('WB-rule "' + self.genNames.ruleMotion + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' + ruleIdMotion + '" was successfully created'
  );
  addRule(ruleIdMotion);

  // Создаем правило для датчиков открытия
  var ruleIdOpening = defineRule(self.genNames.ruleOpening, {
    whenChanged: openingTopics,
    then: function (newValue, devName, cellName) {
      sensorTriggeredHandler(newValue, devName, cellName, 'opening');
    },
  });
  if (!ruleIdOpening) {
    setTotalError('WB-rule "' + self.genNames.ruleOpening + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' + ruleIdOpening + '" was successfully created'
  );
  addRule(ruleIdOpening);

  // Создаем правило следящее за движением
  // Оно нужно для приведения всех датчиков движения к одному типу switch
  //   - Тип датчиков value приведется к типу switch
  //   - Тип датчиков switch не изменится
  var ruleIdMotionInProgress = defineRule(self.genNames.ruleMotionInProgress, {
    whenChanged: [self.genNames.vDevice + '/motionInProgress'],
    then: function (newValue, devName, cellName) {
      motionInProgressHandler(newValue, devName, cellName);
    },
  });
  if (!ruleIdMotionInProgress) {
    setTotalError('WB-rule "' + self.genNames.ruleMotionInProgress + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' +
      self.genNames.ruleMotionInProgress +
      '" was successfully created'
  );
  addRule(ruleIdMotionInProgress);

  // Правило следящее за изменением значения задержки до включения логики сценария
  var ruleIdRemainingTimeToLogicEnableInSec = defineRule(
    self.genNames.ruleRemainingTimeToLogicEnableInSec,
    {
      whenChanged: [self.genNames.vDevice + '/remainingTimeToLogicEnableInSec'],
      then: function (newValue, devName, cellName) {
        tm.processEvent(devName + '/' + cellName, newValue);
      },
    }
  );
  if (!ruleIdRemainingTimeToLogicEnableInSec) {
    setTotalError(
      'WB-rule "' +
        self.genNames.ruleRemainingTimeToLogicEnableInSec +
        '" not created'
    );
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' +
      self.genNames.ruleRemainingTimeToLogicEnableInSec +
      '" was successfully created'
  );
  addRule(ruleIdRemainingTimeToLogicEnableInSec);

  log.debug('Light-control initialization completed successfully');
  return true;

  // ======================================================
  //                  Определения функций
  // ======================================================

  function addCustomCellsToVd() {
      var controlCfg = {
        title: {
          en: 'Light off in',
          ru: 'Отключение света через',
        },
        units: 's',
        type: 'value',
        value: 0,
        forceDefault: true, // Always must start from 0
        readonly: true,
        order: 2,
      };
      self.vd.addControl('remainingTimeToLightOffInSec', controlCfg);

      controlCfg = {
        title: { en: 'Light on', ru: 'Освещение включено' },
        type: 'switch',
        value: false,
        readonly: true,
        order: 6,
      };
      self.vd.addControl('lightOn', controlCfg);

      controlCfg = {
        title: { en: 'Last switch action', ru: 'Тип последнего переключения' },
        type: 'value',
        readonly: true,
        forceDefault: true,   // always start from the default enum value
        value: lastActionType.NOT_USED,             // 0 = Not used
        enum: {
          // All operations done by the scenario itself
          0: { en: 'Not used',     ru: 'Не используется'      },
          1: { en: 'Rule turned ON',  ru: 'Сценарий включил'  },
          2: { en: 'Rule turned OFF', ru: 'Сценарий выключил' },
          // At least one lamp forced ON
          3: { en: 'Turn‑on externally',  ru: 'Включили извне'  },
          // All lamps forced OFF
          4: { en: 'Turn‑off externally', ru: 'Выключили извне' },
          // Mixed external states, minimum one lamp externaly changed
          5: { en: 'Partial external',    ru: 'Частично извне'  },
          6: { en: 'Partial by rule',     ru: 'Частично сценарий'},
        },
        order: 8,
      };
      self.vd.addControl('lastSwitchAction', controlCfg);

    // Условное добавление полей в зависимости от конфигурации
    if (cfg.motionSensors.length > 0) {
      controlCfg = {
        title: {
          en: 'Motion in progress',
          ru: 'Есть движение',
        },
        type: 'switch',
        value: false,
        readonly: true,
        order: 4,
      };
      self.vd.addControl('motionInProgress', controlCfg);
    }

    if (cfg.openingSensors.length > 0) {
      controlCfg = {
        title: {
          en: 'Door open',
          ru: 'Дверь открыта',
        },
        type: 'switch',
        value: false,
        readonly: true,
        order: 5,
      };
      self.vd.addControl('doorOpen', controlCfg);
    }

    if (cfg.lightSwitches.length > 0) {
      controlCfg = {
        title: {
          en: 'Automation activation in',
          ru: 'Активация автоматики через',
        },
        units: 's',
        type: 'value',
        value: 0,
        forceDefault: true, // Always must start from 0
        readonly: true,
        order: 3,
      };
      self.vd.addControl('remainingTimeToLogicEnableInSec', controlCfg);

      controlCfg = {
        title: {
          en: 'Disabled manually by switch',
          ru: 'Отключено ручным выключателем',
        },
        type: 'switch',
        value: false,
        forceDefault: true, // Always must start from disabled
        readonly: true,
        order: 7,
      };
      self.vd.addControl('logicDisabledByWallSwitch', controlCfg);
    }
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
        self.vd,
        self.genNames.vDevice,
        cellName,
        ''
      );
      if (!vdControlCreated) {
        setTotalError(
          'Failed to add ' + cellPrefix + ' ctrl for ' + curMqttControl
        );
      }
      log.debug('Success add ' + cellPrefix + ' ctrl for ' + curMqttControl);
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
    self.vd.addControl('curValDisableLightTimerInSec', {
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
    self.vd.addControl('curValDisabledLogicTimerInSec', {
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

    if (cfg.lightDevices.length > 0) {
      addLinkedControlsArray(cfg.lightDevices, 'light_device');
    }

    if (cfg.motionSensors.length > 0) {
      addLinkedControlsArray(cfg.motionSensors, 'motion_sensor');
    }

    if (cfg.openingSensors.length > 0) {
      addLinkedControlsArray(cfg.openingSensors, 'opening_sensor');
    }

    if (cfg.lightSwitches.length > 0) {
      addLinkedControlsArray(cfg.lightSwitches, 'light_switch');
    }
  }

  /**
   * Обновление содержашейся в контроле цифры оставшегося времени
   * до отключения света каждую секунду
   */
  function updateRemainingLightOffTime() {
    var remainingTime =
      dev[self.genNames.vDevice + '/remainingTimeToLightOffInSec'];
    if (remainingTime >= 1) {
      dev[self.genNames.vDevice + '/remainingTimeToLightOffInSec'] =
        remainingTime - 1;
    }
  }

  /**
   * Обновление содержашейся в контроле цифры оставшегося времени
   * до активации логики каждую секунду
   */
  function updateRemainingLogicEnableTime() {
    var remainingTime =
      dev[self.genNames.vDevice + '/remainingTimeToLogicEnableInSec'];
    if (remainingTime >= 1) {
      dev[self.genNames.vDevice + '/remainingTimeToLogicEnableInSec'] =
        remainingTime - 1;
    }
  }

  /**
   * Запуск таймера отключения света
   * @param {number} newDelayMs - Задержка в миллисекундах
   */
  function startLightOffTimer(newDelayMs) {
    var newDelaySec = newDelayMs / 1000;
    dev[self.genNames.vDevice + '/remainingTimeToLightOffInSec'] = newDelaySec;

    if (cfg.isDebugEnabled === true) {
      dev[self.genNames.vDevice + '/curValDisableLightTimerInSec'] = newDelaySec;
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
    dev[self.genNames.vDevice + '/remainingTimeToLogicEnableInSec'] = newDelaySec;

    if (cfg.isDebugEnabled === true) {
      dev[self.genNames.vDevice + '/curValDisabledLogicTimerInSec'] = newDelaySec;
    }
    // @note: Таймер автоматически запускает обратный отсчет при установке
    //        нового значения в контрол таймера
  }

  /**
   * Выключение освещения
   */
  function turnOffLightsByTimeout() {
    dev[self.genNames.vDevice + '/lightOn'] = false;
    resetLightOffTimer();
  }

  /**
   * Активация логики сценария
   */
  function enableLogicByTimeout() {
    dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'] = false;
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
    dev[self.genNames.vDevice + '/remainingTimeToLightOffInSec'] = 0;

    if (cfg.isDebugEnabled === true) {
      dev[self.genNames.vDevice + '/curValDisableLightTimerInSec'] = 0;
    }
  }

  function resetLogicEnableTimer() {
    logicEnableTimerId = null;
    dev[self.genNames.vDevice + '/remainingTimeToLogicEnableInSec'] = 0;

    if (cfg.isDebugEnabled === true) {
      dev[self.genNames.vDevice + '/curValDisabledLogicTimerInSec'] = 0;
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
        setTotalError('Motion sensor have not correct value: "' + newValue + '"');
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
    for (var i = 0; i < cfg.openingSensors.length; i++) {
      var curSensor = cfg.openingSensors[i];
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
    for (var i = 0; i < cfg.motionSensors.length; i++) {
      var curSensorState = dev[cfg.motionSensors[i].mqttTopicName];
      var isActive = isMotionSensorActiveByBehavior(
        cfg.motionSensors[i],
        curSensorState
      );
      if (isActive === true) {
        return false; // Если хотя бы один датчик активен, возвращаем false
      }
    }
    return true; // Все датчики пассивны
  }

  /**
   * Handler for any change coming from a lighting device
   *
   * @param {*} newValue New value of the changed device topic
   */
  function lightDevicesHandler(newValue, devName, cellName) {
    var internalLightStatus = dev[self.genNames.vDevice + '/lightOn'];
    /* -------- 1. Считаем фактическое состояние всей группы -------- */
    var onCnt = 0;
    for (var i = 0; i < cfg.lightDevices.length; i++) {
      if (dev[cfg.lightDevices[i].mqttTopicName] === true) {
        onCnt++;
      }
    }

    var allLightOn  = onCnt === cfg.lightDevices.length; // включены все
    var allLightOff = onCnt === 0;                       // выключены все
    var mixedState  = !allLightOn && !allLightOff;       // частично

    var isExternalChange = false;
    /* -------- 2. Обрабатываем действия, инициированные сценарием -------- */
    if (ruleActionInProgress && (newValue === internalLightStatus)) {
      // Если изменение инициировал сам сценарий — выходим
      //   - Лампа пришла в то же состояние, что и vd/lightOn
      //   - Значит, именно сценарий её только что переключил

      /* 2.1. Пока не достигнут итоговый результат → PARTIAL_BY_RULE */
      if (mixedState) {
        dev[self.genNames.vDevice + '/lastSwitchAction'] = lastActionType.PARTIAL_BY_RULE;
        return;  // ждём следующих изменений для завершения
      }
  
      /* 2.2. Итоговое состояние достигнуто */
      if (allLightOn  && ruleTargetState === true) {
        dev[self.genNames.vDevice + '/lastSwitchAction'] = lastActionType.RULE_ON;
      } else if (allLightOff && ruleTargetState === false) {
        dev[self.genNames.vDevice + '/lastSwitchAction'] = lastActionType.RULE_OFF;
      }
  

      /* 2.3. НЕ синхронизируем индикатор lightOn (он должен быть уже верен) */
      if (dev[self.genNames.vDevice + '/lightOn'] !== ruleTargetState) {
        log.error('Not correct logic!');
        syncingLightOn = true;
        dev[self.genNames.vDevice + '/lightOn'] = ruleTargetState;
        syncingLightOn = false;
      }

      // сценарий закончил переключение
      ruleActionInProgress = false;
      ruleTargetState      = null;
      return;
    }

    /* === 3. ВНЕШНЕЕ изменение === */

    isExternalChange = true;
    topicName = devName + '/' + cellName;
    log.debug('External change detected for device: "{}"' + topicName);
    log.debug('newValue: ' + newValue);


    if (newValue === false) {
      log.debug('External control detected: Minimum one light turn-OFF externally');
    } else if (newValue === true) {
      log.debug('External control detected: Minimum one light turn-ON externally');
    }


    /* 3.1. Определяем тип действия */
    if (mixedState) {
      dev[self.genNames.vDevice + '/lastSwitchAction'] = lastActionType.PARTIAL_EXT;
      // В «частичном» варианте lightOn НЕ меняем
    } else if (allLightOn) {
      dev[self.genNames.vDevice + '/lastSwitchAction'] = lastActionType.EXT_ON;

      /* --- синхронизируем топик lightOn (всё активировали) --- */
      if (dev[self.genNames.vDevice + '/lightOn'] !== true) {
        syncingLightOn = true;
        dev[self.genNames.vDevice + '/lightOn'] = true;
        syncingLightOn = false;
      }
    } else if (allLightOff) {
      dev[self.genNames.vDevice + '/lastSwitchAction'] = lastActionType.EXT_OFF;

      /* --- синхронизируем топик lightOn (всё отключили) --- */
      if (dev[self.genNames.vDevice + '/lightOn'] !== false) {
        syncingLightOn = true;
        dev[self.genNames.vDevice + '/lightOn'] = false;
        syncingLightOn = false;
      }
    }
    return;
  }


  function lastSwitchActionCb (topicObj /*, eventObj */) {
    var action = topicObj.val.new;
  
    /* --- 1. Внешне выключили все девайсы освещения --- */
    if (action === lastActionType.EXT_OFF) {
  
      /* 1.1. Сброс таймера света */
      if (lightOffTimerId) {
        clearTimeout(lightOffTimerId);
        resetLightOffTimer();
      }

      /* 1.2. Всегда сбрасываем таймер блокировки логики при внешнем выключении */
      if (logicEnableTimerId) {
        clearTimeout(logicEnableTimerId);
        resetLogicEnableTimer();
      }

      /* 1.3. Снимаем блокировку автоматизации */
      var logicBlocked = dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'];
      if (logicBlocked === true) {
        dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'] = false;
      }

      /* 1.2. Сброс таймера блокировки логики —
             ТОЛЬКО если логика НЕ отключена настенным выключателем */
      // var logicBlocked = dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'];
      // if (!logicBlocked && logicEnableTimerId) {
      //   clearTimeout(logicEnableTimerId);
      //   resetLogicEnableTimer();
      // }
  
      /* 1.4. Обнуляем флаг движения, чтобы новое движение снова включило свет */
      if (dev[self.genNames.vDevice + '/motionInProgress'] === true) {
        dev[self.genNames.vDevice + '/motionInProgress'] = false;
      }

      /* 1.5. Синхронизуем индикатор lightOn, если нужно */
      if (dev[self.genNames.vDevice + '/lightOn'] !== false) {
        syncingLightOn = true;
        dev[self.genNames.vDevice + '/lightOn'] = false;
        syncingLightOn = false;
      }

    //   /* ==== НОВЫЙ БЛОК: движение есть, свет погасили ==== */
    //   if (dev[self.genNames.vDevice + '/motionInProgress'] === true &&
    //     dev[self.genNames.vDevice + '/lightOn']            === false) {

    //   log.debug('EXT_OFF during motion → restart automation');

    //   /* 1. Помечаем, что сценарий вновь включает свет */
    //   ruleActionInProgress = true;
    //   ruleTargetState      = true;

    //   /* 2. Включаем все лампы */
    //   setValueAllDevicesByBehavior(cfg.lightDevices, true);

    //   /* 3. Запускаем таймер авто‑выключения,
    //         как при обычном срабатывании движения */
    //   startLightOffTimer(cfg.delayByMotionSensors * 1000);
    // }


      return true;
    }
  
    /* --- 2. Внешне ВКЛЮЧИЛИ всё --- */
    if (action === lastActionType.EXT_ON) {
  
      /* 2.1. Если правило активно и автоматика разрешена — запускаем таймер
         такой же, как при срабатывании датчика движения              */
      var isRuleEnabled = dev[self.genNames.vDevice + '/rule_enabled'];
      var isLogicBlocked = dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'];
      var motionNow = dev[self.genNames.vDevice + '/motionInProgress'];
      /* --- 0. Если это настенный выключатель (logicBlocked=true) ---
             оставляем ТАЙМЕРЫ, расставленные logicDisabledCb, нетронутыми */
      if (isLogicBlocked) {
        log.debug('lastSwitchActionCb: detected wall switch');
        startLightOffTimer   (cfg.delayBlockAfterSwitch * 1000);
        startLogicEnableTimer(cfg.delayBlockAfterSwitch * 1000);
        return true;          // → выходим, ничего не трогаем
      }
      // if (isRuleEnabled && !isLogicBlocked) {
      //   /* Свет уже горит, поэтому просто заводим «таймер погашения» */
      //   startLightOffTimer(cfg.delayByMotionSensors * 1000);
      // }
  
      /*   ─ Запускаем таймер ТОЛЬКО если
             – правило активно,
             – автоматика не заблокирована,
             – в момент включения ОБНАРУЖЕНО движение.            */
      /* 1. Автоматическое гашение, когда свет включили извне во время движения */
      if (isRuleEnabled && motionNow === true) {
        startLightOffTimer(cfg.delayByMotionSensors * 1000);
      } else {
          /* Если таймер случайно был запущен раньше — сбросим,
             чтобы не погасить свет вручную.                     */
          if (lightOffTimerId) {
              clearTimeout(lightOffTimerId);
              resetLightOffTimer();
          }
      }

      return true;
    }
  
    /* --- 3. Иные значения не требуют реакции --- */
    return true;
  }
  

  /**
   * Обработчик выключения логики автоматики при использовании выключателя
   *
   * @param {boolean} topicObj.val.new Новое значение состояния логики:
   *     true - включает логику и запускает таймеры (если разрешено)
   *     false - выключает логику и отключает свет.
   * @returns {boolean} Callback возвращает true при успехе
   */
  function logicDisabledCb(topicObj, eventObj) {
    if (lightOffTimerId) {
      clearTimeout(lightOffTimerId);
      resetLightOffTimer();
    }
    if (logicEnableTimerId) {
      clearTimeout(logicEnableTimerId);
      resetLogicEnableTimer();
    }

    if (topicObj.val.new === false) {
      dev[self.genNames.vDevice + '/lightOn'] = false;
      return true;
    }

    // Если значение true, включаем свет
    dev[self.genNames.vDevice + '/lightOn'] = true;
    if (cfg.isDelayEnabledAfterSwitch === true) {
      startLightOffTimer(cfg.delayBlockAfterSwitch * 1000);
      startLogicEnableTimer(cfg.delayBlockAfterSwitch * 1000);
    }
    return true;
  }

  function doorOpenCb(topicObj, eventObj) {
    var isDoorOpened = topicObj.val.new === true;
    var isDoorClosed = topicObj.val.new === false;

    if (isDoorOpened) {
      dev[self.genNames.vDevice + '/lightOn'] = true;
      startLightOffTimer(cfg.delayByOpeningSensors * 1000);
    } else if (isDoorClosed) {
      // Do nothing
    } else {
      log.error('Door status - have not correct type: {}', topicObj.val.new);
    }

    return true;
  }

  function lightOnCb(topicObj, eventObj) {
    /* Не реагируем, если это мы сами обновили индикатор */
    if (syncingLightOn) return true;

    var isLightSwitchedOn = topicObj.val.new === true;
    var isLightSwitchedOff = topicObj.val.new === false;

    if (isLightSwitchedOn) {
      ruleActionInProgress = true;
      ruleTargetState      = true;
      setValueAllDevicesByBehavior(cfg.lightDevices, true);
    } else if (isLightSwitchedOff) {
      ruleActionInProgress = true;
      ruleTargetState      = false;
      setValueAllDevicesByBehavior(cfg.lightDevices, false);
    } else {
      log.error('Light on - have not correct type: {}', topicObj.val.new);
    }

    return true;
  }

  function remainingTimeToLightOffCb(topicObj, eventObj) {
    /**
     * Значение таймера отключения света может стать нулем в двух случаях:
     * 1 - Таймер дошел до конца без новых внешних воздействи
     * 2 - Таймер был обнулен так как движение снова появилось
     */
    var curMotionStatus = dev[self.genNames.vDevice + '/motionInProgress'];
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
      log.error(
        'Remaining time to light enable: have not correct value:' +
          topicObj.val.new
      );
    }

    return true;
  }

  function remainingTimeToLogicEnableCb(topicObj, eventObj) {
    if (topicObj.val.new === 0) {
      enableLogicByTimeout();
    } else if (topicObj.val.new >= 1) {
      // Recharge timer
      if (logicEnableTimerId) {
        clearTimeout(logicEnableTimerId);
      }
      logicEnableTimerId = setTimeout(updateRemainingLogicEnableTime, 1000);
    } else {
      log.error(
        'Remaining time to logic enable: have not correct value:' +
          topicObj.val.new
      );
    }

    return true;
  }

  function lightSwitchUsedCb(topicObj, eventObj) {
    // Для выключателей считаем, что любое изменение (не важно какое)
    // - Меняет состояние переключателя отключения логики сценария
    var curValue = dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'];
    dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'] = !curValue;

    return true;
  }

  function openingSensorTriggeredLaunchCb(topicObj, eventObj) {
    // Тригерит только изменение выбранное пользователем
    dev[self.genNames.vDevice + '/doorOpen'] = true;

    return true;
  }

  function openingSensorTriggeredResetCb(topicObj, eventObj) {
    // Тригерит только противоположное действие
    if (checkAllOpeningSensorsClose()) {
      dev[self.genNames.vDevice + '/doorOpen'] = false;
    } else {
      // Если некоторые двери еще открыты - то ничего не делаем
    }

    return true;
  }

  //Извлечение имен контролов (mqttTopicName) из массива
  function extractMqttTopics(devices) {
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
    var isMotionDetected = newValue === true;

    if (isMotionDetected) {
      if (lightOffTimerId) {
        clearTimeout(lightOffTimerId);
      }
      resetLightOffTimer();
      dev[self.genNames.vDevice + '/lightOn'] = true;
    } else {
      // Detected motion end
      startLightOffTimer(cfg.delayByMotionSensors * 1000);
    }
  }

  // Обработчик, вызываемый при срабатывании датчиков движения и открытия
  function sensorTriggeredHandler(newValue, devName, cellName, sensorType) {
    var isRuleActive = dev[self.genNames.vDevice + '/rule_enabled'];

    if (isRuleActive === false) {
      // log.debug('Light-control is disabled in virtual device - doing nothing');
      return true;
    }

    var isSwitchUsed = dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'];
    if (isSwitchUsed === true) {
      // log.debug('Light-control is disabled after used wall switch - doing nothing');
      return true;
    }

    if (sensorType === 'motion') {
      // Найдем сенсор в списке по cellName
      var matchedSensor = null;
      for (var i = 0; i < cfg.motionSensors.length; i++) {
        if (
          cfg.motionSensors[i].mqttTopicName ===
          devName + '/' + cellName
        ) {
          matchedSensor = cfg.motionSensors[i];
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
        dev[self.genNames.vDevice + '/motionInProgress'] = true;
      } else if (sensorTriggered === false) {
        if (checkAllMotionSensorsInactive()) {
          // log.debug('~ All motion sensors inactive');
          dev[self.genNames.vDevice + '/motionInProgress'] = false;
        } else {
          // log.debug('~ Some motion sensors are still active - keeping lights on');
        }
      }
    }

    if (sensorType === 'opening') {
      var res = tm.processEvent(devName + '/' + cellName, newValue);
      log.debug('opening res = ' + JSON.stringify(res));
    }

    return true;
  }
}

exports.LightControlScenario = LightControlScenario;
