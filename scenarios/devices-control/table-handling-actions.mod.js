/**
 * @file Module for control actions table handling
 * 
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Comments in JSDoc format <https://jsdoc.app/>
 */

/**
 * Action to disable the control
 * @param {boolean} actualValue - Current state of the control
 * @returns {boolean} Always returns false
 */
function setDisable(actualValue, actionValue) {
  var newCtrlValue = false;
  return newCtrlValue;
}

/**
 * Action to enable the control
 * @param {boolean} actualValue - Current state of the control
 * @returns {boolean} Always returns true
 */
function setEnable(actualValue, actionValue) {
  var newCtrlValue = true;
  return newCtrlValue;
}

/**
 * Action to toggle the control state
 * @param {boolean} actualValue - Current state of the control
 * @returns {boolean} Returns the opposite of the current control state
 */
function toggle(actualValue, actionValue) {
  var newCtrlValue = !actualValue;
  return newCtrlValue;
}

/**
 * Action to set control value to actionValue
 * @param {number} actualValue - Current state of the control
 * @param {number} actionValue - Value set by user
 * @returns {number} Returns new control value
 */
function setValue(actualValue, actionValue) {
  var newCtrlValue = actionValue;
  return newCtrlValue;
}

/**
 * Action to increase control value by actionValue amount
 * @param {number} actualValue - Current state of the control
 * @param {number} actionValue - Value set by user
 * @returns {number} Returns new control value
 */
function increaseValueBy(actualValue, actionValue) {
  var newCtrlValue = actualValue + actionValue;
  return newCtrlValue;
}

/**
 * Action to decrease control value by actionValue amount
 * @param {number} actualValue - Current state of the control
 * @param {number} actionValue - Value set by user
 * @returns {number} Returns new control value
 */
function decreaseValueBy(actualValue, actionValue) {
  var newCtrlValue = actualValue - actionValue;
  return newCtrlValue;
}

/**
* Actions table
* Contains action name and its corresponding:
* - Allowed control types
* - Handler
*/
var actionsTable = {
  'toggle': {
    reqCtrlTypes: ['switch'],
    handler: toggle
  },
  'setEnable': {
    reqCtrlTypes: ['switch'],
    handler: setEnable
  },
  'setDisable': {
    reqCtrlTypes: ['switch'],
    handler: setDisable
  },
  'setValue': {
    reqCtrlTypes: ['value'],
    handler: setValue
  },
  'increaseValueBy': {
    reqCtrlTypes: ['value'],
    handler: increaseValueBy
  },
  'decreaseValueBy': {
    reqCtrlTypes: ['value'],
    handler: decreaseValueBy
  }
};

exports.actionsTable = actionsTable;
