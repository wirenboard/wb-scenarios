/**
 * @file thermostat-hysteresis.mod.js - ES5 module for wb-rules v2.34
 * @description Two-position control of one thermostat circuit
 *
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var HeatFlowDirection = require('constants.mod').HeatFlowDirection;

/**
 * Circuit as the regulator uses it
 * @typedef {Object} RegulatedCircuit
 * @property {function(): number} getTemperature - Current temperature
 * @property {function(): number} getSetpoint - Setpoint of the circuit
 * @property {function(boolean): void} setWorking - Turns the circuit on or off
 * @property {Object} log - Logger of the circuit
 */

/**
 * Two-position regulator of one thermostat circuit
 *
 * Heating turns on at setpoint - hysteresis and off at
 * setpoint + hysteresis, cooling the other way round
 *
 * @param {HeatFlowDirection} heatFlowDirection - Heat flow direction of the circuit
 * @param {number} hysteresis - Switching range around the setpoint (°C)
 * @param {RegulatedCircuit} circuit - Circuit to regulate
 * @constructor
 */
function HysteresisRegulator(heatFlowDirection, hysteresis, circuit) {
  this.isHeating = heatFlowDirection === HeatFlowDirection.HEATING;
  this.hysteresis = hysteresis;
  this.circuit = circuit;
}

/**
 * Starts regulation for the current temperature
 */
HysteresisRegulator.prototype.start = function start() {
  this.update();
};

/**
 * Turns the circuit off
 */
HysteresisRegulator.prototype.stop = function stop() {
  this.circuit.setWorking(false);
};

/**
 * Re-evaluates the circuit for the current temperature and setpoint
 */
HysteresisRegulator.prototype.update = function update() {
  var setpoint = this.circuit.getSetpoint();
  var curTemp = this.circuit.getTemperature();
  var upperLimit = setpoint + this.hysteresis;
  var lowerLimit = setpoint - this.hysteresis;

  // Above the range heating stops and cooling works, below the other way round
  if (curTemp >= upperLimit) {
    this.circuit.setWorking(!this.isHeating);
  } else if (curTemp <= lowerLimit) {
    this.circuit.setWorking(this.isHeating);
  }
};

exports.HysteresisRegulator = HysteresisRegulator;
