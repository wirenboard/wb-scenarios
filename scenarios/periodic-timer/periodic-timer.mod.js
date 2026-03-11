/**
 * @file periodic-timer.mod.js - ES5 module for wb-rules 2.38
 * @description Periodic Timer scenario class that extends ScenarioBase.
 *   Executes start actions repeatedly within an active time window.
 *   Every minute inside the window the phase is determined by
 *   elapsed = minuteOfDay - fromMin (+ 1440 on wrap-around),
 *   phase = elapsed % interval: if phase < duration → startControls,
 *   otherwise → stopControls. On window exit stopControls fire once
 *   to clean up. When duration = 0 only startControls fire (at
 *   phase === 0). Interval is counted from activeFrom.
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState = require('virtual-device-helpers.mod').ScenarioState;
var Logger = require('logger.mod').Logger;
var aTable = require('table-handling-actions.mod');
var constants = require('constants.mod');

/**
 * Actions table restricted to idempotent operations only.
 * toggle, increaseValueBy, decreaseValueBy are excluded because the scenario
 * fires controls on every cron tick — non-idempotent actions would accumulate.
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

var MS_PER_MINUTE = constants.MS_PER_MINUTE;

var MAX_DAYS_AHEAD = 8; // today + 7


/**
 * @typedef {Object} PeriodicTimerConfig
 * @property {string} [idPrefix] - Optional prefix for scenario identification
 *   If not provided, it will be generated from the scenario name
 * @property {string} activeFrom - Active window start HH:MM
 * @property {string} activeTo - Active window end HH:MM
 * @property {number} interval - Interval in minutes (1–1440)
 * @property {number} duration - Stop delay in minutes (0–1440)
 * @property {Array<string>} scheduleDaysOfWeek - Array of selected weekdays 
 * Valid values: "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
 * @property {Array<Object>} startControls - Controls executed at the start of each cycle.
 *   When duration > 0: fired every minute while phase < duration (idempotent).
 *   When duration = 0: fired once per interval when phase === 0.
 *   Also fired immediately on manual execution (execute_now).
 *   At least one item required.
 *   Each object contains:
 *   - control {string}: Control name ('device/control')
 *   - behaviorType {string}: Action type — one of: setEnable, setDisable, setValue
 *   - actionValue {*}: Value to set (used by setValue)
 * @property {Array<Object>} stopControls - Controls executed at the stop phase of each cycle.
 *   Only relevant when duration > 0: fired every minute while phase >= duration (idempotent).
 *   Also fired once when the active window ends (cleanup tick).
 *   After manual execution: fired via setTimeout after duration minutes.
 *   Required when duration > 0, ignored when duration = 0.
 *   Each object contains:
 *   - control {string}: Control name ('device/control')
 *   - behaviorType {string}: Action type — one of: setEnable, setDisable, setValue
 *   - actionValue {*}: Value to set (used by setValue)
 */

/**
 * Periodic Timer scenario implementation
 * @class PeriodicTimerScenario
 * @extends ScenarioBase
 * @description Executes start actions repeatedly within an active time window.
 */
function PeriodicTimerScenario() {
  ScenarioBase.call(this);
  
  /**
   * Context object for storing scenario runtime state
   * @type {Object}
   * @property {boolean} wasInActiveWindow - Whether the scenario was inside
   *   the active window on the previous cron tick. Used to detect window exit
   *   and fire stopControls once as a cleanup tick. Reset on restart.
   */
  this.ctx = {
    wasInActiveWindow: false,   // Tracks window presence across cron ticks
  };
}

PeriodicTimerScenario.prototype =
  Object.create(ScenarioBase.prototype);
PeriodicTimerScenario.prototype.constructor = PeriodicTimerScenario;

/**
 * Generate names for virtual device and rules
 * @param {string} idPrefix - Scenario identifier used as MQTT device name suffix
 * @returns {Object} - Object containing vDevice, ruleMain, ruleManual, ruleTimeUpdate, ruleDisable names
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
 * Get configuration for waiting for controls
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object
 * @returns {Object} - Object with controls array containing all topics
 *                     from startControls and stopControls to wait for
 */
PeriodicTimerScenario.prototype.defineControlsWaitConfig =
  function(cfg) {
    var allTopics = [];
    var i;
    for (i = 0; i < (cfg.startControls || []).length; i++) {
      if (cfg.startControls[i].control) {
        allTopics.push(cfg.startControls[i].control);
      }
    }
    for (i = 0; i < (cfg.stopControls || []).length; i++) {
      if (cfg.stopControls[i].control) {
        allTopics.push(cfg.stopControls[i].control);
      }
    }
    return { controls: allTopics };
  };

/**
 * Check if control type is valid for the action
 * @param {string} controlName - Control name in 'device/control' format
 * @param {string[]} reqCtrlTypes - List of allowed control types for the action
 * @returns {boolean} - Returns true if control type matches one of reqCtrlTypes,
 *                      or if reqCtrlTypes is empty (no restriction)
 */
function isControlTypeValid(controlName, reqCtrlTypes) {
  if (!reqCtrlTypes || reqCtrlTypes.length === 0) {
    return true;
  }
  var controlType = dev[controlName + '#type'];
  if (!controlType) {
    log.debug('Control type for {} not found', controlName);
    return false;
  }
  log.debug('Control: {} | Type: {}', controlName, controlType);
  return reqCtrlTypes.indexOf(controlType) !== -1;
}

/**
 * Validate all controls against periodicTimerActionsTable
 * @param {Object[]} controls - Array of control configurations to validate
 * @param {Object} table - Actions table with allowed behavior types
 *                              and their required control types
 * @returns {boolean} - Returns true if all controls have valid behavior types
 *                      and matching control types, otherwise false
 */
function validateControls(controls, table) {
  for (var i = 0; i < controls.length; i++) {
    var curCtrlName = controls[i].control;
    var curBehaviorType = controls[i].behaviorType;
    if (!table[curBehaviorType]) {
      log.error(
        "Behavior type '{}' not found in table",
        curBehaviorType
      );
      return false;
    }
    var reqCtrlTypes = table[curBehaviorType].reqCtrlTypes;
    if (!isControlTypeValid(curCtrlName, reqCtrlTypes)) {
      log.debug(
        "Control '{}' is not of valid type for '{}'",
        curCtrlName,
        curBehaviorType
      );
      return false;
    }
  }
  return true;
}

/**
 * Configuration validation
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object to validate
 * @returns {boolean} - Returns true if configuration is valid, otherwise false
 */
PeriodicTimerScenario.prototype.validateCfg = function(cfg) {
  if (
    typeof cfg.interval !== 'number' ||
    cfg.interval < 1 ||
    cfg.interval > 1440
  ) {
    log.error(
      'Periodic Timer validation error: ' +
      'interval must be between 1 and 1440'
    );
    return false;
  }

  if (
    typeof cfg.duration !== 'number' ||
    cfg.duration < 0 ||
    cfg.duration > 1440
  ) {
    log.error(
      'Periodic Timer validation error: ' +
      'duration must be between 0 and 1440'
    );
    return false;
  }

  if (cfg.duration > 0 && cfg.duration >= cfg.interval) {
    log.error(
      'Periodic Timer validation error: ' +
      'duration ({}) must be less than interval ({})',
      cfg.duration,
      cfg.interval
    );
    return false;
  }

  if (cfg.interval + cfg.duration > 1440) {
    log.error(
      'Periodic Timer validation error: ' +
      'interval + duration ({}) must not exceed 1440',
      cfg.interval + cfg.duration
    );
    return false;
  }

  if (
    !Array.isArray(cfg.scheduleDaysOfWeek) ||
    cfg.scheduleDaysOfWeek.length === 0
  ) {
    log.error(
      'Periodic Timer validation error: ' +
      'at least one day must be selected'
    );
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
    log.error(
      'Periodic Timer validation error: ' +
      'activeFrom and activeTo must not be equal'
    );
    return false;
  }

  if (
    !Array.isArray(cfg.startControls) ||
    cfg.startControls.length === 0
  ) {
    log.error(
      'Periodic Timer validation error: ' +
      'startControls must have at least 1 item'
    );
    return false;
  }

  if (!validateControls(cfg.startControls, periodicTimerActionsTable)) {
    log.error(
      'Periodic Timer validation error: ' +
      'one or more startControls have invalid type'
    );
    return false;
  }

  if (cfg.duration > 0) {
    if (
      !Array.isArray(cfg.stopControls) ||
      cfg.stopControls.length === 0
    ) {
      log.error(
        'Periodic Timer validation error: ' +
        'stopControls required when duration > 0'
      );
      return false;
    }
    if (!validateControls(cfg.stopControls, periodicTimerActionsTable)) {
      log.error(
        'Periodic Timer validation error: ' +
        'one or more stopControls have invalid type'
      );
      return false;
    }
  }

  log.debug('Periodic Timer configuration validation successful');
  return true;
};

/**
 * Format current system time for display
 * @returns {string} - Formatted string: "Weekday YYYY-MM-DD HH:MM"
 */
function formatCurrentTime() {
  var currentDate = dev['system_time/current_date'];
  var currentTime = dev['system_time/current_time'];
  var currentDayNum = dev['system_time/current_day'];
  var currentDay = DAY_NAMES[currentDayNum] || 'Unknown';
  return currentDay + ' ' + currentDate + ' ' + currentTime;
}

/**
 * Convert HH:MM string to minutes from midnight
 * @param {string} timeStr - Time string in HH:MM format
 * @returns {number} - Total minutes elapsed since 00:00
 */
function timeStrToMinutes(timeStr) {
  var parts = timeStr.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

/**
 * Check if minuteOfDay is within [activeFrom, activeTo) window.
 * activeTo is exclusive: the window ends before that minute.
 * Supports wrap-around (e.g. 22:00–06:00).
 * @param {number} minuteOfDay - Current time as minutes from midnight (0–1439)
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object
 * @returns {boolean}
 */
function isInActiveWindow(minuteOfDay, cfg) {
  var fromMin = timeStrToMinutes(cfg.activeFrom);
  var toMin = timeStrToMinutes(cfg.activeTo);
  if (fromMin <= toMin) {
    return minuteOfDay >= fromMin && minuteOfDay < toMin;
  }
  // Wrap-around: e.g. 22:00–06:00
  return minuteOfDay >= fromMin || minuteOfDay < toMin;
}

/**
 * Check if a given day of week is in the scheduled days list
 * @param {number} dayOfWeek - Day of week (0=Sunday … 6=Saturday)
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object
 * @returns {boolean}
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
 * Check if today is a scheduled day
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object
 * @returns {boolean} - Returns true if today's weekday is in scheduleDaysOfWeek
 */
function isTodayScheduled(cfg) {
  return isScheduledDay(new Date().getDay(), cfg);
}

/**
 * Format date/time for display: "Monday 2026-03-10 14:00"
 * Matches the format used in AstronomicalTimer.
 * @param {Date|null} date - Date object to format, or null if no date available
 * @returns {string} - Formatted string "Weekday YYYY-MM-DD HH:MM",
 *                     or "--:--" if date is null
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
    dayName + ' ' + year + '-' + month + '-' + day +
    ' ' + hours + ':' + minutes
  );
}

/**
 * Find the next start time as a Date object.
 * Slots are counted from activeFrom (not from midnight).
 * Supports wrap-around windows: slots spilling past midnight get dayAdjust=1
 * and are checked against the next calendar day's schedule.
 * Searches up to 8 days ahead.
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object
 * @returns {Date|null} - Date of the next interval slot inside the active window,
 *                        or null if no slot found within 8 days
 */
function getNextStartTime(cfg) {
  var now = new Date();
  var nowMs = now.getTime();
  var fromMin = timeStrToMinutes(cfg.activeFrom);

  for (var d = 0; d < MAX_DAYS_AHEAD; d++) {
    var baseDay = new Date(now);
    baseDay.setDate(baseDay.getDate() + d);

    for (var offset = 0; offset < 1440; offset += cfg.interval) {
      var totalMin = fromMin + offset;
      var minuteInDay = totalMin % 1440;
      var dayAdjust = Math.floor(totalMin / 1440);

      if (!isInActiveWindow(minuteInDay, cfg)) {
        continue;
      }

      var slotDate = new Date(baseDay);
      slotDate.setDate(slotDate.getDate() + dayAdjust);

      if (!isScheduledDay(slotDate.getDay(), cfg)) {
        continue;
      }

      slotDate.setHours(
        Math.floor(minuteInDay / 60), minuteInDay % 60, 0, 0
      );
      if (slotDate.getTime() > nowMs) {
        return slotDate;
      }
    }
  }
  return null;
}

/**
 * Find the next stop time as a Date object.
 * If currently in start phase inside the active window, returns end of
 * the current start phase (intervalStart + duration).
 * Otherwise returns next start time + duration.
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object
 * @returns {Date|null} - Date of the next stop, or null if not found
 */
function getNextStopTime(cfg) {
  var now = new Date();
  var minuteOfDay = now.getHours() * 60 + now.getMinutes();
  if (isTodayScheduled(cfg) && isInActiveWindow(minuteOfDay, cfg)) {
    var fromMin = timeStrToMinutes(cfg.activeFrom);
    var elapsed = minuteOfDay >= fromMin
      ? minuteOfDay - fromMin
      : minuteOfDay + 1440 - fromMin;
    var phase = elapsed % cfg.interval;
    if (phase < cfg.duration) {
      var stopMinRaw = minuteOfDay - phase + cfg.duration;
      var stopDate = new Date(now);
      if (stopMinRaw >= 1440) {
        stopDate.setDate(stopDate.getDate() + 1);
        stopMinRaw -= 1440;
      }
      stopDate.setHours(
        Math.floor(stopMinRaw / 60), stopMinRaw % 60, 0, 0
      );
      return stopDate;
    }
  }
  var nextStart = getNextStartTime(cfg);
  if (!nextStart) {
    return null;
  }
  return new Date(nextStart.getTime() + cfg.duration * MS_PER_MINUTE);
}

/**
 * Format planned stop time as full date/time string.
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object
 * @returns {string} - Formatted string "Weekday YYYY-MM-DD HH:MM",
 *                     or "--:--" if no next stop time found
 */
function formatNextStop(cfg) {
  return formatNextExecution(getNextStopTime(cfg));
}

/**
 * Compute scenario state based on current time and config
 * @param {PeriodicTimerScenario} self
 * @param {PeriodicTimerConfig} cfg
 * @returns {number} ScenarioState.NORMAL | WAITING | DISABLED
 */
function computeState(self, cfg) {
  var isEnabled = dev[self.genNames.vDevice + '/rule_enabled'];
  if (!isEnabled) {
    return ScenarioState.DISABLED;
  }
  var now = new Date();
  var minuteOfDay = now.getHours() * 60 + now.getMinutes();
  var inWindow =
    isTodayScheduled(cfg) && isInActiveWindow(minuteOfDay, cfg);
  return inWindow ? ScenarioState.NORMAL : ScenarioState.WAITING;
}

/**
 * Add custom controls to virtual device
 * @param {PeriodicTimerScenario} self - Scenario instance
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object
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
    value: formatNextExecution(getNextStartTime(cfg)),
    forceDefault: true,
    readonly: true,
    order: 5,
  });

  if (cfg.duration > 0) {
    self.vd.devObj.addControl('next_stop', {
      title: {
        en: 'Next stop',
        ru: 'Следующее отключение',
      },
      type: 'text',
      value: formatNextStop(cfg),
      forceDefault: true,
      readonly: true,
      order: 6,
    });
  }
}

/**
 * Refresh all display controls: current_time, state, next_start, next_stop.
 * Called every minute (timeUpdateRule) and on scenario enable (disableRule).
 * @param {PeriodicTimerScenario} self - Scenario instance
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object
 */
function refreshDisplay(self, cfg) {
  var vDevName = self.genNames.vDevice;
  dev[vDevName + '/current_time'] = formatCurrentTime();
  self.setState(computeState(self, cfg));
  dev[vDevName + '/next_start'] =
    formatNextExecution(getNextStartTime(cfg));
  if (cfg.duration > 0) {
    dev[vDevName + '/next_stop'] = formatNextStop(cfg);
  }
}

/**
 * Execute a list of controls via periodicTimerActionsTable
 * @param {Object[]} controls - Array of control configurations to execute
 */
function executeControls(controls) {
  for (var i = 0; i < (controls || []).length; i++) {
    var ctrl = controls[i];
    try {
      var actualValue = dev[ctrl.control];
      var newValue = periodicTimerActionsTable[ctrl.behaviorType].handler(
        actualValue,
        ctrl.actionValue
      );
      log.debug('Set {} = {}', ctrl.control, newValue);
      dev[ctrl.control] = newValue;
    } catch (error) {
      log.error(
        'Failed to update control {}: {}',
        ctrl.control,
        error.message || error
      );
    }
  }
}

/**
 * Main per-minute cron tick handler.
 *
 * Inside the active window the phase determines which controls fire:
 *   elapsed = minuteOfDay - fromMin (+ 1440 on wrap-around)
 *   phase = elapsed % interval
 *   duration > 0:
 *     phase < duration  → startControls (every minute, idempotent)
 *     phase >= duration → stopControls  (every minute, idempotent)
 *   duration = 0:
 *     phase === 0       → startControls (once per interval)
 *
 * On the first tick after leaving the window stopControls fire once
 * to clean up (ctx.wasInActiveWindow flag).
 *
 * @param {PeriodicTimerScenario} self - Scenario instance
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object
 */
function cronTick(self, cfg) {
  var vDevName = self.genNames.vDevice;
  var isEnabled = dev[vDevName + '/rule_enabled'];

  var now = new Date();
  var minuteOfDay = now.getHours() * 60 + now.getMinutes();
  var inWindow =
    isEnabled &&
    isTodayScheduled(cfg) &&
    isInActiveWindow(minuteOfDay, cfg);

  if (!inWindow) {
    if (self.ctx.wasInActiveWindow && cfg.duration > 0) {
      log.debug('Exited active window, firing stopControls (cleanup) for: {}', self.idPrefix);
      executeControls(cfg.stopControls);
    }
    self.ctx.wasInActiveWindow = false;
    return;
  }

  self.ctx.wasInActiveWindow = true;

  var fromMin = timeStrToMinutes(cfg.activeFrom);
  var elapsed = minuteOfDay >= fromMin
    ? minuteOfDay - fromMin
    : minuteOfDay + 1440 - fromMin;
  var phase = elapsed % cfg.interval;

  if (cfg.duration === 0) {
    if (phase === 0) {
      log.debug('Interval start [0/{}], firing startControls for: {}', cfg.interval, self.idPrefix);
      executeControls(cfg.startControls);
    }
    return;
  }

  if (phase < cfg.duration) {
    log.debug('Start phase [{}/{}], firing startControls for: {}', phase, cfg.interval, self.idPrefix);
    executeControls(cfg.startControls);
  } else {
    log.debug('Stop phase [{}/{}], firing stopControls for: {}', phase, cfg.interval, self.idPrefix);
    executeControls(cfg.stopControls);
  }
}

/**
 * Manual trigger handler (execute_now button).
 * Fires startControls immediately; if duration > 0, schedules
 * stopControls via setTimeout (best-effort, does not survive restarts).
 * @param {PeriodicTimerScenario} self - Scenario instance
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object
 */
function manualHandler(self, cfg) {
  var isEnabled = dev[self.genNames.vDevice + '/rule_enabled'];
  if (!isEnabled) {
    log.debug('Scenario disabled, skipping manual trigger for: {}', self.idPrefix);
    return;
  }

  log.debug('Manual execution triggered for: {}', self.idPrefix);
  executeControls(cfg.startControls);

  if (cfg.duration > 0) {
    setTimeout(function() {
      log.debug('Manual stop timeout fired for: {}', self.idPrefix);
      executeControls(cfg.stopControls);
    }, cfg.duration * MS_PER_MINUTE);
  }
}

/**
 * Create the per-minute cron rule
 * @param {PeriodicTimerScenario} self - Scenario instance
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object
 * @returns {boolean} - Returns true if rule was created successfully
 */
function createCronRule(self, cfg) {
  log.debug('Creating cron rule for periodic timer');

  var ruleId = defineRule(self.genNames.ruleMain, {
    when: cron('0 * * * * *'),
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
 * Create the manual trigger rule (execute_now button)
 * @param {PeriodicTimerScenario} self - Scenario instance
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object
 * @returns {boolean} - Returns true if rule was created successfully
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
 * Create the system time update rule
 * Updates current_time, state, next_start, next_stop every minute.
 * @param {PeriodicTimerScenario} self - Scenario instance
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object
 * @returns {boolean} - Returns true if rule was created successfully
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
 * Create the disable cleanup rule (rule_enabled switch).
 * When the scenario is disabled and duration > 0, fires stopControls once
 * to restore the controlled devices to their off/stop state.
 * @param {PeriodicTimerScenario} self - Scenario instance
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object
 * @returns {boolean} - Returns true if rule was created successfully
 */
function createDisableRule(self, cfg) {
  log.debug('Creating disable rule');

  var disableRuleId = defineRule(self.genNames.ruleDisable, {
    whenChanged: [self.genNames.vDevice + '/rule_enabled'],
    then: function disableCleanupHandler(newValue) {
      if (!newValue) {
        log.debug('Scenario disabled for: {}', self.idPrefix);
        if (cfg.duration > 0) {
          log.debug('Firing stopControls cleanup for: {}', self.idPrefix);
          executeControls(cfg.stopControls);
          self.ctx.wasInActiveWindow = false;
        }
        self.setState(ScenarioState.DISABLED);
      } else {
        refreshDisplay(self, cfg);
        cronTick(self, cfg);
      }
    },
  });

  if (!disableRuleId) {
    log.error('Failed to create disable cleanup rule');
    return false;
  }

  // Intentionally NOT added via self.addRule() — this rule must stay active
  // even when the scenario is disabled, so the user can re-enable it.
  log.debug('Disable cleanup rule created');
  return true;
}

/**
 * Create all rules for the scenario
 * @param {PeriodicTimerScenario} self - Scenario instance
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object
 * @returns {boolean} - Returns true if all rules were created successfully
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
 * Scenario-specific initialization
 * @param {string} deviceTitle - Human-readable scenario name
 * @param {PeriodicTimerConfig} cfg - Scenario configuration object
 * @returns {boolean} - Returns true if initialization completed successfully
 */
PeriodicTimerScenario.prototype.initSpecific = function(
  deviceTitle,
  cfg
) {
  /**
   * NOTE: This method is executed ONLY when:
   * - Base initialization is complete
   * - Configuration is valid
   * - All referenced controls exist in the system
   * 
   * The async initialization chain guarantees that all prerequisites are met.
   * No need to re-validate or check control existence here.
   */
  log.debug('Start init periodic timer scenario');
  log.setLabel(loggerFileLabel + '/' + this.idPrefix);

  // Add custom controls to virtual device
  addCustomControlsToVirtualDevice(this, cfg);

  // Create all rules
  var rulesCreated = createRules(this, cfg);

  if (rulesCreated) {
    this.setState(computeState(this, cfg));
    log.debug(
      'Periodic timer initialized for device "{}"',
      deviceTitle
    );
  }

  return rulesCreated;
};

exports.PeriodicTimerScenario = PeriodicTimerScenario;
