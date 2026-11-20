/**
 * @file thermostat-pid.mod.js - ES5 module for wb-rules v2.34
 * @description PID control with PWM of one thermostat circuit
 *
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var PidEngine = require('pid-engine.mod').PidEngine;
var constants = require('constants.mod');

var MAX_CYCLE_TIME_DEVIATION_RATIO =
  constants.MAX_CYCLE_TIME_DEVIATION_RATIO;
var MS_PER_SECOND = constants.MS_PER_SECOND;

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
 * Circuit as the regulator uses it
 * @typedef {Object} RegulatedCircuit
 * @property {function(): number} getTemperature - Current temperature
 * @property {function(): number} getSetpoint - Setpoint of the circuit
 * @property {function(boolean): void} setWorking - Turns the circuit on or off
 * @property {Object} log - Logger of the circuit
 */

/**
 * @typedef {Object} PidRegulatorControls
 * @property {Object} outputPower - VD control of the output power (%)
 * @property {Object} outputTiming - VD control of the ON / OFF cycle durations
 */

/**
 * PID regulator with PWM of one thermostat circuit
 * @param {string} heatFlowDirection - Heat flow direction of the circuit,
 *   a HeatFlowDirection value
 * @param {PidSettings} pidSettings - PID settings of the circuit
 * @param {RegulatedCircuit} circuit - Circuit to regulate
 * @param {PidRegulatorControls} controls - VD controls of the circuit
 * @constructor
 */
function PidRegulator(heatFlowDirection, pidSettings, circuit, controls) {
  this.pidSettings = pidSettings;
  this.circuit = circuit;
  this.controls = controls;
  this.pid = new PidEngine(
    pidSettings.pidCoefficients.kp,
    pidSettings.pidCoefficients.ki,
    pidSettings.pidCoefficients.kd,
    pidSettings.deadBand,
    heatFlowDirection
  );

  this.isStarted = false;
  this.cycleTimerId = null; // setTimeout ID for next PWM cycle
  this.offTimerId = null; // setTimeout ID for turning off actuators mid-cycle
  this.pwmCycleCount = 0; // Counter for PID recalculation
  this.pidOutput = 0; // Last PID output (0-100)
  this.lastComputeTime = null; // Timestamp of last PID computation (ms)
}

/**
 * Start PID mode: reset PID and kick off the PWM cycle loop.
 * First _runPwmCycle call will recompute PID (because pwmCycleCount === 0).
 */
PidRegulator.prototype.start = function start() {
  this._cancelPidTimers();
  this.isStarted = true;
  this.pid.reset();
  this.pwmCycleCount = 0;
  this.pidOutput = 0;
  this.lastComputeTime = null; // Reset timestamp on start
  this._runPwmCycle();
  this.circuit.log.debug('PID mode started');
};

/**
 * Stop PID mode: cancel timers, turn off actuators
 */
PidRegulator.prototype.stop = function stop() {
  this._cancelPidTimers();
  this.isStarted = false;
  this.circuit.setWorking(false);
  this.controls.outputPower.setValue(0);
  this.controls.outputTiming.setValue('-');
  this.circuit.log.debug('PID mode stopped, timers cancelled');
};

/**
 * CircuitSwitcher calls this method when the temperature or the setpoint
 * changes. It is empty because PID reads them at the start of each cycle
 */
PidRegulator.prototype.update = function update() {};

/**
 * Restart a working regulator with a reset PID.
 * A stopped regulator resets PID on its next start.
 */
PidRegulator.prototype.reset = function reset() {
  this.circuit.log.debug('PID reset by user');
  if (this.isStarted) {
    this.start();
  }
};

/**
 * Cancel all PID/PWM timers
 * @private
 */
PidRegulator.prototype._cancelPidTimers = function cancelPidTimers() {
  if (this.cycleTimerId) {
    clearTimeout(this.cycleTimerId);
    this.cycleTimerId = null;
  }
  if (this.offTimerId) {
    clearTimeout(this.offTimerId);
    this.offTimerId = null;
  }
};

/**
 * Recompute PID output and update the corresponding VD control.
 * Called at the start of each PID cycle (every N PWM cycles).
 * @private
 */
PidRegulator.prototype._recomputePidOutput = function recomputePidOutput() {
  var now = Date.now();
  var setpoint = this.circuit.getSetpoint();
  var measurement = this.circuit.getTemperature();

  // Determine dt for PID computation
  var dt;
  var configuredDt =
    this.pidSettings.pwmPeriodSec * this.pidSettings.pidRecalcCycles;

  if (this.lastComputeTime === null) {
    dt = configuredDt;
    this.circuit.log.debug(
      'First PID cycle, using configured dt: {} sec',
      dt
    );
  } else {
    var actualDt = (now - this.lastComputeTime) / MS_PER_SECOND;
    var deviation = Math.abs(actualDt - configuredDt) / configuredDt;

    if (deviation > MAX_CYCLE_TIME_DEVIATION_RATIO) {
      this.circuit.log.warning(
        'PID cycle time deviation: actual={} sec, configured={} sec (deviation={}%)',
        actualDt.toFixed(2),
        configuredDt,
        (deviation * 100).toFixed(1)
      );
    }

    dt = actualDt;
  }

  this.lastComputeTime = now;

  this.pidOutput = this.pid.compute(setpoint, measurement, dt);
  this.controls.outputPower.setValue(Math.round(this.pidOutput));

  var state = this.pid.getState();
  this.circuit.log.debug(
    'PID computed: setpoint={} measurement={} output={} P={} I={} D={}',
    setpoint,
    measurement,
    this.pidOutput.toFixed(1),
    state.p.toFixed(2),
    state.i.toFixed(2),
    state.d.toFixed(2)
  );
};

/**
 * Run one PWM cycle:
 * - At the start of each PID cycle (every N PWM cycles, when
 *   pwmCycleCount === 0) delegates PID recompute to _recomputePidOutput
 * - Converts current pidOutput (%) into on/off durations
 * - Applies min ON / min OFF safety constraints
 * - Drives actuators (full ON, full OFF, or ON-then-OFF via setTimeout)
 * - Schedules its own next invocation via setTimeout
 *
 * Lifecycle is controlled externally: started by start, stopped by
 * stop (which cancels both the cycle timer and the in-cycle off timer).
 *
 * @private
 */
PidRegulator.prototype._runPwmCycle = function runPwmCycle() {
  var self = this;
  var pidSettings = this.pidSettings;

  // Recompute PID at the start of each PID cycle (every N PWM cycles).
  // pwmCycleCount === 0 means "we're at the start of a PID cycle".
  if (this.pwmCycleCount === 0) {
    this._recomputePidOutput();
  }
  this.pwmCycleCount =
    (this.pwmCycleCount + 1) % pidSettings.pidRecalcCycles;

  // Calculate on/off durations from duty cycle
  var onTime = (this.pidOutput / 100) * pidSettings.pwmPeriodSec;
  var offTime = pidSettings.pwmPeriodSec - onTime;
  var originalOnTime = onTime;
  var originalOffTime = offTime;
  var constraintsApplied = false;

  // Apply min on constraints
  if (onTime > 0 && onTime < pidSettings.minOnTimeSec) {
    onTime = 0;
    offTime = pidSettings.pwmPeriodSec - onTime;
    constraintsApplied = true;
  }

  // Apply min off constraints
  if (offTime < pidSettings.minOffTimeSec) {
    offTime = pidSettings.minOffTimeSec;
    onTime = pidSettings.pwmPeriodSec - offTime;
    constraintsApplied = true;
  }

  if (constraintsApplied) {
    this.circuit.log.debug(
      'Cycle adjusted: ON {}s -> {}s, OFF {}s -> {}s (PID output={}%)',
      originalOnTime.toFixed(2),
      onTime.toFixed(2),
      originalOffTime.toFixed(2),
      offTime.toFixed(2),
      this.pidOutput.toFixed(1)
    );
  }

  // Updating the display of working timers
  this.controls.outputTiming.setValue(
    Math.round(onTime) + ' / ' + Math.round(offTime)
  );

  if (onTime >= pidSettings.pwmPeriodSec) {
    // 100% duty — stay on the whole cycle
    this.circuit.setWorking(true);
  } else if (onTime <= 0) {
    // 0% duty — stay off the whole cycle
    this.circuit.setWorking(false);
  } else {
    // Partial duty: on, then off after onTime
    this.circuit.setWorking(true);
    this.offTimerId = setTimeout(function turnOffMidCycle() {
      self.offTimerId = null;
      self.circuit.setWorking(false);
    }, onTime * MS_PER_SECOND);
  }

  // Schedule next cycle
  this.cycleTimerId = setTimeout(function runNextCycle() {
    self.cycleTimerId = null;
    self._runPwmCycle();
  }, pidSettings.pwmPeriodSec * MS_PER_SECOND);
};

exports.PidRegulator = PidRegulator;
