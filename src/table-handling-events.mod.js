/**
 * @file Module for registered control events table handling
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Comments in JSDoc format <https://jsdoc.app/>
 */

/**
 * Control activation event
 * @param {boolean} newValue - New state of the control
 * @returns {boolean} Returns true if control is enabled
 */
function whenEnabled(newValue) {
  var isEventTriggered = newValue === true;
  return isEventTriggered;
}

/**
 * Control deactivation event
 * @param {boolean} newValue - New state of the control
 * @returns {boolean} Returns true if control is disabled
 */
function whenDisabled(newValue) {
  var isEventTriggered = newValue === false;
  return isEventTriggered;
}

/**
 * Control state change event
 * @param {any} newValue - New state of the control
 * @returns {boolean} Always returns true
 */
function whenChange(newValue) {
  var isEventTriggered = true; // Always triggers on change
  return isEventTriggered;
}

/**
 * Value exceeds threshold event
 * @param {number} newValue - Numeric value of the control
 * @param {Object} controlConfig - Control configuration with threshold
 * @returns {boolean} Returns true if value is greater than threshold
 */
function whenGreaterThan(newValue, controlConfig) {
  return newValue > controlConfig.threshold;
}

/**
 * Value below threshold event
 * @param {number} newValue - Numeric value of the control
 * @param {Object} controlConfig - Control configuration with threshold
 * @returns {boolean} Returns true if value is less than threshold
 */
function whenLessThan(newValue, controlConfig) {
  return newValue < controlConfig.threshold;
}

/**
 * Events table
 * Contains event name and its corresponding:
 * - Allowed control types
 * - Handler
 */
var eventsTable = {
  whenChange: {
    reqCtrlTypes: [], // [] empty - can use any type
    handler: whenChange,
  },
  whenDisabled: {
    reqCtrlTypes: ['switch'],
    handler: whenDisabled,
  },
  whenEnabled: {
    reqCtrlTypes: ['switch'],
    handler: whenEnabled,
  },
  whenGreaterThan: {
    reqCtrlTypes: ['value', 'range', 'temperature'],
    handler: whenGreaterThan,
  },
  whenLessThan: {
    reqCtrlTypes: ['value', 'range', 'temperature'],
    handler: whenLessThan,
  },
};

exports.eventsTable = eventsTable;
