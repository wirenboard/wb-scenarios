/**
 * @file duration-reverse.mod.js - ES5 module for wb-rules v2.28
 * @description Shared auto-off helpers for the schedule and astronomical-timer
 *   scenarios: turn-off delay parsing/validation, reversing of reversible
 *   actions, the turn-off timer, and formatting of the turn-off / next-execution
 *   time display. The turn-off timer id lives in a caller-owned state object,
 *   passed in as `timerState`.
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var registry = require('table-handling-actions.mod');
var constants = require('constants.mod');
var Logger = require('logger.mod').Logger;

var log = new Logger('WBSC-duration-reverse');

var MS_PER_SECOND = constants.MS_PER_SECOND;
var MS_PER_MINUTE = constants.MS_PER_MINUTE;
var MS_PER_HOUR = constants.MS_PER_HOUR;
var FULL_DAYS = constants.FULL_DAYS;

var MAX_DURATION_MS = 12 * MS_PER_HOUR;

// Actions reversed after the delay: toggle and setEnable/setDisable flip back,
// setValue/setText/setColor apply reverseValue
var REVERSIBLE_ACTIONS = {
  toggle: true,
  setEnable: true,
  setDisable: true,
  setValue: true,
  setText: true,
  setColor: true,
};

/**
 * Convert a duration object to milliseconds.
 * @param {Object} duration - {durationUnit, durationValue}
 * @returns {number} Delay in milliseconds
 */
function durationToMs(duration) {
  if (duration.durationUnit === 'hours') {
    return duration.durationValue * MS_PER_HOUR;
  }
  if (duration.durationUnit === 'seconds') {
    return duration.durationValue * MS_PER_SECOND;
  }
  return duration.durationValue * MS_PER_MINUTE;
}

/**
 * True when the turn-off delay is set (durationValue >= 1).
 * @param {Object} cfg - Scenario config
 * @returns {boolean}
 */
function isDurationEnabled(cfg) {
  return !!(cfg.duration && cfg.duration.durationValue >= 1);
}

/**
 * True when at least one output action can be reversed.
 * @param {Object} cfg - Scenario config
 * @returns {boolean}
 */
function hasReversibleControls(cfg) {
  for (var i = 0; i < cfg.outControls.length; i++) {
    if (REVERSIBLE_ACTIONS[cfg.outControls[i].behaviorType]) {
      return true;
    }
  }
  return false;
}

/**
 * A turn-off timer is used only when a delay is set and something is reversible.
 * @param {Object} cfg - Scenario config
 * @returns {boolean}
 */
function usesTurnOffTimer(cfg) {
  return isDurationEnabled(cfg) && hasReversibleControls(cfg);
}

/**
 * Validate the turn-off delay. Negative/fractional values are rejected here
 * even though isDurationEnabled treats them as disabled.
 * @param {Object} cfg - Scenario config
 * @returns {?string} Error message, or null when absent/disabled or valid
 */
function validateDuration(cfg) {
  if (!cfg.duration || !cfg.duration.durationValue) {
    return null;
  }
  var validUnits = ['hours', 'minutes', 'seconds'];
  if (validUnits.indexOf(cfg.duration.durationUnit) === -1) {
    return 'duration.durationUnit must be hours, minutes or seconds';
  }
  if (
    typeof cfg.duration.durationValue !== 'number' ||
    cfg.duration.durationValue < 0 ||
    cfg.duration.durationValue % 1 !== 0
  ) {
    return 'duration.durationValue must be a non-negative integer';
  }
  if (durationToMs(cfg.duration) > MAX_DURATION_MS) {
    return 'turn-off delay must not exceed 12 hours';
  }
  return null;
}

/**
 * Format a date as "DayName YYYY-MM-DD HH:MM", or "--:--" when absent.
 * @param {?Date} date - Date to format
 * @returns {string}
 */
function formatNextExecution(date) {
  if (!date) {
    return '--:--';
  }

  var dayName = FULL_DAYS[date.getDay()];
  var day = ('0' + date.getDate()).slice(-2);
  var month = ('0' + (date.getMonth() + 1)).slice(-2);
  var year = date.getFullYear();
  var hours = ('0' + date.getHours()).slice(-2);
  var minutes = ('0' + date.getMinutes()).slice(-2);

  return (
    dayName +
    ' ' +
    year +
    '-' +
    month +
    '-' +
    day +
    ' ' +
    hours +
    ':' +
    minutes
  );
}

/**
 * Reverse reversible controls - toggle and setEnable/setDisable flip,
 * setValue/setText/setColor apply reverseValue. Empty reverseValue is skipped.
 * @param {Object} cfg - Scenario config
 * @returns {void}
 */
function executeReverse(cfg) {
  for (var i = 0; i < cfg.outControls.length; i++) {
    var outControl = cfg.outControls[i];
    var behaviorType = outControl.behaviorType;
    if (!REVERSIBLE_ACTIONS[behaviorType]) {
      continue;
    }

    var curCtrlName = outControl.control;
    try {
      var actualValue = dev[curCtrlName];
      var newCtrlValue;

      if (behaviorType === 'toggle') {
        newCtrlValue =
          registry.actionsTable.toggle.launchHandler(actualValue);
      } else if (behaviorType === 'setEnable') {
        newCtrlValue =
          registry.actionsTable.setDisable.launchHandler(actualValue);
      } else if (behaviorType === 'setDisable') {
        newCtrlValue =
          registry.actionsTable.setEnable.launchHandler(actualValue);
      } else {
        var reverseValue = outControl.reverseValue;
        if (reverseValue === undefined || reverseValue === '') {
          continue;
        }
        newCtrlValue = registry.actionsTable[behaviorType].launchHandler(
          actualValue,
          reverseValue
        );
      }

      dev[curCtrlName] = newCtrlValue;
    } catch (error) {
      log.error(
        'Failed to reverse control {}: {}',
        curCtrlName,
        error.message || error
      );
    }
  }
}

/**
 * Write text to the return_time control when it exists.
 * @param {Object} self - Scenario instance
 * @param {string} text - Text to display
 * @returns {void}
 */
function setReturnTimeDisplay(self, text) {
  if (self.vd.devObj.getControl('return_time')) {
    dev[self.genNames.vDevice + '/return_time'] = text;
  }
}

/**
 * Clear the pending turn-off timer and reset the display.
 * @param {Object} self - Scenario instance
 * @param {Object} timerState - Caller state holding offTimerId
 * @returns {void}
 */
function cancelOffTimer(self, timerState) {
  if (timerState.offTimerId !== null) {
    clearTimeout(timerState.offTimerId);
    timerState.offTimerId = null;
  }
  setReturnTimeDisplay(self, '--:--');
}

/**
 * Arm the timer that reverses controls after the delay.
 * @param {Object} self - Scenario instance
 * @param {Object} cfg - Scenario config
 * @param {Object} timerState - Caller state holding offTimerId
 * @returns {void}
 */
function armOffTimer(self, cfg, timerState) {
  var delayMs = durationToMs(cfg.duration);
  var returnDate = new Date(Date.now() + delayMs);

  timerState.offTimerId = setTimeout(function turnOffHandler() {
    timerState.offTimerId = null;
    executeReverse(cfg);
    setReturnTimeDisplay(self, '--:--');
  }, delayMs);

  setReturnTimeDisplay(self, formatNextExecution(returnDate));
}

exports.usesTurnOffTimer = usesTurnOffTimer;
exports.validateDuration = validateDuration;
exports.formatNextExecution = formatNextExecution;
exports.executeReverse = executeReverse;
exports.cancelOffTimer = cancelOffTimer;
exports.armOffTimer = armOffTimer;
