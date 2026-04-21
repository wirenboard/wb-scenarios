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
var PidEngine = require('pid-engine.mod').PidEngine;

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
  setEnable: aTable.actionsTable.setEnable,
  setDisable: aTable.actionsTable.setDisable,
};

/**
 * @typedef {Object} ActuatorConfig
 * @property {string} mqttTopicName - MQTT topic of the actuator (e.g. 'relay_module/K2')
 * @property {'setEnable'|'setDisable'} behaviorType - Action when heating is needed
 */

/**
 * @typedef {Object} PidCoefficients
 * @property {number} kp - Proportional gain
 * @property {number} ki - Integral gain
 * @property {number} kd - Derivative gain
 */

/**
 * @typedef {Object} ThermostatConfig
 * @property {string} [idPrefix] - Optional prefix for scenario identification
 *   If not provided, it will be generated from the scenario name
 * @property {number} targetTemp - Target temperature set by the user
 * @property {number} tempLimitsMin - Lower limit for temperature setting
 * @property {number} tempLimitsMax - Upper limit for temperature setting
 * @property {string} tempSensor - Name of the input control topic - monitored
 *   Example: temperature sensor whose value should be tracked
 *   'temp_sensor/temp_value'
 * @property {Array<ActuatorConfig>} actuators - List of output controls
 * @property {'hysteresis'|'pid'} controlMode - Control algorithm selector
 *
 * Hysteresis mode (controlMode === 'hysteresis'):
 * @property {number} hysteresis - Hysteresis value (switching range, °C)
 *
 * PID mode (controlMode === 'pid'):
 * @property {Object} pidSettings - PID settings object
 * @property {number} pidSettings.deadBand - Dead band around setpoint (°C)
 * @property {number} pidSettings.kp - Proportional gain
 * @property {number} pidSettings.ki - Integral gain
 * @property {number} pidSettings.kd - Derivative gain
 * @property {number} pidSettings.pwmPeriodSec - PWM cycle duration (seconds)
 * @property {number} pidSettings.pidRecalcCycles - Recompute PID every N cycles
 * @property {number} pidSettings.minOnTimeSec - Minimum actuator ON time (s)
 * @property {number} pidSettings.minOffTimeSec - Minimum actuator OFF time (s)
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
   * One persistent-storage for all scenarios of this type,
   * contains target temperature set by user in virtual device.
   * Stored in common storage "wb-scenarios-common-persistent-data":
   * @example
   *   scenariosRegistry = {
   *     "bathroom_floor": {
   *       "userSettings": { "targetTemp": 22 }
   *     },
   *     "kitchen_heater": {
   *       "userSettings": { "targetTemp": 24 }
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
    // PID mode state
    pid: null, // PidEngine instance
    cycleTimerId: null, // setTimeout ID for next PWM cycle
    offTimerId: null, // setTimeout ID for turning off actuators mid-cycle
    pwmCycleCount: 0, // Counter for PID recalculation
    pidOutput: 0, // Last PID output (0-100)
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
  outputPower: 'output_power',
  outputTiming: 'output_timing',
  pidReset: 'pid_reset',
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
    rulePidReset: baseRuleName + 'pid_reset',
  };
};

/**
 * Get configuration for waiting for controls
 * @param {ThermostatConfig} cfg - Configuration object
 * @returns {Object} Waiting configuration object
 */
ThermostatScenario.prototype.defineControlsWaitConfig = function (cfg) {
  var actuatorTopics = extractMqttTopics(cfg.actuators || []);

  var allTopics = [].concat(cfg.tempSensor, actuatorTopics);
  return { controls: allTopics };
};

/**
 * Configuration validation
 * @param {ThermostatConfig} cfg - Configuration object
 * @returns {boolean} True if configuration is valid, false otherwise
 */
ThermostatScenario.prototype.validateCfg = function (cfg) {
  var isLimitsCorrect = cfg.tempLimitsMin < cfg.tempLimitsMax;
  if (!isLimitsCorrect) {
    log.error(
      'Thermostat validation error: temperature limit "Min" = "{}" must be less than "Max" = "{}"',
      cfg.tempLimitsMin,
      cfg.tempLimitsMax
    );
  }

  var isTargetTempCorrect =
    cfg.targetTemp >= cfg.tempLimitsMin &&
    cfg.targetTemp <= cfg.tempLimitsMax;
  if (!isTargetTempCorrect) {
    log.error(
      'Thermostat validation error: target temperature "{}" must be in the range from "Min" to "Max"',
      cfg.targetTemp
    );
  }

  var isModeParamsCorrect = true;
  if (cfg.controlMode === 'hysteresis') {
    if (!(cfg.hysteresis > 0)) {
      log.error(
        'Thermostat validation error: hysteresis value must be greater than 0, but got "{}"',
        cfg.hysteresis
      );
      isModeParamsCorrect = false;
    }
  } else if (cfg.controlMode === 'pid') {
    if (
      typeof cfg.pidSettings.deadBand !== 'number' ||
      cfg.pidSettings.deadBand < 0
    ) {
      log.error(
        'Thermostat validation error: dead band value must be greater than 0, but got "{}"',
        cfg.pidSettings.deadBand
      );
      isModeParamsCorrect = false;
    }
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

  // Validate actuators array
  if (!Array.isArray(cfg.actuators) || cfg.actuators.length === 0) {
    log.error(
      'Thermostat validation error: at least one actuator is required'
    );
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

  var isPidValid = true;
  if (cfg.controlMode === 'pid') {
    if (!cfg.pidSettings || typeof cfg.pidSettings !== 'object') {
      log.error(
        'Thermostat validation error: pidSettings object is missing, but got "{}"',
        cfg.pidSettings
      );
      isPidValid = false;
    } else if (
      !cfg.pidSettings.pidCoefficients ||
      typeof cfg.pidSettings.pidCoefficients !== 'object'
    ) {
      log.error(
        'Thermostat validation error: PID coefficients object is missing'
      );
      isPidValid = false;
    } else {
      if (
        typeof cfg.pidSettings.pidCoefficients.kp !== 'number' ||
        cfg.pidSettings.pidCoefficients.kp < 0
      ) {
        log.error(
          'Thermostat validation error: Kp must be a number >= 0, but got "{}"',
          cfg.pidSettings.pidCoefficients.kp
        );
        isPidValid = false;
      }
      if (
        typeof cfg.pidSettings.pidCoefficients.ki !== 'number' ||
        cfg.pidSettings.pidCoefficients.ki < 0
      ) {
        log.error(
          'Thermostat validation error: Ki must be a number >= 0, but got "{}"',
          cfg.pidSettings.pidCoefficients.ki
        );
        isPidValid = false;
      }
      if (
        typeof cfg.pidSettings.pidCoefficients.kd !== 'number' ||
        cfg.pidSettings.pidCoefficients.kd < 0
      ) {
        log.error(
          'Thermostat validation error: Kd must be a number >= 0, but got "{}"',
          cfg.pidSettings.pidCoefficients.kd
        );
        isPidValid = false;
      }
    }
    if (
      typeof cfg.pidSettings.pwmPeriodSec !== 'number' ||
      cfg.pidSettings.pwmPeriodSec <= 0 ||
      cfg.pidSettings.pwmPeriodSec % 1 !== 0
    ) {
      log.error(
        'Thermostat validation error: Cycle period must be an integer > 0, but got "{}"',
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
        'Thermostat validation error: PID recalc cycles must be an integer >= 1, but got "{}"',
        cfg.pidSettings.pidRecalcCycles
      );
      isPidValid = false;
    }
    if (
      typeof cfg.pidSettings.minOnTimeSec !== 'number' ||
      cfg.pidSettings.minOnTimeSec < 0
    ) {
      log.error(
        'Thermostat validation error: min ON time must be a number >= 0, but got "{}"',
        cfg.pidSettings.minOnTimeSec
      );
      isPidValid = false;
    }
    if (
      typeof cfg.pidSettings.minOffTimeSec !== 'number' ||
      cfg.pidSettings.minOffTimeSec < 0
    ) {
      log.error(
        'Thermostat validation error: min OFF time must be a number >= 0, but got "{}"',
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
        'Thermostat validation error: Cycle period ({}) must be greater than min ON time ({}) + min OFF time ({}) = {}',
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
    isModeParamsCorrect &&
    isTempSensorValid &&
    isActuatorsValid &&
    isPidValid;

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
    // Default to OFF: heating is started explicitly by the scenario logic.
    value: false,
    forceDefault: true,
    order: 4,
    readonly: true,
  };
  self.vd.devObj.addControl(vdCtrl.actuatorStatus, controlCfg);

  if (cfg.controlMode === 'pid') {
    controlCfg = {
      title: { en: 'Power', ru: 'Мощность' },
      type: 'value',
      value: 0,
      units: '%',
      order: 5,
      readonly: true,
    };
    self.vd.devObj.addControl(vdCtrl.outputPower, controlCfg);

    controlCfg = {
      title: {
        en: 'ON / OFF (s)',
        ru: 'Вкл / Выкл (с)',
      },
      type: 'text',
      value: '-',
      order: 6,
      readonly: true,
    };
    self.vd.devObj.addControl(vdCtrl.outputTiming, controlCfg);

    controlCfg = {
      title: {
        en: 'Reset PID',
        ru: 'Сброс ПИД',
      },
      type: 'pushbutton',
      order: 7,
    };
    self.vd.devObj.addControl(vdCtrl.pidReset, controlCfg);
  }
}

/**
 * Set a VD control value only if it differs from the current one.
 * Avoids spurious MQTT publishes and rule re-triggering.
 * @param {Object} ctrl - VD control object
 * @param {*} value - Desired value
 */
function setCtrlIfChanged(ctrl, value) {
  if (ctrl.getValue() !== value) {
    ctrl.setValue(value);
  }
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
  // WARNING: Called on every temperature change. We always recalculate whether
  // heating should be on or off, but the actual switch (setValue) only fires
  // when the value needs to change (guarded by getValue() !== target check).
  var upperLimit = data.targetTemp + data.hysteresis;
  var lowerLimit = data.targetTemp - data.hysteresis;

  if (data.curTemp >= upperLimit) {
    log.debug(
      'Heater turned OFF, current/target temperatures: "{}"/"{}" °C',
      data.curTemp,
      data.targetTemp
    );
    applyHeatingToActuators(cfg.actuators, false);
    setCtrlIfChanged(vdCtrlActuator, false);
  } else if (data.curTemp <= lowerLimit) {
    log.debug(
      'Heater turned ON, current/target temperatures: "{}"/"{}" °C',
      data.curTemp,
      data.targetTemp
    );
    applyHeatingToActuators(cfg.actuators, true);
    setCtrlIfChanged(vdCtrlActuator, true);
  }
}

/**
 * Turn off all actuators (reverse state)
 * @param {Object} vdCtrlActuator - VD control for actuator status
 * @param {ThermostatConfig} cfg - Configuration object
 */
function turnOffAllActuators(vdCtrlActuator, cfg) {
  applyHeatingToActuators(cfg.actuators, false);
  setCtrlIfChanged(vdCtrlActuator, false);
}

/**
 * Cancel all PID/PWM timers
 * @param {Object} ctx - Scenario runtime context
 */
function cancelPidTimers(ctx) {
  if (ctx.cycleTimerId) {
    clearTimeout(ctx.cycleTimerId);
    ctx.cycleTimerId = null;
  }
  if (ctx.offTimerId) {
    clearTimeout(ctx.offTimerId);
    ctx.offTimerId = null;
  }
}

/**
 * Recompute PID output and update the corresponding VD control.
 * Called at the start of each PID cycle (every N PWM cycles).
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {ThermostatConfig} cfg - Configuration object
 */
function recomputePidOutput(self, cfg) {
  var setpoint = self.vd.devObj.getControl(vdCtrl.targetTemp).getValue();
  var measurement = dev[cfg.tempSensor];
  var dtSec = cfg.pidSettings.pwmPeriodSec * cfg.pidSettings.pidRecalcCycles;

  self.ctx.pidOutput = self.ctx.pid.compute(setpoint, measurement, dtSec);
  self.vd.devObj
    .getControl(vdCtrl.outputPower)
    .setValue(Math.round(self.ctx.pidOutput));

  var state = self.ctx.pid.getState();
  log.debug(
    'PID computed: setpoint={} measurement={} output={} P={} I={} D={}',
    setpoint,
    measurement,
    self.ctx.pidOutput.toFixed(1),
    state.p.toFixed(2),
    state.i.toFixed(2),
    state.d.toFixed(2)
  );
}

/**
 * Run one PWM cycle:
 * - At the start of each PID cycle (every N PWM cycles, when
 *   pwmCycleCount === 0) delegates PID recompute to recomputePidOutput
 * - Converts current pidOutput (%) into on/off durations
 * - Applies min ON / min OFF safety constraints
 * - Drives actuators (full ON, full OFF, or ON-then-OFF via setTimeout)
 * - Schedules its own next invocation via setTimeout
 *
 * Lifecycle is controlled externally: started by startPidMode, stopped by
 * stopPidMode (which cancels both the cycle timer and the in-cycle off timer).
 *
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {ThermostatConfig} cfg - Configuration object
 */
function runPwmCycle(self, cfg) {
  var vdCtrlActuator = self.vd.devObj.getControl(vdCtrl.actuatorStatus);
  var vdCtrlOutputTiming = self.vd.devObj.getControl(vdCtrl.outputTiming);

  // Recompute PID at the start of each PID cycle (every N PWM cycles).
  // pwmCycleCount === 0 means "we're at the start of a PID cycle".
  if (self.ctx.pwmCycleCount === 0) {
    recomputePidOutput(self, cfg);
  }
  self.ctx.pwmCycleCount =
    (self.ctx.pwmCycleCount + 1) % cfg.pidSettings.pidRecalcCycles;

  // Calculate on/off durations from duty cycle
  var onTime = (self.ctx.pidOutput / 100) * cfg.pidSettings.pwmPeriodSec;
  var offTime = cfg.pidSettings.pwmPeriodSec - onTime;
  var originalOnTime = onTime;
  var originalOffTime = offTime;
  var constraintsApplied = false;

  // Apply min on constraints
  if (onTime > 0 && onTime < cfg.pidSettings.minOnTimeSec) {
    onTime = 0;
    offTime = cfg.pidSettings.pwmPeriodSec - onTime;
    constraintsApplied = true;
  }

  // Apply min off constraints
  if (offTime < cfg.pidSettings.minOffTimeSec) {
    offTime = cfg.pidSettings.minOffTimeSec;
    onTime = cfg.pidSettings.pwmPeriodSec - offTime;
    constraintsApplied = true;
  }

  if (constraintsApplied) {
    log.debug(
      'Cycle adjusted: ON {}s -> {}s, OFF {}s -> {}s (PID output={}%)',
      originalOnTime.toFixed(2),
      onTime.toFixed(2),
      originalOffTime.toFixed(2),
      offTime.toFixed(2),
      self.ctx.pidOutput.toFixed(1)
    );
  }

  // Updating the display of working timers
  vdCtrlOutputTiming.setValue(
    Math.round(onTime) + ' / ' + Math.round(offTime)
  );

  if (onTime >= cfg.pidSettings.pwmPeriodSec) {
    // 100% duty — stay on the whole cycle
    applyHeatingToActuators(cfg.actuators, true);
    setCtrlIfChanged(vdCtrlActuator, true);
  } else if (onTime <= 0) {
    // 0% duty — stay off the whole cycle
    applyHeatingToActuators(cfg.actuators, false);
    setCtrlIfChanged(vdCtrlActuator, false);
  } else {
    // Partial duty: on, then off after onTime
    applyHeatingToActuators(cfg.actuators, true);
    setCtrlIfChanged(vdCtrlActuator, true);
    self.ctx.offTimerId = setTimeout(function () {
      self.ctx.offTimerId = null;
      applyHeatingToActuators(cfg.actuators, false);
      setCtrlIfChanged(vdCtrlActuator, false);
    }, onTime * 1000);
  }

  // Schedule next cycle
  self.ctx.cycleTimerId = setTimeout(function () {
    self.ctx.cycleTimerId = null;
    runPwmCycle(self, cfg);
  }, cfg.pidSettings.pwmPeriodSec * 1000);
}

/**
 * Stop PID mode: cancel timers, turn off actuators, reset PID
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {ThermostatConfig} cfg - Configuration object
 */
function stopPidMode(self, cfg) {
  cancelPidTimers(self.ctx);
  applyHeatingToActuators(cfg.actuators, false);
  if (self.ctx.pid) {
    self.ctx.pid.reset();
  }
  self.ctx.pwmCycleCount = 0;
  self.ctx.pidOutput = 0;

  // Reset VD controls
  var vdCtrlActuator = self.vd.devObj.getControl(vdCtrl.actuatorStatus);
  var vdCtrlOutputPower = self.vd.devObj.getControl(vdCtrl.outputPower);
  var vdCtrlOutputTiming = self.vd.devObj.getControl(vdCtrl.outputTiming);

  setCtrlIfChanged(vdCtrlActuator, false);
  vdCtrlOutputPower.setValue(0);
  vdCtrlOutputTiming.setValue('-');
  log.debug('PID mode stopped, timers cancelled, PID reset');
}

/**
 * Start PID mode: kick off the PWM cycle loop.
 * First runPwmCycle call will recompute PID (because pwmCycleCount === 0).
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {ThermostatConfig} cfg - Configuration object
 */
function startPidMode(self, cfg) {
  self.ctx.pwmCycleCount = 0;
  self.ctx.pidOutput = 0;
  runPwmCycle(self, cfg);
  log.debug('PID mode started');
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
  if (
    !hasCriticalErr(dev[cfg.tempSensor + '#error']) &&
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
  var isActuatorErrRule = ruleName.indexOf('actuator_err_') !== -1;

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
        targetVdCtrl.setError(getActuatorsCriticalErr(cfg.actuators));
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

  // TODO(Valerii 2026-03-20): Remove old storage migration after one year
  // Migration from old PersistentStorage('wbscThermostatSettings')
  if (storedTemp === undefined) {
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
 * Creates rules for hysteresis mode
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {ThermostatConfig} cfg - Configuration object
 * @returns {boolean} True if all rules created successfully, false otherwise
 */
function createHysteresisRules(self, cfg) {
  log.debug('Hysteresis: start all required rules creation');

  var vdCtrlCurTemp = self.vd.devObj.getControl(vdCtrl.curTemp);
  var vdCtrlActuator = self.vd.devObj.getControl(vdCtrl.actuatorStatus);
  var vdCtrlTargetTemp = self.vd.devObj.getControl(vdCtrl.targetTemp);
  var vdCtrlEnable = self.vd.devObj.getControl(vdCtrl.ruleEnabled);

  var ruleId = null;

  // Temperature changed rule
  ruleId = defineRule(self.genNames.ruleTempChanged, {
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
  });
  if (!ruleId) {
    log.error('Hysteresis: failed to create temperature changed rule');
    return false;
  }
  // This rule not disable when user use switch in virtual device
  log.debug(
    'Hysteresis: temperature changed rule created with ID "{}"',
    ruleId
  );

  // Scenario status rule
  ruleId = defineRule(self.genNames.ruleSetScStatus, {
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
        if (self.ctx.suppressNextDisable) {
          self.ctx.suppressNextDisable = false;
          log.debug(
            'Hysteresis: skipping initial disable from storage restore'
          );
          return;
        }
        turnOffAllActuators(vdCtrlActuator, cfg);
      }
    },
  });
  if (!ruleId) {
    log.error('Hysteresis: failed to create scenario status rule');
    return false;
  }
  // This rule is not managed when user use switch enable/disable in vdev
  log.debug('Hysteresis: scenario status rule created with ID "{}"', ruleId);

  // Target temperature change rule
  ruleId = defineRule(self.genNames.ruleSetTargetTemp, {
    whenChanged: [self.genNames.vDevice + '/' + vdCtrl.targetTemp],
    then: function (newValue, devName, cellName) {
      // Save the new temperature to persistent storage
      try {
        self.setPsUserSetting('targetTemp', newValue);
        log.debug(
          'Hysteresis: target temperature "{}" saved in persistent storage for scenario="{}"',
          newValue,
          self.idPrefix
        );
      } catch (err) {
        log.error(
          'Hysteresis: error saving target temperature to storage: {}',
          err
        );
      }
      var data = {
        curTemp: dev[cfg.tempSensor],
        targetTemp: newValue,
        hysteresis: cfg.hysteresis,
      };
      updateHeatingState(vdCtrlActuator, cfg, data);
    },
  });
  if (!ruleId) {
    log.error('Hysteresis: failed to create target temperature change rule');
    return false;
  }
  self.addRule(ruleId);
  log.debug(
    'Hysteresis: target temp change rule created with ID "{}"',
    ruleId
  );

  return true;
}

/**
 * Creates rules for PID mode
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {ThermostatConfig} cfg - Configuration object
 * @returns {boolean} True if all rules created successfully
 */
function createPidRules(self, cfg) {
  log.debug('PID: start all required rules creation');

  var vdCtrlCurTemp = self.vd.devObj.getControl(vdCtrl.curTemp);

  var ruleId = null;

  // Temperature changed → update VD display only (PID reads sensor on its timer)
  ruleId = defineRule(self.genNames.ruleTempChanged, {
    whenChanged: [cfg.tempSensor],
    then: function (newValue, devName, cellName) {
      vdCtrlCurTemp.setValue(newValue);
    },
  });
  if (!ruleId) {
    log.error('PID: failed to create temperature changed rule');
    return false;
  }
  // This rule not disable when user use switch in virtual device
  log.debug('PID: temperature display rule created with ID "{}"', ruleId);

  // Scenario enabled/disabled then start or stop PID
  ruleId = defineRule(self.genNames.ruleSetScStatus, {
    whenChanged: [self.genNames.vDevice + '/' + vdCtrl.ruleEnabled],
    then: function (newValue) {
      if (newValue) {
        startPidMode(self, cfg);
      } else {
        if (self.ctx.suppressNextDisable) {
          self.ctx.suppressNextDisable = false;
          log.debug('PID: skipping initial disable from storage restore');
          return;
        }
        stopPidMode(self, cfg);
      }
    },
  });
  if (!ruleId) {
    log.error('PID: failed to create scenario status rule');
    return false;
  }
  // This rule is not managed when user use switch enable/disable in vdev
  log.debug('PID: scenario status rule created with ID "{}"', ruleId);

  // Target temperature changed then save only (PID picks up new setpoint on next cycle)
  ruleId = defineRule(self.genNames.ruleSetTargetTemp, {
    whenChanged: [self.genNames.vDevice + '/' + vdCtrl.targetTemp],
    then: function (newValue, devName, cellName) {
      // Save the new temperature to persistent storage
      try {
        self.setPsUserSetting('targetTemp', newValue);
        log.debug(
          'PID: target temperature "{}" saved in persistent storage for scenario="{}"',
          newValue,
          self.idPrefix
        );
      } catch (err) {
        log.error(
          'PID: error saving target temperature to storage: {}',
          err
        );
      }
    },
  });
  if (!ruleId) {
    log.error('PID: failed to create target temperature change rule');
    return false;
  }
  self.addRule(ruleId);
  log.debug('PID: target temp rule created with ID "{}"', ruleId);

  // PID reset button
  ruleId = defineRule(self.genNames.rulePidReset, {
    whenChanged: [self.genNames.vDevice + '/' + vdCtrl.pidReset],
    then: function () {
      if (!self.ctx.pid) return;
      self.ctx.pid.reset();
      self.ctx.pidOutput = 0;
      log.debug('PID reset by user');

      // Restart cycle immediately with fresh PID compute
      cancelPidTimers(self.ctx);
      startPidMode(self, cfg);
    },
  });
  if (!ruleId) {
    log.error('PID: failed to create PID reset rule');
    return false;
  }
  self.addRule(ruleId);
  log.debug('PID: reset button rule created with ID "{}"', ruleId);

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
  var vdCtrlActuator = self.vd.devObj.getControl(vdCtrl.actuatorStatus);
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
 * Creates all required rules for current type scenario
 * @param {ThermostatScenario} self - Reference to the ThermostatScenario instance
 * @param {ThermostatConfig} cfg - Configuration object
 * @returns {boolean} True if all rules created successfully, false otherwise
 */
function createRules(self, cfg) {
  var rulesState = false;

  if (cfg.controlMode === 'pid') {
    rulesState = createPidRules(self, cfg);
  } else {
    rulesState = createHysteresisRules(self, cfg);
  }

  if (!rulesState) return false;

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
  log.debug('Start init thermostat scenario');
  log.setLabel(loggerFileLabel + '/' + this.idPrefix);

  // Restore target temperature from storage
  var usedTemp = restoreTargetTemperature(this, cfg);

  addCustomControlsToVirtualDevice(this, cfg, usedTemp);

  // Create all rules
  var rulesCreated = createRules(this, cfg);

  if (rulesCreated) {
    var enabledFromStorage = this.getPsUserSetting(vdCtrl.ruleEnabled, true);
    if (!enabledFromStorage) {
      this.ctx.suppressNextDisable = true;
    }

    if (cfg.controlMode === 'pid') {
      this.ctx.pid = new PidEngine(
        cfg.pidSettings.pidCoefficients.kp,
        cfg.pidSettings.pidCoefficients.ki,
        cfg.pidSettings.pidCoefficients.kd,
        cfg.pidSettings.deadBand
      );
      if (enabledFromStorage) {
        startPidMode(this, cfg);
      }
    } else if (enabledFromStorage) {
      // Set initial heater state after initialization
      var vdCtrlActuator = this.vd.devObj.getControl(vdCtrl.actuatorStatus);
      var vdCtrlTargetTemp = this.vd.devObj.getControl(vdCtrl.targetTemp);
      var data = {
        curTemp: dev[cfg.tempSensor],
        targetTemp: vdCtrlTargetTemp.getValue(),
        hysteresis: cfg.hysteresis,
      };
      updateHeatingState(vdCtrlActuator, cfg, data);
    }

    this.setState(ScenarioState.NORMAL);
    log.debug(
      'Thermostat scenario initialized successfully for device "{}"',
      deviceTitle
    );
  }

  return rulesCreated;
};

exports.ThermostatScenario = ThermostatScenario;
