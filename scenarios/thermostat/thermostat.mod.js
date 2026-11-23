/**
 * @file thermostat.mod.js - ES5 module for wb-rules v2.34
 * @description Thermostat scenario class that extends ScenarioBase
 *     Heating and cooling circuits share the temperature sensor. One circuit
 *     regulates at a time, circuit-switcher.mod.js picks it by the temperature.
 *     Regulators of the circuits live in thermostat-hysteresis.mod.js and
 *     thermostat-pid.mod.js
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState = require('virtual-device-helpers.mod').ScenarioState;
var isRangeStepValid = require('virtual-device-helpers.mod').isRangeStepValid;
var getRangeStep = require('virtual-device-helpers.mod').getRangeStep;
var Logger = require('logger.mod').Logger;
var actionsTable = require('table-handling-actions.mod').actionsTable;
var HeatFlowDirection = require('constants.mod').HeatFlowDirection;
var HysteresisRegulator =
  require('thermostat-hysteresis.mod').HysteresisRegulator;
var PidRegulator = require('thermostat-pid.mod').PidRegulator;
var CircuitSwitcher = require('circuit-switcher.mod').CircuitSwitcher;
var getEnabledCircuitNames =
  require('circuit-switcher.mod').getEnabledCircuitNames;
var getEnabledCircuitsActuators =
  require('circuit-switcher.mod').getEnabledCircuitsActuators;
var getCircuitsLinkErrors =
  require('circuit-switcher.mod').getCircuitsLinkErrors;
var getPidSettingsErrors = require('pid-engine.mod').getPidSettingsErrors;

var hasCriticalErr = require('wbsc-wait-controls.mod').hasCriticalErr;
var isControlTypeValid =
  require('scenarios-general-helpers.mod').isControlTypeValid;
var extractMqttTopics =
  require('scenarios-general-helpers.mod').extractMqttTopics;

var loggerFileLabel = 'WBSC-thermostat-mod';
var log = new Logger(loggerFileLabel);

/**
 * Actions table for thermostat actuators.
 * Only setEnable and setDisable are allowed.
 */
var thermostatActionsTable = {
  setEnable: actionsTable.setEnable,
  setDisable: actionsTable.setDisable,
};

/**
 * @typedef {Object} ActuatorConfig
 * @property {string} mqttTopicName - MQTT topic of the actuator (e.g. 'relay_module/K2')
 * @property {'setEnable'|'setDisable'} behaviorType - Action when the circuit works
 */

/**
 * @typedef {Object} PidCoefficients
 * @property {number} kp - Proportional gain
 * @property {number} ki - Integral gain
 * @property {number} kd - Derivative gain
 */

/**
 * @typedef {Object} PidSettings
 * @property {number} deadBand - Dead band around setpoint (°C)
 * @property {PidCoefficients} pidCoefficients - PID gains (kp, ki, kd)
 * @property {number} pwmPeriodSec - PWM cycle duration (seconds)
 * @property {number} pidRecalcCycles - Recompute PID every N cycles
 * @property {number} minOnTimeSec - Minimum circuit work time in a cycle (s)
 * @property {number} minOffTimeSec - Minimum circuit pause in a cycle (s)
 */

/**
 * @typedef {Object} ThermostatCircuitConfig
 * @property {number} targetTemp - Target temperature set by the user
 * @property {number} tempLimitsMin - Lower limit for temperature setting
 * @property {number} tempLimitsMax - Upper limit for temperature setting
 * @property {Array<ActuatorConfig>} actuators - List of output controls
 * @property {'hysteresis'|'pid'} controlMode - Control algorithm selector
 * @property {number} [hysteresis] - Switching range (°C), hysteresis mode
 * @property {PidSettings} [pidSettings] - PID settings, PID mode
 */

/**
 * @typedef {Object} ThermostatConfig
 * @property {string} [idPrefix] - Optional prefix for scenario identification
 *   If not provided, it will be generated from the scenario name
 * @property {string} tempSensor - Name of the input control topic - monitored
 *   Example: temperature sensor whose value should be tracked
 *   'temp_sensor/temp_value'
 * @property {number} [targetTempStep] - Slider step of the target temperature
 *   controls of both circuits, published as the control precision.
 *   Defaults to 0.1
 * @property {ThermostatCircuitConfig} [heating] - Heating circuit,
 *   absent when heating is off
 * @property {ThermostatCircuitConfig} [cooling] - Cooling circuit,
 *   absent when cooling is off
 */

/**
 * Runtime of one enabled circuit
 * The regulator gets the circuit and uses name, getTemperature, getSetpoint,
 * setWorking and log, CircuitSwitcher also uses showSetpointError
 * @typedef {Object} Circuit
 * @property {HeatFlowDirection} name - Circuit name
 * @property {ThermostatCircuitConfig} cfg - Circuit configuration
 * @property {function(): number} getTemperature - Current temperature
 * @property {function(): number} getSetpoint - Setpoint of the circuit
 * @property {function(boolean): void} setWorking - Turns the circuit on or off,
 *   each channel follows its behaviorType
 * @property {function(boolean): void} showSetpointError - Shows or clears
 *   the error on the setpoint control
 * @property {Logger} log - Logger of the scenario
 * @property {HysteresisRegulator|PidRegulator} regulator - Regulator
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
   * Target temperature of each circuit is persisted via ScenarioBase PS API:
   *   this.getPsUserSetting('heatingTargetTemp', defaultValue)
   *   this.setPsUserSetting('heatingTargetTemp', value)
   *
   * One persistent-storage for all scenarios of this type,
   * contains target temperature set by user in virtual device.
   * Stored in common storage "wb-scenarios-common-persistent-data":
   * @example
   *   scenariosRegistry = {
   *     "bathroom_floor": {
   *       "userSettings": { "heatingTargetTemp": 22 }
   *     },
   *     "kitchen_heater": {
   *       "userSettings": { "heatingTargetTemp": 24 }
   *     },
   *     "living_room": {
   *       "userSettings": { "heatingTargetTemp": 21, "coolingTargetTemp": 25 }
   *     },
   *     ...
   *   }
   *
   * @type {Object}
   */
  this.ctx = {
    errorTimers: {}, // Timers for error handling debounce
    errorCheckTimeoutMs: 10000, // 10s debounce time for errors
    // Suppress the first disable event after init when storage says disabled.
    // wb-rules creates VD with rule_enabled=true (forceDefault), then base class
    // restores rule_enabled=false from storage, which fires the disable rule and
    // would otherwise reset user-controlled actuators on every wb-rules restart.
    suppressNextDisable: false,
    circuits: {}, // Enabled circuits by name
    switcher: null, // Picks the active circuit, created in initSpecific
  };
}
ThermostatScenario.prototype = Object.create(ScenarioBase.prototype);
ThermostatScenario.prototype.constructor = ThermostatScenario;

/**
 * Control key strings for virtual device
 */
var vdCtrl = {
  ruleEnabled: 'rule_enabled',
  curTemp: 'current_temperature',
};

/**
 * Card titles of the circuit controls
 */
var circuitTitles = {
  heating: {
    targetTemp: {
      en: 'Heating Setpoint',
      ru: 'Заданная температура нагрева',
    },
    actuatorStatus: { en: 'Heating Status', ru: 'Статус нагрева' },
    outputPower: { en: 'Heating Power', ru: 'Мощность нагрева' },
    outputTiming: {
      en: 'Heating ON / OFF (s)',
      ru: 'Нагрев вкл / выкл (с)',
    },
    pidReset: { en: 'Reset Heating PID', ru: 'Сброс ПИД нагрева' },
  },
  cooling: {
    targetTemp: {
      en: 'Cooling Setpoint',
      ru: 'Заданная температура охлаждения',
    },
    actuatorStatus: { en: 'Cooling Status', ru: 'Статус охлаждения' },
    outputPower: { en: 'Cooling Power', ru: 'Мощность охлаждения' },
    outputTiming: {
      en: 'Cooling ON / OFF (s)',
      ru: 'Охлаждение вкл / выкл (с)',
    },
    pidReset: { en: 'Reset Cooling PID', ru: 'Сброс ПИД охлаждения' },
  },
};

/**
 * Order of the first circuit control on the card
 */
var circuitFirstCtrlOrder = {
  heating: 3,
  cooling: 8,
};

/**
 * Control key strings of a circuit in virtual device
 * @param {HeatFlowDirection} circuitName - Circuit name
 * @returns {Object} Control keys
 */
function getCircuitCtrlIds(circuitName) {
  return {
    targetTemp: circuitName + '_target_temperature',
    actuatorStatus: circuitName + '_actuator_status',
    outputPower: circuitName + '_output_power',
    outputTiming: circuitName + '_output_timing',
    pidReset: circuitName + '_pid_reset',
  };
}

/**
 * Prefix of the rule names of a circuit
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {HeatFlowDirection} circuitName - Circuit name
 * @returns {string} Rule name prefix
 */
function getCircuitRuleNamePrefix(self, circuitName) {
  return self.genNames.vDevice + '_' + circuitName + '_';
}

/**
 * PersistentStorage key of the circuit setpoint set from the virtual device
 * @param {HeatFlowDirection} circuitName - Circuit name
 * @returns {string} Storage key
 */
function getTargetTempStorageKey(circuitName) {
  return circuitName + 'TargetTemp';
}

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
    ruleSensorErr: baseRuleName + 'sensor_error_changed',
  };
};

/**
 * Get configuration for waiting for controls
 * @param {ThermostatConfig} cfg - Configuration object
 * @returns {Object} Waiting configuration object
 */
ThermostatScenario.prototype.defineControlsWaitConfig = function (cfg) {
  var actuatorTopics = extractMqttTopics(getEnabledCircuitsActuators(cfg));
  var allTopics = [].concat(cfg.tempSensor, actuatorTopics);
  return { controls: allTopics };
};

/**
 * A critical error of a used channel outranks crossed setpoints,
 * and both outrank the runtime enable switch.
 * @param {boolean} isEnabled - Position of the runtime enable switch
 * @returns {number} ScenarioState constant
 */
ThermostatScenario.prototype.computeState = function (isEnabled) {
  if (hasAnyCriticalErr(this.cfg)) {
    return ScenarioState.USED_CONTROL_ERROR;
  }
  if (this.ctx.switcher.isSetpointsCrossed) {
    return ScenarioState.CONFIG_INVALID;
  }
  return ScenarioBase.prototype.computeState.call(this, isEnabled);
};

/**
 * Validates configuration of one circuit
 * @param {HeatFlowDirection} circuitName - Circuit name
 * @param {ThermostatCircuitConfig} cfg - Circuit configuration
 * @returns {boolean} True if configuration is valid, false otherwise
 */
function validateCircuitCfg(circuitName, cfg) {
  var isLimitsCorrect = cfg.tempLimitsMin < cfg.tempLimitsMax;
  if (!isLimitsCorrect) {
    log.error(
      '{}: Thermostat validation error: temperature limit "Min" = "{}" must be less than "Max" = "{}"',
      circuitName,
      cfg.tempLimitsMin,
      cfg.tempLimitsMax
    );
  }

  var isTargetTempCorrect =
    cfg.targetTemp >= cfg.tempLimitsMin &&
    cfg.targetTemp <= cfg.tempLimitsMax;
  if (!isTargetTempCorrect) {
    log.error(
      '{}: Thermostat validation error: target temperature "{}" must be in the range from "Min" to "Max"',
      circuitName,
      cfg.targetTemp
    );
  }

  var isHysteresisCorrect = true;
  if (cfg.controlMode === 'hysteresis') {
    if (!(cfg.hysteresis > 0)) {
      log.error(
        '{}: Thermostat validation error: hysteresis value must be greater than 0, but got "{}"',
        circuitName,
        cfg.hysteresis
      );
      isHysteresisCorrect = false;
    }
  }

  // Validate actuators array
  if (!Array.isArray(cfg.actuators) || cfg.actuators.length === 0) {
    log.error(
      '{}: Thermostat validation error: at least one actuator is required',
      circuitName
    );
    return false;
  }

  var isActuatorsValid = true;
  for (var i = 0; i < cfg.actuators.length; i++) {
    var act = cfg.actuators[i];
    if (!thermostatActionsTable[act.behaviorType]) {
      log.error(
        '{}: Thermostat validation error: invalid behaviorType "{}" for actuator "{}"',
        circuitName,
        act.behaviorType,
        act.mqttTopicName
      );
      isActuatorsValid = false;
      continue;
    }
    var reqCtrlTypes = thermostatActionsTable[act.behaviorType].reqCtrlTypes;
    if (!isControlTypeValid(act.mqttTopicName, reqCtrlTypes)) {
      log.error(
        '{}: Thermostat validation error: actuator "{}" must be of type "switch"',
        circuitName,
        act.mqttTopicName
      );
      isActuatorsValid = false;
    }
  }

  var isPidValid = true;
  if (cfg.controlMode === 'pid') {
    if (!cfg.pidSettings || typeof cfg.pidSettings !== 'object') {
      log.error(
        '{}: Thermostat validation error: pidSettings object is missing, but got "{}"',
        circuitName,
        cfg.pidSettings
      );
      return false;
    }
    getPidSettingsErrors(
      cfg.pidSettings.pidCoefficients,
      cfg.pidSettings.deadBand
    ).forEach(function logPidError(errorText) {
      log.error(
        '{}: Thermostat validation error: {}',
        circuitName,
        errorText
      );
      isPidValid = false;
    });
    if (
      typeof cfg.pidSettings.pwmPeriodSec !== 'number' ||
      cfg.pidSettings.pwmPeriodSec <= 0 ||
      cfg.pidSettings.pwmPeriodSec % 1 !== 0
    ) {
      log.error(
        '{}: Thermostat validation error: Cycle period must be an integer > 0, but got "{}"',
        circuitName,
        cfg.pidSettings.pwmPeriodSec
      );
      isPidValid = false;
    }
    if (
      typeof cfg.pidSettings.pidRecalcCycles !== 'number' ||
      cfg.pidSettings.pidRecalcCycles < 1 ||
      cfg.pidSettings.pidRecalcCycles % 1 !== 0
    ) {
      log.error(
        '{}: Thermostat validation error: PID recalc cycles must be an integer >= 1, but got "{}"',
        circuitName,
        cfg.pidSettings.pidRecalcCycles
      );
      isPidValid = false;
    }
    if (
      typeof cfg.pidSettings.minOnTimeSec !== 'number' ||
      cfg.pidSettings.minOnTimeSec < 0
    ) {
      log.error(
        '{}: Thermostat validation error: min ON time must be a number >= 0, but got "{}"',
        circuitName,
        cfg.pidSettings.minOnTimeSec
      );
      isPidValid = false;
    }
    if (
      typeof cfg.pidSettings.minOffTimeSec !== 'number' ||
      cfg.pidSettings.minOffTimeSec < 0
    ) {
      log.error(
        '{}: Thermostat validation error: min OFF time must be a number >= 0, but got "{}"',
        circuitName,
        cfg.pidSettings.minOffTimeSec
      );
      isPidValid = false;
    }
    if (
      isPidValid &&
      cfg.pidSettings.pwmPeriodSec <=
        cfg.pidSettings.minOnTimeSec + cfg.pidSettings.minOffTimeSec
    ) {
      log.error(
        '{}: Thermostat validation error: Cycle period ({}) must be greater than min ON time ({}) + min OFF time ({}) = {}',
        circuitName,
        cfg.pidSettings.pwmPeriodSec,
        cfg.pidSettings.minOnTimeSec,
        cfg.pidSettings.minOffTimeSec,
        cfg.pidSettings.minOnTimeSec + cfg.pidSettings.minOffTimeSec
      );
      isPidValid = false;
    }
  }

  var isCfgValid =
    isLimitsCorrect &&
    isTargetTempCorrect &&
    isHysteresisCorrect &&
    isActuatorsValid &&
    isPidValid;

  return isCfgValid;
}

/**
 * Configuration validation
 * @param {ThermostatConfig} cfg - Configuration object
 * @returns {boolean} True if configuration is valid, false otherwise
 */
ThermostatScenario.prototype.validateCfg = function (cfg) {
  var isTargetTempStepCorrect = isRangeStepValid(cfg.targetTempStep);
  if (!isTargetTempStepCorrect) {
    log.error(
      'Thermostat validation error: target temperature step must be a number > 0, but got "{}"',
      cfg.targetTempStep
    );
  }

  var tempSensorType = dev[cfg.tempSensor + '#type'];
  var isTempSensorValid =
    tempSensorType === null ||
    tempSensorType === 'value' ||
    tempSensorType === 'temperature';
  if (!isTempSensorValid) {
    log.error(
      'Thermostat validation error: sensor type must be "value" or "temperature", but got "{}"',
      tempSensorType
    );
  }

  var circuitNames = getEnabledCircuitNames(cfg);
  if (circuitNames.length === 0) {
    log.error(
      'Thermostat validation error: heating, cooling or both must be enabled'
    );
    return false;
  }

  var isCircuitsValid = true;
  circuitNames.forEach(function checkCircuit(circuitName) {
    if (!validateCircuitCfg(circuitName, cfg[circuitName])) {
      isCircuitsValid = false;
    }
  });

  var isCircuitsCompatible = true;
  if (isCircuitsValid) {
    getCircuitsLinkErrors(cfg, 'targetTemp').forEach(
      function logLinkError(errorText) {
        log.error('Thermostat validation error: {}', errorText);
        isCircuitsCompatible = false;
      }
    );
  }

  return (
    isTargetTempStepCorrect &&
    isTempSensorValid &&
    isCircuitsValid &&
    isCircuitsCompatible
  );
};

/**
 * Adds the controls of one circuit to the virtual device
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {ThermostatConfig} cfg - Configuration object
 * @param {HeatFlowDirection} circuitName - Circuit name
 * @param {number} initialTemp - Initial value for the target temperature
 */
function addCircuitControls(self, cfg, circuitName, initialTemp) {
  var circuitCfg = cfg[circuitName];
  var ctrlIds = getCircuitCtrlIds(circuitName);
  var titles = circuitTitles[circuitName];
  var order = circuitFirstCtrlOrder[circuitName];

  /** @type {ControlOptions} */
  var controlCfg = {
    title: titles.targetTemp,
    type: 'range',
    value: initialTemp,
    min: circuitCfg.tempLimitsMin,
    max: circuitCfg.tempLimitsMax,
    precision: getRangeStep(cfg.targetTempStep),
    order: order,
  };
  self.vd.devObj.addControl(ctrlIds.targetTemp, controlCfg);

  controlCfg = {
    title: titles.actuatorStatus,
    type: 'switch',
    // Default to OFF: the circuit is started explicitly by the scenario logic.
    value: false,
    forceDefault: true,
    order: order + 1,
    readonly: true,
  };
  self.vd.devObj.addControl(ctrlIds.actuatorStatus, controlCfg);

  if (circuitCfg.controlMode === 'pid') {
    controlCfg = {
      title: titles.outputPower,
      type: 'value',
      value: 0,
      units: '%',
      order: order + 2,
      readonly: true,
    };
    self.vd.devObj.addControl(ctrlIds.outputPower, controlCfg);

    controlCfg = {
      title: titles.outputTiming,
      type: 'text',
      value: '-',
      order: order + 3,
      readonly: true,
    };
    self.vd.devObj.addControl(ctrlIds.outputTiming, controlCfg);

    controlCfg = {
      title: titles.pidReset,
      type: 'pushbutton',
      order: order + 4,
    };
    self.vd.devObj.addControl(ctrlIds.pidReset, controlCfg);
  }
}

/**
 * Adds required custom controls cells to the virtual device
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {ThermostatConfig} cfg - Configuration object
 * @param {Object<string, number>} initialTemps - Initial target temperature
 *   of each enabled circuit by name
 */
function addCustomControlsToVirtualDevice(self, cfg, initialTemps) {
  /** @type {ControlOptions} */
  var controlCfg = {
    title: {
      en: 'Current Temperature',
      ru: 'Текущая температура',
    },
    type: 'value',
    units: 'deg C',
    value: dev[cfg.tempSensor],
    forceDefault: true,
    order: 2,
    readonly: true,
  };
  self.vd.devObj.addControl(vdCtrl.curTemp, controlCfg);

  getEnabledCircuitNames(cfg).forEach(function addControls(circuitName) {
    addCircuitControls(self, cfg, circuitName, initialTemps[circuitName]);
  });
}

/**
 * Apply the circuit state to all its actuators.
 * Only writes to actuators whose current state differs from desired.
 * @param {Array<ActuatorConfig>} actuators - List of actuator configurations
 * @param {boolean} shouldWork - Whether the circuit should work
 */
function applyToActuators(actuators, shouldWork) {
  for (var i = 0; i < actuators.length; i++) {
    var act = actuators[i];
    try {
      // XNOR: setEnable turns ON when working, setDisable turns OFF when working
      var desiredValue = shouldWork === (act.behaviorType === 'setEnable');
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
 * Creates the runtime and the regulator of one circuit
 * The circuit controls must already exist in the virtual device
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {HeatFlowDirection} circuitName - Circuit name
 * @param {ThermostatCircuitConfig} circuitCfg - Circuit configuration
 * @returns {Circuit} Circuit runtime
 */
function createCircuit(self, circuitName, circuitCfg) {
  var ctrlIds = getCircuitCtrlIds(circuitName);
  var vdCtrlTargetTemp = self.vd.devObj.getControl(ctrlIds.targetTemp);
  var vdCtrlStatus = self.vd.devObj.getControl(ctrlIds.actuatorStatus);

  // The regulator reads the temperature and the setpoint and turns
  // the circuit on or off only through these functions
  /** @type {Circuit} */
  var circuit = {
    name: circuitName,
    cfg: circuitCfg,
    getTemperature: function getTemperature() {
      return dev[self.cfg.tempSensor];
    },
    getSetpoint: function getSetpoint() {
      return vdCtrlTargetTemp.getValue();
    },
    // Writes the channels of the circuit and its status on the card
    setWorking: function setWorking(shouldWork) {
      applyToActuators(circuitCfg.actuators, shouldWork);
      if (vdCtrlStatus.getValue() !== shouldWork) {
        vdCtrlStatus.setValue(shouldWork);
        log.debug(
          '{}: Turned {}, current/target temperatures: "{}"/"{}" °C',
          circuitName,
          shouldWork ? 'ON' : 'OFF',
          circuit.getTemperature(),
          circuit.getSetpoint()
        );
      }
    },
    showSetpointError: function showSetpointError(isError) {
      vdCtrlTargetTemp.setError(isError ? 'r' : '');
    },
    log: log,
    regulator: null, // Set below, the regulator gets this circuit
  };

  if (circuitCfg.controlMode === 'pid') {
    var pidControls = {
      outputPower: self.vd.devObj.getControl(ctrlIds.outputPower),
      outputTiming: self.vd.devObj.getControl(ctrlIds.outputTiming),
    };
    circuit.regulator = new PidRegulator(
      circuitName,
      circuitCfg.pidSettings,
      circuit,
      pidControls
    );
  } else {
    circuit.regulator = new HysteresisRegulator(
      circuitName,
      circuitCfg.hysteresis,
      circuit
    );
  }
  return circuit;
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
  if (!hasAnyCriticalErr(cfg)) {
    vdCtrlEnable.setReadonly(false);
  }
}

/**
 * Checks whether any used channel is in a critical error state
 * @param {ThermostatConfig} cfg - Configuration object
 * @returns {boolean} True if the sensor or any actuator has an r/w error
 */
function hasAnyCriticalErr(cfg) {
  return (
    hasCriticalErr(dev[cfg.tempSensor + '#error']) ||
    getEnabledCircuitNames(cfg).some(function hasActuatorErr(name) {
      return getActuatorsCriticalErr(cfg[name].actuators) !== '';
    })
  );
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
 * @param {Array<ActuatorConfig>|null} actuators - Actuators of the circuit
 *     sharing the target control, null for the sensor
 * @returns {RuleId} ID of the created rule
 */
function createErrChangeRule(
  self,
  ruleName,
  sourceErrTopic,
  targetVdCtrl,
  vdCtrlEnable,
  actuators
) {
  // Multiple actuators of a circuit share one VD control
  // (<circuit>_actuator_status).
  // On error clear we must check that ALL actuators are clean
  // before removing the red highlight from the shared control.
  var isActuatorErrRule = actuators !== null;

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
        targetVdCtrl.setError(getActuatorsCriticalErr(actuators));
      }

      if (!hasCriticalErr(newValue)) {
        log.debug(
          'Error cleared or non-critical error (p) detected for topic "{}". New state: "{}"',
          sourceErrTopic,
          newValue
        );
        tryClearReadonly(vdCtrlEnable, self.cfg);
        self.setState(self.computeState(vdCtrlEnable.getValue()));

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
          self.setState(self.computeState(vdCtrlEnable.getValue()));
          vdCtrlEnable.setReadonly(true);
          // The rule_enabled rule runs only after this callback. Stop the
          // circuits now, so that a sensor change before that rule cannot
          // start a circuit. A disabled scenario keeps its channels as is
          if (self.ctx.switcher.isStarted) {
            self.ctx.switcher.stop();
          }
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
 * Heating also reads the targetTemp key stored before the circuits split.
 * Includes one-time migration from old PersistentStorage('wbscThermostatSettings')
 *
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {HeatFlowDirection} circuitName - Circuit name
 * @param {ThermostatCircuitConfig} cfg - Circuit configuration
 * @returns {number} The target temperature to use
 */
function restoreTargetTemperature(self, circuitName, cfg) {
  var storageKey = getTargetTempStorageKey(circuitName);
  var storedTemp = self.getPsUserSetting(storageKey, undefined);
  var isHeating = circuitName === HeatFlowDirection.HEATING;

  // Heating setpoint stored before the circuits split
  if (storedTemp === undefined && isHeating) {
    storedTemp = self.getPsUserSetting('targetTemp', undefined);
  }

  // TODO(Valerii 2026-03-20): Remove old storage migration after one year
  // Migration from old PersistentStorage('wbscThermostatSettings')
  if (storedTemp === undefined && isHeating) {
    try {
      var oldPs = new PersistentStorage('wbscThermostatSettings', {
        global: true,
      });
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
    self.setPsUserSetting(storageKey, storedTemp);
    log.debug(
      'Restored {}="{}" for scenario="{}"',
      storageKey,
      storedTemp,
      self.idPrefix
    );
    return storedTemp;
  }

  // Either no stored value, or it's out of range
  var usedTemp = cfg.targetTemp;
  self.setPsUserSetting(storageKey, usedTemp);

  // Show warning only if something was stored but invalid
  if (typeof storedTemp === 'number') {
    log.warning(
      'Stored temp="{}" is out of range or invalid for "{}". Reset to "{}"',
      storedTemp,
      storageKey,
      usedTemp
    );
  }
  return usedTemp;
}

/**
 * Creates the rules of one circuit
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {Circuit} circuit - Circuit runtime
 * @returns {boolean} True if all rules created successfully
 */
function createCircuitRules(self, circuit) {
  var ctrlIds = getCircuitCtrlIds(circuit.name);
  var ruleNamePrefix = getCircuitRuleNamePrefix(self, circuit.name);
  var storageKey = getTargetTempStorageKey(circuit.name);
  var vdCtrlEnable = self.vd.devObj.getControl(vdCtrl.ruleEnabled);

  // Works when the scenario is disabled too, so crossed setpoints
  // show up right away
  var ruleId = defineRule(ruleNamePrefix + 'set_target_t', {
    whenChanged: [self.genNames.vDevice + '/' + ctrlIds.targetTemp],
    then: function onTargetTempChanged(newValue) {
      try {
        self.setPsUserSetting(storageKey, newValue);
        log.debug(
          '{} "{}" saved in persistent storage',
          storageKey,
          newValue
        );
      } catch (err) {
        log.error('Error saving {} to storage: {}', storageKey, err);
      }

      if (self.ctx.switcher.onSetpointChanged()) {
        self.setState(self.computeState(vdCtrlEnable.getValue()));
      }
    },
  });
  if (!ruleId) {
    log.error('Failed to create {} target temperature rule', circuit.name);
    return false;
  }
  log.debug(
    '{} target temperature rule created with ID "{}"',
    circuit.name,
    ruleId
  );

  if (circuit.cfg.controlMode !== 'pid') {
    return true;
  }

  ruleId = defineRule(ruleNamePrefix + 'pid_reset', {
    whenChanged: [self.genNames.vDevice + '/' + ctrlIds.pidReset],
    then: function onPidReset() {
      circuit.regulator.reset();
    },
  });
  if (!ruleId) {
    log.error('Failed to create {} PID reset rule', circuit.name);
    return false;
  }
  self.addRule(ruleId);
  log.debug('{} PID reset rule created with ID "{}"', circuit.name, ruleId);

  return true;
}

/**
 * Creates error handling rules for sensor and actuators (shared by both modes)
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {ThermostatConfig} cfg - Configuration object
 * @returns {boolean} True if all rules created successfully
 */
function createErrorRules(self, cfg) {
  var vdCtrlCurTemp = self.vd.devObj.getControl(vdCtrl.curTemp);
  var vdCtrlEnable = self.vd.devObj.getControl(vdCtrl.ruleEnabled);

  var ruleId = null;

  // Error handling rule for temperature sensor
  var sensorErrTopic = cfg.tempSensor + '#error';
  ruleId = createErrChangeRule(
    self,
    self.genNames.ruleSensorErr,
    sensorErrTopic,
    vdCtrlCurTemp,
    vdCtrlEnable,
    null
  );
  if (!ruleId) {
    log.error('Failed to create tempSensor error handling rule');
    return false;
  }
  // This rule not disable when user use switch in virtual device
  log.debug('Temp. sensor error handling rule created with ID="{}"', ruleId);

  // Error handling rules for each actuator, shown on the circuit status
  var circuitNames = Object.keys(self.ctx.circuits);
  for (var c = 0; c < circuitNames.length; c++) {
    var circuit = self.ctx.circuits[circuitNames[c]];
    var actuators = circuit.cfg.actuators;
    var vdCtrlStatus = self.vd.devObj.getControl(
      getCircuitCtrlIds(circuit.name).actuatorStatus
    );
    var ruleNamePrefix = getCircuitRuleNamePrefix(self, circuit.name);

    for (var i = 0; i < actuators.length; i++) {
      ruleId = createErrChangeRule(
        self,
        ruleNamePrefix + 'actuator_err_' + i,
        actuators[i].mqttTopicName + '#error',
        vdCtrlStatus,
        vdCtrlEnable,
        actuators
      );
      if (!ruleId) {
        log.error(
          'Failed to create error handling rule for actuator "{}"',
          actuators[i].mqttTopicName
        );
        return false;
      }
      // This rule not disable when user use switch in virtual device
      log.debug(
        'Actuator error handling rule created for "{}" with ID="{}"',
        actuators[i].mqttTopicName,
        ruleId
      );
    }
  }

  return true;
}

/**
 * Creates all required rules for current type scenario
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {ThermostatConfig} cfg - Configuration object
 * @returns {boolean} True if all rules created successfully, false otherwise
 */
function createRules(self, cfg) {
  var vdCtrlCurTemp = self.vd.devObj.getControl(vdCtrl.curTemp);

  // Picks the active circuit by the temperature
  var ruleId = defineRule(self.genNames.ruleTempChanged, {
    whenChanged: [cfg.tempSensor],
    then: function onTemperatureChanged(newValue) {
      vdCtrlCurTemp.setValue(newValue);
      self.ctx.switcher.updateActiveCircuit();
    },
  });
  if (!ruleId) {
    log.error('Failed to create temperature changed rule');
    return false;
  }
  // This rule not disable when user use switch in virtual device
  log.debug('Temperature changed rule created with ID "{}"', ruleId);

  ruleId = defineRule(self.genNames.ruleSetScStatus, {
    whenChanged: [self.genNames.vDevice + '/' + vdCtrl.ruleEnabled],
    then: function onScenarioSwitched(newValue) {
      if (newValue) {
        self.ctx.switcher.start();
        return;
      }
      if (self.ctx.suppressNextDisable) {
        self.ctx.suppressNextDisable = false;
        log.debug('Skipping initial disable from storage restore');
        return;
      }
      self.ctx.switcher.stop();
    },
  });
  if (!ruleId) {
    log.error('Failed to create scenario status rule');
    return false;
  }
  // This rule is not managed when user use switch enable/disable in vdev
  log.debug('Scenario status rule created with ID "{}"', ruleId);

  var circuitNames = Object.keys(self.ctx.circuits);
  for (var i = 0; i < circuitNames.length; i++) {
    if (!createCircuitRules(self, self.ctx.circuits[circuitNames[i]])) {
      return false;
    }
  }

  return createErrorRules(self, cfg);
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
  var self = this;
  log.debug('Start init thermostat scenario');
  log.setLabel(loggerFileLabel + '/' + this.idPrefix);

  // Restore the target temperature of each circuit from storage
  var initialTemps = {};
  getEnabledCircuitNames(cfg).forEach(function restoreTemp(circuitName) {
    initialTemps[circuitName] = restoreTargetTemperature(
      self,
      circuitName,
      cfg[circuitName]
    );
  });

  addCustomControlsToVirtualDevice(this, cfg, initialTemps);

  getEnabledCircuitNames(cfg).forEach(function initCircuit(circuitName) {
    self.ctx.circuits[circuitName] = createCircuit(
      self,
      circuitName,
      cfg[circuitName]
    );
  });
  this.ctx.switcher = new CircuitSwitcher(this.ctx.circuits, log);

  // Create all rules
  var rulesCreated = createRules(this, cfg);

  if (rulesCreated) {
    var enabledFromStorage = this.getPsUserSetting(vdCtrl.ruleEnabled, true);
    if (!enabledFromStorage) {
      this.ctx.suppressNextDisable = true;
    }

    // Setpoints saved from the card may cross even with a valid config.
    // Check them before start(). Until this check, the switcher does not
    // know about the crossing and start() can turn on a circuit
    this.ctx.switcher.onSetpointChanged();
    if (enabledFromStorage) {
      this.ctx.switcher.start();
    }

    log.debug(
      'Thermostat scenario initialized successfully for device "{}"',
      deviceTitle
    );
  }

  return rulesCreated;
};

exports.ThermostatScenario = ThermostatScenario;
