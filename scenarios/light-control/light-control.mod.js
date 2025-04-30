/**
 * @file light-control.mod.js - ES5 module for wb-rules v2.28
 * @description Light control scenario class that extends ScenarioBase
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var vdHelpers = require('virtual-device-helpers.mod');
var aTable = require('registry-action-resolvers.mod');
var Logger = require('logger.mod').Logger;
var extractMqttTopics =
  require('scenarios-general-helpers.mod').extractMqttTopics;

var loggerFileLabel = 'WBSC-light-control-mod';
var log = new Logger(loggerFileLabel);

/**
 * Enum for tracking the last action type in the light control system
 * @enum {number}
 */
var lastActionType = {
  NOT_USED: 0, // Not used yet (set immediately after start)
  SCENARIO_ON: 1, // Scenario turned everything on
  SCENARIO_OFF: 2, // Scenario turned everything off
  EXT_ON: 3, // Externally turned everything on
  EXT_OFF: 4, // Externally turned everything off
  PARTIAL_EXT: 5, // Partially changed by external actions
  PARTIAL_BY_SCENARIO: 6, // Partially changed by Scenario
};

/**
 * @typedef {Object} LightControlConfig
 * @property {string} [idPrefix] - Optional prefix for scenario identification
 *   If not provided, it will be generated from the scenario name
 * @property {Array<Object>} lightDevices - Array of light devices to control
 * @property {Array<Object>} motionSensors - Array of motion sensors
 * @property {Array<Object>} openingSensors - Array of opening sensors
 * @property {Array<Object>} lightSwitches - Array of manual light switches
 * @property {boolean} [isDebugEnabled] - Enable debug mode with extra VD ctrl
 * @property {number} [delayByMotionSensors] - Delay (s) before turning off
 *   lights after motion stops
 * @property {number} [delayByOpeningSensors] - Delay (s) before turning off
 *   lights after door closes
 * @property {boolean} [isDelayEnabledAfterSwitch] - Enable auto-off delay
 *   after manual switch usage
 * @property {number} [delayBlockAfterSwitch] - Delay (s) before automation
 *   resumes after manual control
 */

/**
 * Light control scenario implementation
 * @class LightControlScenario
 * @extends ScenarioBase
 */
function LightControlScenario() {
  ScenarioBase.call(this);

  /**
   * Context object for storing scenario runtime state
   * @type {Object}
   */
  this.ctx = {
    scenarioActionInProgress: false, // scenario is currently changing lights
    scenarioTargetState: null, // true → should turn on, false → turn off
    syncingLightOn: false, // flag to prevent recursion when syncing lightOn
    lightOffTimerId: null, // timer ID for turning off lights
    logicEnableTimerId: null, // timer ID for re-enabling automation logic
  };
}
LightControlScenario.prototype = Object.create(ScenarioBase.prototype);
LightControlScenario.prototype.constructor = LightControlScenario;

/**
 * Generates name identifiers for virtual device and rules
 * @param {string} idPrefix - ID prefix for this scenario instance
 * @returns {Object} Generated names
 */
LightControlScenario.prototype.generateNames = function (idPrefix) {
  var scenarioPrefix = 'wbsc_';
  var baseRuleName = scenarioPrefix + idPrefix + '_';

  // prettier-ignore
  return {
    vDevice: scenarioPrefix + idPrefix,
    ruleLightDevsChange: baseRuleName + 'lightDevsChange',
    ruleLastSwitchActionChange: baseRuleName + 'lastSwitchActionChange',
    ruleLogicDisabledChange: baseRuleName + 'logicDisabledChange',
    ruleDoorOpenChange: baseRuleName + 'doorOpenChange',
    ruleMotion: baseRuleName + 'motion',
    ruleTimeToLightOffChange: baseRuleName + 'remainingTimeToLightOffChange',
    ruleTimeToLogicEnableChange: baseRuleName + 'remainingTimeToLogicEnableChange',
    ruleLightOnChange: baseRuleName + 'lightOnChange',
    ruleLightSwitchUsed: baseRuleName + 'lightSwitchUsed',
    ruleOpeningSensorsChange: baseRuleName + 'openingSensorsChange',
    ruleMotionInProgress: baseRuleName + 'motionInProgress',
    ruleLogicDisabledByWallSwitch: baseRuleName + 'logicDisabledByWallSwitch',
  };
};

/**
 * Get configuration for waiting for controls
 *
 * @param {Object} cfg Configuration object
 * @returns {Object} Waiting configuration object or empty object for no wait
 */
LightControlScenario.prototype.defineControlsWaitConfig = function (cfg) {
  var lightDevTopics = extractMqttTopics(cfg.lightDevices || []);
  var motionTopics = extractMqttTopics(cfg.motionSensors || []);
  var openingTopics = extractMqttTopics(cfg.openingSensors || []);
  var switchTopics = extractMqttTopics(cfg.lightSwitches || []);

  var allTopics = [].concat(
    lightDevTopics,
    motionTopics,
    openingTopics,
    switchTopics
  );
  return { controls: allTopics };
};

/**
 * Configuration validation
 * @param {LightControlConfig} cfg - Configuration object
 * @returns {boolean} True if configuration is valid, false otherwise
 */
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

    log.error('Invalid delay - must be a positive number ' + curDelays);
    return false;
  }

  var isLightDevicesEmpty = cfg.lightDevices.length === 0;
  if (isLightDevicesEmpty) {
    log.error(
      'Light-control initialization error: no light devices specified'
    );
    return false;
  }

  // Check that at least one trigger type is specified
  var isAllTriggersEmpty =
    cfg.motionSensors.length === 0 &&
    cfg.openingSensors.length === 0 &&
    cfg.lightSwitches.length === 0;
  if (isAllTriggersEmpty) {
    log.error(
      'Light-control initialization error: no motion, ' +
        'opening sensors and wall switches specified'
    );
    return false;
  }

  return true;
};

/**
 * Adds required controls to the virtual device
 * @param {Object} self - Reference to the LightControlScenario instance
 * @param {Object} cfg - Configuration object
 */
function addCustomControlsToVirtualDevice(self, cfg) {
  // Add basic lightOn control
  self.vd.devObj.addControl('lightOn', {
    title: {
      en: 'Light On',
      ru: 'Освещение включено',
    },
    type: 'switch',
    value: false,
    readonly: true,
    order: 6,
  });

  // Add timer for light off countdown
  self.vd.devObj.addControl('remainingTimeToLightOffInSec', {
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
  });

  // Conditional controls based on configuration
  if (cfg.motionSensors.length > 0) {
    self.vd.devObj.addControl('motionInProgress', {
      title: {
        en: 'Motion in progress',
        ru: 'Есть движение',
      },
      type: 'switch',
      value: false,
      readonly: true,
      order: 4,
    });
  }

  if (cfg.openingSensors.length > 0) {
    self.vd.devObj.addControl('doorOpen', {
      title: {
        en: 'Door open',
        ru: 'Дверь открыта',
      },
      type: 'switch',
      value: false,
      readonly: true,
      order: 5,
    });
  }

  if (cfg.lightSwitches.length > 0) {
    self.vd.devObj.addControl('remainingTimeToLogicEnableInSec', {
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
    });

    self.vd.devObj.addControl('logicDisabledByWallSwitch', {
      title: {
        en: 'Disabled manually by switch',
        ru: 'Отключено ручным выключателем',
      },
      type: 'switch',
      value: false,
      forceDefault: true, // Always must start from disabled
      readonly: true,
      order: 7,
    });
  }

  // Add last switch action tracker
  self.vd.devObj.addControl('lastSwitchAction', {
    title: {
      en: 'Last switch action',
      ru: 'Тип последнего переключения',
    },
    type: 'value',
    readonly: true,
    forceDefault: true, // always start from the default enum value
    value: lastActionType.NOT_USED,
    enum: {
      // All operations done by the scenario itself
      0: { en: 'No actions yet', ru: 'Нет операций' },
      1: { en: 'Turned ON by scenario', ru: 'Включено сценарием' },
      2: { en: 'Turned OFF by scenario', ru: 'Выключено сценарием' },
      // At least one lamp forced ON
      3: { en: 'Turned ON externally', ru: 'Включено извне' },
      // All lamps forced OFF
      4: { en: 'Turned OFF externally', ru: 'Выключено извне' },
      // Mixed external states, minimum one lamp externaly changed
      5: {
        en: 'Partially changed externally',
        ru: 'Частично изменено извне',
      },
      6: {
        en: 'Partially changed by scenario',
        ru: 'Частично изменено сценарием',
      },
    },
    order: 8,
  });
}

/**
 * Adds all linked device controls to the virtual device for debugging
 * @param {Object} self - Reference to the LightControlScenario instance
 * @param {Object} cfg - Configuration object
 */
function addAllLinkedDevicesToVd(self, cfg) {
  if (cfg.lightDevices.length > 0) {
    addLinkedControlsArray(self, cfg.lightDevices, 'light_device');
  }

  if (cfg.motionSensors.length > 0) {
    addLinkedControlsArray(self, cfg.motionSensors, 'motion_sensor');
  }

  if (cfg.openingSensors.length > 0) {
    addLinkedControlsArray(self, cfg.openingSensors, 'opening_sensor');
  }

  if (cfg.lightSwitches.length > 0) {
    addLinkedControlsArray(self, cfg.lightSwitches, 'light_switch');
  }
}

/**
 * Adds an array of linked controls to the virtual device
 * @param {Object} self - Reference to the LightControlScenario instance
 * @param {Array} arrayOfControls - Array of controls to link
 * @param {string} cellPrefix - Prefix for control names in the virtual device
 */
function addLinkedControlsArray(self, arrayOfControls, cellPrefix) {
  for (var i = 0; i < arrayOfControls.length; i++) {
    var curMqttControl = arrayOfControls[i].mqttTopicName;
    var cellName = cellPrefix + '_' + i;
    var vdControlCreated = vdHelpers.addLinkedControlRO(
      curMqttControl,
      self.vd.devObj,
      self.genNames.vDevice,
      cellName,
      ''
    );
    if (!vdControlCreated) {
      log.error(
        'Failed to add ' + cellPrefix + ' ctrl for ' + curMqttControl
      );
    }
    log.debug('Success add ' + cellPrefix + ' ctrl for ' + curMqttControl);
  }
}

/**
 * Updates the remaining time to light off each second
 * @param {Object} self - Reference to the LightControlScenario instance
 */
function updateRemainingLightOffTime(self) {
  var remainingTime =
    dev[self.genNames.vDevice + '/remainingTimeToLightOffInSec'];
  if (remainingTime >= 1) {
    dev[self.genNames.vDevice + '/remainingTimeToLightOffInSec'] =
      remainingTime - 1;
  }
}

/**
 * Updates the remaining time to logic enable each second
 * @param {Object} self - Reference to the LightControlScenario instance
 */
function updateRemainingLogicEnableTime(self) {
  var remainingTime =
    dev[self.genNames.vDevice + '/remainingTimeToLogicEnableInSec'];
  if (remainingTime >= 1) {
    dev[self.genNames.vDevice + '/remainingTimeToLogicEnableInSec'] =
      remainingTime - 1;
  }
}

/**
 * Starts the light off timer
 * @param {Object} self - Reference to the LightControlScenario instance
 * @param {number} newDelayMs - Delay in milliseconds
 */
function startLightOffTimer(self, newDelayMs) {
  var newDelaySec = newDelayMs / 1000;
  dev[self.genNames.vDevice + '/remainingTimeToLightOffInSec'] = newDelaySec;
  // Timer automatically starts countdown when a new value is set
}

/**
 * Starts the logic enable timer
 * @param {Object} self - Reference to the LightControlScenario instance
 * @param {number} newDelayMs - Delay in milliseconds
 */
function startLogicEnableTimer(self, newDelayMs) {
  var newDelaySec = newDelayMs / 1000;
  dev[self.genNames.vDevice + '/remainingTimeToLogicEnableInSec'] =
    newDelaySec;
  // Timer automatically starts countdown when a new value is set
}

/**
 * Turns off the lights by timeout
 * @param {Object} self - Reference to the LightControlScenario instance
 */
function turnOffLightsByTimeout(self) {
  dev[self.genNames.vDevice + '/lightOn'] = false;
  resetLightOffTimer(self);
}

/**
 * Enables logic by timeout
 * @param {Object} self - Reference to the LightControlScenario instance
 */
function enableLogicByTimeout(self) {
  dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'] = false;
  resetLogicEnableTimer(self);
}

/**
 * Resets the light off timer
 * @param {Object} self - Reference to the LightControlScenario instance
 */
function resetLightOffTimer(self) {
  self.ctx.lightOffTimerId = null;
  dev[self.genNames.vDevice + '/remainingTimeToLightOffInSec'] = 0;
}

/**
 * Resets the logic enable timer
 * @param {Object} self - Reference to the LightControlScenario instance
 */
function resetLogicEnableTimer(self) {
  self.ctx.logicEnableTimerId = null;
  dev[self.genNames.vDevice + '/remainingTimeToLogicEnableInSec'] = 0;
}

/**
 * Sets values for all devices based on behavior type
 * @param {Array} actionControlsArr - Array of controls with behavior type and values
 * @param {boolean} state - State to apply (true - allow, false - reset)
 */
function setValueAllDevicesByBehavior(actionControlsArr, state) {
  for (var i = 0; i < actionControlsArr.length; i++) {
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

/**
 * @typedef {Object} SensorConfig
 * @property {string} mqttTopicName - MQTT topic name for the sensor
 * @property {string} behaviorType - Sensor behavior type
 *   - whenEnabled
 *   - whenDisabled
 * @property {string} [description] - Optional description of the sensor
 */

/**
 * Finds configuration for topic name in the specified configuration array
 * @param {string} topicName - Topic name to search for
 * @param {SensorConfig[]} configArray - Array of configurations to search in
 * @returns {SensorConfig|null} Found topic configuration or null if not found
 */
function findTopicConfig(topicName, configArray) {
  if (!configArray || !Array.isArray(configArray)) {
    log.error(
      'Invalid config array provided for topic search: ' + topicName
    );
    return null;
  }

  for (var i = 0; i < configArray.length; i++) {
    if (configArray[i].mqttTopicName === topicName) {
      return configArray[i];
    }
  }

  log.error('Cannot find config for topic: "{}"', topicName);
  return null;
}

/**
 * Checks if a motion sensor is active based on its behavior type
 * @param {SensorConfig} sensorWithBehavior - Sensor object with behavior type
 * @param {any} newValue - Current sensor value
 * @returns {boolean} isSensorTriggered - Shows if sensor is activated:
 *   - True if sensor is active
 *   - False otherwise
 */
function isMotionSensorActiveByBehavior(sensorWithBehavior, newValue) {
  if (sensorWithBehavior.behaviorType === 'whileValueHigherThanThreshold') {
    return newValue >= sensorWithBehavior.actionValue;
  }

  if (sensorWithBehavior.behaviorType === 'whenEnabled') {
    if (newValue === true || newValue === 'true') {
      return true;
    }

    if (newValue === false || newValue === 'false') {
      return false;
    }

    throw new Error('Motion sensor has incorrect value: "' + newValue + '"');
  }

  throw new Error(
    'Unknown behavior type for sensor: ' + sensorWithBehavior.mqttTopicName
  );
}

/**
 * Checks if an opening sensor is triggered
 * @param {SensorConfig} sensorWithBehavior - Sensor object with behavior type
 * @param {boolean|string} newValue - Current sensor value
 * @returns {boolean} Triggered status based on behavior type
 *   - true if sensor is triggered (door is open)
 *   - false otherwise
 */
function isOpeningSensorOpenedByBehavior(sensorWithBehavior, newValue) {
  if (sensorWithBehavior.behaviorType === 'whenDisabled') {
    /**
     * Normally closed sensor:
     *   - When door is closed - normal state is true
     *   - When door is open - disconnected, state is false
     */
    return newValue === false || newValue === 'false';
  }

  if (sensorWithBehavior.behaviorType === 'whenEnabled') {
    /**
     * Normally open sensor:
     *   - When door is closed - normal state is false
     *   - When door is open - connected, state is true
     */
    return newValue === true || newValue === 'true';
  }

  throw new Error(
    'Unknown behavior type for sensor: ' + sensorWithBehavior.mqttTopicName
  );
}

/**
 * Checks if all opening sensors are closed (doors are closed)
 * @param {Array<Object>} openingSensors - Array of opening sensor configs
 * @returns {boolean} Complex status for all sensors:
 *   - true if all sensors show that doors are closed
 *   - false otherwise
 */
function checkAllOpeningSensorsClose(openingSensors) {
  for (var i = 0; i < openingSensors.length; i++) {
    var curSensorState = dev[openingSensors[i].mqttTopicName];
    var isOpen = isOpeningSensorOpenedByBehavior(
      openingSensors[i],
      curSensorState
    );
    if (isOpen === true) {
      return false; // Least one sensor is active (door is open)
    }
  }
  return true; // All sensors are passive (doors are closed)
}

/**
 * Checks if all motion sensors are inactive
 * @param {Array<Object>} motionSensors - Array of motion sensor configurations
 * @returns {boolean} Complex status for all sensors:
 *   - true if all sensors show no motion is detected
 *   - false otherwise
 */
function checkAllMotionSensorsInactive(motionSensors) {
  for (var i = 0; i < motionSensors.length; i++) {
    var curSensorState = dev[motionSensors[i].mqttTopicName];
    var isActive = isMotionSensorActiveByBehavior(
      motionSensors[i],
      curSensorState
    );
    if (isActive === true) {
      return false; // Least one sensor is active
    }
  }
  return true; // All sensors are inactive
}

/**
 * Creates all required rules for the light control scenario
 * @param {Object} self - Reference to the LightControlScenario instance
 * @param {Object} cfg - Configuration object
 * @returns {boolean} True if rules created successfully, false otherwise
 */
function createRules(self, cfg) {
  var lightDevTopics = extractMqttTopics(cfg.lightDevices);
  var motionTopics = extractMqttTopics(cfg.motionSensors);
  var openingTopics = extractMqttTopics(cfg.openingSensors);
  var switchTopics = extractMqttTopics(cfg.lightSwitches);

  // Rule for motion sensors
  var ruleIdMotion = defineRule(self.genNames.ruleMotion, {
    whenChanged: motionTopics,
    then: function (newValue, devName, cellName) {
      motionSensorHandler(self, newValue, devName, cellName);
    },
  });
  if (!ruleIdMotion) {
    log.error('WB-rule "' + self.genNames.ruleMotion + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' + ruleIdMotion + '" was successfully created'
  );
  self.addRule(ruleIdMotion);

  // Rule for motion in progress
  var ruleIdMotionInProgress = defineRule(
    self.genNames.ruleMotionInProgress,
    {
      whenChanged: [self.genNames.vDevice + '/motionInProgress'],
      then: function (newValue, devName, cellName) {
        motionInProgressHandler(self, newValue, devName, cellName);
      },
    }
  );
  if (!ruleIdMotionInProgress) {
    log.error(
      'WB-rule "' + self.genNames.ruleMotionInProgress + '" not created'
    );
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' +
      ruleIdMotionInProgress +
      '" was successfully created'
  );
  self.addRule(ruleIdMotionInProgress);

  // Rule for remaining time to light off changes
  ruleName = self.genNames.ruleTimeToLightOffChange;
  var ruleIdRemainingTimeToLightOff = defineRule(ruleName, {
    whenChanged: self.genNames.vDevice + '/remainingTimeToLightOffInSec',
    then: function (newValue, devName, cellName) {
      remainingTimeToLightOffHandler(self, newValue, devName, cellName);
    },
  });
  if (!ruleIdRemainingTimeToLightOff) {
    log.error('WB-rule "' + ruleName + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' +
      ruleIdRemainingTimeToLightOff +
      '" was successfully created'
  );
  self.addRule(ruleIdRemainingTimeToLightOff);

  // Rule for light on changes
  ruleName = self.genNames.ruleLightOnChange;
  var ruleIdLightOnChange = defineRule(ruleName, {
    whenChanged: self.genNames.vDevice + '/lightOn',
    then: function (newValue, devName, cellName) {
      lightOnHandler(self, newValue, devName, cellName);
    },
  });
  if (!ruleIdLightOnChange) {
    log.error('WB-rule "' + ruleName + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' +
      ruleIdLightOnChange +
      '" was successfully created'
  );
  self.addRule(ruleIdLightOnChange);

  // Rule for opening sensors changes
  ruleName = self.genNames.ruleOpeningSensorsChange;
  var ruleIdOpeningSensorsChange = defineRule(ruleName, {
    whenChanged: openingTopics,
    then: function (newValue, devName, cellName) {
      openingSensorHandler(self, newValue, devName, cellName);
    },
  });
  if (!ruleIdOpeningSensorsChange) {
    log.error('WB-rule "' + ruleName + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' +
      ruleIdOpeningSensorsChange +
      '" was successfully created'
  );
  self.addRule(ruleIdOpeningSensorsChange);

  // Rule for light switch used
  ruleName = self.genNames.ruleLightSwitchUsed;
  var ruleIdLightSwitchUsed = defineRule(ruleName, {
    whenChanged: switchTopics,
    then: function (newValue, devName, cellName) {
      lightSwitchUsedHandler(self, newValue, devName, cellName);
    },
  });
  if (!ruleIdLightSwitchUsed) {
    log.error('WB-rule "' + ruleName + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' +
      ruleIdLightSwitchUsed +
      '" was successfully created'
  );
  self.addRule(ruleIdLightSwitchUsed);

  // Rule for remaining time to logic enable changes
  ruleName = self.genNames.ruleTimeToLogicEnableChange;
  var ruleIdRemainingTimeToLogicEnableChange = defineRule(ruleName, {
    whenChanged: self.genNames.vDevice + '/remainingTimeToLogicEnableInSec',
    then: function (newValue, devName, cellName) {
      remainingTimeToLogicEnableHandler(self, newValue, devName, cellName);
    },
  });
  if (!ruleIdRemainingTimeToLogicEnableChange) {
    log.error('WB-rule "' + ruleName + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' +
      ruleIdRemainingTimeToLogicEnableChange +
      '" was successfully created'
  );
  self.addRule(ruleIdRemainingTimeToLogicEnableChange);

  // Rule for door open changes
  ruleName = self.genNames.ruleDoorOpenChange;
  var ruleIdDoorOpen = defineRule(ruleName, {
    whenChanged: self.genNames.vDevice + '/doorOpen',
    then: function (newValue, devName, cellName) {
      doorOpenHandler(self, newValue, devName, cellName);
    },
  });
  if (!ruleIdDoorOpen) {
    log.error('WB-rule "' + ruleName + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' + ruleIdDoorOpen + '" was successfully created'
  );
  self.addRule(ruleIdDoorOpen);

  // Rule for logic disabled changes
  ruleName = self.genNames.ruleLogicDisabledChange;
  var ruleIdLogicDisabled = defineRule(ruleName, {
    whenChanged: self.genNames.vDevice + '/logicDisabledByWallSwitch',
    then: function (newValue, devName, cellName) {
      logicDisabledHandler(self, newValue, devName, cellName);
    },
  });
  if (!ruleIdLogicDisabled) {
    log.error('WB-rule "' + ruleName + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' +
      ruleIdLogicDisabled +
      '" was successfully created'
  );
  self.addRule(ruleIdLogicDisabled);

  // Rule for light devices changes
  ruleName = self.genNames.ruleLightDevsChange;
  var ruleIdLightDevsChange = defineRule(ruleName, {
    whenChanged: lightDevTopics,
    then: function (newValue, devName, cellName) {
      lightDevicesHandler(self, newValue, devName, cellName);
    },
  });
  if (!ruleIdLightDevsChange) {
    log.error('WB-rule "' + ruleName + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' +
      ruleIdLightDevsChange +
      '" was successfully created'
  );
  self.addRule(ruleIdLightDevsChange);

  // Rule for last switch action changes
  ruleName = self.genNames.ruleLastSwitchActionChange;
  var ruleIdLastSwitchActionChange = defineRule(ruleName, {
    whenChanged: self.genNames.vDevice + '/lastSwitchAction',
    then: function (newValue, devName, cellName) {
      lastSwitchActionHandler(self, newValue, devName, cellName);
    },
  });
  if (!ruleIdLastSwitchActionChange) {
    log.error('WB-rule "' + ruleName + '" not created');
    return false;
  }
  log.debug(
    'WB-rule with IdNum "' +
      ruleIdLastSwitchActionChange +
      '" was successfully created'
  );
  self.addRule(ruleIdLastSwitchActionChange);

  return true;
}

/**
 * Handler for motion sensor changes
 * @param {Object} self - Reference to the LightControlScenario instance
 * @param {any} newValue - New sensor value
 * @param {string} devName - Device name
 * @param {string} cellName - Cell name
 */
function motionSensorHandler(self, newValue, devName, cellName) {
  if (dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'] === true) {
    // log.debug('Light-control is disabled after used wall switch - doing nothing');
    return;
  }

  var topicName = devName + '/' + cellName;
  var matchedConfig = findTopicConfig(topicName, self.cfg.motionSensors);
  if (!matchedConfig) {
    log.error('Motion sensor not found: ' + topicName);
    return;
  }

  var isMotionActive = isMotionSensorActiveByBehavior(
    matchedConfig,
    newValue
  );
  if (isMotionActive) {
    // Any motion sensor active - we enable control
    dev[self.genNames.vDevice + '/motionInProgress'] = true;
  } else {
    // Only if all motion sensors deactivated - we disable control
    if (checkAllMotionSensorsInactive(self.cfg.motionSensors)) {
      dev[self.genNames.vDevice + '/motionInProgress'] = false;
    }
    // If some motion sensors are still active - do nothing, keeping lights on
    // Status will remain "active" until all sensors are deactivated
  }
}

/**
 * Handler for motion in progress changes
 * @param {Object} self - Reference to the LightControlScenario instance
 * @param {boolean} newValue - New motion state value
 * @param {string} devName - Device name
 * @param {string} cellName - Cell name
 */
function motionInProgressHandler(self, newValue, devName, cellName) {
  var isMotionDetected = newValue === true;

  if (isMotionDetected) {
    if (self.ctx.lightOffTimerId) {
      clearTimeout(self.ctx.lightOffTimerId);
    }
    resetLightOffTimer(self);
    dev[self.genNames.vDevice + '/lightOn'] = true;
  } else {
    // Detected motion end
    startLightOffTimer(self, self.cfg.delayByMotionSensors * 1000);
  }
}

/**
 * Handler for remaining time to light off changes
 * @param {Object} self - Reference to the LightControlScenario instance
 * @param {number} newValue - New time value
 * @param {string} devName - Device name
 * @param {string} cellName - Cell name
 */
function remainingTimeToLightOffHandler(self, newValue, devName, cellName) {
  var curMotionStatus = dev[self.genNames.vDevice + '/motionInProgress'];
  if (newValue === 0 && curMotionStatus === true) {
    // Do nothing if timer reset to zero during motion
    return true;
  }

  if (newValue === 0) {
    turnOffLightsByTimeout(self);
  } else if (newValue >= 1) {
    // Recharge timer
    if (self.ctx.lightOffTimerId) {
      clearTimeout(self.ctx.lightOffTimerId);
    }
    self.ctx.lightOffTimerId = setTimeout(function () {
      updateRemainingLightOffTime(self);
    }, 1000);
  } else {
    log.error(
      'Remaining time to light enable: has incorrect value: ' + newValue
    );
  }

  return true;
}

/**
 * Handler for light on control changes
 * @param {Object} self - Reference to the LightControlScenario instance
 * @param {boolean} newValue - New light state value
 * @param {string} devName - Device name
 * @param {string} cellName - Cell name
 */
function lightOnHandler(self, newValue, devName, cellName) {
  // Don't react if we updated the indicator ourselves
  if (self.ctx.syncingLightOn) return true;

  var isLightSwitchedOn = newValue === true;
  var isLightSwitchedOff = newValue === false;

  if (isLightSwitchedOn) {
    self.ctx.scenarioActionInProgress = true;
    self.ctx.scenarioTargetState = true;
    setValueAllDevicesByBehavior(self.cfg.lightDevices, true);
  } else if (isLightSwitchedOff) {
    self.ctx.scenarioActionInProgress = true;
    self.ctx.scenarioTargetState = false;
    setValueAllDevicesByBehavior(self.cfg.lightDevices, false);
  } else {
    log.error('Light on - has incorrect type: {}', newValue);
  }

  return true;
}

/**
 * Handler for opening sensor changes
 * @param {Object} self - Reference to the LightControlScenario instance
 * @param {any} newValue - New sensor value
 * @param {string} devName - Device name
 * @param {string} cellName - Cell name
 */
function openingSensorHandler(self, newValue, devName, cellName) {
  if (dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'] === true) {
    // log.debug('Light-control is disabled after used wall switch - doing nothing');
    return;
  }

  var topicName = devName + '/' + cellName;
  var matchedConfig = findTopicConfig(topicName, self.cfg.openingSensors);
  if (!matchedConfig) {
    log.error('Opening sensor not found: ' + topicName);
    return;
  }

  var isDoorOpen = isOpeningSensorOpenedByBehavior(matchedConfig, newValue);
  if (isDoorOpen) {
    // Any door open - we enable control '/doorOpen'
    dev[self.genNames.vDevice + '/doorOpen'] = true;
  } else {
    // Only if all doors closed - we disable control '/doorOpen'
    if (checkAllOpeningSensorsClose(self.cfg.openingSensors)) {
      dev[self.genNames.vDevice + '/doorOpen'] = false;
    }
    // If some doors are still open - do nothing
    // Status will remain "open" until all doors are closed
  }
}

/**
 * Handler for light switch used
 * @param {Object} self - Reference to the LightControlScenario instance
 * @param {any} newValue - New switch value
 * @param {string} devName - Device name
 * @param {string} cellName - Cell name
 */
function lightSwitchUsedHandler(self, newValue, devName, cellName) {
  // For switches, consider any change as toggling the scenario logic state
  var curValue = dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'];
  dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'] = !curValue;

  return true;
}

/**
 * Handler for remaining time to logic enable changes
 * @param {Object} self - Reference to the LightControlScenario instance
 * @param {number} newValue - New time value
 * @param {string} devName - Device name
 * @param {string} cellName - Cell name
 */
function remainingTimeToLogicEnableHandler(
  self,
  newValue,
  devName,
  cellName
) {
  if (newValue === 0) {
    enableLogicByTimeout(self);
  } else if (newValue >= 1) {
    // Recharge timer
    if (self.ctx.logicEnableTimerId) {
      clearTimeout(self.ctx.logicEnableTimerId);
    }
    self.ctx.logicEnableTimerId = setTimeout(function () {
      updateRemainingLogicEnableTime(self);
    }, 1000);
  } else {
    log.error(
      'Remaining time to logic enable: has incorrect value: ' + newValue
    );
  }

  return true;
}

/**
 * Handler for door open changes
 * @param {Object} self - Reference to the LightControlScenario instance
 * @param {boolean} newValue - New door state value
 * @param {string} devName - Device name
 * @param {string} cellName - Cell name
 */
function doorOpenHandler(self, newValue, devName, cellName) {
  var isDoorOpened = newValue === true;
  var isDoorClosed = newValue === false;

  if (isDoorOpened) {
    dev[self.genNames.vDevice + '/lightOn'] = true;
    startLightOffTimer(self, self.cfg.delayByOpeningSensors * 1000);
  } else if (isDoorClosed) {
    // Do nothing
  } else {
    log.error('Door status - has incorrect type: {}', newValue);
  }

  return true;
}

/**
 * Handler for disabling automation logic when using the switch
 * @param {Object} self - Reference to the LightControlScenario instance
 * @param {boolean} newValue - New logic state value
 * @param {string} devName - Device name
 * @param {string} cellName - Cell name
 */
function logicDisabledHandler(self, newValue, devName, cellName) {
  if (self.ctx.lightOffTimerId) {
    clearTimeout(self.ctx.lightOffTimerId);
    resetLightOffTimer(self);
  }
  if (self.ctx.logicEnableTimerId) {
    clearTimeout(self.ctx.logicEnableTimerId);
    resetLogicEnableTimer(self);
  }

  if (newValue === false) {
    dev[self.genNames.vDevice + '/lightOn'] = false;
    return true;
  }

  dev[self.genNames.vDevice + '/lightOn'] = true;
  if (self.cfg.isDelayEnabledAfterSwitch === true) {
    startLightOffTimer(self, self.cfg.delayBlockAfterSwitch * 1000);
    startLogicEnableTimer(self, self.cfg.delayBlockAfterSwitch * 1000);
  }
  return true;
}

/**
 * Handler for light devices changes
 * @param {Object} self - Reference to the LightControlScenario instance
 * @param {any} newValue - New value of the changed device
 * @param {string} devName - Device name
 * @param {string} cellName - Cell name
 */
function lightDevicesHandler(self, newValue, devName, cellName) {
  var internalLightStatus = dev[self.genNames.vDevice + '/lightOn'];

  // Calculate the actual state of the entire group
  var onCnt = 0;
  for (var i = 0; i < self.cfg.lightDevices.length; i++) {
    if (dev[self.cfg.lightDevices[i].mqttTopicName] === true) {
      onCnt++;
    }
  }
  var allLightOn = onCnt === self.cfg.lightDevices.length; // all on
  var allLightOff = onCnt === 0; // all off
  var mixedState = !allLightOn && !allLightOff; // partially on/off

  // Handle changes initiated by the scenario
  if (self.ctx.scenarioActionInProgress && newValue === internalLightStatus) {
    // While the final result hasn't been achieved → PARTIAL_BY_SCENARIO
    if (mixedState) {
      dev[self.genNames.vDevice + '/lastSwitchAction'] =
        lastActionType.PARTIAL_BY_SCENARIO;
      return; // wait for more changes to complete
    }

    // Final state achieved
    if (allLightOn && self.ctx.scenarioTargetState === true) {
      dev[self.genNames.vDevice + '/lastSwitchAction'] =
        lastActionType.SCENARIO_ON;
    } else if (allLightOff && self.ctx.scenarioTargetState === false) {
      dev[self.genNames.vDevice + '/lastSwitchAction'] =
        lastActionType.SCENARIO_OFF;
    }

    // Don't sync the lightOn indicator (it should already be correct)
    if (
      dev[self.genNames.vDevice + '/lightOn'] !== self.ctx.scenarioTargetState
    ) {
      log.error('Not correct logic!');
      self.ctx.syncingLightOn = true;
      dev[self.genNames.vDevice + '/lightOn'] = self.ctx.scenarioTargetState;
      self.ctx.syncingLightOn = false;
    }
    // scenario finished switching
    self.ctx.scenarioActionInProgress = false;
    self.ctx.scenarioTargetState = null;
    return;
  }

  // External change
  var topicName = devName + '/' + cellName;
  log.debug('External change detected for device: "{}"' + topicName);
  log.debug('newValue: ' + newValue);

  if (newValue === false) {
    log.debug(
      'External control detected: Minimum one light turn-OFF externally'
    );
  } else if (newValue === true) {
    log.debug(
      'External control detected: Minimum one light turn-ON externally'
    );
  }
  // Determine action type
  if (mixedState) {
    dev[self.genNames.vDevice + '/lastSwitchAction'] =
      lastActionType.PARTIAL_EXT;
    // Don't change lightOn in "partial" state
  } else if (allLightOn) {
    dev[self.genNames.vDevice + '/lastSwitchAction'] = lastActionType.EXT_ON;

    // Sync lightOn topic (all activated)
    if (dev[self.genNames.vDevice + '/lightOn'] !== true) {
      self.ctx.syncingLightOn = true;
      dev[self.genNames.vDevice + '/lightOn'] = true;
      self.ctx.syncingLightOn = false;
    }
  } else if (allLightOff) {
    dev[self.genNames.vDevice + '/lastSwitchAction'] =
      lastActionType.EXT_OFF;
    // Sync lightOn topic (all deactivated)
    if (dev[self.genNames.vDevice + '/lightOn'] !== false) {
      self.ctx.syncingLightOn = true;
      dev[self.genNames.vDevice + '/lightOn'] = false;
      self.ctx.syncingLightOn = false;
    }
  }
}

/**
 * Handler for last switch action changes
 * @param {Object} self - Reference to the LightControlScenario instance
 * @param {number} newValue - New action type value
 * @param {string} devName - Device name
 * @param {string} cellName - Cell name
 */
function lastSwitchActionHandler(self, newValue, devName, cellName) {
  var curActionType = newValue;

  // All light devices turned off externally
  if (curActionType === lastActionType.EXT_OFF) {
    if (self.ctx.lightOffTimerId) {
      clearTimeout(self.ctx.lightOffTimerId);
      resetLightOffTimer(self);
    }
    if (self.ctx.logicEnableTimerId) {
      clearTimeout(self.ctx.logicEnableTimerId);
      resetLogicEnableTimer(self);
    }

    if (dev[self.genNames.vDevice + '/motionInProgress'] === true) {
      dev[self.genNames.vDevice + '/motionInProgress'] = false;
    }
    if (dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'] === true) {
      dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'] = false;
    }

    // Sync lightOn indicator if needed
    if (dev[self.genNames.vDevice + '/lightOn'] !== false) {
      self.ctx.syncingLightOn = true;
      dev[self.genNames.vDevice + '/lightOn'] = false;
      self.ctx.syncingLightOn = false;
    }

    return;
  }

  // Other values 'lastActionType' don't require a reaction
}

/**
 * Scenario initialization
 * @param {string} deviceTitle - Virtual device title
 * @param {LightControlConfig} cfg - Configuration object
 * @returns {boolean} True if initialization succeeded
 */
LightControlScenario.prototype.initSpecific = function (deviceTitle, cfg) {
  log.debug('Start init light scenario');
  log.setLabel(loggerFileLabel + '/' + this.idPrefix);

  // Add all required controls to the virtual device
  addCustomControlsToVirtualDevice(this, cfg);
  if (cfg.isDebugEnabled === true) {
    log.debug('Scenario debug enabled - add extra controls to VD');
    var self = this;
    addAllLinkedDevicesToVd(self, cfg);
  }

  log.debug('Start all required rules creation');
  var rulesCreated = createRules(this, cfg);

  log.debug('Light control scenario initialized');
  return rulesCreated;
};

exports.LightControlScenario = LightControlScenario;
