/**
 * @file light-control.mod.js - ES5 module for wb-rules v2.28
 * @description Light control scenario class that extends ScenarioBase
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState = require('virtual-device-helpers.mod').ScenarioState;
var Logger = require('logger.mod').Logger;

var vdHelpers = require('virtual-device-helpers.mod');
var registry = require('control-interaction-registry.mod');
var extractMqttTopics =
  require('scenarios-general-helpers.mod').extractMqttTopics;
var isControlTypeValid =
  require('scenarios-general-helpers.mod').isControlTypeValid;

var loggerFileLabel = 'WBSC-light-control-mod';
var log = new Logger(loggerFileLabel);

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
    scenarioPendingCount: 0, // remaining own changes to confirm before finalize
    syncingLightOn: false, // flag to prevent recursion when syncing lightOn
    lightOffTimerId: null, // timer ID for turning off lights
    logicEnableTimerId: null, // timer ID for re-enabling automation logic
  };
}
LightControlScenario.prototype = Object.create(ScenarioBase.prototype);
LightControlScenario.prototype.constructor = LightControlScenario;

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
 * @param {Object} cfg - Configuration object
 * @returns {Object} Waiting configuration object
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
 * Validate outputs against the action registry
 * @param {Array} lightDevices - Array of light device configs
 * @returns {boolean} True if every output is valid
 */
function validateLightDevices(lightDevices) {
  for (var i = 0; i < lightDevices.length; i++) {
    var ctrl = lightDevices[i];
    if (!registry.actionsTable[ctrl.behaviorType]) {
      log.error(
        "Light-control validation error: behavior type '{}' not found",
        ctrl.behaviorType
      );
      return false;
    }
    var reqCtrlTypes = registry.actionsTable[ctrl.behaviorType].reqCtrlTypes;
    if (!isControlTypeValid(ctrl.mqttTopicName, reqCtrlTypes)) {
      log.error(
        "Light-control validation error: control '{}' is not of valid type for '{}'",
        ctrl.mqttTopicName,
        ctrl.behaviorType
      );
      return false;
    }
  }
  return true;
}

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

  if (!validateLightDevices(cfg.lightDevices)) {
    return false;
  }

  return true;
};

/**
 * Adds required custom controls cells to the virtual device
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
 * @param {LightControlConfig} cfg - Configuration object
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
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
 * @param {LightControlConfig} cfg - Configuration object
 * @returns {boolean} Indicates whether all device controls were created successfully.
 */
function addAllLinkedDevicesToVd(self, cfg) {
  var result;

  if (cfg.lightDevices.length > 0) {
    result = addLinkedControlsArray(self, cfg.lightDevices, 'light_device');
    if (!result) return false;
  }

  if (cfg.motionSensors.length > 0) {
    result = addLinkedControlsArray(
      self,
      cfg.motionSensors,
      'motion_sensor'
    );
    if (!result) return false;
  }

  if (cfg.openingSensors.length > 0) {
    result = addLinkedControlsArray(
      self,
      cfg.openingSensors,
      'opening_sensor'
    );
    if (!result) return false;
  }

  if (cfg.lightSwitches.length > 0) {
    result = addLinkedControlsArray(self, cfg.lightSwitches, 'light_switch');
    if (!result) return false;
  }

  return true;
}

/**
 * Adds an array of linked controls to the virtual device
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
 * @param {Array} arrayOfControls - Array of controls to link
 * @param {string} cellPrefix - Prefix for control names in the virtual device
 * @returns {boolean} Indicates whether all controls successfully created
 */
function addLinkedControlsArray(self, arrayOfControls, cellPrefix) {
  // Flag to indicate that all controls were created successfully
  var allControlsCreated = true;

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
      allControlsCreated = false;
    } else {
      log.debug('Success add ' + cellPrefix + ' ctrl for ' + curMqttControl);
    }
  }

  return allControlsCreated;
}

/**
 * Updates the remaining time to light off each second
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
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
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
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
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
 * @param {number} newDelayMs - Delay in milliseconds
 */
function startLightOffTimer(self, newDelayMs) {
  var newDelaySec = newDelayMs / 1000;
  dev[self.genNames.vDevice + '/remainingTimeToLightOffInSec'] = newDelaySec;
  // Timer automatically starts countdown when a new value is set
}

/**
 * Starts the logic enable timer
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
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
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
 */
function turnOffLightsByTimeout(self) {
  dev[self.genNames.vDevice + '/lightOn'] = false;
  resetLightOffTimer(self);
}

/**
 * Enables logic by timeout
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
 */
function enableLogicByTimeout(self) {
  dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'] = false;
  resetLogicEnableTimer(self);
}

/**
 * Resets the light off timer
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
 */
function resetLightOffTimer(self) {
  self.ctx.lightOffTimerId = null;
  dev[self.genNames.vDevice + '/remainingTimeToLightOffInSec'] = 0;
}

/**
 * Resets the logic enable timer
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
 */
function resetLogicEnableTimer(self) {
  self.ctx.logicEnableTimerId = null;
  dev[self.genNames.vDevice + '/remainingTimeToLogicEnableInSec'] = 0;
}

/**
 * Reset-value for a light device. Falls back to the type default when
 * resetValue is absent or empty
 *
 * TODO(Valerii): ideally the reset should restore the value the control held before
 * the scenario changed it (captured on launch), not a static resetValue or
 * type default. This matters most for setText/setColor, where a fixed default
 * is arbitrary. No simple way to do this yet — left for a follow-up.
 *
 * @param {Object} ctrl - Light device config (behaviorType, resetValue)
 * @returns {number|string|undefined} Off-value to apply on reset
 */
function resolveResetValue(ctrl) {
  if (ctrl.resetValue !== undefined && ctrl.resetValue !== '') {
    return ctrl.resetValue;
  }
  if (ctrl.behaviorType === 'setValueNumericInput') {
    return 0;
  }
  if (ctrl.behaviorType === 'setText') {
    return '';
  }
  if (ctrl.behaviorType === 'setColor') {
    return '#ffffff'; // white — default color of the wb-dynamic-type widget
  }
  return undefined;
}

/**
 * Strict equality, but null/undefined count as ''. Empty text control
 * publishes an empty payload and reads back as null
 * @param {any} controlValue - Current control value
 * @param {any} resolvedValue - Resolved on/off target
 * @returns {boolean} Whether both represent the same value
 */
function controlValueEquals(controlValue, resolvedValue) {
  var a =
    controlValue === null || controlValue === undefined ? '' : controlValue;
  var b =
    resolvedValue === null || resolvedValue === undefined
      ? ''
      : resolvedValue;
  return a === b;
}

/**
 * Precompute each light device's published on/off value
 * so the watchdog can compare control values
 * @param {LightControlConfig} cfg - Configuration object
 */
function precomputeLightDeviceTargets(cfg) {
  for (var i = 0; i < cfg.lightDevices.length; i++) {
    var ctrl = cfg.lightDevices[i];
    var entry = registry.actionsTable[ctrl.behaviorType];
    ctrl.resolvedOnValue = entry.launchHandler(null, ctrl.actionValue);
    ctrl.resolvedOffValue = entry.resetHandler(
      null,
      resolveResetValue(ctrl)
    );
  }
}

/**
 * Applies on (state=true) or off (state=false) value to every light device.
 * @param {Array} actionControlsArr - Light device configs
 * @param {boolean} state - true → apply on value, false → apply off value
 * @returns {number} How many controls actually changed value (each fires one
 *   watchdog callback). Lets the watchdog tell our own changes from external.
 */
function setValueAllDevicesByBehavior(actionControlsArr, state) {
  var changedCount = 0;
  for (var i = 0; i < actionControlsArr.length; i++) {
    var ctrl = actionControlsArr[i];
    var actualValue = dev[ctrl.mqttTopicName];
    // Values are precomputed once in precomputeLightDeviceTargets, so the
    // published value is exactly what the watchdog compares against
    var newCtrlValue = state ? ctrl.resolvedOnValue : ctrl.resolvedOffValue;
    if (!controlValueEquals(newCtrlValue, actualValue)) {
      changedCount++;
    }
    dev[ctrl.mqttTopicName] = newCtrlValue;
  }
  return changedCount;
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
 * Defines a rule, logs result, and registers the rule ID in the scenario
 * @param {LightControlScenario} self - Scenario instance
 * @param {string} name - Unique rule name
 * @param {Array|string} topics - MQTT topic(s) to subscribe on change
 * @param {Function} handler - Handler function to call on topic change
 * @returns {boolean} Rule created status:
 *   - True if rule created or skipped
 *   - False if creation attempted but failed
 */
function createAndRegisterRule(self, name, topics, handler) {
  var isEmptyTopics =
    (Array.isArray(topics) && topics.length === 0) ||
    (typeof topics === 'string' && topics.trim() === '');

  if (isEmptyTopics) {
    log.debug('WB-rule "' + name + '" skipped — no topics defined');
    return true; // Считается успешным, просто нет смысла создавать правило
  }

  var ruleId = defineRule(name, {
    whenChanged: topics,
    then: function (newValue, devName, cellName) {
      handler(self, newValue, devName, cellName);
    },
  });

  if (!ruleId) {
    log.error('WB-rule "' + name + '" not created');
    return false;
  }

  log.debug('WB-rule with IdNum "' + ruleId + '" was successfully created');
  self.addRule(ruleId);
  return true;
}

/**
 * Creates all required rules for current type scenario
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
 * @param {LightControlConfig} cfg - Configuration object
 * @returns {boolean} True if all rules created successfully, false otherwise
 */
function createRules(self, cfg) {
  log.debug('Start all required rules creation');

  var gName = self.genNames;
  var vd = self.genNames.vDevice;

  var lightDevTopics = extractMqttTopics(cfg.lightDevices);
  var motionTopics = extractMqttTopics(cfg.motionSensors);
  var openingTopics = extractMqttTopics(cfg.openingSensors);
  var switchTopics = extractMqttTopics(cfg.lightSwitches);

  // Rule for motion sensors
  if (
    !createAndRegisterRule(
      self,
      gName.ruleMotion,
      motionTopics,
      motionSensorHandler
    )
  ) {
    return false;
  }

  // Rule for motion in progress
  if (
    !createAndRegisterRule(
      self,
      gName.ruleMotionInProgress,
      vd + '/motionInProgress',
      motionInProgressHandler
    )
  ) {
    return false;
  }

  // Rule for remaining time to light off changes
  if (
    !createAndRegisterRule(
      self,
      gName.ruleTimeToLightOffChange,
      vd + '/remainingTimeToLightOffInSec',
      remainingTimeToLightOffHandler
    )
  ) {
    return false;
  }

  // Rule for light on changes
  if (
    !createAndRegisterRule(
      self,
      gName.ruleLightOnChange,
      vd + '/lightOn',
      lightOnHandler
    )
  ) {
    return false;
  }

  // Rule for opening sensors changes
  if (
    !createAndRegisterRule(
      self,
      gName.ruleOpeningSensorsChange,
      openingTopics,
      openingSensorHandler
    )
  ) {
    return false;
  }

  // Rule for light switch used
  if (
    !createAndRegisterRule(
      self,
      gName.ruleLightSwitchUsed,
      switchTopics,
      lightSwitchUsedHandler
    )
  ) {
    return false;
  }

  // Rule for remaining time to logic enable changes
  if (
    !createAndRegisterRule(
      self,
      gName.ruleTimeToLogicEnableChange,
      vd + '/remainingTimeToLogicEnableInSec',
      remainingTimeToLogicEnableHandler
    )
  ) {
    return false;
  }

  // Rule for door open changes
  if (
    !createAndRegisterRule(
      self,
      gName.ruleDoorOpenChange,
      vd + '/doorOpen',
      doorOpenHandler
    )
  ) {
    return false;
  }

  // Rule for logic disabled changes
  if (
    !createAndRegisterRule(
      self,
      gName.ruleLogicDisabledChange,
      vd + '/logicDisabledByWallSwitch',
      logicDisabledHandler
    )
  ) {
    return false;
  }

  // Rule for light devices changes
  if (
    !createAndRegisterRule(
      self,
      gName.ruleLightDevsChange,
      lightDevTopics,
      lightDevicesHandler
    )
  ) {
    return false;
  }

  // Rule for last switch action changes
  if (
    !createAndRegisterRule(
      self,
      gName.ruleLastSwitchActionChange,
      vd + '/lastSwitchAction',
      lastSwitchActionHandler
    )
  ) {
    return false;
  }

  return true;
}

/**
 * Handler for motion sensor changes
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
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
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
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
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
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
      self.ctx.lightOffTimerId = null;
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
 * Drives all light devices to the on (true) or off (false) target and arms the
 * watchdog to expect exactly the number of own changes that will fire.
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
 * @param {boolean} targetState - true → apply on values, false → apply off values
 */
function applyScenarioState(self, targetState) {
  self.ctx.scenarioTargetState = targetState;
  var changed = setValueAllDevicesByBehavior(
    self.cfg.lightDevices,
    targetState
  );
  if (changed > 0) {
    // Expect `changed` watchdog callbacks, finalize after the last one
    self.ctx.scenarioActionInProgress = true;
    self.ctx.scenarioPendingCount = changed;
  } else {
    // No values changed, then no callbacks will fire, mark the result directly
    self.ctx.scenarioActionInProgress = false;
    self.ctx.scenarioTargetState = null;
    dev[self.genNames.vDevice + '/lastSwitchAction'] = targetState
      ? lastActionType.SCENARIO_ON
      : lastActionType.SCENARIO_OFF;
  }
}

/**
 * Handler for light on control changes
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
 * @param {boolean} newValue - New light state value
 * @param {string} devName - Device name
 * @param {string} cellName - Cell name
 */
function lightOnHandler(self, newValue, devName, cellName) {
  // Don't react if we updated the indicator ourselves
  if (self.ctx.syncingLightOn) return true;

  if (newValue === true) {
    applyScenarioState(self, true);
  } else if (newValue === false) {
    applyScenarioState(self, false);
  } else {
    log.error('Light on - has incorrect type: {}', newValue);
  }

  return true;
}

/**
 * Handler for opening sensor changes
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
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
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
 * @param {any} newValue - New switch value
 * @param {string} devName - Device name
 * @param {string} cellName - Cell name
 */
function lightSwitchUsedHandler(self, newValue, devName, cellName) {
  // For switches, consider any change (for switch with/withoout state) as toggling the scenario logic state
  if (self.ctx.lightOffTimerId) {
    clearTimeout(self.ctx.lightOffTimerId);
    resetLightOffTimer(self);
  }

  var newLightState = !dev[self.genNames.vDevice + '/lightOn'];
  dev[self.genNames.vDevice + '/lightOn'] = newLightState;
  if (newLightState === false) {
    dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'] = false;
    return true;
  }

  dev[self.genNames.vDevice + '/logicDisabledByWallSwitch'] = true;
  if (self.cfg.isDelayEnabledAfterSwitch === true) {
    startLightOffTimer(self, self.cfg.delayBlockAfterSwitch * 1000);
  }

  return true;
}

/**
 * Handler for remaining time to logic enable changes
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
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
      self.ctx.logicEnableTimerId = null;
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
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
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
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
 * @param {boolean} newValue - New logic state value
 * @param {string} devName - Device name
 * @param {string} cellName - Cell name
 */
function logicDisabledHandler(self, newValue, devName, cellName) {
  if (self.ctx.logicEnableTimerId) {
    clearTimeout(self.ctx.logicEnableTimerId);
    resetLogicEnableTimer(self);
  }

  if (newValue === true && self.cfg.isDelayEnabledAfterSwitch === true) {
    startLogicEnableTimer(self, self.cfg.delayBlockAfterSwitch * 1000);
  }
  return true;
}

/**
 * Handler for light devices changes
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
 * @param {any} newValue - New value of the changed device
 * @param {string} devName - Device name
 * @param {string} cellName - Cell name
 */
function lightDevicesHandler(self, newValue, devName, cellName) {
  var topicName = devName + '/' + cellName;

  // Group state by comparing each control to its on/off target
  // a value matching neither counts as neither on nor off
  var onCnt = 0;
  var offCnt = 0;
  for (var i = 0; i < self.cfg.lightDevices.length; i++) {
    var devCfg = self.cfg.lightDevices[i];
    var curValue = dev[devCfg.mqttTopicName];
    if (controlValueEquals(curValue, devCfg.resolvedOnValue)) {
      onCnt++;
    } else if (controlValueEquals(curValue, devCfg.resolvedOffValue)) {
      offCnt++;
    }
  }
  var allLightOn = onCnt === self.cfg.lightDevices.length; // all on
  var allLightOff = offCnt === self.cfg.lightDevices.length; // all off
  var mixedState = !allLightOn && !allLightOff; // partially on/off

  // Our own change, the control matches the value we are applying to it
  var changedCfg = findTopicConfig(topicName, self.cfg.lightDevices);
  var expectedByScenario =
    self.ctx.scenarioTargetState === true
      ? changedCfg && changedCfg.resolvedOnValue
      : changedCfg && changedCfg.resolvedOffValue;
  if (
    self.ctx.scenarioActionInProgress &&
    changedCfg &&
    controlValueEquals(newValue, expectedByScenario)
  ) {
    // Consume one of our own pending changes, stay PARTIAL until the last one
    self.ctx.scenarioPendingCount--;
    if (self.ctx.scenarioPendingCount > 0) {
      dev[self.genNames.vDevice + '/lastSwitchAction'] =
        lastActionType.PARTIAL_BY_SCENARIO;
      return;
    }

    // Last own change processed, then record the final state
    if (allLightOn && self.ctx.scenarioTargetState === true) {
      dev[self.genNames.vDevice + '/lastSwitchAction'] =
        lastActionType.SCENARIO_ON;
    } else if (allLightOff && self.ctx.scenarioTargetState === false) {
      dev[self.genNames.vDevice + '/lastSwitchAction'] =
        lastActionType.SCENARIO_OFF;
    }

    // Sync the lightOn indicator only if it diverged from the target
    if (
      dev[self.genNames.vDevice + '/lightOn'] !==
      self.ctx.scenarioTargetState
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
  log.debug('External change detected for device: "{}"', topicName);
  log.debug('newValue: {}', newValue);

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
 * @param {LightControlScenario} self - Reference to the LightControlScenario instance
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
  /**
   * NOTE: This method is executed ONLY when:
   * - Base initialization is complete
   * - Configuration is valid
   * - All referenced controls exist in the system
   *
   * The async initialization chain guarantees that all prerequisites are met.
   * No need to re-validate or check control existence here.
   */
  log.debug('Start init light scenario');
  log.setLabel(loggerFileLabel + '/' + this.idPrefix);

  // Resolve per-device on/off values once for the external-change watchdog
  precomputeLightDeviceTargets(cfg);

  // Add all required controls to the virtual device
  addCustomControlsToVirtualDevice(this, cfg);
  if (cfg.isDebugEnabled === true) {
    log.debug('Scenario debug enabled - add extra controls to VD');
    var self = this;
    ok = addAllLinkedDevicesToVd(self, cfg);
    if (!ok) return false;
  }

  var rulesCreated = createRules(this, cfg);

  if (rulesCreated) {
    this.setState(ScenarioState.NORMAL);
    log.debug(
      'Light control scenario initialized successfully for device "{}"',
      deviceTitle
    );
  }

  return rulesCreated;
};

exports.LightControlScenario = LightControlScenario;
