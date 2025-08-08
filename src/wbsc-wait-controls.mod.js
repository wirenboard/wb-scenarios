/**
 * @file wbsc-wait-controls.mod.js - ES5 module for wb-rules v2.28
 * @description Wait controls while creation time, for example after reset
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 */

// Defaults values
var WAIT_DEF = {
  CONTROLS_WAIT_TIMEOUT_MS: 60000, // Millisecons
  CONTROLS_WAIT_PERIOD_MS: 5000 // Millisecons
};

/**
 * Check if a control is ready (initialized)
 * @param {string} controlPath - Control path like "device/control"
 * @returns {boolean} True if control is initialized
 **/
function isControlReady(controlPath) {
  return dev[controlPath] !== null;
  // NOTE: May check for this goal and
  //       dev[topic + '#type'] !== null
}

/**
 * Checks if the given error value contains a critical error.
 * A critical error is defined as a string containing 'r' or 'w'
 * @param {string|undefined} errorVal - The error value to check
 * @returns {boolean} True if there is a critical error, false otherwise
 */
function hasCriticalErr(errorVal) {
  if (typeof errorVal !== 'string') {
    return false;
  }
  return (errorVal.indexOf('r') !== -1 || errorVal.indexOf('w') !== -1);
}

/**
 * Check if a control is ready and has no critical errors
 * @param {string} controlPath - Control path like "device/control"
 * @returns {boolean} True if control is ready and healthy
 */
function isControlHealthy(controlPath) {
  if (!isControlReady(controlPath)) {
    return false;
  }
  if (hasCriticalErr(dev[controlPath  + '#error'])) {
    return false;
  }
  return true;
}

/**
 * @typedef {Object} ControlsTimeoutError
 * @property {string} message - Error message
 * @property {string[]} notReadyCtrlList - List of controls that did not become ready within the timeout period
 * @property {string} name - Error name (always "Error")
 * @property {string} stack - Error stack trace
 */

/**
 * Wait for controls to become ready
 *
 * @param {string[]} controls - Array of control paths, e.g. ["wb-gpio/Relay_1", "wb-gpio/Relay_2"]
 * @param {Object} [options] - Configuration options
 * @param {number} [options.timeout=WAIT_DEF.CONTROLS_WAIT_TIMEOUT_MS] - Max waiting time in milliseconds
 * @param {number} [options.period=WAIT_DEF.CONTROLS_WAIT_PERIOD_MS] - Polling period in milliseconds
 * @param {Function} callback - Callback called upon success or timeout
 *                                Signature: callback(err, param1, param2, ...)
 *                                where err is null on success or ControlsTimeoutError on failure
 * @param {...any} [params] - Additional parameters passed to the callback
 *
 * @example
 *   // Without options - used default timeout and polling period options
 *   waitControls(controls, callback, param1);
 *   // With options - change default 60000ms/5000ms to 9000ms/100ms
 *   waitControls(controls, { timeout: 9000, period: 100 }, callback, param1);
 **/
function waitControls(controls, options, callback) {
  var cbParamsStartIndex;
  if (typeof options === 'function') {
    callback = options;
    options = {};
    cbParamsStartIndex = 2; // Collect params starting from the 3rd argument
  } else {
    cbParamsStartIndex = 3; // Collect params starting from the 4th argument
  }

  options = options || {};
  var timeout = typeof options.timeout !== 'undefined' ? options.timeout : WAIT_DEF.CONTROLS_WAIT_TIMEOUT_MS;
  var period = typeof options.period !== 'undefined' ? options.period : WAIT_DEF.CONTROLS_WAIT_PERIOD_MS;

  if (typeof callback !== 'function') {
    log.error("waitControls() callback parameter is not a function:", 
              "got '" + typeof callback + "' instead");
    return;
  }

  // Collect parameters for callback
  var cbParams = Array.prototype.slice.call(arguments, cbParamsStartIndex);

  if (!controls || controls.length === 0) {
    callback.apply(null, [null].concat(cbParams));
    return;
  }

  var startTime = new Date().getTime();
  
  var intervalId = setInterval(function() {
    var allReady = true;
    for (var i = 0; i < controls.length; i++) {
      if (!isControlHealthy(controls[i])) {
        allReady = false;
        break;
      }
    }

    if (allReady) {
      clearInterval(intervalId);
      callback.apply(null, [null].concat(cbParams));
      return;
    }

    var elapsed = new Date().getTime() - startTime;
    if (elapsed >= timeout) {
      clearInterval(intervalId);
      var err = new Error("WaitControls: Timeout expired waiting for controls");

      err.notReadyCtrlList = [];
      for (var i = 0; i < controls.length; i++) {
        if (!isControlHealthy(controls[i])) {
          err.notReadyCtrlList.push(controls[i]);
        }
      }
      err.message = "WaitControls: Timeout expired waiting for " + err.notReadyCtrlList.length + " controls";

      callback.apply(null, [err].concat(cbParams));
      return;
    }
  }, period);
}

exports.WAIT_DEF = WAIT_DEF;
exports.waitControls = waitControls;
exports.hasCriticalErr = hasCriticalErr;
