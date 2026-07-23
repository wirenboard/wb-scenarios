/**
 * @file Module for control actions table handling
 *
 *       Exports the actionsTable — output effects applied to controls.
 *       Entry: { reqCtrlTypes, launchHandler, resetHandler }
 *         launchHandler — perform the action (former launchResolver),
 *         resetHandler  — undo the action (former resetResolver).
 *       Merges the two former action tables (table-handling-actions and
 *       registry-action-resolvers). Control events live in a separate
 *       module - table-handling-events.mod.js.
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Comments in JSDoc format <https://jsdoc.app/>
 */

/**
 * Action to disable the control
 * @param {boolean} actualValue - Current state of the control
 * @param {*} actionValue - Not used
 * @returns {boolean} Always returns false
 */
function setDisable(actualValue, actionValue) {
  var newCtrlValue = false;
  return newCtrlValue;
}

/**
 * Action to enable the control
 * @param {boolean} actualValue - Current state of the control
 * @param {*} actionValue - Not used
 * @returns {boolean} Always returns true
 */
function setEnable(actualValue, actionValue) {
  var newCtrlValue = true;
  return newCtrlValue;
}

/**
 * Action to toggle the control state
 * @param {boolean} actualValue - Current state of the control
 * @param {*} actionValue - Not used
 * @returns {boolean} Returns the opposite of the current control state
 */
function toggle(actualValue, actionValue) {
  var newCtrlValue = !actualValue;
  return newCtrlValue;
}

/**
 * Action to set control value to actionValue
 * @param {number} actualValue - Current state of the control
 * @param {number|string} actionValue - Value set by user, cast to Number
 * @returns {number} Returns new control value
 */
function setValue(actualValue, actionValue) {
  var newCtrlValue = Number(actionValue);
  return newCtrlValue;
}

/**
 * Action to increase control value by actionValue amount
 * @param {number} actualValue - Current state of the control
 * @param {number|string} actionValue - Value to increase, cast to Number
 * @returns {number} Returns new control value
 */
function increaseValueBy(actualValue, actionValue) {
  var newCtrlValue = actualValue + Number(actionValue);
  return newCtrlValue;
}

/**
 * Action to decrease control value by actionValue amount
 * @param {number} actualValue - Current state of the control
 * @param {number|string} actionValue - Value to decrease, cast to Number
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
 * Action to set the color of an rgb control
 * The wb-dynamic-type widget yields the color as a hex string (#rrggbb), while
 * a WB rgb control expects the decimal "R;G;B" format, so we convert on publish.
 * @param {string} actualValue - Current state of the control
 * @param {string} actionValue - Hex color set by user (e.g. "#ff8040")
 * @returns {string} Color in "R;G;B" format (e.g. "255;128;64")
 */
function setColor(actualValue, actionValue) {
  var hex = String(actionValue).replace('#', '');
  var r = parseInt(hex.substr(0, 2), 16);
  var g = parseInt(hex.substr(2, 2), 16);
  var b = parseInt(hex.substr(4, 2), 16);

  var newCtrlValue;

  // Guard against an empty or malformed hex (e.g. an untouched widget field)
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    newCtrlValue = '255;255;255'; // white fallback
  } else {
    newCtrlValue = r + ';' + g + ';' + b;
  }

  return newCtrlValue;
}

/**
 * Registry of output effects
 *
 * Contains the action name and its corresponding:
 * - reqCtrlTypes  — allowed control types for the action
 * - launchHandler — applies the action
 * - resetHandler  — reverses the action
 */
var actionsTable = {
  toggle: {
    reqCtrlTypes: ['switch'],
    launchHandler: toggle,
    resetHandler: toggle,
  },
  setEnable: {
    reqCtrlTypes: ['switch'],
    launchHandler: setEnable,
    resetHandler: setDisable,
  },
  setDisable: {
    reqCtrlTypes: ['switch'],
    launchHandler: setDisable,
    resetHandler: setEnable,
  },
  setValue: {
    reqCtrlTypes: ['value', 'range'],
    launchHandler: setValue,
    resetHandler: setValue,
  },
  // light-control's numeric action historically uses its own key
  // `setValueNumericInput` (only `value`, no `range`). Kept as-is to avoid a
  // config migration - shares the same handler as the common `setValue`.
  setValueNumericInput: {
    reqCtrlTypes: ['value'],
    launchHandler: setValue,
    resetHandler: setValue,
  },
  increaseValueBy: {
    reqCtrlTypes: ['value', 'range'],
    launchHandler: increaseValueBy,
    resetHandler: decreaseValueBy,
  },
  decreaseValueBy: {
    reqCtrlTypes: ['value', 'range'],
    launchHandler: decreaseValueBy,
    resetHandler: increaseValueBy,
  },
  setText: {
    reqCtrlTypes: ['text'],
    launchHandler: setText,
    resetHandler: setText,
  },
  setColor: {
    reqCtrlTypes: ['rgb'],
    launchHandler: setColor,
    resetHandler: setColor,
  },
};

exports.actionsTable = actionsTable;
