/**
 * @file pid-controller.mod.js - ES5 module for wb-rules v2.34
 * @description PID controller scenario for analog outputs.
 *     Writes computed values directly to analog outputs.
 *     Heating and cooling circuits share the sensor. One circuit
 *     regulates at a time, circuit-switcher.mod.js picks it by the sensor
 *     value. The regulator of a circuit lives in
 *     pid-controller-regulator.mod.js
 *
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState = require('virtual-device-helpers.mod').ScenarioState;
var isRangeStepValid = require('virtual-device-helpers.mod').isRangeStepValid;
var getRangeStep = require('virtual-device-helpers.mod').getRangeStep;
var Logger = require('logger.mod').Logger;
var getPidSettingsErrors = require('pid-engine.mod').getPidSettingsErrors;
var HeatFlowDirection = require('constants.mod').HeatFlowDirection;
var PidControllerRegulator =
  require('pid-controller-regulator.mod').PidControllerRegulator;
var CircuitSwitcher = require('circuit-switcher.mod').CircuitSwitcher;
var getEnabledCircuitNames =
  require('circuit-switcher.mod').getEnabledCircuitNames;

var hasCriticalErr = require('wbsc-wait-controls.mod').hasCriticalErr;
var extractMqttTopics =
  require('scenarios-general-helpers.mod').extractMqttTopics;
var findRepeatedMqttTopics =
  require('scenarios-general-helpers.mod').findRepeatedMqttTopics;

var loggerFileLabel = 'WBSC-pid-controller-mod';
var log = new Logger(loggerFileLabel);

/**
 * @typedef {Object} PidActuatorConfig
 * @property {string} mqttTopicName - MQTT topic of the analog output
 * @property {'direct'|'inverted'} behaviorType - Output direction
 * @property {number} precision - Rounding precision (0 = integer, 1 = tenths, 2 = hundredths)
 * @property {number} outputMin - Minimum output value (actuator units)
 * @property {number} outputMax - Maximum output value (actuator units)
 */

/**
 * @typedef {Object} PidControllerCircuitConfig
 * @property {number} setpoint - Initial target value
 * @property {{min: number, max: number}} setpointLimits - Setpoint limits
 * @property {{kp: number, ki: number, kd: number}} pidCoefficients - PID coefficients
 * @property {number} calculationPeriodSec - PID recalculation interval
 * @property {number} deadBand - Dead zone around setpoint
 * @property {Array<PidActuatorConfig>} actuators - Controlled outputs
 */

/**
 * @typedef {Object} PidControllerConfig
 * @property {string} [idPrefix] - Optional prefix for scenario ID
 * @property {string} sensor - MQTT topic of input sensor
 * @property {number} [setpointStep] - Slider step of the setpoint controls
 *   of both circuits, published as the control precision. Defaults to 0.1
 * @property {PidControllerCircuitConfig} [heating] - Heating circuit,
 *   absent when heating is off
 * @property {PidControllerCircuitConfig} [cooling] - Cooling circuit,
 *   absent when cooling is off
 */

/**
 * Runtime of one enabled circuit
 * The regulator gets the circuit and uses name, getTemperature, getSetpoint,
 * setOutput and log, CircuitSwitcher also uses showSetpointError
 * @typedef {Object} Circuit
 * @property {HeatFlowDirection} name - Circuit name
 * @property {PidControllerCircuitConfig} cfg - Circuit configuration
 * @property {function(): number} getTemperature - Current sensor value
 * @property {function(): number} getSetpoint - Setpoint of the circuit
 * @property {function(number): void} setOutput - Sets the circuit power
 *   0..100, each output follows its behaviorType
 * @property {function(boolean): void} showSetpointError - Shows or clears
 *   the error on the setpoint control
 * @property {Logger} log - Logger of the scenario
 * @property {PidControllerRegulator} regulator - Regulator
 */

/**
 * PID controller scenario for analog outputs
 * @class PidControllerScenario
 * @extends ScenarioBase
 */
function PidControllerScenario() {
  ScenarioBase.call(this);

  /**
   * Context object for storing scenario runtime state
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
PidControllerScenario.prototype = Object.create(ScenarioBase.prototype);
PidControllerScenario.prototype.constructor = PidControllerScenario;

/**
 * Control key strings for virtual device
 */
var vdCtrl = {
  ruleEnabled: 'rule_enabled',
  currentValue: 'current_value',
};

/**
 * Card titles of the circuit controls
 */
var circuitTitles = {
  heating: {
    setpoint: { en: 'Heating Setpoint', ru: 'Уставка нагрева' },
    outputPower: { en: 'Heating Power', ru: 'Мощность нагрева' },
    pidReset: { en: 'Reset Heating PID', ru: 'Сброс ПИД нагрева' },
  },
  cooling: {
    setpoint: { en: 'Cooling Setpoint', ru: 'Уставка охлаждения' },
    outputPower: { en: 'Cooling Power', ru: 'Мощность охлаждения' },
    pidReset: { en: 'Reset Cooling PID', ru: 'Сброс ПИД охлаждения' },
  },
};

/**
 * Order of the first circuit control on the card
 */
var circuitFirstCtrlOrder = {
  heating: 3,
  cooling: 6,
};

/**
 * Control key strings of a circuit in virtual device
 * @param {HeatFlowDirection} circuitName - Circuit name
 * @returns {Object} Control keys
 */
function getCircuitCtrlIds(circuitName) {
  return {
    setpoint: circuitName + '_setpoint',
    outputPower: circuitName + '_output_power',
    pidReset: circuitName + '_pid_reset',
  };
}

/**
 * Prefix of the rule names of a circuit
 * @param {PidControllerScenario} self - Reference to the PidControllerScenario instance
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
function getSetpointStorageKey(circuitName) {
  return circuitName + 'Setpoint';
}

/**
 * Generates name identifiers for virtual device and rules
 * @param {string} idPrefix - ID prefix for this scenario instance
 * @returns {Object} Generated names
 */
PidControllerScenario.prototype.generateNames = function (idPrefix) {
  var scenarioPrefix = 'wbsc_';
  var baseRuleName = scenarioPrefix + idPrefix + '_';

  return {
    vDevice: scenarioPrefix + idPrefix,
    ruleSensorChanged: baseRuleName + 'sensor_changed',
    ruleSetScStatus: baseRuleName + 'set_sc_status',
    ruleSensorErr: baseRuleName + 'sensor_error_changed',
  };
};

/**
 * Get configuration for waiting for controls
 * @param {PidControllerConfig} cfg - Configuration object
 * @returns {Object} Waiting configuration object
 */
PidControllerScenario.prototype.defineControlsWaitConfig = function (cfg) {
  var actuatorTopics = [];
  getEnabledCircuitNames(cfg).forEach(function addTopics(circuitName) {
    actuatorTopics = actuatorTopics.concat(
      extractMqttTopics(cfg[circuitName].actuators || [])
    );
  });

  var allTopics = [].concat(cfg.sensor, actuatorTopics);
  return { controls: allTopics };
};

/**
 * A critical error of a used channel outranks crossed setpoints,
 * and both outrank the runtime enable switch.
 * @param {boolean} isEnabled - Position of the runtime enable switch
 * @returns {number} ScenarioState constant
 */
PidControllerScenario.prototype.computeState = function (isEnabled) {
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
 * @param {PidControllerCircuitConfig} cfg - Circuit configuration
 * @returns {boolean} True if configuration is valid
 */
function validateCircuitCfg(circuitName, cfg) {
  // An enabled circuit without its block in the config comes as {}
  var limits = cfg.setpointLimits || {};
  var isLimitsCorrect = limits.min < limits.max;
  if (!isLimitsCorrect) {
    log.error(
      '{}: PID validation error: setpoint limit Min="{}" must be less than Max="{}"',
      circuitName,
      limits.min,
      limits.max
    );
  }

  var isSetpointCorrect =
    cfg.setpoint >= limits.min && cfg.setpoint <= limits.max;
  if (!isSetpointCorrect) {
    log.error(
      '{}: PID validation error: setpoint "{}" must be in range [Min, Max]',
      circuitName,
      cfg.setpoint
    );
  }

  var isPidSettingsValid = true;
  getPidSettingsErrors(cfg.pidCoefficients, cfg.deadBand).forEach(
    function logPidError(errorText) {
      log.error('{}: PID validation error: {}', circuitName, errorText);
      isPidSettingsValid = false;
    }
  );

  var isPeriodValid =
    typeof cfg.calculationPeriodSec === 'number' &&
    cfg.calculationPeriodSec >= 1 &&
    cfg.calculationPeriodSec % 1 === 0;
  if (!isPeriodValid) {
    log.error(
      '{}: PID validation error: calculationPeriodSec must be integer >= 1, got "{}"',
      circuitName,
      cfg.calculationPeriodSec
    );
  }

  // Validate actuators
  if (!Array.isArray(cfg.actuators) || cfg.actuators.length === 0) {
    log.error(
      '{}: PID validation error: at least one actuator is required',
      circuitName
    );
    return false;
  }

  var isActuatorsValid = true;
  for (var i = 0; i < cfg.actuators.length; i++) {
    var act = cfg.actuators[i];

    // Validate precision
    if (
      typeof act.precision !== 'number' ||
      act.precision < 0 ||
      act.precision > 2 ||
      act.precision % 1 !== 0
    ) {
      log.error(
        '{}: PID validation error: precision must be 0, 1 or 2 for actuator "{}", got "{}"',
        circuitName,
        act.mqttTopicName,
        act.precision
      );
      isActuatorsValid = false;
    }

    if (
      typeof act.outputMin !== 'number' ||
      typeof act.outputMax !== 'number'
    ) {
      log.error(
        '{}: PID validation error: outputMin and outputMax must be numbers for actuator "{}"',
        circuitName,
        act.mqttTopicName
      );
      isActuatorsValid = false;
    } else if (act.outputMin >= act.outputMax) {
      log.error(
        '{}: PID validation error: outputMin="{}" must be < outputMax="{}" for actuator "{}"',
        circuitName,
        act.outputMin,
        act.outputMax,
        act.mqttTopicName
      );
      isActuatorsValid = false;
    }
  }

  return (
    isLimitsCorrect &&
    isSetpointCorrect &&
    isPidSettingsValid &&
    isPeriodValid &&
    isActuatorsValid
  );
}

/**
 * Configuration validation
 * @param {PidControllerConfig} cfg - Configuration object
 * @returns {boolean} True if configuration is valid
 */
PidControllerScenario.prototype.validateCfg = function (cfg) {
  var isSetpointStepCorrect = isRangeStepValid(cfg.setpointStep);
  if (!isSetpointStepCorrect) {
    log.error(
      'PID validation error: setpoint step must be a number > 0, got "{}"',
      cfg.setpointStep
    );
  }

  // Validate sensor type
  var sensorType = dev[cfg.sensor + '#type'];
  var isSensorValid =
    sensorType === null ||
    sensorType === 'value' ||
    sensorType === 'temperature' ||
    sensorType === 'range';
  if (!isSensorValid) {
    log.error(
      'PID validation error: sensor type must be "value", "temperature" or "range", got "{}"',
      sensorType
    );
  }

  var circuitNames = getEnabledCircuitNames(cfg);
  if (circuitNames.length === 0) {
    log.error(
      'PID validation error: heating, cooling or both must be enabled'
    );
    return false;
  }

  var isCircuitsValid = true;
  circuitNames.forEach(function checkCircuit(circuitName) {
    if (!validateCircuitCfg(circuitName, cfg[circuitName])) {
      isCircuitsValid = false;
    }
  });

  var isActuatorsUnique = true;
  if (isCircuitsValid) {
    var allActuators = [];
    circuitNames.forEach(function collectActuators(circuitName) {
      allActuators = allActuators.concat(cfg[circuitName].actuators);
    });
    var repeatedTopics = findRepeatedMqttTopics(allActuators);
    if (repeatedTopics.length > 0) {
      log.error(
        'PID validation error: outputs "{}" are used more than once',
        repeatedTopics.join(', ')
      );
      isActuatorsUnique = false;
    }
  }

  var isCircuitsCompatible = true;
  if (isCircuitsValid && circuitNames.length === 2) {
    if (cfg.heating.setpoint >= cfg.cooling.setpoint) {
      log.error(
        'PID validation error: heating setpoint "{}" must be below cooling setpoint "{}"',
        cfg.heating.setpoint,
        cfg.cooling.setpoint
      );
      isCircuitsCompatible = false;
    }
  }

  return (
    isSetpointStepCorrect &&
    isSensorValid &&
    isCircuitsValid &&
    isActuatorsUnique &&
    isCircuitsCompatible
  );
};

/**
 * Adds the controls of one circuit to the virtual device
 * @param {PidControllerScenario} self - Reference to the PidControllerScenario instance
 * @param {PidControllerConfig} cfg - Configuration
 * @param {HeatFlowDirection} circuitName - Circuit name
 * @param {number} initialSetpoint - Restored setpoint value
 */
function addCircuitControls(self, cfg, circuitName, initialSetpoint) {
  var circuitCfg = cfg[circuitName];
  var ctrlIds = getCircuitCtrlIds(circuitName);
  var titles = circuitTitles[circuitName];
  var order = circuitFirstCtrlOrder[circuitName];

  self.vd.devObj.addControl(ctrlIds.setpoint, {
    title: titles.setpoint,
    type: 'range',
    value: initialSetpoint,
    min: circuitCfg.setpointLimits.min,
    max: circuitCfg.setpointLimits.max,
    precision: getRangeStep(cfg.setpointStep),
    order: order,
  });

  self.vd.devObj.addControl(ctrlIds.outputPower, {
    title: titles.outputPower,
    type: 'value',
    value: 0,
    units: '%',
    order: order + 1,
    readonly: true,
  });

  self.vd.devObj.addControl(ctrlIds.pidReset, {
    title: titles.pidReset,
    type: 'pushbutton',
    order: order + 2,
  });
}

/**
 * Adds custom controls to the virtual device
 * @param {PidControllerScenario} self - Reference to the PidControllerScenario instance
 * @param {PidControllerConfig} cfg - Configuration
 * @param {Object<string, number>} initialSetpoints - Restored setpoint
 *   of each enabled circuit by name
 */
function addCustomControlsToVirtualDevice(self, cfg, initialSetpoints) {
  self.vd.devObj.addControl(vdCtrl.currentValue, {
    title: {
      en: 'Current Value',
      ru: 'Текущее значение',
    },
    type: 'value',
    value: dev[cfg.sensor],
    forceDefault: true,
    order: 2,
    readonly: true,
  });

  getEnabledCircuitNames(cfg).forEach(function addControls(circuitName) {
    addCircuitControls(
      self,
      cfg,
      circuitName,
      initialSetpoints[circuitName]
    );
  });
}

/**
 * Map PID output (0-100%) to actuator value using its min/max and behavior.
 * @param {number} pidOutput - PID output 0..100
 * @param {PidActuatorConfig} act - Actuator configuration
 * @returns {number} Mapped value in actuator units
 */
function mapOutputToActuator(pidOutput, act) {
  var range = act.outputMax - act.outputMin;
  var fraction = pidOutput / 100;

  if (act.behaviorType === 'inverted') {
    return act.outputMax - fraction * range;
  }
  return act.outputMin + fraction * range;
}

/**
 * Apply PID output to all actuators. Writes only when value changes.
 * @param {Array<PidActuatorConfig>} actuators - List of actuator configs
 * @param {number} pidOutput - PID output 0..100
 */
function applyOutputToActuators(actuators, pidOutput) {
  for (var i = 0; i < actuators.length; i++) {
    var act = actuators[i];
    var value = mapOutputToActuator(pidOutput, act);

    // Round numbers to the required number of decimal places
    var multiplier = Math.pow(10, act.precision);
    value = Math.round(value * multiplier) / multiplier;

    try {
      if (dev[act.mqttTopicName] !== value) {
        dev[act.mqttTopicName] = value;
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
 * @param {PidControllerScenario} self - Reference to the PidControllerScenario instance
 * @param {HeatFlowDirection} circuitName - Circuit name
 * @param {PidControllerCircuitConfig} circuitCfg - Circuit configuration
 * @returns {Circuit} Circuit runtime
 */
function createCircuit(self, circuitName, circuitCfg) {
  var ctrlIds = getCircuitCtrlIds(circuitName);
  var vdCtrlSetpoint = self.vd.devObj.getControl(ctrlIds.setpoint);
  var vdCtrlOutputPower = self.vd.devObj.getControl(ctrlIds.outputPower);

  // The regulator reads the sensor value and the setpoint and sets
  // the circuit power only through these functions
  /** @type {Circuit} */
  var circuit = {
    name: circuitName,
    cfg: circuitCfg,
    getTemperature: function getTemperature() {
      return dev[self.cfg.sensor];
    },
    getSetpoint: function getSetpoint() {
      return vdCtrlSetpoint.getValue();
    },
    // Writes the outputs of the circuit and its power on the card
    setOutput: function setOutput(pidOutput) {
      applyOutputToActuators(circuitCfg.actuators, pidOutput);
      vdCtrlOutputPower.setValue(Math.round(pidOutput * 10) / 10);
    },
    showSetpointError: function showSetpointError(isError) {
      vdCtrlSetpoint.setError(isError ? 'r' : '');
    },
    log: log,
    regulator: null, // Set below, the regulator gets this circuit
  };

  circuit.regulator = new PidControllerRegulator(
    circuitName,
    circuitCfg,
    circuit
  );
  return circuit;
}

/**
 * Get the critical error value of the first broken actuator
 * @param {Array<PidActuatorConfig>} actuators - List of actuator configs
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
 * Updates readonly state of rule_enabled control.
 * Removes readonly only when ALL errors are cleared.
 * @param {Object} vdCtrlEnable - Enable control
 * @param {PidControllerConfig} cfg - Configuration
 */
function tryClearReadonly(vdCtrlEnable, cfg) {
  if (!hasAnyCriticalErr(cfg)) {
    vdCtrlEnable.setReadonly(false);
  }
}

/**
 * Checks whether any used channel is in a critical error state
 * @param {PidControllerConfig} cfg - Configuration
 * @returns {boolean} True if the sensor or any actuator has an r/w error
 */
function hasAnyCriticalErr(cfg) {
  return (
    hasCriticalErr(dev[cfg.sensor + '#error']) ||
    getEnabledCircuitNames(cfg).some(function hasActuatorErr(name) {
      return getActuatorsCriticalErr(cfg[name].actuators) !== '';
    })
  );
}

/**
 * Creates an error handling rule for a sensor or actuator
 * @param {PidControllerScenario} self - Reference to the PidControllerScenario instance
 * @param {string} ruleName - Rule name
 * @param {string} sourceErrTopic - Error MQTT topic
 * @param {Object} targetVdCtrl - VD control to mark with error
 * @param {Object} vdCtrlEnable - Enable control
 * @param {Array<PidActuatorConfig>|null} actuators - Actuators of the circuit
 *     sharing the target control, null for the sensor
 * @returns {number|null} Rule ID or null
 */
function createErrChangeRule(
  self,
  ruleName,
  sourceErrTopic,
  targetVdCtrl,
  vdCtrlEnable,
  actuators
) {
  var isActuatorErrRule = actuators !== null;

  var ruleCfg = {
    whenChanged: [sourceErrTopic],
    then: function (newValue) {
      if (!isActuatorErrRule) {
        targetVdCtrl.setError(newValue);
      } else if (hasCriticalErr(newValue)) {
        targetVdCtrl.setError(newValue);
      } else {
        targetVdCtrl.setError(getActuatorsCriticalErr(actuators));
      }

      if (!hasCriticalErr(newValue)) {
        log.debug(
          'Error cleared or non-critical for topic "{}"',
          sourceErrTopic
        );
        tryClearReadonly(vdCtrlEnable, self.cfg);
        self.setState(self.computeState(vdCtrlEnable.getValue()));

        if (self.ctx.errorTimers[sourceErrTopic]) {
          clearTimeout(self.ctx.errorTimers[sourceErrTopic]);
          self.ctx.errorTimers[sourceErrTopic] = null;
        }
        return;
      }

      log.warning(
        'Critical error (r/w) for topic "{}": "{}"',
        sourceErrTopic,
        newValue
      );

      if (self.ctx.errorTimers[sourceErrTopic]) {
        return;
      }

      self.ctx.errorTimers[sourceErrTopic] = setTimeout(function () {
        var currentErrorVal = dev[sourceErrTopic];
        if (hasCriticalErr(currentErrorVal)) {
          log.error(
            'Scenario disabled: error for "{}" not cleared for {} ms',
            sourceErrTopic,
            self.ctx.errorCheckTimeoutMs
          );
          self.setState(self.computeState(vdCtrlEnable.getValue()));
          vdCtrlEnable.setReadonly(true);
          // The rule_enabled rule runs only after this callback. Stop the
          // circuits now, so that a sensor change before that rule cannot
          // start a circuit. A disabled scenario keeps its outputs as is
          if (self.ctx.switcher.isStarted) {
            self.ctx.switcher.stop();
          }
          vdCtrlEnable.setValue(false);
        }
        self.ctx.errorTimers[sourceErrTopic] = null;
      }, self.ctx.errorCheckTimeoutMs);
    },
  };

  var ruleId = defineRule(ruleName, ruleCfg);
  return ruleId;
}

/**
 * Creates the rules of one circuit
 * @param {PidControllerScenario} self - Reference to the PidControllerScenario instance
 * @param {Circuit} circuit - Circuit runtime
 * @returns {boolean} True if all rules created
 */
function createCircuitRules(self, circuit) {
  var ctrlIds = getCircuitCtrlIds(circuit.name);
  var ruleNamePrefix = getCircuitRuleNamePrefix(self, circuit.name);
  var storageKey = getSetpointStorageKey(circuit.name);
  var vdCtrlEnable = self.vd.devObj.getControl(vdCtrl.ruleEnabled);

  // Works when the scenario is disabled too, so crossed setpoints
  // show up right away
  var ruleId = defineRule(ruleNamePrefix + 'set_setpoint', {
    whenChanged: [self.genNames.vDevice + '/' + ctrlIds.setpoint],
    then: function onSetpointChanged(newValue) {
      try {
        self.setPsUserSetting(storageKey, newValue);
        log.debug('{} "{}" saved to storage', storageKey, newValue);
      } catch (err) {
        log.error('Error saving {} to storage: {}', storageKey, err);
      }

      if (self.ctx.switcher.onSetpointChanged()) {
        self.setState(self.computeState(vdCtrlEnable.getValue()));
      }
    },
  });
  if (!ruleId) {
    log.error('Failed to create {} setpoint change rule', circuit.name);
    return false;
  }
  log.debug(
    '{} setpoint change rule created with ID "{}"',
    circuit.name,
    ruleId
  );

  // PID reset button
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
 * Creates all PID controller rules
 * @param {PidControllerScenario} self - Reference to the PidControllerScenario instance
 * @param {PidControllerConfig} cfg - Configuration
 * @returns {boolean} True if all rules created
 */
function createRules(self, cfg) {
  var vdCtrlCurValue = self.vd.devObj.getControl(vdCtrl.currentValue);

  var ruleId = null;

  // Sensor changed then update VD display and pick the active circuit
  // (PID reads sensor on its timer)
  ruleId = defineRule(self.genNames.ruleSensorChanged, {
    whenChanged: [cfg.sensor],
    then: function (newValue) {
      vdCtrlCurValue.setValue(newValue);
      self.ctx.switcher.updateActiveCircuit();
    },
  });
  if (!ruleId) {
    log.error('Failed to create sensor changed rule');
    return false;
  }
  // This rule not disable when user use switch in virtual device
  log.debug('Sensor changed rule created with ID "{}"', ruleId);

  // Enable/disable scenario
  ruleId = defineRule(self.genNames.ruleSetScStatus, {
    whenChanged: [self.genNames.vDevice + '/' + vdCtrl.ruleEnabled],
    then: function (newValue) {
      if (newValue) {
        self.ctx.switcher.start();
      } else {
        if (self.ctx.suppressNextDisable) {
          self.ctx.suppressNextDisable = false;
          log.debug('Skipping initial disable from storage restore');
          return;
        }
        self.ctx.switcher.stop();
      }
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

  // Error rules
  return createErrorRules(self, cfg);
}

/**
 * Creates error handling rules for sensor and actuators
 * @param {PidControllerScenario} self - Reference to the PidControllerScenario instance
 * @param {PidControllerConfig} cfg - Configuration
 * @returns {boolean} True if all rules created successfully
 */
function createErrorRules(self, cfg) {
  var vdCtrlCurValue = self.vd.devObj.getControl(vdCtrl.currentValue);
  var vdCtrlEnable = self.vd.devObj.getControl(vdCtrl.ruleEnabled);

  var ruleId = null;

  // Sensor error
  var sensorErrTopic = cfg.sensor + '#error';
  ruleId = createErrChangeRule(
    self,
    self.genNames.ruleSensorErr,
    sensorErrTopic,
    vdCtrlCurValue,
    vdCtrlEnable,
    null
  );
  if (!ruleId) {
    log.error('Failed to create sensor error handling rule');
    return false;
  }
  log.debug('Sensor error rule created with ID "{}"', ruleId);

  // Actuator errors, shown on the circuit power
  var circuitNames = Object.keys(self.ctx.circuits);
  for (var c = 0; c < circuitNames.length; c++) {
    var circuit = self.ctx.circuits[circuitNames[c]];
    var actuators = circuit.cfg.actuators;
    var vdCtrlOutputPower = self.vd.devObj.getControl(
      getCircuitCtrlIds(circuit.name).outputPower
    );
    var ruleNamePrefix = getCircuitRuleNamePrefix(self, circuit.name);

    for (var i = 0; i < actuators.length; i++) {
      ruleId = createErrChangeRule(
        self,
        ruleNamePrefix + 'actuator_err_' + i,
        actuators[i].mqttTopicName + '#error',
        vdCtrlOutputPower,
        vdCtrlEnable,
        actuators
      );
      if (!ruleId) {
        log.error(
          'Failed to create error rule for actuator "{}"',
          actuators[i].mqttTopicName
        );
        return false;
      }
      log.debug(
        'Actuator error rule created for "{}" with ID "{}"',
        actuators[i].mqttTopicName,
        ruleId
      );
    }
  }

  return true;
}

/**
 * Restore setpoint from persistent storage
 * Heating also reads the setpoint key stored before the circuits split
 * @param {PidControllerScenario} self - Reference to the PidControllerScenario instance
 * @param {HeatFlowDirection} circuitName - Circuit name
 * @param {PidControllerCircuitConfig} cfg - Circuit configuration
 * @returns {number} Setpoint to use
 */
function restoreSetpoint(self, circuitName, cfg) {
  var storageKey = getSetpointStorageKey(circuitName);
  var stored = self.getPsUserSetting(storageKey, undefined);

  // Heating setpoint stored before the circuits split
  if (stored === undefined && circuitName === HeatFlowDirection.HEATING) {
    stored = self.getPsUserSetting('setpoint', undefined);
  }

  var isValid =
    typeof stored === 'number' &&
    stored >= cfg.setpointLimits.min &&
    stored <= cfg.setpointLimits.max;

  if (isValid) {
    self.setPsUserSetting(storageKey, stored);
    log.debug(
      'Restored {}="{}" for scenario="{}"',
      storageKey,
      stored,
      self.idPrefix
    );
    return stored;
  }

  var usedSetpoint = cfg.setpoint;
  self.setPsUserSetting(storageKey, usedSetpoint);

  if (typeof stored === 'number') {
    log.warning(
      'Stored setpoint="{}" out of range for "{}". Reset to "{}"',
      stored,
      storageKey,
      usedSetpoint
    );
  }
  return usedSetpoint;
}

/**
 * Scenario-specific initialization
 * @param {string} deviceTitle - Virtual device title
 * @param {PidControllerConfig} cfg - Configuration object
 * @returns {boolean} True if initialization succeeded
 */
PidControllerScenario.prototype.initSpecific = function (deviceTitle, cfg) {
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
  log.debug('Start init PID controller scenario');
  log.setLabel(loggerFileLabel + '/' + this.idPrefix);

  // Restore the setpoint of each circuit from storage
  var initialSetpoints = {};
  getEnabledCircuitNames(cfg).forEach(function restoreCircuit(circuitName) {
    initialSetpoints[circuitName] = restoreSetpoint(
      self,
      circuitName,
      cfg[circuitName]
    );
  });

  addCustomControlsToVirtualDevice(this, cfg, initialSetpoints);

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

    // Setpoints saved from the card may cross even with a valid config
    this.ctx.switcher.onSetpointChanged();
    if (enabledFromStorage) {
      this.ctx.switcher.start();
    }

    log.debug(
      'PID controller scenario initialized successfully for device "{}"',
      deviceTitle
    );
  }

  return rulesCreated;
};

exports.PidControllerScenario = PidControllerScenario;
