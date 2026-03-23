/**
 * @file periodic-timer.mod.js - ES5 module for wb-rules v2.38
 * @description Periodic Timer scenario class that extends ScenarioBase.
 *   Activates controls at a fixed interval within an active time window.
 *   After the work time each control is restored to its previous state.
 *   Uses a setTimeout chain for precise timing (hours, minutes, or seconds).
 *   The cron rule fires every minute to detect window entry; the setTimeout
 *   chain manages subsequent cycles and window-exit cleanup independently.
 * 
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState = require('virtual-device-helpers.mod').ScenarioState;
var Logger = require('logger.mod').Logger;
var aTable = require('table-handling-actions.mod');
var constants = require('constants.mod');
var isControlTypeValid = require('scenarios-general-helpers.mod').isControlTypeValid;
var extractMqttTopics =
  require('scenarios-general-helpers.mod').extractMqttTopics;

/**
 * Actions table. toggle, increaseValueBy, decreaseValueBy are excluded —
 * reverse logic is handled explicitly by executeReverse().
 */
var periodicTimerActionsTable = {
  setEnable:  aTable.actionsTable.setEnable,
  setDisable: aTable.actionsTable.setDisable,
  setValue:   aTable.actionsTable.setValue,
};

var loggerFileLabel = 'WBSC-periodic-timer-mod';
var log = new Logger(loggerFileLabel);

var DAY_NAME_TO_NUMBER = constants.DAY_NAME_TO_NUMBER;
var DAY_NAMES = constants.DAY_NAMES;
var VALID_DAYS = constants.VALID_DAYS;
var FULL_DAYS = constants.FULL_DAYS;

var MS_PER_SECOND = constants.MS_PER_SECOND;
var MS_PER_MINUTE = constants.MS_PER_MINUTE;
var MS_PER_HOUR = constants.MS_PER_HOUR;

/**
 * Minimum delay between cycles (ms). Prevents a tight loop when workTime
 * >= interval (no validation enforces this constraint intentionally).
 */
var MIN_CYCLE_DELAY_MS = 100;

var MAX_DAYS_AHEAD = 8; // today + 7

/**
 * @typedef {Object} TimeObj
 * @property {'hours'|'minutes'|'seconds'} unit
 * @property {number} value - positive integer
 */

/**
 * @typedef {Object} ControlConfig
 * @property {string} mqttTopicName - MQTT topic 'device/control'
 * @property {'setEnable'|'setDisable'|'setValue'} behaviorType
 * @property {number} [initValue] - setValue: value to apply on start
 * @property {number} [reverseValue] - setValue: value to restore on stop
 */

/**
 * @typedef {Object} PeriodicTimerConfig
 * @property {string} [idPrefix]
 * @property {string} activeFrom - HH:MM, start of active window (inclusive)
 * @property {string} activeTo - HH:MM, end of active window (exclusive)
 * @property {TimeObj} interval - Cycle repeat period (e.g. every 2 hours)
 * @property {TimeObj} workTime - Duration controls stay active before reversing
 * @property {Array<string>} scheduleDaysOfWeek - Days of week when scenario
 *   is active (e.g. ['monday', 'friday']). At least one day required
 * @property {Array<ControlConfig>} outControls - Controls to activate at the
 *   start of each cycle. Automatically reversed after workTime expires
 */

/**
 * Periodic Timer scenario implementation.
 * @class PeriodicTimerScenario
 * @extends ScenarioBase
 * @description Repeatedly activates controls at a fixed interval within a time
 *   window. After each work phase the controls are automatically reversed.
 */
function PeriodicTimerScenario() {
  ScenarioBase.call(this);

  /**
   * Runtime state. All fields reset to defaults on every wb-rules restart.
   * @type {Object}
   * @property {boolean} isRunning - true while the setTimeout chain is active
   * @property {boolean} inWorkPhase - true while controls are in active state
   *   (between executeStart and executeReverse). Used to avoid double-reverse.
   * @property {number|null} workTimerId - setTimeout id for work-time expiry
   * @property {number|null} nextCycleTimerId - setTimeout id for next cycle
   * @property {number|null} nextCycleStartMs - epoch ms of scheduled next cycle
   * @property {number|null} workTimeEndMs - epoch ms when work time expires
   */
  this.ctx = {
    isRunning: false,
    inWorkPhase: false,
    workTimerId: null,
    nextCycleTimerId: null,
    nextCycleStartMs: null,
    workTimeEndMs: null,
  };
}

// Set up inheritance
PeriodicTimerScenario.prototype =
  Object.create(ScenarioBase.prototype);
PeriodicTimerScenario.prototype.constructor = PeriodicTimerScenario;

/**
 * Generate names for virtual device and rules.
 * @param {string} idPrefix - The prefix for generating names
 * @returns {Object} Generated names
 */
PeriodicTimerScenario.prototype.generateNames = function(idPrefix) {
  var scenarioPrefix = 'wbsc_';
  var baseRuleName = scenarioPrefix + idPrefix + '_';
  return {
    vDevice: scenarioPrefix + idPrefix,
    ruleMain: baseRuleName + 'mainRule',
    ruleManual: baseRuleName + 'manualRule',
    ruleTimeUpdate: baseRuleName + 'timeUpdateRule',
    ruleDisable: baseRuleName + 'disableRule',
  };
};

/**
 * Controls to wait for before init (only outControls).
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @returns {Object} Waiting configuration object
 */
PeriodicTimerScenario.prototype.defineControlsWaitConfig =
  function(cfg) {
    var allTopics = extractMqttTopics(cfg.outControls || []);
    return { controls: allTopics };
  };

/**
 * Validate all controls against periodicTimerActionsTable.
 * For setValue also checks that initValue and reverseValue are numbers.
 * @param {ControlConfig[]} controls - Array of control configurations
 * @param {Object} table - Table containing allowed types for each action
 * @returns {boolean} Returns true if all controls have valid configuration
 */
function validateControls(controls, table) {
  for (var i = 0; i < controls.length; i++) {
    var ctrl = controls[i];
    if (!table[ctrl.behaviorType]) {
      log.error(
        "Behavior type '{}' not found in table",
        ctrl.behaviorType
      );
      return false;
    }
    var reqCtrlTypes = table[ctrl.behaviorType].reqCtrlTypes;
    if (!isControlTypeValid(ctrl.mqttTopicName, reqCtrlTypes)) {
      log.debug(
        "Control '{}' is not of valid type for '{}'",
        ctrl.mqttTopicName,
        ctrl.behaviorType
      );
      return false;
    }
    if (ctrl.behaviorType === 'setValue') {
      if (typeof ctrl.initValue !== 'number') {
        log.error(
          "Periodic Timer validation error: control '{}': initValue must be a number",
          ctrl.mqttTopicName
        );
        return false;
      }
      if (typeof ctrl.reverseValue !== 'number') {
        log.error(
          "Periodic Timer validation error: control '{}': reverseValue must be a number",
          ctrl.mqttTopicName
        );
        return false;
      }
    }
  }
  return true;
}

/**
 * Validate a TimeObj field.
 * @param {TimeObj} obj - Object to validate
 * @param {string} fieldName - Field name used in error messages
 * @returns {boolean} True if valid, false otherwise
 */
function validateTimeObj(obj, fieldName) {
  var validUnits = ['hours', 'minutes', 'seconds'];
  if (!obj || typeof obj !== 'object') {
    log.error(
      'Periodic Timer validation error: {} must be an object',
      fieldName
    );
    return false;
  }
  if (validUnits.indexOf(obj.unit) === -1) {
    log.error(
      'Periodic Timer validation error: {}.unit must be hours, minutes or seconds',
      fieldName
    );
    return false;
  }
  if (
    typeof obj.value !== 'number' ||
    obj.value < 1 ||
    obj.value % 1 !== 0
  ) {
    log.error(
      'Periodic Timer validation error: {}.value must be a positive integer',
      fieldName
    );
    return false;
  }
  return true;
}

/**
 * Configuration validation.
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @returns {boolean} True if configuration is valid, false otherwise
 */
PeriodicTimerScenario.prototype.validateCfg = function(cfg) {
  if (!validateTimeObj(cfg.workTime, 'workTime')) {
    return false;
  }
  if (!validateTimeObj(cfg.interval, 'interval')) {
    return false;
  }

  if (
    !Array.isArray(cfg.scheduleDaysOfWeek) ||
    cfg.scheduleDaysOfWeek.length === 0
  ) {
    log.error('Periodic Timer validation error: at least one day must be selected');
    return false;
  }

  for (var i = 0; i < cfg.scheduleDaysOfWeek.length; i++) {
    if (VALID_DAYS.indexOf(cfg.scheduleDaysOfWeek[i]) === -1) {
      log.error(
        'Periodic Timer validation error: invalid day: {}',
        cfg.scheduleDaysOfWeek[i]
      );
      return false;
    }
  }

  var timeRe = /^\d{2}:\d{2}$/;
  if (
    typeof cfg.activeFrom !== 'string' ||
    !timeRe.test(cfg.activeFrom)
  ) {
    log.error(
      'Periodic Timer validation error: activeFrom must be HH:MM'
    );
    return false;
  }

  if (
    typeof cfg.activeTo !== 'string' ||
    !timeRe.test(cfg.activeTo)
  ) {
    log.error(
      'Periodic Timer validation error: activeTo must be HH:MM'
    );
    return false;
  }

  if (cfg.activeFrom === cfg.activeTo) {
    log.error('Periodic Timer validation error: activeFrom and activeTo must not be equal');
    return false;
  }

  if (
    !Array.isArray(cfg.outControls) ||
    cfg.outControls.length === 0
  ) {
    log.error('Periodic Timer validation error: outControls must have at least 1 item');
    return false;
  }

  if (!validateControls(cfg.outControls, periodicTimerActionsTable)) {
    log.error('Periodic Timer validation error: one or more outControls have invalid configuration');
    return false;
  }

  log.debug('Periodic Timer configuration validation successful');
  return true;
};

/**
 * Add scenario-specific controls to the virtual device.
 * @param {PeriodicTimerScenario} self - Reference to the scenario instance
 * @param {PeriodicTimerConfig} cfg - Configuration object
 */
function addCustomControlsToVirtualDevice(self, cfg) {
  log.debug('Adding custom controls to virtual device');

  self.vd.devObj.addControl('execute_now', {
    title: {
      en: 'Execute now',
      ru: 'Выполнить сейчас',
    },
    type: 'pushbutton',
    order: 2,
  });

  // forceDefault: true prevents wb-rules from restoring a stale cached value
  // from persistent DB on restart — display controls must always show fresh data
  self.vd.devObj.addControl('current_time', {
    title: {
      en: 'Current time',
      ru: 'Текущее время',
    },
    type: 'text',
    value: formatCurrentTime(),
    forceDefault: true,
    readonly: true,
    order: 3,
  });

  self.vd.devObj.addControl('active_window', {
    title: {
      en: 'Active window',
      ru: 'Окно запуска',
    },
    type: 'text',
    value: cfg.activeFrom + ' - ' + cfg.activeTo,
    forceDefault: true,
    readonly: true,
    order: 4,
  });

  self.vd.devObj.addControl('next_start', {
    title: {
      en: 'Next start',
      ru: 'Следующий запуск',
    },
    type: 'text',
    value: formatNextExecution(getNextStartTime(self, cfg)),
    forceDefault: true,
    readonly: true,
    order: 5,
  });

  self.vd.devObj.addControl('next_stop', {
    title: {
      en: 'Next stop',
      ru: 'Следующее отключение',
    },
    type: 'text',
    value: formatNextExecution(getNextStopTime(self, cfg)),
    forceDefault: true,
    readonly: true,
    order: 6,
  });
}

/**
 * Convert a TimeObj to milliseconds.
 * @param {TimeObj} timeObj - Time object with unit and value
 * @returns {number} Duration in milliseconds
 */
function timeObjToMs(timeObj) {
  if (timeObj.unit === 'hours') {
    return timeObj.value * MS_PER_HOUR;
  }
  if (timeObj.unit === 'seconds') {
    return timeObj.value * MS_PER_SECOND;
  }
  return timeObj.value * MS_PER_MINUTE;
}

/**
 * Convert HH:MM string to minutes from midnight.
 * @param {string} timeStr - Time string in HH:MM format
 * @returns {number} Minutes from midnight
 */
function timeStrToMinutes(timeStr) {
  var parts = timeStr.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

/**
 * Format current system time as "Weekday YYYY-MM-DD HH:MM".
 * Reads from system_time virtual device so the display stays in sync
 * with the controller clock and the timeUpdateRule trigger.
 * @returns {string} Formatted current time string
 */
function formatCurrentTime() {
  var currentDate = dev['system_time/current_date'];
  var currentTime = dev['system_time/current_time'];
  var currentDayNum = dev['system_time/current_day'];
  var currentDay = DAY_NAMES[currentDayNum] || 'Unknown';
  return currentDay + ' ' + currentDate + ' ' + currentTime;
}

/**
 * Format a Date as "Weekday YYYY-MM-DD HH:MM:SS".
 * Seconds are included because interval and workTime can be set in seconds.
 * @param {Date|null} date - Date to format, or null
 * @returns {string} Formatted date string, or '--:--' if date is null
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
  var seconds = ('0' + date.getSeconds()).slice(-2);
  return (
    dayName + ' ' + year + '-' + month + '-' + day +
    ' ' + hours + ':' + minutes + ':' + seconds
  );
}

/**
 * Check if minuteOfDay is within [activeFrom, activeTo).
 * activeTo is exclusive. Supports wrap-around (e.g. 22:00–06:00).
 * @param {number} minuteOfDay - Current minute of the day (0–1439)
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @returns {boolean} True if within the active window
 */
function isInActiveWindow(minuteOfDay, cfg) {
  var fromMin = timeStrToMinutes(cfg.activeFrom);
  var toMin = timeStrToMinutes(cfg.activeTo);
  if (fromMin <= toMin) {
    return minuteOfDay >= fromMin && minuteOfDay < toMin;
  }
  // Wrap-around window (e.g. 22:00–06:00): active on either side of midnight
  return minuteOfDay >= fromMin || minuteOfDay < toMin;
}

/**
 * Check if a day-of-week number is in scheduleDaysOfWeek.
 * @param {number} dayOfWeek - 0=Sunday … 6=Saturday
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @returns {boolean} True if the day is scheduled
 */
function isScheduledDay(dayOfWeek, cfg) {
  for (var i = 0; i < cfg.scheduleDaysOfWeek.length; i++) {
    if (DAY_NAME_TO_NUMBER[cfg.scheduleDaysOfWeek[i]] === dayOfWeek) {
      return true;
    }
  }
  return false;
}

/**
 * Check if today is a scheduled day.
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @returns {boolean} True if today is a scheduled day
 */
function isTodayScheduled(cfg) {
  return isScheduledDay(new Date().getDay(), cfg);
}

/**
 * Check if we are currently inside the active window on a scheduled day.
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @returns {boolean} True if currently in active window
 */
function isCurrentlyInWindow(cfg) {
  var now = new Date();
  var minuteOfDay = now.getHours() * 60 + now.getMinutes();
  return isTodayScheduled(cfg) && isInActiveWindow(minuteOfDay, cfg);
}

/**
 * Find the next time activeFrom occurs on a scheduled day.
 * Used when no cycle is running to show when the next window opens.
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @returns {Date|null} Date of next window start, or null if none found
 */
function getNextWindowStart(cfg) {
  var now = new Date();
  var fromMin = timeStrToMinutes(cfg.activeFrom);

  for (var d = 0; d < MAX_DAYS_AHEAD; d++) {
    var candidate = new Date(now);
    candidate.setDate(candidate.getDate() + d);
    candidate.setHours(
      Math.floor(fromMin / 60), fromMin % 60, 0, 0
    );
    if (
      isScheduledDay(candidate.getDay(), cfg) &&
      candidate.getTime() > now.getTime()
    ) {
      return candidate;
    }
  }
  return null;
}

/**
 * Get next start time for display.
 * Returns ctx.nextCycleStartMs if a cycle is scheduled within the current
 * window, otherwise falls back to the next window opening time.
 * @param {PeriodicTimerScenario} self - Reference to the scenario instance
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @returns {Date|null} Next start time
 */
function getNextStartTime(self, cfg) {
  if (self.ctx.nextCycleStartMs) {
    return new Date(self.ctx.nextCycleStartMs);
  }
  return getNextWindowStart(cfg);
}

/**
 * Get the epoch ms when the active window ends on the same day as date.
 * Handles wrap-around windows (e.g. 22:00–06:00).
 * @param {Date} date - Reference date (typically next cycle start)
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @returns {number} Epoch ms of window end
 */
function getWindowEndMs(date, cfg) {
  var toMin = timeStrToMinutes(cfg.activeTo);
  var fromMin = timeStrToMinutes(cfg.activeFrom);
  var end = new Date(date);
  end.setHours(Math.floor(toMin / 60), toMin % 60, 0, 0);
  // Wrap-around: activeTo is on the next day relative to activeFrom
  if (toMin <= fromMin && end.getTime() <= date.getTime()) {
    end.setDate(end.getDate() + 1);
  }
  return end.getTime();
}

/**
 * Get next stop time for display.
 * Returns ctx.workTimeEndMs if controls are currently active, otherwise
 * next start + workTime, capped at the window end to avoid showing a stop
 * time that would never be reached (cron exits the window first).
 * @param {PeriodicTimerScenario} self - Reference to the scenario instance
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @returns {Date|null} Next stop time
 */
function getNextStopTime(self, cfg) {
  if (self.ctx.workTimeEndMs) {
    var windowEndMs = getWindowEndMs(new Date(), cfg);
    return new Date(Math.min(self.ctx.workTimeEndMs, windowEndMs));
  }
  var nextStart = getNextStartTime(self, cfg);
  if (!nextStart) {
    return null;
  }
  var stopMs = nextStart.getTime() + timeObjToMs(cfg.workTime);
  var windowEndMs = getWindowEndMs(nextStart, cfg);
  return new Date(Math.min(stopMs, windowEndMs));
}

/**
 * Compute scenario state based on enabled flag and current window position.
 * @param {PeriodicTimerScenario} self - Reference to the scenario instance
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @returns {number} ScenarioState constant
 */
function computeState(self, cfg) {
  var isEnabled = dev[self.genNames.vDevice + '/rule_enabled'];
  if (!isEnabled) {
    return ScenarioState.DISABLED;
  }
  return isCurrentlyInWindow(cfg)
    ? ScenarioState.NORMAL
    : ScenarioState.WAITING;
}

/**
 * Refresh all display controls: current_time, state, next_start, next_stop.
 * Single point of truth for VD display updates — called from all rule handlers.
 * @param {PeriodicTimerScenario} self - Reference to the scenario instance
 * @param {PeriodicTimerConfig} cfg - Configuration object
 */
function refreshDisplay(self, cfg) {
  var vDevName = self.genNames.vDevice;
  var state = computeState(self, cfg);
  dev[vDevName + '/current_time'] = formatCurrentTime();
  self.setState(state);
  if (state === ScenarioState.DISABLED) {
    dev[vDevName + '/next_start'] = '--:--';
    dev[vDevName + '/next_stop'] = '--:--';
  } else {
    dev[vDevName + '/next_start'] =
      formatNextExecution(getNextStartTime(self, cfg));
    dev[vDevName + '/next_stop'] =
      formatNextExecution(getNextStopTime(self, cfg));
  }
}

/**
 * Execute start actions (activate controls).
 * Each control is processed independently so one failure does not block others.
 * @param {ControlConfig[]} controls - Array of control configurations
 */
function executeStart(controls) {
  for (var i = 0; i < controls.length; i++) {
    var ctrl = controls[i];
    try {
      var newValue = periodicTimerActionsTable[ctrl.behaviorType].handler(
        dev[ctrl.mqttTopicName],
        ctrl.initValue
      );
      log.debug('Start: set {} = {}', ctrl.mqttTopicName, newValue);
      dev[ctrl.mqttTopicName] = newValue;
    } catch (error) {
      log.error(
        'Failed to activate control {}: {}',
        ctrl.mqttTopicName,
        error.message || error
      );
    }
  }
}

/**
 * Execute reverse actions (restore controls to their previous state).
 * Reversal is symmetric:
 *   setEnable  → setDisable
 *   setDisable → setEnable
 *   setValue   → setValue with reverseValue
 * @param {ControlConfig[]} controls - Array of control configurations
 */
function executeReverse(controls) {
  for (var i = 0; i < controls.length; i++) {
    var ctrl = controls[i];
    try {
      var newValue;
      if (ctrl.behaviorType === 'setEnable') {
        newValue = periodicTimerActionsTable.setDisable.handler(
          dev[ctrl.mqttTopicName], null
        );
      } else if (ctrl.behaviorType === 'setDisable') {
        newValue = periodicTimerActionsTable.setEnable.handler(
          dev[ctrl.mqttTopicName], null
        );
      } else if (ctrl.behaviorType === 'setValue') {
        newValue = periodicTimerActionsTable.setValue.handler(
          dev[ctrl.mqttTopicName], ctrl.reverseValue
        );
      } else {
        continue;
      }
      log.debug('Reverse: set {} = {}', ctrl.mqttTopicName, newValue);
      dev[ctrl.mqttTopicName] = newValue;
    } catch (error) {
      log.error(
        'Failed to reverse control {}: {}',
        ctrl.mqttTopicName,
        error.message || error
      );
    }
  }
}

/**
 * Cancel both pending timers and clear the related ctx fields.
 * Safe to call at any time — clears only non-null timer ids.
 * @param {PeriodicTimerScenario} self - Reference to the scenario instance
 */
function cancelTimers(self) {
  if (self.ctx.workTimerId !== null) {
    clearTimeout(self.ctx.workTimerId);
    self.ctx.workTimerId = null;
  }
  if (self.ctx.nextCycleTimerId !== null) {
    clearTimeout(self.ctx.nextCycleTimerId);
    self.ctx.nextCycleTimerId = null;
    self.ctx.nextCycleStartMs = null;
  }
}

/**
 * Stop the running cycle: cancel pending timers, reverse controls if currently
 * in work phase, and reset all ctx flags.
 * Safe to call when not running (no-op).
 * @param {PeriodicTimerScenario} self - Reference to the scenario instance
 * @param {PeriodicTimerConfig} cfg - Configuration object
 */
function stopWorkCycle(self, cfg) {
  if (!self.ctx.isRunning) {
    return;
  }

  // Cancel both timers before any side effects so they cannot fire after stop
  cancelTimers(self);

  // Reverse only if controls are currently active (inWorkPhase).
  // If we are in the pause between cycles, controls are already off —
  // reversing them again would incorrectly turn them on.
  if (self.ctx.inWorkPhase) {
    log.debug(
      'Stopping mid-cycle, reversing controls for: {}',
      self.idPrefix
    );
    executeReverse(cfg.outControls);
  }

  self.ctx.isRunning = false;
  self.ctx.inWorkPhase = false;
  self.ctx.nextCycleStartMs = null;
  self.ctx.workTimeEndMs = null;
}

/**
 * Called when the work phase ends. Reverses controls and either schedules
 * the next cycle (if it falls inside the active window) or stops the chain.
 * @param {PeriodicTimerScenario} self - Reference to the scenario instance
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @param {number} intervalMs - Full cycle interval in milliseconds
 * @param {number} workTimeMs - Work phase duration in milliseconds
 */
function onWorkTimeExpired(self, cfg, intervalMs, workTimeMs) {
  self.ctx.inWorkPhase = false;
  self.ctx.workTimeEndMs = null;
  self.ctx.workTimerId = null;

  log.debug(
    'Work time expired, reversing controls for: {}',
    self.idPrefix
  );
  executeReverse(cfg.outControls);

  // Gap between end of work phase and start of next cycle
  var remainingMs = intervalMs - workTimeMs;
  if (remainingMs < MIN_CYCLE_DELAY_MS) {
    remainingMs = MIN_CYCLE_DELAY_MS;
  }

  var nextScheduledCycleTime = new Date(Date.now() + remainingMs);
  var nextMinuteOfDay =
    nextScheduledCycleTime.getHours() * 60 +
    nextScheduledCycleTime.getMinutes();

  if (
    isScheduledDay(nextScheduledCycleTime.getDay(), cfg) &&
    isInActiveWindow(nextMinuteOfDay, cfg)
  ) {
    self.ctx.nextCycleStartMs = Date.now() + remainingMs;
    refreshDisplay(self, cfg);

    // Wait out the gap, then start the next cycle
    self.ctx.nextCycleTimerId = setTimeout(function () {
      self.ctx.nextCycleTimerId = null;
      self.ctx.nextCycleStartMs = null;
      startWorkCycle(self, cfg);
    }, remainingMs);
  } else {
    // Next cycle would fall outside the window — stop the chain.
    // cronTick will restart it when the window opens again.
    log.debug(
      'Next cycle outside window, stopping for: {}',
      self.idPrefix
    );
    self.ctx.isRunning = false;
    self.ctx.nextCycleStartMs = null;
    refreshDisplay(self, cfg);
  }
}

/**
 * Start a single work cycle and chain the next one automatically.
 *
 * Flow:
 *   1. Execute start actions immediately.
 *   2. After workTime — onWorkTimeExpired:
 *      a. Execute reverse actions.
 *      b. Check if the next cycle falls inside the active window.
 *         - Yes: schedule next cycle after the remaining interval gap.
 *         - No:  mark as not running — cronTick will restart when needed.
 *
 * @param {PeriodicTimerScenario} self - Reference to the scenario instance
 * @param {PeriodicTimerConfig} cfg - Configuration object
 */
function startWorkCycle(self, cfg) {
  var intervalMs = timeObjToMs(cfg.interval);
  var workTimeMs = timeObjToMs(cfg.workTime);

  // Pre-calculate whether the next cycle will fall inside the window so
  // next_start can be shown correctly during the current work phase.
  var nextCycleTime = new Date(Date.now() + intervalMs);
  var nextMinuteOfDay =
    nextCycleTime.getHours() * 60 + nextCycleTime.getMinutes();
  var nextCycleInWindow =
    isScheduledDay(nextCycleTime.getDay(), cfg) &&
    isInActiveWindow(nextMinuteOfDay, cfg);

  self.ctx.isRunning = true;
  self.ctx.inWorkPhase = true;
  self.ctx.nextCycleStartMs = nextCycleInWindow
    ? nextCycleTime.getTime()
    : null;
  self.ctx.workTimeEndMs = Date.now() + workTimeMs;

  log.debug(
    'Cycle start, interval={}ms workTime={}ms for: {}',
    intervalMs, workTimeMs, self.idPrefix
  );

  executeStart(cfg.outControls);
  refreshDisplay(self, cfg);

  // Wait for the work phase to end, then handle transition
  self.ctx.workTimerId = setTimeout(function () {
    onWorkTimeExpired(self, cfg, intervalMs, workTimeMs);
  }, workTimeMs);
}

/**
 * Cron tick handler — fires every minute at :00 seconds.
 * Responsible only for window entry and exit transitions:
 *   - Enters window and cycle not running → start cycle.
 *   - Exits window (or scenario disabled) and cycle is running → stop cycle.
 * While the cycle is already running inside the window the setTimeout chain
 * manages itself; cronTick does not interfere.
 * @param {PeriodicTimerScenario} self - Reference to the scenario instance
 * @param {PeriodicTimerConfig} cfg - Configuration object
 */
function cronTick(self, cfg) {
  var isEnabled = dev[self.genNames.vDevice + '/rule_enabled'];

  if (isEnabled && isCurrentlyInWindow(cfg)) {
    if (!self.ctx.isRunning) {
      log.debug('In window, starting cycle for: {}', self.idPrefix);
      startWorkCycle(self, cfg);
    }
  } else {
    if (self.ctx.isRunning) {
      log.debug(
        'Outside window or disabled, stopping cycle for: {}',
        self.idPrefix
      );
      stopWorkCycle(self, cfg);
      refreshDisplay(self, cfg);
    }
  }
}

/**
 * Manual trigger handler (execute_now button).
 * Stops any running cycle and immediately starts a fresh one via startWorkCycle,
 * regardless of the active window. startWorkCycle handles all display updates
 * and chains subsequent cycles automatically — inside the window the chain
 * continues; outside it stops and cronTick restarts it at the next window.
 * @param {PeriodicTimerScenario} self - Reference to the scenario instance
 * @param {PeriodicTimerConfig} cfg - Configuration object
 */
function manualHandler(self, cfg) {
  var isEnabled = dev[self.genNames.vDevice + '/rule_enabled'];
  if (!isEnabled) {
    log.debug(
      'Scenario disabled, skipping manual trigger for: {}',
      self.idPrefix
    );
    return;
  }

  log.debug('Manual execution triggered for: {}', self.idPrefix);
  stopWorkCycle(self, cfg);
  startWorkCycle(self, cfg);
}

/**
 * Create the per-minute cron rule.
 * Fires every minute at :00 seconds and calls cronTick, which detects
 * window entry (starts the cycle) and window exit (stops the cycle).
 * @param {PeriodicTimerScenario} self - Reference to the scenario instance
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @returns {boolean} True if rule created successfully, false otherwise
 */
function createCronRule(self, cfg) {
  log.debug('Creating cron rule for periodic timer');

  var ruleId = defineRule(self.genNames.ruleMain, {
    when: cron('0 * * * * *'), // Every minute at 0 seconds
    then: function cronTickHandler() {
      cronTick(self, cfg);
    },
  });

  if (!ruleId) {
    log.error('Failed to create cron rule');
    return false;
  }

  log.debug('Cron rule created');
  self.addRule(ruleId);
  return true;
}

/**
 * Create the manual trigger rule (execute_now button).
 * @param {PeriodicTimerScenario} self - Reference to the scenario instance
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @returns {boolean} True if rule created successfully, false otherwise
 */
function createManualRule(self, cfg) {
  log.debug('Creating manual trigger rule');

  var manualRuleId = defineRule(self.genNames.ruleManual, {
    whenChanged: [self.genNames.vDevice + '/execute_now'],
    then: function manualTriggerHandler(newValue) {
      if (newValue) {
        manualHandler(self, cfg);
      }
    },
  });

  if (!manualRuleId) {
    log.error('Failed to create manual trigger rule');
    return false;
  }

  log.debug('Manual trigger rule created');
  self.addRule(manualRuleId);
  return true;
}

/**
 * Create the system time update rule.
 * Refreshes current_time, state, next_start, next_stop whenever the
 * system clock changes (once per minute).
 * @param {PeriodicTimerScenario} self - Reference to the scenario instance
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @returns {boolean} True if rule created successfully, false otherwise
 */
function createTimeUpdateRule(self, cfg) {
  log.debug('Creating time update rule');

  var timeUpdateRuleId = defineRule(self.genNames.ruleTimeUpdate, {
    whenChanged: [
      'system_time/current_time',
      'system_time/current_date',
      'system_time/current_day',
    ],
    then: function timeUpdateHandler() {
      refreshDisplay(self, cfg);
    },
  });

  if (!timeUpdateRuleId) {
    log.error('Failed to create time update rule');
    return false;
  }

  log.debug('Time update rule created');
  self.addRule(timeUpdateRuleId);
  return true;
}

/**
 * Create the disable/enable rule (rule_enabled switch).
 * On disable: stops the cycle (with reverse if in work phase) and sets
 * DISABLED state. On enable: refreshes display and starts cycle immediately
 * if currently inside the active window.
 * Intentionally NOT registered via self.addRule() so it remains active
 * even when the scenario is disabled — otherwise re-enabling would not work.
 * @param {PeriodicTimerScenario} self - Reference to the scenario instance
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @returns {boolean} True if rule created successfully, false otherwise
 */
function createDisableRule(self, cfg) {
  log.debug('Creating disable rule');

  var disableRuleId = defineRule(self.genNames.ruleDisable, {
    whenChanged: [self.genNames.vDevice + '/rule_enabled'],
    then: function disableCleanupHandler(newValue) {
      if (!newValue) {
        log.debug('Scenario disabled for: {}', self.idPrefix);
        stopWorkCycle(self, cfg);
        refreshDisplay(self, cfg);
      } else {
        log.debug('Scenario enabled for: {}', self.idPrefix);
        refreshDisplay(self, cfg);
        cronTick(self, cfg);
      }
    },
  });

  if (!disableRuleId) {
    log.error('Failed to create disable rule');
    return false;
  }

  log.debug('Disable rule created');
  return true;
}

/**
 * Create all rules for the scenario.
 * @param {PeriodicTimerScenario} self - Reference to the scenario instance
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @returns {boolean} True if all rules created successfully, false otherwise
 */
function createRules(self, cfg) {
  log.debug('Creating all rules');

  if (!createCronRule(self, cfg)) {
    return false;
  }
  if (!createManualRule(self, cfg)) {
    return false;
  }
  if (!createTimeUpdateRule(self, cfg)) {
    return false;
  }
  if (!createDisableRule(self, cfg)) {
    return false;
  }

  return true;
}

/**
 * Scenario-specific initialization.
 * Called by ScenarioBase.init() after VD creation, config validation,
 * and all referenced controls becoming available.
 * @param {string} deviceTitle - Virtual device title
 * @param {PeriodicTimerConfig} cfg - Configuration object
 * @returns {boolean} True if initialization succeeded
 */
PeriodicTimerScenario.prototype.initSpecific = function(
  deviceTitle,
  cfg
) {
  log.debug('Start init periodic timer scenario');
  log.setLabel(loggerFileLabel + '/' + this.idPrefix);

  addCustomControlsToVirtualDevice(this, cfg);

  var rulesCreated = createRules(this, cfg);

  if (rulesCreated) {
    this.setState(computeState(this, cfg));

    // Start the cycle immediately if we are already inside the active window.
    // Without this check, the first cycle would be delayed until the next
    // cron tick (up to 60 seconds after restart).
    var isEnabled = dev[this.genNames.vDevice + '/rule_enabled'];
    if (isEnabled && isCurrentlyInWindow(cfg)) {
      log.debug(
        'Init in active window, starting cycle for: "{}"',
        deviceTitle
      );
      startWorkCycle(this, cfg);
    }

    log.debug(
      'Periodic timer initialized for device "{}"',
      deviceTitle
    );
  }

  return rulesCreated;
};

exports.PeriodicTimerScenario = PeriodicTimerScenario;
