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

var loggerFileLabel = 'WBSC-thermostat-mod';
var log = new Logger(loggerFileLabel);

/**
 * Control key strings for virtual device
 */
var vdCtrl = {
  ruleEnabled: 'rule_enabled',
  targetTemp: 'target_temperature',
  curTemp: 'current_temperature',
  actuatorStatus: 'actuator_status',
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
    rule_sync_act_status: baseRuleName + '_sync_act_status',
    rule_temp_changed: baseRuleName + '_temp_changed',
    rule_set_sc_status: baseRuleName + '_set_sc_status',
    rule_set_target_t: baseRuleName + '_set_target_t',
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
 * Creates a basic virtual device with a rule switch if it not already exist
 * @param {string} vdName The name of the virtual device
 * @param {string} vdTitle The title of the virtual device
 * @param {Array<number>} managedRulesId Array of rule IDs to toggle on switch
 * @returns {Object|null} The virtual device object if created, otherwise null
 */
function createBasicVd(vdName, vdTitle, managedRulesId) {
  var existingVdObj = getDevice(vdName);
  if (existingVdObj !== undefined) {
    log.error('Virtual device "{}" already exists in system', vdName);
    return null;
  }
  log.debug(
    'Virtual device "{}" not exists in system -> create new',
    vdName
  );

  var vdCfg = {
    title: vdTitle,
    cells: {},
  };
  var vdObj = defineVirtualDevice(vdName, vdCfg);
  if (!vdObj) {
    log.error('Virtual device "{}" not created', vdTitle);
    return null;
  }

  var controlCfg = {
    title: {
      en: 'Activate scenario rule',
      ru: 'Активировать правило сценария',
    },
    type: 'switch',
    value: true,
  };
  vdObj.addControl(vdCtrl.ruleEnabled, controlCfg);

  function toggleRules(newValue) {
    for (var i = 0; i < managedRulesId.length; i++) {
      if (newValue) {
        enableRule(managedRulesId[i]);
      } else {
        disableRule(managedRulesId[i]);
      }
    }
  }

  var ruleId = defineRule(vdName + '_change_' + vdCtrl.ruleEnabled, {
    whenChanged: [vdName + '/' + vdCtrl.ruleEnabled],
    then: toggleRules,
  });

  if (!ruleId) {
    log.error('Failed to create the rule: {}', vdName);
    return null;
  }

  log.debug('Base VD and rule with names "{}" created successfully', vdName);
  return vdObj;
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
 */
function addCustomCellsToVd(vdObj, cfg) {
  var controlCfg = {
    title: {
      en: 'Temperature Setpoint',
      ru: 'Заданная температура',
    },
    type: 'range',
    value: cfg.targetTemp,
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
 * Creates thermostat control rules
 * @param {ThermostatConfig} cfg Configuration parameters
 * @param {Object} genNames Generated names
 * @param {Object} vdObj Scenario virtual device
 * @param {Array<string>} managedRulesId Array of rule IDs for enabling/disabling
 */
function createRules(cfg, genNames, vdObj, managedRulesId) {
  var ruleCfg = {};
  var ruleId = null;

  ctrlCurTemp = vdObj.getControl(vdCtrl.curTemp);
  ctrlActuator = vdObj.getControl(vdCtrl.actuatorStatus);
  ctrlTartetTemp = vdObj.getControl(vdCtrl.targetTemp);
  ctrlEnable = vdObj.getControl(vdCtrl.ruleEnabled);

  ruleCfg = {
    whenChanged: [cfg.tempSensor],
    then: function (newValue, devName, cellName) {
      ctrlCurTemp.setValue(newValue);

      var data = {
        curTemp: newValue,
        targetTemp: ctrlTartetTemp.getValue(),
        hysteresis: cfg.hysteresis,
      };
      updateHeatingState(cfg.actuator, data);
    },
  };
  ruleId = defineRule(genNames.rule_temp_changed, ruleCfg);
  managedRulesId.push(ruleId);
  log.debug('Temperature changed rule created success with ID "{}"', ruleId);

  ruleCfg = {
    whenChanged: [cfg.actuator],
    then: function (newValue, devName, cellName) {
      ctrlActuator.setValue(newValue);
    },
  };
  ruleId = defineRule(genNames.rule_sync_act_status, ruleCfg);
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
          targetTemp: ctrlTartetTemp.getValue(),
          hysteresis: cfg.hysteresis,
        };
        updateHeatingState(cfg.actuator, data);
        /* Sync actual device status with VD **/
        ctrlCurTemp.setValue(dev[cfg.tempSensor]);
      } else {
        dev[cfg.actuator] = false;
        ctrlActuator.setValue(false);
      }
    },
  };
  ruleId = defineRule(genNames.rule_set_sc_status, ruleCfg);
  // This rule not disable when user use switch in virtual device
  log.debug(
    'Activate scenario status rule created success with ID "{}"',
    ruleId
  );

  ruleCfg = {
    whenChanged: [genNames.vDevice + '/' + vdCtrl.targetTemp],
    then: function (newValue, devName, cellName) {
      var curTemp = dev[cfg.tempSensor];
      var data = {
        curTemp: curTemp,
        targetTemp: newValue,
        hysteresis: cfg.hysteresis,
      };
      updateHeatingState(cfg.actuator, data);
    },
  };
  ruleId = defineRule(genNames.rule_set_target_t, ruleCfg);
  managedRulesId.push(ruleId);
  log.debug('Target temp change rule created success with ID "{}"', ruleId);

  /**
   * Rule to handle temperature sensor errors
   */
  var sensorErrTopic = cfg.tempSensor + '#error';
  var ruleCfg = {
    whenChanged: [sensorErrTopic],
    then: function (newValue, devName, cellName) {
      if (newValue !== '') {
        log.error(
          'Scenario disabled: Temperature sensor error topic {} state: {}',
          sensorErrTopic,
          newValue
        );
        ctrlCurTemp.setError(newValue);
        ctrlEnable.setReadonly(true);
        ctrlEnable.setValue(false);
      } else {
        // The error is cleared – reset the control's error state
        ctrlCurTemp.setError('');
        ctrlEnable.setReadonly(false);
      }
    },
  };
  var ruleId = defineRule(genNames.vDevice + '_sensor_error_watch', ruleCfg);
  // This rule not disable when user use switch in virtual device
  log.debug('Temp. sensor error handling rule created with ID="{}"', ruleId);

  /**
   * Rule to handle actuator errors
   */
  var actuatorErrTopic = cfg.actuator + '#error';
  ruleCfg = {
    whenChanged: [actuatorErrTopic],
    then: function (newValue, devName, cellName) {
      if (newValue !== '') {
        log.error(
          'Scenario disabled: Actuator (heater) error topic {} state: {}',
          actuatorErrTopic,
          newValue
        );
        ctrlActuator.setError(newValue);
        ctrlEnable.setReadonly(true);
        ctrlEnable.setValue(false);
      } else {
        // The error is cleared – reset the control's error state
        ctrlActuator.setError('');
        ctrlEnable.setReadonly(false);
      }
    },
  };
  var ruleId = defineRule(
    genNames.vDevice + '_actuator_error_watch',
    ruleCfg
  );
  // This rule not disable when user use switch in virtual device
  log.debug('Actuator error handling rule created with ID="{}"', ruleId);
}

/**
 * Initializes a virtual device and defines a rule
 * for controlling the device
 * @param {string} deviceTitle Name of the virtual device
 * @param {ThermostatConfig} cfg Configuration parameters
 * @returns {boolean} Returns true if initialization is successful, otherwise false
 */
function init(deviceTitle, cfg) {
  var idPrefix = helpers.getIdPrefix(deviceTitle, cfg);
  log.setLabel(loggerFileLabel + '/' + idPrefix);
  var genNames = generateNames(idPrefix);

  // Create a minimal basic virtual device to indicate errors if they occur
  var managedRulesId = [];
  var vdObj = createBasicVd(genNames.vDevice, deviceTitle, managedRulesId);
  if (vdObj === null) {
    return false;
  }

  if (isConfigValid(cfg) !== true) {
    setVdTotalError(vdObj, 'Config not valid');
    return false;
  }

  addCustomCellsToVd(vdObj, cfg);
  createRules(cfg, genNames, vdObj, managedRulesId);

  // Set first heater state after initialisation
  var data = {
    curTemp: dev[cfg.tempSensor],
    targetTemp: dev[genNames.vDevice + '/' + vdCtrl.targetTemp],
    hysteresis: cfg.hysteresis,
  };
  updateHeatingState(cfg.actuator, data);

  return true;
}

exports.init = init;
