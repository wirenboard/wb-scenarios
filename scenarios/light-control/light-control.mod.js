/**
 * @file light-control.mod.js - ES5 module for wb-rules v2.28
 * @description Light control scenario class that extends ScenarioBase
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var vdHelpers = require('virtual-device-helpers.mod');
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
  RULE_ON: 1, // Scenario turned everything on
  RULE_OFF: 2, // Scenario turned everything off
  EXT_ON: 3, // Externally turned everything on
  EXT_OFF: 4, // Externally turned everything off
  PARTIAL_EXT: 5, // Partially changed by external actions
  PARTIAL_BY_RULE: 6, // Partially changed by Scenario
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
    ruleActionInProgress: false, // scenario is currently changing lights
    ruleTargetState: null, // true → should turn on, false → turn off
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
    ruleRemainingTimeToLightOffChange: baseRuleName + 'remainingTimeToLightOffChange',
    ruleRemainingTimeToLogicEnableChange: baseRuleName + 'remainingTimeToLogicEnableChange',
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
      0: { en: 'Not used', ru: 'Не используется' },
      1: { en: 'Rule turned ON', ru: 'Сценарий включил' },
      2: { en: 'Rule turned OFF', ru: 'Сценарий выключил' },
      // At least one lamp forced ON
      3: { en: 'Turn‑on externally', ru: 'Включили извне' },
      // All lamps forced OFF
      4: { en: 'Turn‑off externally', ru: 'Выключили извне' },
      // Mixed external states, minimum one lamp externaly changed
      5: { en: 'Partial external', ru: 'Частично извне' },
      6: { en: 'Partial by rule', ru: 'Частично сценарий' },
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

  // Check if debug mode is enabled and add extra controls if needed
  if (cfg.isDebugEnabled === true) {
    var self = this;
    addAllLinkedDevicesToVd(self, cfg);
  } else {
    log.debug('Debug disabled and has value: "' + cfg.isDebugEnabled + '"');
  }

  // Create a simple rule as a placeholder
  var ruleId = defineRule(this.genNames.ruleLightOnChange, {
    whenChanged: [this.genNames.vDevice + '/lightOn'],
    then: function (newValue) {
      log.debug('Light state changed to: ' + newValue);
    },
  });

  this.addRule(ruleId);
  log.debug('Light control scenario initialized');
  return true;
};

exports.LightControlScenario = LightControlScenario;
