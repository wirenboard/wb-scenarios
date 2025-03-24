/**
 * @file thermostat.mod.js - module for WirenBoard wb-rules 2.0
 * @description Module for initializing the thermostat algorithm
 *     based on user-specified parameters
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Comments formatted in JSDoc <https://jsdoc.app/> - Google styleguide
 */

var helpers = require('scenarios-general-helpers.mod');
var Logger = require('logger.mod').Logger;
var createBasicVd = require('virtual-device-helpers.mod').createBasicVd;

var loggerFileLabel = 'WBSC-thermostat-mod';
var log = new Logger(loggerFileLabel);

/**
 * One persistent-storage for all scenarios this type
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
var ps = null;

/**
 * Control key strings for virtual device
 */
var vdCtrl = {
  ruleEnabled: 'rule_enabled',
  targetTemp: 'target_temperature',
  curTemp: 'current_temperature',
  actuatorStatus: 'actuator_status',
  initStatus: 'init_status'
};

/**
 * Generates the names to be used
 * @param {string} idPrefix Prefix for identifying this algorithm
 *     For example: 'warm_floor_in_bathroom'
 * @returns {Object} An object with generated names
 */
function generateNames(idPrefix) {
  var scenarioPrefix = 'wbsc_';
  var baseRuleName = scenarioPrefix + idPrefix;

  var generatedNames = {
    vDevice: scenarioPrefix + idPrefix,
    ruleSyncActStatus: baseRuleName + '_sync_act_status',
    ruleTempChanged: baseRuleName + '_temp_changed',
    ruleSetScStatus: baseRuleName + '_set_sc_status',
    ruleSetTargetTemp: baseRuleName + '_set_target_t',
    ruleSensorErr: baseRuleName + '_sensor_error_changed',
    ruleActuatorErr: baseRuleName + '_actuator_error_changed',
  };

  return generatedNames;
}

/**
 * @typedef {Object} ThermostatConfig
 * @property {string} [idPrefix] Optional prefix for the name to identify
 *     the virtual device and rule:
 *     - If specified, the virtual device and rule will be named
 *       `wbsc_<!idPrefix!>` and `wbru_<!idPrefix!>`
 *     - If not specified (undefined), the name will be generated
 *       by transliterating the name passed to `init()`
 * @property {number} targetTemp Target temperature set by the user
 * @property {number} hysteresis Hysteresis value (switching range)
 * @property {number} tempLimitsMin Lower limit for temperature setting
 * @property {number} tempLimitsMax Upper limit for temperature setting
 * @property {string} tempSensor Name of the input control topic - monitored
 *     Example: temperature sensor whose value should be tracked
 *     'temp_sensor/temp_value'
 * @property {string} actuator Name of the output control topic - controlled
 *     Example: relay output to be controlled - 'relay_module/K2'
 */

/**
 * Validate the configuration parameters
 * @param {ThermostatConfig} cfg Configuration parameters
 * @returns {boolean} Validation status:
 *     - true: if the parameters are valid
 *     - false: if there is an error
 */
function isConfigValid(cfg) {
  var isLimitsCorrect = cfg.tempLimitsMin <= cfg.tempLimitsMax;
  if (isLimitsCorrect !== true) {
    log.error(
      'Config temperature limit "Min" = "{}" must be less than "Max" = "{}"',
      cfg.tempLimitsMin,
      cfg.tempLimitsMax
    );
  }

  var isTargetTempCorrect =
    cfg.targetTemp >= cfg.tempLimitsMin &&
    cfg.targetTemp <= cfg.tempLimitsMax;
  if (isTargetTempCorrect !== true) {
    log.error(
      'Target temperature "{}" must be in the range from "Min" to "Max"',
      cfg.targetTemp
    );
  }

  var isHysteresisCorrect = cfg.hysteresis > 0;
  if (isHysteresisCorrect !== true) {
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
  if (isTempSensorValid !== true) {
    log.error(
      'Sensor type must be "value" or "temperature", but got "{}"',
      tempSensorType
    );
  }

  var actuatorType = dev[cfg.actuator + '#type'];
  var isActuatorValid = actuatorType === null || actuatorType === 'switch';
  if (isActuatorValid !== true) {
    log.error('Actuator type must be "switch", but got "{}"', actuatorType);
  }

  var isCfgValid =
    isLimitsCorrect &&
    isTargetTempCorrect &&
    isHysteresisCorrect &&
    isTempSensorValid &&
    isActuatorValid;

  return isCfgValid;
}

/**
 * Sets an error on a virtual device in three steps:
 *   - Logs the error message
 *   - Sets an error on each control to turn the entire device red
 *   - Turn off all scenario logic rules by 'vd/rule_enabled' switch
 * @param {Object} vdObj The virtual device object
 * @param {string} errorMsg The error message to log
 */
function setVdTotalError(vdObj, errorMsg) {
  if (vdObj === undefined) {
    log.error('Virtual device does not exist in the system');
    return;
  }
  log.error(errorMsg);
  vdObj.controlsList().forEach(function (ctrl) {
    /**
     * The error type can be 'r', 'w', or 'p'
     * Our goal is to highlight the control in red
     */
    ctrl.setError('r');
  });
  vdObj.getControl(vdCtrl.ruleEnabled).setValue(false);
}

/**
 * Adds custom control cells to a virtual device for scenario functionality
 * @param {Object} vdObj The virtual device object
 * @param {ThermostatConfig} cfg Configuration parameters
 * @param {number} initialTemp Initial value for the target temperature
 */
function addCustomCellsToVd(vdObj, cfg, initialTemp) {
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
  vdObj.addControl(vdCtrl.targetTemp, controlCfg);

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
  vdObj.addControl(vdCtrl.curTemp, controlCfg);

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
  vdObj.addControl(vdCtrl.actuatorStatus, controlCfg);
}

/**
 * @typedef {Object} HeatingStateData
 * @property {number} curTemp The current temperature (°C)
 * @property {number} targetTemp The target temperature (°C)
 * @property {number} hysteresis The hysteresis value (°C)
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
 * @param {string} actuator The actuator identifier (key in the dev object)
 * @param {HeatingStateData} data Heating state data
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
 * Checks if the given error value contains a critical error.
 * A critical error is defined as a string containing 'r' or 'w'
 * @param {string|undefined} errorVal The error value to check
 * @returns {boolean} True if there is a critical error, false otherwise
 */
function hasCriticalErr(errorVal) {
  if (typeof errorVal !== 'string') {
    return false;
  }

  return (errorVal.indexOf('r') !== -1 || errorVal.indexOf('w') !== -1);
}

/**
 * Checks if all specified topics are properly initialized
 * 
 * @param {string[]} topics - Array of string topics to check
 *     Example: ['relay_module/K2', 'temp_sensor/temp_value']
 * @returns {boolean} Returns true if ALL topics in the array are initialized
 *     (non-null #type) and have no critical errors, otherwise false
 */
function isTopicsInited(topics) {
  for (var i = 0; i < topics.length; i++) {
    var topic = topics[i];
    if (dev[topic + '#type'] === null) {
      return false;
    }
    if (hasCriticalErr(dev[topic + '#error'])) {
      return false;
    }
  }
  return true;
}

/**
 * Updates the readonly state of the rule enable control
 * Removes readonly only when both errors (sensor and actuator) are cleared
 * @param {object} vdCtrlEnable Control "Enable rules" in scenario virtual dev
 * @param {ThermostatConfig} cfg Configuration parameters
 */
function tryClearReadonly(vdCtrlEnable, cfg) {
  if ( !hasCriticalErr(dev[cfg.tempSensor + '#error']) &&
       !hasCriticalErr(dev[cfg.actuator + '#error'])
  ) {
    vdCtrlEnable.setReadonly(false);
  }
}

var errorTimers = {};
var errorCheckTimeoutMs = 10000; // 10s debounce time

/**
 * Creates an error handling rule for a sensor or actuator
 * @param {string} ruleName The name of the rule to be created
 * @param {string} sourceErrTopic The MQTT topic where error events published
 *     Example: "temperature_sensor/temperature#error", "relay_module/K2#error"
 * @param {Object} targetVdCtrl The target virtual device control for sync
 *     Example: `vdCtrlCurTemp = vdObj.getControl('ctrlID')`
 * @param {object} vdCtrlEnable Control "Enable rules" in scenario virtual dev
 * @param {ThermostatConfig} cfg Configuration parameters
 * @returns {number|null} The ID of the created rule, or `null` if failed
 */
function createErrChangeRule(
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

        // If on this topic was running timer - disable this timer
        if (errorTimers[sourceErrTopic]) {
          clearTimeout(errorTimers[sourceErrTopic]);
          errorTimers[sourceErrTopic] = null;
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
      if (errorTimers[sourceErrTopic]) {
        return;
      }

      errorTimers[sourceErrTopic] = setTimeout(function () {
        // When timer stop - check still critical errors r/w
        var currentErrorVal = dev[sourceErrTopic];
        if (hasCriticalErr(currentErrorVal)) {
          log.error(
            'Scenario disabled: critical error (r/w) for topic "{}" not cleared for {} ms. Current error state: "{}"',
            sourceErrTopic,
            errorCheckTimeoutMs,
            currentErrorVal
          );
          vdCtrlEnable.setReadonly(true);
          vdCtrlEnable.setValue(false);
        } else {
          log.debug(
            'Error in topic "{}" cleared before timer disabled. Scenario still running.',
            sourceErrTopic
          );
        }
        errorTimers[sourceErrTopic] = null;
      }, errorCheckTimeoutMs);
    },
  };

  var ruleId = defineRule(ruleName, ruleCfg);
  return ruleId;
}

/**
 * Creates thermostat control rules
 * @param {ThermostatConfig} cfg Configuration parameters
 * @param {Object} genNames Generated names
 * @param {Object} vdObj Scenario virtual device
 * @param {Array<string>} managedRulesId Array of rule IDs for enabling/disabling
 * @param {string} idPrefix Unique identifier of the scenario for persistent storage
 */
function createRules(cfg, genNames, vdObj, managedRulesId, idPrefix) {
  var vdCtrlCurTemp = vdObj.getControl(vdCtrl.curTemp);
  var vdCtrlActuator = vdObj.getControl(vdCtrl.actuatorStatus);
  var vdCtrlTargetTemp = vdObj.getControl(vdCtrl.targetTemp);
  var vdCtrlEnable = vdObj.getControl(vdCtrl.ruleEnabled);

  var ruleCfg = {};
  var ruleId = null;

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
  ruleId = defineRule(genNames.ruleTempChanged, ruleCfg);
  managedRulesId.push(ruleId);
  log.debug('Temperature changed rule created success with ID "{}"', ruleId);

  ruleCfg = {
    whenChanged: [cfg.actuator],
    then: function (newValue, devName, cellName) {
      vdCtrlActuator.setValue(newValue);
    },
  };
  ruleId = defineRule(genNames.ruleSyncActStatus, ruleCfg);
  managedRulesId.push(ruleId);
  log.debug(
    'Sync actuator status rule created success with ID "{}"',
    ruleId
  );

  ruleCfg = {
    whenChanged: [genNames.vDevice + '/' + vdCtrl.ruleEnabled],
    then: function (newValue, devName, cellName) {
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
  ruleId = defineRule(genNames.ruleSetScStatus, ruleCfg);
  // This rule not disable when user use switch in virtual device
  log.debug(
    'Activate scenario status rule created success with ID "{}"',
    ruleId
  );

  ruleCfg = {
    whenChanged: [genNames.vDevice + '/' + vdCtrl.targetTemp],
    then: function (newValue, devName, cellName) {

      // Save the new temperature to persistent storage
      if (ps && typeof ps[idPrefix] !== 'undefined') {
        try {
          ps[idPrefix].targetTemp = newValue;
          log.debug(
            'Target temperature "{}" saved in persistent storage for scenario="{}"',
            newValue,
            idPrefix
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
  ruleId = defineRule(genNames.ruleSetTargetTemp, ruleCfg);
  managedRulesId.push(ruleId);
  log.debug('Target temp change rule created success with ID "{}"', ruleId);

  var sensorErrTopic = cfg.tempSensor + '#error';
  ruleId = createErrChangeRule(
    genNames.ruleSensorErr,
    sensorErrTopic,
    vdCtrlCurTemp,
    vdCtrlEnable,
    cfg
  );
  // This rule not disable when user use switch in virtual device
  log.debug('Temp. sensor error handling rule created with ID="{}"', ruleId);

  var actuatorErrTopic = cfg.actuator + '#error';
  ruleId = createErrChangeRule(
    genNames.ruleActuatorErr,
    actuatorErrTopic,
    vdCtrlActuator,
    vdCtrlEnable,
    cfg
  );
  // This rule not disable when user use switch in virtual device
  log.debug('Actuator error handling rule created with ID="{}"', ruleId);
}

/**
 * Restore target temperature from persistent storage (if saved previosly)
 * If the stored value is invalid or missing, we use cfg.targetTemp and save it
 * @param {string} idPrefix Unique identifier of the scenario
 * @param {Object} cfg Thermostat config (tempLimitsMin, tempLimitsMax, etc.)
 * @returns {number} The target temperature to use
 */
function restoreTargetTemperature(idPrefix, cfg) {
  if (typeof ps[idPrefix] === 'undefined') {
    try {
      ps[idPrefix] = StorableObject({});
    } catch (err) {
      log.error('Error on ps[idPrefix] assignment: {}', err);
      return cfg.targetTemp;
    }

    log.debug(
      'Created new record in persistent storage for scenario="{}"',
      idPrefix
    );
  }

  var storedTemp = ps[idPrefix].targetTemp;
  var isValidStoredTemp =
    typeof storedTemp === 'number' &&
    storedTemp >= cfg.tempLimitsMin &&
    storedTemp <= cfg.tempLimitsMax;

  if (isValidStoredTemp) {
    log.debug(
      'Restored targetTemp="{}" for scenario="{}"',
      storedTemp,
      idPrefix
    );
    return storedTemp;
  } else {
    // Either no stored value, or it's out of range
    var usedTemp = cfg.targetTemp;
    ps[idPrefix].targetTemp = usedTemp;

    // Show warning only if something was stored but invalid
    if (typeof storedTemp === 'number') {
      log.warning(
        'Stored temp="{}" is out of range or invalid for "{}". Reset to "{}"',
        storedTemp,
        idPrefix,
        usedTemp
      );
    }
    return usedTemp;
  }
}

/**
 * Initializes a virtual device and defines a rule
 * for controlling the device
 * @param {string} deviceTitle Name of the virtual device
 * @param {ThermostatConfig} cfg Configuration parameters
 * @returns {boolean} Returns true if initialization is successful, otherwise false
 */
function init(deviceTitle, cfg) {
  ps = new PersistentStorage('wbscThermostatSettings', { global: true });
  var idPrefix = helpers.getIdPrefix(deviceTitle, cfg);
  log.setLabel(loggerFileLabel + '/' + idPrefix);
  var genNames = generateNames(idPrefix);

  // Create a minimal basic virtual device to indicate errors if they occur
  var managedRulesId = [];
  var vdObj = createBasicVd(genNames.vDevice, deviceTitle, managedRulesId);
  if (vdObj === null) {
    return false;
  }

  // Set up a timer that will wait for initialization
  // If the topics become available after N seconds, continue
  var checkIntervalMs = 500;
  var totalWaitMs = 10000;
  var elapsedMs = 0;
  var initStatusCtrl = vdObj.getControl(vdCtrl.initStatus);
  initStatusCtrl.setValue('Wait linked topic initialisation for ' + (totalWaitMs / 1000) + 's ...');
  var waitTimer = setInterval(function () {
    elapsedMs += checkIntervalMs;

    if (isTopicsInited([cfg.tempSensor, cfg.actuator])) {
      clearInterval(waitTimer);
      initStatusCtrl.setValue('Topics initialized, startup continuing...');

      if (!isConfigValid(cfg)) {
        setVdTotalError(vdObj, 'Config not valid');
        return false;
      }

      var usedTemp = restoreTargetTemperature(idPrefix, cfg);
      addCustomCellsToVd(vdObj, cfg, usedTemp);
      createRules(cfg, genNames, vdObj, managedRulesId, idPrefix);

      // Set first heater state after initialisation
      var data = {
        curTemp: dev[cfg.tempSensor],
        targetTemp: dev[genNames.vDevice + '/' + vdCtrl.targetTemp],
        hysteresis: cfg.hysteresis,
      };
      updateHeatingState(cfg.actuator, data);

      vdObj.removeControl(vdCtrl.initStatus);
      log.debug('Thermostat init complete for device "{}".', deviceTitle);
    } else if (elapsedMs >= totalWaitMs) {
      var msg = 'Failed to initialize linked topics in ' + (elapsedMs / 1000) + 's.';
      initStatusCtrl.setValue(msg);

      clearInterval(waitTimer);
      setVdTotalError(vdObj, msg);
      log.error(msg);
    }
  }, checkIntervalMs);

  return true;
}

exports.init = init;
