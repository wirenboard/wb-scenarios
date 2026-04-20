/**
 * @file pid-controller.mod.js - ES5 module for wb-rules v2.34
 * @description PID controller scenario for analog outputs.
 *     Writes computed values directly to analog outputs.
 *
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState = require('virtual-device-helpers.mod').ScenarioState;
var Logger = require('logger.mod').Logger;
var PidEngine = require('pid-engine.mod').PidEngine;

var hasCriticalErr = require('wbsc-wait-controls.mod').hasCriticalErr;
var extractMqttTopics = require('scenarios-general-helpers.mod').extractMqttTopics;

var loggerFileLabel = 'WBSC-pid-controller-mod';
var log = new Logger(loggerFileLabel);

/**
 * @typedef {Object} PidActuatorConfig
 * @property {string} mqttTopicName - MQTT topic of the analog output
 * @property {'direct'|'inverted'} behaviorType - Output direction
 * @property {number} outputMin - Minimum output value (actuator units)
 * @property {number} outputMax - Maximum output value (actuator units)
 */

/**
 * @typedef {Object} PidControllerConfig
 * @property {string} [idPrefix] - Optional prefix for scenario ID
 * @property {string} sensor - MQTT topic of input sensor
 * @property {number} setpoint - Initial target value
 * @property {{min: number, max: number}} setpointLimits - Setpoint limits
 * @property {{kp: number, ki: number, kd: number}} pid - PID coefficients
 * @property {number} calculationPeriodSec - PID recalculation interval
 * @property {number} deadBand - Dead zone around setpoint
 * @property {Array<PidActuatorConfig>} actuators - Controlled outputs
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
    // PID mode state
    pid: null,          // PidEngine instance
    cycleTimerId: null, // setTimeout ID for next cycle
    pidOutput: 0,       // Last PID output (0-100)
  };
}
PidControllerScenario.prototype = Object.create(ScenarioBase.prototype);
PidControllerScenario.prototype.constructor = PidControllerScenario;

/**
 * Control key strings for virtual device
 */
var vdCtrl = {
  ruleEnabled: 'rule_enabled',
  setpoint: 'setpoint',
  currentValue: 'current_value',
  outputPower: 'output_power',
  pidReset: 'pid_reset',
};

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
    ruleSetSetpoint: baseRuleName + 'set_setpoint',
    rulePidReset: baseRuleName + 'pid_reset',
    ruleSensorErr: baseRuleName + 'sensor_error_changed',
  };
};

/**
 * Get configuration for waiting for controls
 * @param {PidControllerConfig} cfg - Configuration object
 * @returns {Object} Waiting configuration object
 */
PidControllerScenario.prototype.defineControlsWaitConfig = function (cfg) {
  var actuatorTopics = extractMqttTopics(cfg.actuators || []);
  var allTopics = [].concat(cfg.sensor, actuatorTopics);
  return { controls: allTopics };
};

/**
 * Configuration validation
 * @param {PidControllerConfig} cfg - Configuration object
 * @returns {boolean} True if configuration is valid
 */
PidControllerScenario.prototype.validateCfg = function (cfg) {
  var isLimitsCorrect = cfg.setpointLimits.min < cfg.setpointLimits.max;
  if (!isLimitsCorrect) {
    log.error(
      'PID validation error: setpoint limit Min="{}" must be less than Max="{}"',
      cfg.setpointLimits.min,
      cfg.setpointLimits.max
    );
  }

  var isSetpointCorrect =
    cfg.setpoint >= cfg.setpointLimits.min &&
    cfg.setpoint <= cfg.setpointLimits.max;
  if (!isSetpointCorrect) {
    log.error(
      'PID validation error: setpoint "{}" must be in range [Min, Max]',
      cfg.setpoint
    );
  }

  var isCoeffsValid = true;
  if (typeof cfg.pid.kp !== 'number' || cfg.pid.kp < 0) {
    log.error('PID validation error: Kp must be >= 0, got "{}"', cfg.pid.kp);
    isCoeffsValid = false;
  }
  if (typeof cfg.pid.ki !== 'number' || cfg.pid.ki < 0) {
    log.error('PID validation error: Ki must be >= 0, got "{}"', cfg.pid.ki);
    isCoeffsValid = false;
  }
  if (typeof cfg.pid.kd !== 'number' || cfg.pid.kd < 0) {
    log.error('PID validation error: Kd must be >= 0, got "{}"', cfg.pid.kd);
    isCoeffsValid = false;
  }

  var isPeriodValid =
    typeof cfg.calculationPeriodSec === 'number' &&
    cfg.calculationPeriodSec >= 1 &&
    cfg.calculationPeriodSec % 1 === 0;
  if (!isPeriodValid) {
    log.error(
      'PID validation error: calculationPeriodSec must be integer >= 1, got "{}"',
      cfg.calculationPeriodSec
    );
  }

  var isDeadBandValid =
    typeof cfg.deadBand === 'number' && cfg.deadBand >= 0;
  if (!isDeadBandValid) {
    log.error(
      'PID validation error: deadBand must be >= 0, got "{}"',
      cfg.deadBand
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

  // Validate actuators
  if (!Array.isArray(cfg.actuators) || cfg.actuators.length === 0) {
    log.error('PID validation error: at least one actuator is required');
    return false;
  }

  var isActuatorsValid = true;
  for (var i = 0; i < cfg.actuators.length; i++) {
    var act = cfg.actuators[i];
    if (typeof act.outputMin !== 'number' ||
        typeof act.outputMax !== 'number') {
      log.error(
        'PID validation error: outputMin and outputMax must be numbers for actuator "{}"',
        act.mqttTopicName
      );
      isActuatorsValid = false;
    } else if (act.outputMin >= act.outputMax) {
      log.error(
        'PID validation error: outputMin="{}" must be < outputMax="{}" for actuator "{}"',
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
    isCoeffsValid &&
    isPeriodValid &&
    isDeadBandValid &&
    isSensorValid &&
    isActuatorsValid
  );
};

/**
 * Adds custom controls to the virtual device
 * @param {PidControllerScenario} self - Reference to the PidControllerScenario instance
 * @param {PidControllerConfig} cfg - Configuration
 * @param {number} initialSetpoint - Restored setpoint value
 */
function addCustomControlsToVirtualDevice(self, cfg, initialSetpoint) {
  self.vd.devObj.addControl(vdCtrl.setpoint, {
    title: {
      en: 'Setpoint',
      ru: 'Уставка',
    },
    type: 'range',
    value: initialSetpoint,
    min: cfg.setpointLimits.min,
    max: cfg.setpointLimits.max,
    order: 2,
  });

  self.vd.devObj.addControl(vdCtrl.currentValue, {
    title: {
      en: 'Current Value',
      ru: 'Текущее значение',
    },
    type: 'value',
    value: dev[cfg.sensor],
    order: 3,
    readonly: true,
  });

  self.vd.devObj.addControl(vdCtrl.outputPower, {
    title: {
      en: 'Output Power',
      ru: 'Мощность',
    },
    type: 'value',
    value: 0,
    units: '%',
    order: 4,
    readonly: true,
  });

  self.vd.devObj.addControl(vdCtrl.pidReset, {
    title: {
      en: 'Reset PID',
      ru: 'Сброс ПИД',
    },
    type: 'pushbutton',
    order: 5,
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
    // Round to 2 decimal places to avoid floating point noise
    value = Math.round(value * 100) / 100;
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
 * Set all actuators to their minimum (direct) or maximum (inverted) value.
 * Used when scenario is disabled.
 * @param {Array<PidActuatorConfig>} actuators - List of actuator configs
 */
function resetActuatorsToMin(actuators) {
  applyOutputToActuators(actuators, 0);
}

/**
 * Compute PID output, apply to actuators, update VD, schedule next cycle.
 * @param {PidControllerScenario} self - Reference to the PidControllerScenario instance
 * @param {PidControllerConfig} cfg - Configuration
 */
function runCalculationCycle(self, cfg) {
  var measurement = dev[cfg.sensor];
  var setpoint = self.vd.devObj.getControl(vdCtrl.setpoint).getValue();

  self.ctx.pidOutput = self.ctx.pid.compute(
    setpoint,
    measurement,
    cfg.calculationPeriodSec
  );

  var state = self.ctx.pid.getState();
  log.debug(
    'PID: sp={} meas={} out={}% P={} I={} D={}',
    setpoint, measurement,
    self.ctx.pidOutput.toFixed(1),
    state.p.toFixed(2),
    state.i.toFixed(2),
    state.d.toFixed(2)
  );

  applyOutputToActuators(cfg.actuators, self.ctx.pidOutput);

  // Update VD display
  self.vd.devObj.getControl(vdCtrl.currentValue).setValue(measurement);
  self.vd.devObj.getControl(vdCtrl.outputPower).setValue(
    Math.round(self.ctx.pidOutput * 10) / 10
  );

  // Schedule next cycle
  self.ctx.cycleTimerId = setTimeout(function () {
    self.ctx.cycleTimerId = null;
    runCalculationCycle(self, cfg);
  }, cfg.calculationPeriodSec * 1000);
}

/**
 * Cancel the calculation cycle timer
 * @param {Object} ctx - Scenario runtime context
 */
function cancelCycleTimer(ctx) {
  if (ctx.cycleTimerId) {
    clearTimeout(ctx.cycleTimerId);
    ctx.cycleTimerId = null;
  }
}

/**
 * Start PID calculation cycle
 * @param {PidControllerScenario} self - Reference to the PidControllerScenario instance
 * @param {PidControllerConfig} cfg - Configuration
 */
function startPidCycle(self, cfg) {
  self.ctx.pidOutput = 0;
  runCalculationCycle(self, cfg);
  log.debug('PID calculation cycle started');
}

/**
 * Stop PID: cancel timer, reset actuators, reset PID
 * @param {PidControllerScenario} self - Reference to the PidControllerScenario instance
 * @param {PidControllerConfig} cfg - Configuration
 */
function stopPidCycle(self, cfg) {
  cancelCycleTimer(self.ctx);
  resetActuatorsToMin(cfg.actuators);
  if (self.ctx.pid) {
    self.ctx.pid.reset();
  }
  self.ctx.pidOutput = 0;

  self.vd.devObj.getControl(vdCtrl.outputPower).setValue(self.ctx.pidOutput);
  log.debug('PID calculation cycle stopped');
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
  if (
    !hasCriticalErr(dev[cfg.sensor + '#error']) &&
    !getActuatorsCriticalErr(cfg.actuators)
  ) {
    vdCtrlEnable.setReadonly(false);
  }
}

/**
 * Creates an error handling rule for a sensor or actuator
 * @param {PidControllerScenario} self - Reference to the PidControllerScenario instance
 * @param {string} ruleName - Rule name
 * @param {string} sourceErrTopic - Error MQTT topic
 * @param {Object} targetVdCtrl - VD control to mark with error
 * @param {Object} vdCtrlEnable - Enable control
 * @param {PidControllerConfig} cfg - Configuration
 * @returns {number|null} Rule ID or null
 */
function createErrChangeRule(
  self,
  ruleName,
  sourceErrTopic,
  targetVdCtrl,
  vdCtrlEnable,
  cfg
) {
  var isActuatorErrRule =
    ruleName.indexOf('actuator_err_') !== -1;

  var ruleCfg = {
    whenChanged: [sourceErrTopic],
    then: function (newValue) {
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
          'Error cleared or non-critical for topic "{}"',
          sourceErrTopic
        );
        tryClearReadonly(vdCtrlEnable, cfg);
        self.setState(ScenarioState.NORMAL);

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
          self.setState(ScenarioState.USED_CONTROL_ERROR);
          vdCtrlEnable.setReadonly(true);
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
 * Creates all PID controller rules
 * @param {PidControllerScenario} self - Reference to the PidControllerScenario instance
 * @param {PidControllerConfig} cfg - Configuration
 * @returns {boolean} True if all rules created
 */
function createRules(self, cfg) {
  var vdCtrlCurValue = self.vd.devObj.getControl(vdCtrl.currentValue);
  var vdCtrlEnable = self.vd.devObj.getControl(vdCtrl.ruleEnabled);

  var ruleId = null;

  // Sensor changed then update VD display (PID reads sensor on its timer)
  ruleId = defineRule(self.genNames.ruleSensorChanged, {
    whenChanged: [cfg.sensor],
    then: function (newValue) {
      vdCtrlCurValue.setValue(newValue);
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
        startPidCycle(self, cfg);
      } else {
        if (self.ctx.suppressNextDisable) {
          self.ctx.suppressNextDisable = false;
          log.debug('Skipping initial disable from storage restore');
          return;
        }
        stopPidCycle(self, cfg);
      }
    },
  });
  if (!ruleId) {
    log.error('Failed to create scenario status rule');
    return false;
  }
  // This rule is not managed when user use switch enable/disable in vdev
  log.debug('Scenario status rule created with ID "{}"', ruleId);

  // Setpoint changed then save to storage (PID picks up on next cycle)
  ruleId = defineRule(self.genNames.ruleSetSetpoint, {
    whenChanged: [self.genNames.vDevice + '/' + vdCtrl.setpoint],
    then: function (newValue) {
      try {
        self.setPsUserSetting('setpoint', newValue);
        log.debug('Setpoint "{}" saved to storage', newValue);
      } catch (err) {
        log.error('Error saving setpoint to storage: {}', err);
      }
    },
  });
  if (!ruleId) {
    log.error('Failed to create setpoint change rule');
    return false;
  }
  self.addRule(ruleId);
  log.debug('Setpoint change rule created with ID "{}"', ruleId);

  // PID reset button
  ruleId = defineRule(self.genNames.rulePidReset, {
    whenChanged: [self.genNames.vDevice + '/' + vdCtrl.pidReset],
    then: function () {
      if (!self.ctx.pid) return;
      self.ctx.pid.reset();
      self.ctx.pidOutput = 0;
      log.debug('PID reset by user');

      cancelCycleTimer(self.ctx);
      if (vdCtrlEnable.getValue()) {
        startPidCycle(self, cfg);
      }
    },
  });
  if (!ruleId) {
    log.error('Failed to create PID reset rule');
    return false;
  }
  self.addRule(ruleId);
  log.debug('PID reset rule created with ID "{}"', ruleId);

  // Error rules
  return createErrorRules(self, cfg);
}

/**
 * Creates error handling rules for sensor and actuators (shared by both modes)
 * @param {PidControllerScenario} self - Reference to the PidControllerScenario instance
 * @param {PidControllerConfig} cfg - Configuration
 * @returns {boolean} True if all rules created successfully
 */
function createErrorRules(self, cfg) {
  var vdCtrlCurValue = self.vd.devObj.getControl(vdCtrl.currentValue);
  var vdCtrlOutputPower = self.vd.devObj.getControl(vdCtrl.outputPower);
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
    cfg
  );
  if (!ruleId) {
    log.error('Failed to create sensor error handling rule');
    return false;
  }
  log.debug('Sensor error rule created with ID="{}"', ruleId);

  // Actuator errors
  var baseRuleName = 'wbsc_' + self.idPrefix + '_';
  for (var i = 0; i < cfg.actuators.length; i++) {
    var actuatorErrTopic = cfg.actuators[i].mqttTopicName + '#error';
    var actuatorErrRuleName = baseRuleName + 'actuator_err_' + i;
    ruleId = createErrChangeRule(
      self,
      actuatorErrRuleName,
      actuatorErrTopic,
      vdCtrlOutputPower,
      vdCtrlEnable,
      cfg
    );
    if (!ruleId) {
      log.error(
        'Failed to create error rule for actuator "{}"',
        cfg.actuators[i].mqttTopicName
      );
      return false;
    }
    log.debug(
      'Actuator error rule created for "{}" with ID="{}"',
      cfg.actuators[i].mqttTopicName,
      ruleId
    );
  }

  return true;
}

/**
 * Restore setpoint from persistent storage
 * @param {PidControllerScenario} self - Reference to the PidControllerScenario instance
 * @param {PidControllerConfig} cfg - Configuration
 * @returns {number} Setpoint to use
 */
function restoreSetpoint(self, cfg) {
  var stored = self.getPsUserSetting('setpoint', undefined);

  var isValid =
    typeof stored === 'number' &&
    stored >= cfg.setpointLimits.min &&
    stored <= cfg.setpointLimits.max;

  if (isValid) {
    log.debug('Restored setpoint="{}" for scenario="{}"', stored, self.idPrefix);
    return stored;
  }

  var usedSetpoint = cfg.setpoint;
  self.setPsUserSetting('setpoint', usedSetpoint);

  if (typeof stored === 'number') {
    log.warning(
      'Stored setpoint="{}" out of range for "{}". Reset to "{}"',
      stored,
      self.idPrefix,
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
  log.debug('Start init PID controller scenario');
  log.setLabel(loggerFileLabel + '/' + this.idPrefix);

  // Restore target setpoint from storage
  var usedSetpoint = restoreSetpoint(this, cfg);
  
  addCustomControlsToVirtualDevice(this, cfg, usedSetpoint);

  // Create all rules
  var rulesCreated = createRules(this, cfg);

  if (rulesCreated) {
    var enabledFromStorage = this.getPsUserSetting(vdCtrl.ruleEnabled, true);
    if (!enabledFromStorage) {
      this.ctx.suppressNextDisable = true;
    }

    this.ctx.pid = new PidEngine(
      cfg.pid.kp,
      cfg.pid.ki,
      cfg.pid.kd,
      cfg.deadBand
    );

    if (enabledFromStorage) {
      startPidCycle(this, cfg);
    }

    this.setState(ScenarioState.NORMAL);
    log.debug(
      'PID controller scenario initialized successfully for device "{}"',
      deviceTitle
    );
  }

  return rulesCreated;
};

exports.PidControllerScenario = PidControllerScenario;
