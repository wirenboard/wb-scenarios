/**
 * @file table-handling-events.mod.js - Registry of control events
 *
 *       Exports the eventsTable — control events. Each handler is a predicate
 *       that takes the new control value and returns whether the event fired.
 *       Entry: { reqCtrlTypes, handler }
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Comments in JSDoc format <https://jsdoc.app/>
 */

/**
 * Control activation event
 * @param {boolean} newValue - New state of the control
 * @returns {boolean} true if the control is enabled
 */
function whenEnabled(newValue) {
  var isEventTriggered = newValue === true;
  return isEventTriggered;
}

/**
 * Control deactivation event
 * @param {boolean} newValue - New state of the control
 * @returns {boolean} true if the control is disabled
 */
function whenDisabled(newValue) {
  var isEventTriggered = newValue === false;
  return isEventTriggered;
}

/**
 * Any control state change event
 * @param {*} newValue - New state of the control
 * @returns {boolean} Always true
 */
function whenChange(newValue) {
  var isEventTriggered = true; // Always triggers on change
  return isEventTriggered;
}

/**
 * Registry of control events
 *
 * Contains the event name and its corresponding:
 * - reqCtrlTypes — allowed control types ([] — any type)
 * - handler      — predicate: returns whether the event fired
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
};

exports.eventsTable = eventsTable;
