/**
 * @file thermostat.mod.js - ES5 module for wb-rules v2.34
 * @description Thermostat scenario class that extends ScenarioBase
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState = require('virtual-device-helpers.mod').ScenarioState;
var Logger = require('logger.mod').Logger;

var hasCriticalErr = require('wbsc-wait-controls.mod').hasCriticalErr;

var loggerFileLabel = 'WBSC-thermostat-mod';
var log = new Logger(loggerFileLabel);

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
 * @property {string} actuator - Name of the output control topic - controlled
 *   Example: relay output to be controlled - 'relay_module/K2'
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
   * @type {Object}
   */
  this.ctx = {
    /**
     * One persistent-storage for all scenarios this type
     * contain target temperature set by user in virtual device
     * @example
     *   ps = {
     *     "bathroom_floor": {
     *       "targetTemp": 22
     *     },
     *     "kitchen_heater": {
     *       "targetTemp": 24
     *     },
     *     ...
     *   }
     */
    ps: null,
    
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
    ruleSyncActStatus: baseRuleName + 'sync_act_status',
    ruleSetScStatus: baseRuleName + 'set_sc_status',
    ruleSetTargetTemp: baseRuleName + 'set_target_t',
    ruleSensorErr: baseRuleName + 'sensor_error_changed',
    ruleActuatorErr: baseRuleName + 'actuator_error_changed',
  };
};

/**
 * Get configuration for waiting for controls
 * @param {Object} cfg - Configuration object
 * @returns {Object} Waiting configuration object
 */
ThermostatScenario.prototype.defineControlsWaitConfig = function (cfg) {
  var allTopics = [].concat(
    cfg.tempSensor,
    cfg.actuator
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

  var actuatorType = dev[cfg.actuator + '#type'];
  var isActuatorValid = actuatorType === null || actuatorType === 'switch';
  if (!isActuatorValid) {
    log.error('Actuator type must be "switch", but got "{}"', actuatorType);
  }

  var isCfgValid =
    isLimitsCorrect &&
    isTargetTempCorrect &&
    isHysteresisCorrect &&
    isTempSensorValid &&
    isActuatorValid;

  return isCfgValid;
};

/**
 * Adds required custom controls cells to the virtual device
 * @param {Object} self - Reference to the ThermostatScenario instance
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
    type: dev[cfg.actuator + '#type'],
    value: dev[cfg.actuator],
    order: 4,
    readonly: true,
  };
  self.vd.devObj.addControl(vdCtrl.actuatorStatus, controlCfg);
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
 * temperature, and hysteresis. Sets the new state if it has changed
 * @param {string} actuator - The actuator identifier (key in the dev object)
 * @param {HeatingStateData} data - Heating state data
 */
function updateHeatingState(actuator, data) {
  var currentState = dev[actuator];
  var upperLimit = data.targetTemp + data.hysteresis;
  var lowerLimit = data.targetTemp - data.hysteresis;

  // Update state only if it has changed
  var isNeedTurnOffHeating =
    data.curTemp >= upperLimit && currentState === true;
  var isNeedTurnOnHeating =
    data.curTemp <= lowerLimit && currentState === false;

  if (isNeedTurnOffHeating) {
    log.debug(
      'Heater turned OFF, current/target temperatures: "{}"/"{}" °C',
      data.curTemp,
      data.targetTemp
    );
    dev[actuator] = false;
  } else if (isNeedTurnOnHeating) {
    log.debug(
      'Heater turned ON, current/target temperatures: "{}"/"{}" °C',
      data.curTemp,
      data.targetTemp
    );
    dev[actuator] = true;
  }
}

/**
 * Updates the readonly state of the rule enable control
 * Removes readonly only when both errors (sensor and actuator) are cleared
 * @param {Object} vdCtrlEnable - Control "Enable rules" in scenario virtual dev
 * @param {ThermostatConfig} cfg - Configuration parameters
 */
function tryClearReadonly(vdCtrlEnable, cfg) {
  if (!hasCriticalErr(dev[cfg.tempSensor + '#error']) &&
       !hasCriticalErr(dev[cfg.actuator + '#error'])
  ) {
    vdCtrlEnable.setReadonly(false);
  }
}

/**
 * Creates an error handling rule for a sensor or actuator
 * @param {Object} self - Reference to the ThermostatScenario instance
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
  var ruleCfg = {
    whenChanged: [sourceErrTopic],
    then: function (newValue, devName, cellName) {
      targetVdCtrl.setError(newValue);

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
 * Restore target temperature and enable state from persistent storage
 * Falls back to config defaults if values are missing or invalid
 * @param {Object} self - Reference to the ThermostatScenario instance
 * @param {ThermostatConfig} cfg - Thermostat config
 * @returns {Object} Restored values: { targetTemp, enabled }
 */
function restorePersistentState(self, cfg) {
  if (typeof self.ctx.ps[self.idPrefix] === 'undefined') {
    try {
      self.ctx.ps[self.idPrefix] = StorableObject({});
    } catch (err) {
      log.error('Error on self.ctx.ps[self.idPrefix] assignment: {}', err);
      return {
        targetTemp: cfg.targetTemp,
        enabled: true,
      };
    }

    log.debug(
      'Created new record in persistent storage for scenario="{}"',
      self.idPrefix
    );
  }

  var storedTemp = self.ctx.ps[self.idPrefix].targetTemp;
  var isValidStoredTemp =
    typeof storedTemp === 'number' &&
    storedTemp >= cfg.tempLimitsMin &&
    storedTemp <= cfg.tempLimitsMax;

  var usedTemp = isValidStoredTemp ? storedTemp : cfg.targetTemp;
  if (!isValidStoredTemp) {
    self.ctx.ps[self.idPrefix].targetTemp = usedTemp;

    if (typeof storedTemp === 'number') {
      log.warning(
        'Stored temp="{}" is out of range or invalid for "{}". Reset to "{}"',
        storedTemp,
        self.idPrefix,
        usedTemp
      );
    }
  } else {
    log.debug(
      'Restored targetTemp="{}" for scenario="{}"',
      storedTemp,
      self.idPrefix
    );
  }

  var storedEnabled = self.ctx.ps[self.idPrefix].enabled;
  var isValidEnabled = typeof storedEnabled === 'boolean';
  var usedEnabled = isValidEnabled ? storedEnabled : true;
  if (!isValidEnabled) {
    self.ctx.ps[self.idPrefix].enabled = usedEnabled;
  }

  return {
    targetTemp: usedTemp,
    enabled: usedEnabled,
  };
}

/**
 * Creates all required rules for current type scenario
 * @param {Object} self - Reference to the ThermostatScenario instance
 * @param {ThermostatConfig} cfg - Configuration object
 * @returns {boolean} True if all rules created successfully, false otherwise
 */
function createRules(self, cfg) {
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
      var data = {
        curTemp: newValue,
        targetTemp: vdCtrlTargetTemp.getValue(),
        hysteresis: cfg.hysteresis,
      };
      updateHeatingState(cfg.actuator, data);
    },
  };
  ruleId = defineRule(self.genNames.ruleTempChanged, ruleCfg);

  if (!ruleId) {
    log.error('Failed to create temperature changed rule');
    return false;
  }
  self.addRule(ruleId);
  log.debug('Temperature changed rule created success with ID "{}"', ruleId);

  // Sync actuator status rule
  ruleCfg = {
    whenChanged: [cfg.actuator],
    then: function (newValue, devName, cellName) {
      vdCtrlActuator.setValue(newValue);
    },
  };
  ruleId = defineRule(self.genNames.ruleSyncActStatus, ruleCfg);

  if (!ruleId) {
    log.error('Failed to create sync actuator status rule');
    return false;
  }
  self.addRule(ruleId);
  log.debug(
    'Sync actuator status rule created success with ID "{}"',
    ruleId
  );

  // Scenario status rule
  ruleCfg = {
    whenChanged: [self.genNames.vDevice + '/' + vdCtrl.ruleEnabled],
    then: function (newValue, devName, cellName) {
      if (self.ctx.ps && typeof self.ctx.ps[self.idPrefix] !== 'undefined') {
        try {
          self.ctx.ps[self.idPrefix].enabled = newValue;
          log.debug(
            'Scenario enabled state "{}" saved for scenario="{}"',
            newValue,
            self.idPrefix
          );
        } catch (err) {
          log.error('Error saving enabled state to storage: {}', err);
        }
      }

      if (newValue) {
        var data = {
          curTemp: dev[cfg.tempSensor],
          targetTemp: vdCtrlTargetTemp.getValue(),
          hysteresis: cfg.hysteresis,
        };
        updateHeatingState(cfg.actuator, data);
        /* Sync actual device status with VD **/
        vdCtrlCurTemp.setValue(dev[cfg.tempSensor]);
      } else {
        dev[cfg.actuator] = false;
        // Sync vd control state, because actuator sync-rule was disabled
        vdCtrlActuator.setValue(false);
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
      if (self.ctx.ps && typeof self.ctx.ps[self.idPrefix] !== 'undefined') {
        try {
          self.ctx.ps[self.idPrefix].targetTemp = newValue;
          log.debug(
            'Target temperature "{}" saved in persistent storage for scenario="{}"',
            newValue,
            self.idPrefix
          );
        } catch (err) {
          log.error('Error saving target temperature to storage: {}', err);
        }
      }

      var curTemp = dev[cfg.tempSensor];
      var data = {
        curTemp: curTemp,
        targetTemp: newValue,
        hysteresis: cfg.hysteresis,
      };
      updateHeatingState(cfg.actuator, data);
    },
  };
  ruleId = defineRule(self.genNames.ruleSetTargetTemp, ruleCfg);

  if (!ruleId) {
    log.error('Failed to create target temperature change rule');
    return false;
  }
  self.addRule(ruleId);
  log.debug('Target temp change rule created success with ID "{}"', ruleId);

  // Error handling rules
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

  var actuatorErrTopic = cfg.actuator + '#error';
  ruleId = createErrChangeRule(
    self,
    self.genNames.ruleActuatorErr,
    actuatorErrTopic,
    vdCtrlActuator,
    vdCtrlEnable,
    cfg
  );
  if (!ruleId) {
    log.error('Failed to create actuator error handling rule');
    return false;
  }
  // This rule not disable when user use switch in virtual device
  log.debug('Actuator error handling rule created with ID="{}"', ruleId);

  return true;
}

/**
 * Scenario initialization
 * @param {string} deviceTitle - Virtual device title
 * @param {ThermostatConfig} cfg - Configuration object
 * @returns {boolean} True if initialization succeeded
 */
ThermostatScenario.prototype.initSpecific = function (deviceTitle, cfg) {
  log.debug('Start init thermostat scenario');
  log.setLabel(loggerFileLabel + '/' + this.idPrefix);

  // Initialize persistent storage
  this.ctx.ps = new PersistentStorage('wbscThermostatSettings', { global: true });

  // Restore target temperature and enable state from storage
  var restored = restorePersistentState(this, cfg);

  // Add custom controls to virtual device
  addCustomControlsToVirtualDevice(this, cfg, restored.targetTemp);

  // Create all rules
  log.debug('Start all required rules creation');
  var rulesCreated = createRules(this, cfg);

  if (rulesCreated) {
    var vdCtrlEnable = this.vd.devObj.getControl(vdCtrl.ruleEnabled);
    if (vdCtrlEnable && vdCtrlEnable.getValue() !== restored.enabled) {
      vdCtrlEnable.setValue(restored.enabled);
    }

    // Set initial heater state after initialization
    var data = {
      curTemp: dev[cfg.tempSensor],
      targetTemp: dev[this.genNames.vDevice + '/' + vdCtrl.targetTemp],
      hysteresis: cfg.hysteresis,
    };
    if (vdCtrlEnable && vdCtrlEnable.getValue()) {
      updateHeatingState(cfg.actuator, data);
    } else {
      dev[cfg.actuator] = false;
    }

    this.setState(ScenarioState.NORMAL);
    log.debug('Thermostat scenario initialized successfully for device "{}"', deviceTitle);
  }

  return rulesCreated;
}

exports.ThermostatScenario = ThermostatScenario;
