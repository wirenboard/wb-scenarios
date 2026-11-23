/**
 * @file pid-engine.mod.js - PID controller algorithm
 * @description Pure PID algorithm without MQTT/wb-rules deps
 *     - Heat flow direction: heating raises the output below the setpoint,
 *       cooling raises it above the setpoint
 *     - P: proportional to current error
 *     - I: integral with anti-windup (clamping 0..100)
 *     - D: derivative on measurement with low-pass filter
 *     - Deadband: reduced gain factor near setpoint
 *
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var HeatFlowDirection = require('constants.mod').HeatFlowDirection;
var MS_PER_SECOND = require('constants.mod').MS_PER_SECOND;

/**
 * Gain multiplier inside the deadband zone.
 * PID does not turn off completely, but operates at 10%
 * of normal gain to compensate slow drift without
 * causing micro-switching.
 * @const {number}
 */
var DEADBAND_GAIN_FACTOR = 0.1;

/**
 * Low-pass filter coefficient for D-term.
 * newFiltered = (1 - alpha) * old + alpha * raw
 * Lower alpha = smoother but slower response.
 * @const {number}
 */
var D_FILTER_ALPHA = 0.2;

var OUTPUT_MIN = 0;
var OUTPUT_MAX = 100;

/**
 * Clamps a value to [min, max] range
 * @param {number} val - Value to clamp
 * @param {number} min - Minimum allowed value
 * @param {number} max - Maximum allowed value
 * @returns {number} Clamped value
 */
function clamp(val, min, max) {
  if (val < min) return min;
  if (val > max) return max;
  return val;
}

/**
 * PID Engine constructor
 * @param {number} kp - Proportional gain
 * @param {number} ki - Integral gain
 * @param {number} kd - Derivative gain
 * @param {number} deadband - Deadband zone width
 *     (same units as setpoint, e.g. degrees C)
 * @param {HeatFlowDirection} heatFlowDirection - Heat flow direction
 * @throws {Error} If heatFlowDirection is not a HeatFlowDirection value
 * @constructor
 */
function PidEngine(kp, ki, kd, deadband, heatFlowDirection) {
  if (
    heatFlowDirection !== HeatFlowDirection.HEATING &&
    heatFlowDirection !== HeatFlowDirection.COOLING
  ) {
    throw new Error(
      'Unknown heat flow direction "' + heatFlowDirection + '"'
    );
  }
  this.kp = kp;
  this.ki = ki;
  this.kd = kd;
  this.deadband = deadband || 0;
  // +1 for heating, -1 for cooling: cooling counts the error as
  // measurement minus setpoint
  this.heatFlowSign =
    heatFlowDirection === HeatFlowDirection.HEATING ? 1 : -1;

  // Internal state
  this.integral = 0;
  this.lastMeasurement = null;
  this.filteredDerivative = 0;
  this.lastComputeTimeMs = null; // Time of the last computeAt call

  // Last computed components (for getState)
  this._lastP = 0;
  this._lastI = 0;
  this._lastD = 0;
  this._lastOutput = 0;
  this._lastDt = 0;
  this._lastDtDeviation = 0;
}

/**
 * Compute PID output value
 *
 * Key design decisions:
 * - D on measurement (not error): avoids spike when
 *   setpoint changes
 * - Low-pass filter on D: smooths sensor noise
 * - Clamping integral: simple anti-windup, integral
 *   cannot exceed output range
 * - Deadband with gain factor: near setpoint PID works
 *   at 10% gain instead of turning off completely
 *
 * @param {number} setpoint - Target value
 * @param {number} measurement - Current measured value
 * @param {number} dt - Time delta in seconds
 * @returns {number} Output clamped to 0..100
 */
PidEngine.prototype.compute = function (setpoint, measurement, dt) {
  var error = this.heatFlowSign * (setpoint - measurement);

  // Deadband: reduce gain near setpoint
  var inDeadband = Math.abs(error) < this.deadband;
  var gainFactor = inDeadband ? DEADBAND_GAIN_FACTOR : 1.0;

  // P - proportional to current error
  var P = this.kp * error * gainFactor;

  // I - integral with anti-windup (clamping)
  this.integral += this.ki * error * dt * gainFactor;
  this.integral = clamp(this.integral, OUTPUT_MIN, OUTPUT_MAX);

  // D - derivative on measurement, not error
  // Uses low-pass filter to reduce sensor noise
  var D = 0;
  if (this.lastMeasurement !== null && dt > 0) {
    var rawDerivative = (measurement - this.lastMeasurement) / dt;
    this.filteredDerivative =
      (1 - D_FILTER_ALPHA) * this.filteredDerivative +
      D_FILTER_ALPHA * rawDerivative;
    D = -this.heatFlowSign * this.kd * this.filteredDerivative * gainFactor;
  }
  this.lastMeasurement = measurement;

  var output = clamp(P + this.integral + D, OUTPUT_MIN, OUTPUT_MAX);

  // Store for getState() debugging
  this._lastP = P;
  this._lastI = this.integral;
  this._lastD = D;
  this._lastOutput = output;

  return output;
};

/**
 * Compute PID output at the given time. The first call after reset uses
 * the expected dt, the next calls use the time since the previous call.
 * getState() then gives the used dt and its deviation from the expected dt
 * @param {number} setpoint - Target value
 * @param {number} measurement - Current measured value
 * @param {number} nowMs - Current time in milliseconds
 * @param {number} expectedDtSec - Configured time between calls in seconds
 * @returns {number} Output clamped to 0..100
 */
PidEngine.prototype.computeAt = function computeAt(
  setpoint,
  measurement,
  nowMs,
  expectedDtSec
) {
  var dt = expectedDtSec;
  if (this.lastComputeTimeMs !== null) {
    dt = (nowMs - this.lastComputeTimeMs) / MS_PER_SECOND;
  }
  this.lastComputeTimeMs = nowMs;
  this._lastDt = dt;
  this._lastDtDeviation = Math.abs(dt - expectedDtSec) / expectedDtSec;
  return this.compute(setpoint, measurement, dt);
};

/**
 * Reset PID internal state.
 * Call when scenario restarts or re-enables.
 * Integral resets to zero for smooth ramp-up.
 */
PidEngine.prototype.reset = function () {
  this.integral = 0;
  this.lastMeasurement = null;
  this.filteredDerivative = 0;
  this.lastComputeTimeMs = null;
  this._lastP = 0;
  this._lastI = 0;
  this._lastD = 0;
  this._lastOutput = 0;
  this._lastDt = 0;
  this._lastDtDeviation = 0;
};

/**
 * Get current PID state for debugging/logging
 * @returns {{p: number, i: number, d: number, integral: number, output: number, dt: number, dtDeviation: number}}
 *     PID components and output:
 *     - p: Last P component
 *     - i: Last I component (= current integral value)
 *     - d: Last D component
 *     - integral: Accumulated integral value
 *     - output: Last output
 *     - dt: Last dt of computeAt in seconds
 *     - dtDeviation: Relative deviation of the last dt from the expected dt
 */
PidEngine.prototype.getState = function () {
  return {
    p: this._lastP,
    i: this._lastI,
    d: this._lastD,
    integral: this.integral,
    output: this._lastOutput,
    dt: this._lastDt,
    dtDeviation: this._lastDtDeviation,
  };
};

/**
 * Checks the PID settings that all scenarios with PidEngine have.
 * The scenario writes the texts to its log
 * @param {{kp: number, ki: number, kd: number}} pidCoefficients - PID gains
 * @param {number} deadBand - Dead band around the setpoint
 * @returns {Array<string>} Error texts, empty if the settings are correct
 */
function getPidSettingsErrors(pidCoefficients, deadBand) {
  var errors = [];
  if (!pidCoefficients || typeof pidCoefficients !== 'object') {
    errors.push('PID coefficients object is missing');
  } else {
    var gainTitles = { kp: 'Kp', ki: 'Ki', kd: 'Kd' };
    Object.keys(gainTitles).forEach(function checkGain(key) {
      var gain = pidCoefficients[key];
      if (typeof gain !== 'number' || gain < 0) {
        errors.push(
          gainTitles[key] + ' must be a number >= 0, but got "' + gain + '"'
        );
      }
    });
  }
  if (typeof deadBand !== 'number' || deadBand < 0) {
    errors.push(
      'dead band must be a number >= 0, but got "' + deadBand + '"'
    );
  }
  return errors;
}

exports.PidEngine = PidEngine;
exports.getPidSettingsErrors = getPidSettingsErrors;
