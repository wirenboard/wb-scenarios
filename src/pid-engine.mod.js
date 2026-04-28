/**
 * @file pid-engine.mod.js - PID controller algorithm
 * @description Pure PID algorithm without MQTT/wb-rules deps
 *     - P: proportional to current error
 *     - I: integral with anti-windup (clamping 0..100)
 *     - D: derivative on measurement with low-pass filter
 *     - Deadband: reduced gain factor near setpoint
 *
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

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
 * @constructor
 */
function PidEngine(kp, ki, kd, deadband) {
  this.kp = kp;
  this.ki = ki;
  this.kd = kd;
  this.deadband = deadband || 0;

  // Internal state
  this.integral = 0;
  this.lastMeasurement = null;
  this.filteredDerivative = 0;

  // Last computed components (for getState)
  this._lastP = 0;
  this._lastI = 0;
  this._lastD = 0;
  this._lastOutput = 0;
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
  var error = setpoint - measurement;

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
    D = -this.kd * this.filteredDerivative * gainFactor;
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
 * Reset PID internal state.
 * Call when scenario restarts or re-enables.
 * Integral resets to zero for smooth ramp-up.
 */
PidEngine.prototype.reset = function () {
  this.integral = 0;
  this.lastMeasurement = null;
  this.filteredDerivative = 0;
  this._lastP = 0;
  this._lastI = 0;
  this._lastD = 0;
  this._lastOutput = 0;
};

/**
 * Get current PID state for debugging/logging
 * @returns {Object} PID components and output
 * @returns {number} returns.p - Last P component
 * @returns {number} returns.i - Last I component
 *     (= current integral value)
 * @returns {number} returns.d - Last D component
 * @returns {number} returns.integral - Accumulated
 *     integral value
 * @returns {number} returns.output - Last output
 */
PidEngine.prototype.getState = function () {
  return {
    p: this._lastP,
    i: this._lastI,
    d: this._lastD,
    integral: this.integral,
    output: this._lastOutput,
  };
};

exports.PidEngine = PidEngine;
