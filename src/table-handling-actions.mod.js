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
 * Action to enable a switch control
 * @param {boolean} actualValue - Current state of the control
 * @param {*} actionValue - Not used
 * @returns {boolean} Always true
 */
function setEnable(actualValue, actionValue) {
  var newCtrlValue = true;
  return newCtrlValue;
}

/**
 * Action to disable a switch control
 * @param {boolean} actualValue - Current state of the control
 * @param {*} actionValue - Not used
 * @returns {boolean} Always false
 */
function setDisable(actualValue, actionValue) {
  var newCtrlValue = false;
  return newCtrlValue;
}

/**
 * Action to toggle a switch control state
 * @param {boolean} actualValue - Current state of the control
 * @param {*} actionValue - Not used
 * @returns {boolean} Inverted control state
 */
function toggle(actualValue, actionValue) {
  var newCtrlValue = !actualValue;
  return newCtrlValue;
}

/**
 * Action to set a numeric control value
 * @param {number} actualValue - Current state of the control
 * @param {number|string} actionValue - Value set by user
 * @returns {number} New control value
 */
function setValue(actualValue, actionValue) {
  var newCtrlValue = Number(actionValue);
  return newCtrlValue;
}

/**
 * Action to increase the control value by actionValue
 * @param {number} actualValue - Current state of the control
 * @param {number|string} actionValue - Value set by user
 * @returns {number} New control value
 */
function increaseValueBy(actualValue, actionValue) {
  var newCtrlValue = actualValue + Number(actionValue);
  return newCtrlValue;
}

/**
 * Action to decrease the control value by actionValue
 * @param {number} actualValue - Current state of the control
 * @param {number|string} actionValue - Value set by user
 * @returns {number} New control value
 */
function decreaseValueBy(actualValue, actionValue) {
  var newCtrlValue = actualValue - Number(actionValue);
  return newCtrlValue;
}

/**
 * Action to set a text control value
 * @param {string} actualValue - Current state of the control
 * @param {string} actionValue - Text set by user
 * @returns {string} New control value
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
 * - launchHandler — action execution handler
 * - resetHandler  — action undo handler (for the "two-value model")
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
