/**
 * Check if a control is ready
 **/
function isControlReady(controlPath) {
  return dev[controlPath] !== null;
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
 * @param {number} [options.timeout=5000] - Max waiting time in milliseconds
 * @param {number} [options.period=500] - Polling period in milliseconds
 * @param {Function} callback - Callback called upon success or timeout
 *                                Signature: callback(err, param1, param2, ...)
 *                                where err is null on success or ControlsTimeoutError on failure
 * @param {...any} [params] - Additional parameters passed to the callback
 *
 * @example
 *   // Without options (used default timeout and polling period options)
 *   waitControls(controls, callback, param1, param2);
 *   // With options
 *   waitControls(controls, { timeout: 5000, period: 100 }, callback, param1, param2);
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
  var timeout = typeof options.timeout !== 'undefined' ? options.timeout : 5000;
  var period = typeof options.period !== 'undefined' ? options.period : 500;

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
      if (!isControlReady(controls[i])) {
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
        if (!isControlReady(controls[i])) {
          err.notReadyCtrlList.push(controls[i]);
        }
      }
      err.message = "WaitControls: Timeout expired waiting for " + err.notReadyCtrlList.length + " controls";

      callback.apply(null, [err].concat(cbParams));
      return;
    }
  }, period);
}
