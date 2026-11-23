/**
 * @file pid-controller-regulator.mod.js - ES5 module for wb-rules v2.34
 * @description PID control of one circuit of the PID controller scenario
 *
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var PidEngine = require('pid-engine.mod').PidEngine;
var constants = require('constants.mod');

var MAX_CYCLE_TIME_DEVIATION_RATIO =
  constants.MAX_CYCLE_TIME_DEVIATION_RATIO;
var MS_PER_SECOND = constants.MS_PER_SECOND;

/**
 * Circuit settings that the regulator uses
 * @typedef {Object} PidRegulatorSettings
 * @property {{kp: number, ki: number, kd: number}} pidCoefficients - PID coefficients
 * @property {number} deadBand - Dead zone around setpoint
 * @property {number} calculationPeriodSec - PID recalculation interval
 */

/**
 * Circuit as the regulator uses it
 * @typedef {Object} RegulatedCircuit
 * @property {string} name - Circuit name, starts each log line
 * @property {function(): number} getTemperature - Current sensor value
 * @property {function(): number} getSetpoint - Setpoint of the circuit
 * @property {function(number): void} setOutput - Sets the circuit power 0..100
 * @property {Object} log - Logger of the scenario
 */

/**
 * PID regulator of one circuit of the PID controller
 * @param {string} heatFlowDirection - Heat flow direction of the circuit,
 *   a HeatFlowDirection value
 * @param {PidRegulatorSettings} settings - Settings of the circuit
 * @param {RegulatedCircuit} circuit - Circuit to regulate
 * @constructor
 */
function PidControllerRegulator(heatFlowDirection, settings, circuit) {
  this.calculationPeriodSec = settings.calculationPeriodSec;
  this.circuit = circuit;
  this.pid = new PidEngine(
    settings.pidCoefficients.kp,
    settings.pidCoefficients.ki,
    settings.pidCoefficients.kd,
    settings.deadBand,
    heatFlowDirection
  );

  this.isStarted = false;
  this.cycleTimerId = null; // setTimeout ID for next cycle
}

/**
 * Start PID calculation cycle with a reset PID
 */
PidControllerRegulator.prototype.start = function start() {
  this._cancelCycleTimer();
  this.isStarted = true;
  this.pid.reset();
  this._runCalculationCycle();
  this.circuit.log.debug(
    '{}: PID calculation cycle started',
    this.circuit.name
  );
};

/**
 * Stop PID: cancel timer, reset actuators
 */
PidControllerRegulator.prototype.stop = function stop() {
  this._cancelCycleTimer();
  this.isStarted = false;
  this.circuit.setOutput(0);
  this.circuit.log.debug(
    '{}: PID calculation cycle stopped',
    this.circuit.name
  );
};

/**
 * CircuitSwitcher calls this method when the sensor value or the setpoint
 * changes. It is empty because PID reads them at the start of each cycle
 */
PidControllerRegulator.prototype.update = function update() {};

/**
 * Restart a working regulator with a reset PID.
 * A stopped regulator resets PID on its next start.
 */
PidControllerRegulator.prototype.reset = function reset() {
  this.circuit.log.debug('{}: PID reset by user', this.circuit.name);
  if (this.isStarted) {
    this.start();
  }
};

/**
 * Cancel the calculation cycle timer
 * @private
 */
PidControllerRegulator.prototype._cancelCycleTimer =
  function cancelCycleTimer() {
    if (this.cycleTimerId) {
      clearTimeout(this.cycleTimerId);
      this.cycleTimerId = null;
    }
  };

/**
 * Compute PID output, set it on the circuit, schedule next cycle.
 * @private
 */
PidControllerRegulator.prototype._runCalculationCycle =
  function runCalculationCycle() {
    var self = this;
    var setpoint = this.circuit.getSetpoint();
    var measurement = this.circuit.getTemperature();

    var pidOutput = this.pid.computeAt(
      setpoint,
      measurement,
      Date.now(),
      this.calculationPeriodSec
    );

    var state = this.pid.getState();
    if (state.dtDeviation > MAX_CYCLE_TIME_DEVIATION_RATIO) {
      this.circuit.log.warning(
        '{}: PID cycle time deviation: actual={} sec, configured={} sec (deviation={}%)',
        this.circuit.name,
        state.dt.toFixed(2),
        this.calculationPeriodSec,
        (state.dtDeviation * 100).toFixed(1)
      );
    }
    this.circuit.log.debug(
      '{}: PID computed: setpoint={} measurement={} dt={} output={} P={} I={} D={}',
      this.circuit.name,
      setpoint,
      measurement,
      state.dt.toFixed(2),
      pidOutput.toFixed(1),
      state.p.toFixed(2),
      state.i.toFixed(2),
      state.d.toFixed(2)
    );

    this.circuit.setOutput(pidOutput);

    // Schedule next cycle
    this.cycleTimerId = setTimeout(function runNextCycle() {
      self.cycleTimerId = null;
      self._runCalculationCycle();
    }, this.calculationPeriodSec * MS_PER_SECOND);
  };

exports.PidControllerRegulator = PidControllerRegulator;
