/**
 * @file circuit-switcher.mod.js - ES5 module for wb-rules v2.34
 * @description Picks the active circuit of a scenario with heating and
 *     cooling circuits. One circuit regulates at a time
 *
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var HeatFlowDirection = require('constants.mod').HeatFlowDirection;

/**
 * @typedef {Object} SwitchedRegulator
 * @property {function(): void} start - Starts regulation
 * @property {function(): void} stop - Stops regulation and turns the circuit off
 * @property {function(): void} update - Re-evaluates the circuit for the
 *   current temperature and setpoint
 */

/**
 * Circuit as the switcher uses it
 * @typedef {Object} SwitchedCircuit
 * @property {string} name - Circuit name
 * @property {function(): number} getTemperature - Current temperature
 * @property {function(): number} getSetpoint - Setpoint of the circuit
 * @property {function(boolean): void} showSetpointError - Shows or clears
 *   the error on the setpoint control of the circuit
 * @property {SwitchedRegulator} regulator - Regulator of the circuit
 */

/**
 * Names of the enabled circuits. The scenario config has a block for each
 * enabled circuit, and the block key is the circuit name
 * @param {Object} cfg - Scenario configuration
 * @returns {Array<string>} Enabled circuit names
 */
function getEnabledCircuitNames(cfg) {
  return [HeatFlowDirection.HEATING, HeatFlowDirection.COOLING].filter(
    function isEnabled(circuitName) {
      return !!cfg[circuitName];
    }
  );
}

/**
 * Switches the heating and cooling circuits of one scenario
 *
 * Heating works below its setpoint and cooling above its setpoint. Between
 * the setpoints the active circuit keeps working. The heating setpoint must
 * be below the cooling one, while it is not both circuits are off
 *
 * @param {{heating: SwitchedCircuit, cooling: SwitchedCircuit}} circuits -
 *   Enabled circuits by name, a disabled circuit is absent
 * @param {Object} log - Logger of the scenario
 * @constructor
 */
function CircuitSwitcher(circuits, log) {
  this.circuits = circuits;
  this.log = log;
  this.isStarted = false; // The scenario is on, start() was called last
  this.activeCircuit = null; // Circuit that regulates now, the other one is off
  this.isSetpointsCrossed = false; // Heating setpoint is not below cooling one
}

/**
 * Picks the circuit that regulates at the current temperature
 * @returns {SwitchedCircuit|null} Circuit to regulate, null while none is
 *   needed yet
 * @private
 */
CircuitSwitcher.prototype._pickCircuit = function pickCircuit() {
  var heating = this.circuits.heating;
  var cooling = this.circuits.cooling;
  if (!heating || !cooling) {
    return heating || cooling;
  }

  var curTemp = heating.getTemperature();
  if (curTemp < heating.getSetpoint()) {
    return heating;
  }
  if (curTemp > cooling.getSetpoint()) {
    return cooling;
  }
  return this.activeCircuit;
};

/**
 * Turns all circuits off
 * @private
 */
CircuitSwitcher.prototype._stopCircuits = function stopCircuits() {
  var self = this;
  this.activeCircuit = null;
  Object.keys(this.circuits).forEach(function stopCircuit(name) {
    self.circuits[name].regulator.stop();
  });
};

/**
 * Turns the inactive circuit off and starts the circuit picked for the
 * current temperature. While the setpoints cross both circuits are off
 */
CircuitSwitcher.prototype.start = function start() {
  this.isStarted = true;
  if (this.isSetpointsCrossed) {
    this._stopCircuits();
    return;
  }

  var self = this;
  var activeCircuit = this._pickCircuit();
  this.activeCircuit = activeCircuit;
  Object.keys(this.circuits).forEach(function stopInactiveCircuit(name) {
    var circuit = self.circuits[name];
    if (circuit !== activeCircuit) {
      circuit.regulator.stop();
    }
  });
  if (activeCircuit) {
    activeCircuit.regulator.start();
  }
};

/**
 * Turns all circuits off until the next start()
 */
CircuitSwitcher.prototype.stop = function stop() {
  this.isStarted = false;
  this._stopCircuits();
};

/**
 * Switches to the circuit picked for the current temperature, otherwise
 * updates the active one. Does nothing while the switcher is stopped or
 * the setpoints cross
 */
CircuitSwitcher.prototype.updateActiveCircuit =
  function updateActiveCircuit() {
    if (!this.isStarted || this.isSetpointsCrossed) {
      return;
    }

    var activeCircuit = this.activeCircuit;
    var nextCircuit = this._pickCircuit();
    if (nextCircuit === activeCircuit) {
      if (activeCircuit) {
        activeCircuit.regulator.update();
      }
      return;
    }

    this.log.debug(
      'Active circuit changed from "{}" to "{}"',
      activeCircuit ? activeCircuit.name : 'none',
      nextCircuit.name
    );
    if (activeCircuit) {
      activeCircuit.regulator.stop();
    }
    this.activeCircuit = nextCircuit;
    nextCircuit.regulator.start();
  };

/**
 * Checks that the heating setpoint is below the cooling one and shows the
 * error on both setpoint controls while it is not
 * @returns {boolean} True if the check result changed
 * @private
 */
CircuitSwitcher.prototype._checkSetpoints = function checkSetpoints() {
  var heating = this.circuits.heating;
  var cooling = this.circuits.cooling;
  if (!heating || !cooling) {
    return false;
  }

  var heatingSetpoint = heating.getSetpoint();
  var coolingSetpoint = cooling.getSetpoint();
  var isCrossed = heatingSetpoint >= coolingSetpoint;
  if (isCrossed === this.isSetpointsCrossed) {
    return false;
  }

  this.isSetpointsCrossed = isCrossed;
  heating.showSetpointError(isCrossed);
  cooling.showSetpointError(isCrossed);
  if (isCrossed) {
    this.log.error(
      'Heating setpoint "{}" must be below cooling setpoint "{}"',
      heatingSetpoint,
      coolingSetpoint
    );
  } else {
    this.log.info(
      'Heating setpoint "{}" is below cooling setpoint "{}"',
      heatingSetpoint,
      coolingSetpoint
    );
  }
  return true;
};

/**
 * Applies the setpoints after a change or after a restore from storage.
 * If the setpoints start or stop to cross, a started switcher starts again,
 * otherwise the active circuit is updated. Channels of a stopped switcher
 * stay untouched
 * @returns {boolean} True if the setpoints started or stopped to cross,
 *   the scenario then updates its state
 */
CircuitSwitcher.prototype.onSetpointChanged = function onSetpointChanged() {
  if (!this._checkSetpoints()) {
    this.updateActiveCircuit();
    return false;
  }
  if (this.isStarted) {
    this.start();
  }
  return true;
};

exports.CircuitSwitcher = CircuitSwitcher;
exports.getEnabledCircuitNames = getEnabledCircuitNames;
