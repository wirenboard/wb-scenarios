/**
 * @file logger.mod.js
 * @description A logging module supporting:
 *     - Custom labels and the {} format similar to wb-rules logger
 *     - Log levels (log, debug, info, warning, error)
 *     - Allows enabling/disabling logging dynamically
 *     - Supports dynamic label change
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Comments formatted in JSDoc <https://jsdoc.app/> - Google styleguide
 */

/**
 * Creates a copy of an array or transforms a Arguments collection into an arr
 * @param {Array|Arguments} srcArr Source array or Arguments collection
 * @return {Array} A new array with the same elements
 */
function copyArray(srcArr) {
  var copy = [];
  for (var i = 0; i < srcArr.length; i++) {
    copy.push(srcArr[i]);
  }
  return copy;
}

/**
 * Logger constructor
 * @param {string} label The label to be added to all log messages in []
 * @constructor
 */
function Logger(label) {
  if (!label || typeof label !== 'string') {
    log.error('Logger requires a valid string label');
  }

  this.label = '[' + label + ']';
  this.enabled = true; // Logger is enabled by default
}

/**
 * Logs a message if the logger is enabled
 * @param {string} level The log level (info, debug, etc.)
 * @param {...*} messages The message to log with
 * @private
 */
Logger.prototype._log = function () {
  if (!this.enabled) return;

  var args = copyArray(arguments);
  var level = args.shift(); // Take the first argument as the log level

  // Modify the first argument to include the label and level
  // Need add level - like this DEBUG:
  //     [MyModule] DEBUG: Debugging details here.
  //     args[0] = this.label + ' ' + level.toUpperCase() + ': ' + args[0];
  args[0] = this.label + ' ' + ': ' + args[0];

  // Call the global log method corresponding to the level
  switch (level) {
    case 'debug':
      log.debug.apply(null, args);
      break;
    case 'info':
      log.info.apply(null, args);
      break;
    case 'warning':
      log.warning.apply(null, args);
      break;
    case 'error':
      log.error.apply(null, args);
      break;
    default:
      break;
  }
};

/**
 * Logs a debug message
 * @param {...*} messages The message to log with
 */
Logger.prototype.debug = function () {
  var args = copyArray(arguments);
  this._log.apply(this, ['debug'].concat(args));
};

/**
 * Logs an info message
 * @param {...*} messages The message to log with
 */
Logger.prototype.info = function () {
  var args = copyArray(arguments);
  this._log.apply(this, ['info'].concat(args));
};

/**
 * Logs a warning message
 * @param {...*} messages The message to log with
 */
Logger.prototype.warning = function () {
  var args = copyArray(arguments);
  this._log.apply(this, ['warning'].concat(args));
};

/**
 * Logs an error message
 * @param {...*} messages The message to log with
 */
Logger.prototype.error = function () {
  var args = copyArray(arguments);
  this._log.apply(this, ['error'].concat(args));
};

/**
 * Enables the logger
 */
Logger.prototype.enable = function () {
  this.enabled = true;
};

/**
 * Disables the logger
 */
Logger.prototype.disable = function () {
  this.enabled = false;
};

/**
 * Dynamically changes the label of the logger
 * @param {string} newLabel The new label to be added to  log messages in []
 */
Logger.prototype.setLabel = function (newLabel) {
  if (!newLabel || typeof newLabel !== 'string') {
    log.error('Logger requires a valid string label');
    return;
  }
  this.label = '[' + newLabel + ']';
};

exports.Logger = Logger;
