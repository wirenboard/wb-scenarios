/**
 * @file thermostat.mod.js - ES5 module for wb-rules v2.34
 * @description Thermostat scenario class that extends ScenarioBase
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState = require('virtual-device-helpers.mod').ScenarioState;
var Logger = require('logger.mod').Logger;
var aTable = require('table-handling-actions.mod');

var hasCriticalErr = require('wbsc-wait-controls.mod').hasCriticalErr;
var isControlTypeValid = require('scenarios-general-helpers.mod').isControlTypeValid;
var extractMqttTopics = require('scenarios-general-helpers.mod').extractMqttTopics;

var loggerFileLabel = 'WBSC-thermostat-mod';
var log = new Logger(loggerFileLabel);

/**
 * Actions table for thermostat actuators.
 * Only setEnable and setDisable are allowed.
 */
var thermostatActionsTable = {
  setEnable:  aTable.actionsTable.setEnable,
  setDisable: aTable.actionsTable.setDisable,
};

/**
 * @typedef {Object} ActuatorConfig
 * @property {string} mqttTopicName - MQTT topic of the actuator (e.g. 'relay_module/K2')
 * @property {'setEnable'|'setDisable'} behaviorType - Action when heating is needed
 */

/**
 * @typedef {Object} ThermostatConfig
 * @property {string} [idPrefix] - Optional prefix for scenario identification
 *   If not provided, it will be generated from the scenario name
 * @property {number} targetTemp - Target temperature set by the user
 * @property {number} hysteresis - Hysteresis value (switching range)
 * @property {number} tempLimitsMin - Lower limit for temperature setting
 * @property {number} tempLimitsMax - Upper limit for temperature setting
 * @property {string} tempSensor - Name of the input control topic - monitored
 *   Example: temperature sensor whose value should be tracked
 *   'temp_sensor/temp_value'
 * @property {Array<ActuatorConfig>} actuators - List of output controls
 */

/**
 * Thermostat control scenario implementation
 * @class ThermostatScenario
 * @extends ScenarioBase
 */
function ThermostatScenario() {
  ScenarioBase.call(this);

  /**
   * Context object for storing scenario runtime state
   *
   * Target temperature is persisted via ScenarioBase PS API:
   *   this.getPsUserSetting('targetTemp', defaultValue)
   *   this.setPsUserSetting('targetTemp', value)
   *
   * Stored in common storage "wb-scenarios-common-persistent-data":
   *   scenariosRegistry[idPrefix].userSettings.targetTemp = <number>
   *
   * @type {Object}
   */
  this.ctx = {
    errorTimers: {}, // Timers for error handling debounce
    errorCheckTimeoutMs: 10000 // 10s debounce time for errors
  };
}
ThermostatScenario.prototype = Object.create(ScenarioBase.prototype);
ThermostatScenario.prototype.constructor = ThermostatScenario;

/**
 * Control key strings for virtual device
 */
var vdCtrl = {
  ruleEnabled: 'rule_enabled',
  targetTemp: 'target_temperature',
  curTemp: 'current_temperature',
  actuatorStatus: 'actuator_status',
  initStatus: 'state'
};

/**
 * Generates name identifiers for virtual device and rules
 * @param {string} idPrefix - ID prefix for this scenario instance
 * @returns {Object} Generated names
 */
ThermostatScenario.prototype.generateNames = function (idPrefix) {
  var scenarioPrefix = 'wbsc_';
  var baseRuleName = scenarioPrefix + idPrefix + '_';

  return {
    vDevice: scenarioPrefix + idPrefix,
    ruleTempChanged: baseRuleName + 'temp_changed',
    ruleSetScStatus: baseRuleName + 'set_sc_status',
    ruleSetTargetTemp: baseRuleName + 'set_target_t',
    ruleSensorErr: baseRuleName + 'sensor_error_changed',
  };
};

/**
 * Get configuration for waiting for controls
 * @param {ThermostatConfig} cfg - Configuration object
 * @returns {Object} Waiting configuration object
 */
ThermostatScenario.prototype.defineControlsWaitConfig = function (cfg) {
  var actuatorTopics = extractMqttTopics(cfg.actuators || []);

  var allTopics = [].concat(
    cfg.tempSensor,
    actuatorTopics
  );
  return { controls: allTopics };
};

/**
 * Configuration validation
 * @param {ThermostatConfig} cfg - Configuration object
 * @returns {boolean} True if configuration is valid, false otherwise
 */
ThermostatScenario.prototype.validateCfg = function (cfg) {
  var isLimitsCorrect = cfg.tempLimitsMin <= cfg.tempLimitsMax;
  if (!isLimitsCorrect) {
    log.error(
      'Config temperature limit "Min" = "{}" must be less than "Max" = "{}"',
      cfg.tempLimitsMin,
      cfg.tempLimitsMax
    );
  }

  var isTargetTempCorrect =
    cfg.targetTemp >= cfg.tempLimitsMin &&
    cfg.targetTemp <= cfg.tempLimitsMax;
  if (!isTargetTempCorrect) {
    log.error(
      'Target temperature "{}" must be in the range from "Min" to "Max"',
      cfg.targetTemp
    );
  }

  var isHysteresisCorrect = cfg.hysteresis > 0;
  if (!isHysteresisCorrect) {
    log.error(
      'Hysteresis value must be greater than 0, but got "{}"',
      cfg.hysteresis
    );
  }

  var tempSensorType = dev[cfg.tempSensor + '#type'];
  var isTempSensorValid =
    tempSensorType === null ||
    tempSensorType === 'value' ||
    tempSensorType === 'temperature';
  if (!isTempSensorValid) {
    log.error(
      'Sensor type must be "value" or "temperature", but got "{}"',
      tempSensorType
    );
  }

  // Validate actuators array
  if (!Array.isArray(cfg.actuators) || cfg.actuators.length === 0) {
    log.error('Thermostat validation error: at least one actuator is required');
    return false;
  }

  var isActuatorsValid = true;
  for (var i = 0; i < cfg.actuators.length; i++) {
    var act = cfg.actuators[i];
    if (!thermostatActionsTable[act.behaviorType]) {
      log.error(
        'Thermostat validation error: invalid behaviorType "{}" for actuator "{}"',
        act.behaviorType,
        act.mqttTopicName
      );
      isActuatorsValid = false;
      continue;
    }
    var reqCtrlTypes = thermostatActionsTable[act.behaviorType].reqCtrlTypes;
    if (!isControlTypeValid(act.mqttTopicName, reqCtrlTypes)) {
      log.error(
        'Thermostat validation error: actuator "{}" must be of type "switch"',
        act.mqttTopicName
      );
      isActuatorsValid = false;
    }
  }

  var isCfgValid =
    isLimitsCorrect &&
    isTargetTempCorrect &&
    isHysteresisCorrect &&
    isTempSensorValid &&
    isActuatorsValid;

  return isCfgValid;
};

/**
 * Adds required custom controls cells to the virtual device
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {ThermostatConfig} cfg - Configuration object
 * @param {number} initialTemp - Initial value for the target temperature
 */
function addCustomControlsToVirtualDevice(self, cfg, initialTemp) {
  var controlCfg = {
    title: {
      en: 'Temperature Setpoint',
      ru: 'Заданная температура',
    },
    type: 'range',
    value: initialTemp,
    min: cfg.tempLimitsMin,
    max: cfg.tempLimitsMax,
    order: 2,
  };
  self.vd.devObj.addControl(vdCtrl.targetTemp, controlCfg);

  controlCfg = {
    title: {
      en: 'Current Temperature',
      ru: 'Текущая температура',
    },
    type: 'value',
    units: 'deg C',
    value: dev[cfg.tempSensor],
    order: 3,
    readonly: true,
  };
  self.vd.devObj.addControl(vdCtrl.curTemp, controlCfg);

  controlCfg = {
    title: {
      en: 'Heating Status',
      ru: 'Статус нагрева',
    },
    type: 'switch',
    value: false,
    order: 4,
    readonly: true,
  };
  self.vd.devObj.addControl(vdCtrl.actuatorStatus, controlCfg);
}

/**
 * Apply heating state to all actuators.
 * Only writes to actuators whose current state differs from desired.
 * @param {Array<ActuatorConfig>} actuators - List of actuator configurations
 * @param {boolean} shouldHeat - Whether heating should be active
 */
function applyHeatingToActuators(actuators, shouldHeat) {
  for (var i = 0; i < actuators.length; i++) {
    var act = actuators[i];
    try {
      // XNOR: setEnable turns ON when heating, setDisable turns OFF when heating
      var desiredValue = shouldHeat === (act.behaviorType === 'setEnable');
      if (dev[act.mqttTopicName] !== desiredValue) {
        dev[act.mqttTopicName] = desiredValue;
      }
    } catch (error) {
      log.error(
        'Failed to set actuator "{}": {}',
        act.mqttTopicName,
        error.message || error
      );
    }
  }
}

/**
 * @typedef {Object} HeatingStateData
 * @property {number} curTemp - The current temperature (°C)
 * @property {number} targetTemp - The target temperature (°C)
 * @property {number} hysteresis - The hysteresis value (°C)
 *
 * @example
 * var data = {
 *   curTemp: 22,
 *   targetTemp: 24,
 *   hysteresis: 2
 * };
 */

/**
 * Updates the heating state based on current temperature, target
 * temperature, and hysteresis. Applies new state to all actuators if changed.
 * @param {Object} vdCtrlActuator - VD control for actuator status
 * @param {ThermostatConfig} cfg - Configuration object
 * @param {HeatingStateData} data - Heating state data
 */
function updateHeatingState(vdCtrlActuator, cfg, data) {
  var upperLimit = data.targetTemp + data.hysteresis;
  var lowerLimit = data.targetTemp - data.hysteresis;

  if (data.curTemp >= upperLimit) {
    log.debug(
      'Heater turned OFF, current/target temperatures: "{}"/"{}" °C',
      data.curTemp,
      data.targetTemp
    );
    applyHeatingToActuators(cfg.actuators, false);
    if (vdCtrlActuator.getValue() !== false) {
      vdCtrlActuator.setValue(false);
    }
  } else if (data.curTemp <= lowerLimit) {
    log.debug(
      'Heater turned ON, current/target temperatures: "{}"/"{}" °C',
      data.curTemp,
      data.targetTemp
    );
    applyHeatingToActuators(cfg.actuators, true);
    if (vdCtrlActuator.getValue() !== true) {
      vdCtrlActuator.setValue(true);
    }
  }
}

/**
 * Turn off all actuators (reverse state)
 * @param {Object} vdCtrlActuator - VD control for actuator status
 * @param {ThermostatConfig} cfg - Configuration object
 */
function turnOffAllActuators(vdCtrlActuator, cfg) {
  applyHeatingToActuators(cfg.actuators, false);
  if (vdCtrlActuator.getValue() !== false) {
    vdCtrlActuator.setValue(false);
  }
}

/**
 * Get the critical error value of the first broken actuator
 * @param {Array<ActuatorConfig>} actuators - List of actuator configurations
 * @returns {string} Error value (truthy) or empty string (falsy)
 */
function getActuatorsCriticalErr(actuators) {
  for (var i = 0; i < actuators.length; i++) {
    var errVal = dev[actuators[i].mqttTopicName + '#error'];
    if (hasCriticalErr(errVal)) {
      return errVal;
    }
  }
  return '';
}

/**
 * Updates the readonly state of the rule enable control
 * Removes readonly only when all errors (sensor and all actuators) are cleared
 * @param {Object} vdCtrlEnable - Control "Enable rules" in scenario virtual dev
 * @param {ThermostatConfig} cfg - Configuration parameters
 */
function tryClearReadonly(vdCtrlEnable, cfg) {
  if (!hasCriticalErr(dev[cfg.tempSensor + '#error']) &&
       !getActuatorsCriticalErr(cfg.actuators)
  ) {
    vdCtrlEnable.setReadonly(false);
  }
}

/**
 * Creates an error handling rule for a sensor or actuator
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {string} ruleName - The name of the rule to be created
 * @param {string} sourceErrTopic - The MQTT topic where error events published
 *     Example: "temperature_sensor/temperature#error", "relay_module/K2#error"
 * @param {Object} targetVdCtrl - The target virtual device control for sync
 *     Example: `vdCtrlCurTemp = vdObj.getControl('ctrlID')`
 * @param {Object} vdCtrlEnable - Control "Enable rules" in scenario virtual dev
 * @param {ThermostatConfig} cfg - Configuration parameters
 * @returns {boolean} True if rule created successfully
 */
function createErrChangeRule(
  self,
  ruleName,
  sourceErrTopic,
  targetVdCtrl,
  vdCtrlEnable,
  cfg
) {
  // Multiple actuators share one VD control (actuator_status).
  // On error clear we must check that ALL actuators are clean
  // before removing the red highlight from the shared control.
  var isActuatorErrRule =
    ruleName.indexOf('actuator_err_') !== -1;

  var ruleCfg = {
    whenChanged: [sourceErrTopic],
    then: function (newValue, devName, cellName) {
      // Sensor: one source per VD control — pass error through
      // Actuator + critical error (r/w): set error on shared control
      // Actuator + error cleared or non-critical (p): check ALL
      //   actuators — keep red if any other still has critical error.
      //   Using hasCriticalErr (not truthy) to avoid "p" overwriting
      //   a critical "r"/"w" from another actuator on the shared control
      if (!isActuatorErrRule) {
        targetVdCtrl.setError(newValue);
      } else if (hasCriticalErr(newValue)) {
        targetVdCtrl.setError(newValue);
      } else {
        targetVdCtrl.setError(
          getActuatorsCriticalErr(cfg.actuators)
        );
      }

      if (!hasCriticalErr(newValue)) {
        log.debug(
          'Error cleared or non-critical error (p) detected for topic "{}". New state: "{}"',
          sourceErrTopic,
          newValue
        );
        tryClearReadonly(vdCtrlEnable, cfg);
        self.setState(ScenarioState.NORMAL);

        // If on this topic was running timer - disable this timer
        if (self.ctx.errorTimers[sourceErrTopic]) {
          clearTimeout(self.ctx.errorTimers[sourceErrTopic]);
          self.ctx.errorTimers[sourceErrTopic] = null;
          log.debug(
            'Debounce timer for error for topic "{}" disabled',
            sourceErrTopic
          );
        }
        return;
      }

      log.warning(
        'Get critical error (r/w) for topic "{}". New error state: "{}"',
        sourceErrTopic,
        newValue
      );

      // Create new timer only if not have running already
      if (self.ctx.errorTimers[sourceErrTopic]) {
        return;
      }

      self.ctx.errorTimers[sourceErrTopic] = setTimeout(function () {
        // When timer stop - check still critical errors r/w
        var currentErrorVal = dev[sourceErrTopic];
        if (hasCriticalErr(currentErrorVal)) {
          log.error(
            'Scenario disabled: critical error (r/w) for topic "{}" not cleared for {} ms. Current error state: "{}"',
            sourceErrTopic,
            self.ctx.errorCheckTimeoutMs,
            currentErrorVal
          );
          self.setState(ScenarioState.USED_CONTROL_ERROR);
          vdCtrlEnable.setReadonly(true);
          vdCtrlEnable.setValue(false);
        } else {
          log.debug(
            'Error in topic "{}" cleared before timer disabled. Scenario still running.',
            sourceErrTopic
          );
        }
        self.ctx.errorTimers[sourceErrTopic] = null;
      }, self.ctx.errorCheckTimeoutMs);
    },
  };

  var ruleId = defineRule(ruleName, ruleCfg);
  return ruleId;
}

/**
 * Restore target temperature from persistent storage (if saved previously)
 * If the stored value is invalid or missing, we use cfg.targetTemp and save it
 *
 * Includes one-time migration from old PersistentStorage('wbscThermostatSettings')
 *
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {ThermostatConfig} cfg - Thermostat config
 * @returns {number} The target temperature to use
 */
function restoreTargetTemperature(self, cfg) {
  var storedTemp = self.getPsUserSetting('targetTemp', undefined);

  // TODO(Valerii 20-03-2026): Remove old storage migration after one year
  // Migration from old PersistentStorage('wbscThermostatSettings')
  if (storedTemp === undefined) {
    try {
      var oldPs = new PersistentStorage('wbscThermostatSettings', { global: true });
      if (typeof oldPs[self.idPrefix] !== 'undefined') {
        var oldTemp = oldPs[self.idPrefix].targetTemp;
        if (typeof oldTemp === 'number') {
          storedTemp = oldTemp;
          oldPs[self.idPrefix] = null;
          log.debug(
            'Migrated targetTemp="{}" from old storage for scenario="{}"',
            storedTemp,
            self.idPrefix
          );
        }
      }
    } catch (err) {
      log.error('Error reading old persistent storage: {}', err);
    }
  }

  var isValidStoredTemp =
    typeof storedTemp === 'number' &&
    storedTemp >= cfg.tempLimitsMin &&
    storedTemp <= cfg.tempLimitsMax;

  if (isValidStoredTemp) {
    self.setPsUserSetting('targetTemp', storedTemp);
    log.debug(
      'Restored targetTemp="{}" for scenario="{}"',
      storedTemp,
      self.idPrefix
    );
    return storedTemp;
  }

  // Either no stored value, or it's out of range
  var usedTemp = cfg.targetTemp;
  self.setPsUserSetting('targetTemp', usedTemp);

  // Show warning only if something was stored but invalid
  if (typeof storedTemp === 'number') {
    log.warning(
      'Stored temp="{}" is out of range or invalid for "{}". Reset to "{}"',
      storedTemp,
      self.idPrefix,
      usedTemp
    );
  }
  return usedTemp;
}

/**
 * Creates all required rules for current type scenario
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {ThermostatConfig} cfg - Configuration object
 * @returns {boolean} True if all rules created successfully, false otherwise
 */
function createRules(self, cfg) {
  log.debug('Start all required rules creation');

  var vdCtrlCurTemp = self.vd.devObj.getControl(vdCtrl.curTemp);
  var vdCtrlActuator = self.vd.devObj.getControl(vdCtrl.actuatorStatus);
  var vdCtrlTargetTemp = self.vd.devObj.getControl(vdCtrl.targetTemp);
  var vdCtrlEnable = self.vd.devObj.getControl(vdCtrl.ruleEnabled);

  var ruleCfg = {};
  var ruleId = null;

  // Temperature changed rule
  ruleCfg = {
    whenChanged: [cfg.tempSensor],
    then: function (newValue, devName, cellName) {
      vdCtrlCurTemp.setValue(newValue);

      // Cause this rule is not disabled when the scenario is disabled,
      // We update heating state only if the scenario is enabled
      if (vdCtrlEnable.getValue()) {
        var data = {
          curTemp: newValue,
          targetTemp: vdCtrlTargetTemp.getValue(),
          hysteresis: cfg.hysteresis,
        };
        updateHeatingState(vdCtrlActuator, cfg, data);
      }
    },
  };
  ruleId = defineRule(self.genNames.ruleTempChanged, ruleCfg);

  if (!ruleId) {
    log.error('Failed to create temperature changed rule');
    return false;
  }

  // This rule not disable when user use switch in virtual device
  log.debug('Temperature changed rule created success with ID "{}"', ruleId);

  // Scenario status rule
  ruleCfg = {
    whenChanged: [self.genNames.vDevice + '/' + vdCtrl.ruleEnabled],
    then: function (newValue, devName, cellName) {
      if (newValue) {
        var data = {
          curTemp: dev[cfg.tempSensor],
          targetTemp: vdCtrlTargetTemp.getValue(),
          hysteresis: cfg.hysteresis,
        };
        updateHeatingState(vdCtrlActuator, cfg, data);
      } else {
        turnOffAllActuators(vdCtrlActuator, cfg);
      }
    },
  };
  ruleId = defineRule(self.genNames.ruleSetScStatus, ruleCfg);

  if (!ruleId) {
    log.error('Failed to create scenario status rule');
    return false;
  }
  // This rule is not managed when user use switch enable/disable in vdev
  log.debug('Scenario status rule created with ID "{}"', ruleId);

  // Target temperature change rule
  ruleCfg = {
    whenChanged: [self.genNames.vDevice + '/' + vdCtrl.targetTemp],
    then: function (newValue, devName, cellName) {

      // Save the new temperature to persistent storage
      try {
        self.setPsUserSetting('targetTemp', newValue);
        log.debug(
          'Target temperature "{}" saved in persistent storage for scenario="{}"',
          newValue,
          self.idPrefix
        );
      } catch (err) {
        log.error('Error saving target temperature to storage: {}', err);
      }

      var curTemp = dev[cfg.tempSensor];
      var data = {
        curTemp: curTemp,
        targetTemp: newValue,
        hysteresis: cfg.hysteresis,
      };
      updateHeatingState(vdCtrlActuator, cfg, data);
    },
  };
  ruleId = defineRule(self.genNames.ruleSetTargetTemp, ruleCfg);

  if (!ruleId) {
    log.error('Failed to create target temperature change rule');
    return false;
  }
  self.addRule(ruleId);
  log.debug('Target temp change rule created success with ID "{}"', ruleId);

  // Error handling rule for temperature sensor
  var sensorErrTopic = cfg.tempSensor + '#error';
  ruleId = createErrChangeRule(
    self,
    self.genNames.ruleSensorErr,
    sensorErrTopic,
    vdCtrlCurTemp,
    vdCtrlEnable,
    cfg
  );
  if (!ruleId) {
    log.error('Failed to create tempSensor error handling rule');
    return false;
  }
  // This rule not disable when user use switch in virtual device
  log.debug('Temp. sensor error handling rule created with ID="{}"', ruleId);

  // Error handling rules for each actuator
  var baseRuleName = 'wbsc_' + self.idPrefix + '_';
  for (var i = 0; i < cfg.actuators.length; i++) {
    var actuatorErrTopic = cfg.actuators[i].mqttTopicName + '#error';
    var actuatorErrRuleName = baseRuleName + 'actuator_err_' + i;
    ruleId = createErrChangeRule(
      self,
      actuatorErrRuleName,
      actuatorErrTopic,
      vdCtrlActuator,
      vdCtrlEnable,
      cfg
    );
    if (!ruleId) {
      log.error(
        'Failed to create error handling rule for actuator "{}"',
        cfg.actuators[i].mqttTopicName
      );
      return false;
    }
    // This rule not disable when user use switch in virtual device
    log.debug(
      'Actuator error handling rule created for "{}" with ID="{}"',
      cfg.actuators[i].mqttTopicName,
      ruleId
    );
  }

  return true;
}

/**
 * Scenario initialization
 * @param {string} deviceTitle - Virtual device title
 * @param {ThermostatConfig} cfg - Configuration object
 * @returns {boolean} True if initialization succeeded
 */
ThermostatScenario.prototype.initSpecific = function (deviceTitle, cfg) {
  /**
   * NOTE: This method is executed ONLY when:
   * - Base initialization is complete
   * - Configuration is valid
   * - All referenced controls exist in the system
   *
   * The async initialization chain guarantees that all prerequisites are met.
   * No need to re-validate or check control existence here.
   */
  log.debug('Start init thermostat scenario');
  log.setLabel(loggerFileLabel + '/' + this.idPrefix);

  // Restore target temperature from storage
  var usedTemp = restoreTargetTemperature(this, cfg);

  // Add custom controls to virtual device
  addCustomControlsToVirtualDevice(this, cfg, usedTemp);

  // Create all rules
  var rulesCreated = createRules(this, cfg);

  if (rulesCreated) {
    // Set initial heater state after initialization
    var vdCtrlActuator = this.vd.devObj.getControl(vdCtrl.actuatorStatus);
    var vdCtrlTargetTemp = this.vd.devObj.getControl(vdCtrl.targetTemp);
    var data = {
      curTemp: dev[cfg.tempSensor],
      targetTemp: vdCtrlTargetTemp.getValue(),
      hysteresis: cfg.hysteresis,
    };
    updateHeatingState(vdCtrlActuator, cfg, data);

    this.setState(ScenarioState.NORMAL);
    log.debug('Thermostat scenario initialized successfully for device "{}"', deviceTitle);
  }

  return rulesCreated;
}

exports.ThermostatScenario = ThermostatScenario;
