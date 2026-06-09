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
  var newCtrlValue = Number(actionValue);
  return newCtrlValue;
}

/**
 * Action to increase control value by actionValue amount
 * @param {number} actualValue - Current state of the control
 * @param {number} actionValue - Value set by user
 * @returns {number} Returns new control value
 */
function increaseValueBy(actualValue, actionValue) {
  var newCtrlValue = actualValue + Number(actionValue);
  return newCtrlValue;
}

/**
 * Action to decrease control value by actionValue amount
 * @param {number} actualValue - Current state of the control
 * @param {number} actionValue - Value set by user
 * @returns {number} Returns new control value
 */
function decreaseValueBy(actualValue, actionValue) {
  var newCtrlValue = actualValue - Number(actionValue);
  return newCtrlValue;
}

/**
 * Action to set a text control value to actionValue
 * @param {string} actualValue - Current state of the control
 * @param {string} actionValue - Text set by user
 * @returns {string} Returns new control value
 */
function setText(actualValue, actionValue) {
  var newCtrlValue = actionValue;
  return newCtrlValue;
}

/**
 * Action to set an rgb control to actionValue color
 * The color picker stores a hex string (#rrggbb), but an rgb
 * control expects the "R;G;B" decimal format
 * @param {string} actualValue - Current state of the control
 * @param {string} actionValue - Hex color set by user (e.g. "#ff8040")
 * @returns {string} Color in "R;G;B" format (e.g. "255;128;64")
 */
function setColor(actualValue, actionValue) {
  var hex = String(actionValue).replace('#', '');
  var r = parseInt(hex.substr(0, 2), 16);
  var g = parseInt(hex.substr(2, 2), 16);
  var b = parseInt(hex.substr(4, 2), 16);
  return r + ';' + g + ';' + b;
}

/**
 * Actions table
 * Contains action name and its corresponding:
 * - Allowed control types
 * - Handler
 */
var actionsTable = {
  toggle: {
    reqCtrlTypes: ['switch'],
    handler: toggle,
  },
  setEnable: {
    reqCtrlTypes: ['switch'],
    handler: setEnable,
  },
  setDisable: {
    reqCtrlTypes: ['switch'],
    handler: setDisable,
  },
  setValue: {
    reqCtrlTypes: ['value', 'range'],
    handler: setValue,
  },
  increaseValueBy: {
    reqCtrlTypes: ['value', 'range'],
    handler: increaseValueBy,
  },
  decreaseValueBy: {
    reqCtrlTypes: ['value', 'range'],
    handler: decreaseValueBy,
  },
  setText: {
    reqCtrlTypes: ['text'],
    handler: setText,
  },
  setColor: {
    reqCtrlTypes: ['rgb'],
    handler: setColor,
  },
};

exports.actionsTable = actionsTable;
