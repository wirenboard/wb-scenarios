/**
 * @file astronomical-timer.mod.js - ES5 module for wb-rules
 * @description Astronomical Timer scenario class that extends
 *   ScenarioBase. Triggers actions based on astronomical events
 *   (sunrise, sunset, twilight, etc.) calculated locally using
 *   suncalc library.
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState = require('virtual-device-helpers.mod').ScenarioState;
var Logger = require('logger.mod').Logger;
var SunCalc = require('suncalc.mod');
var aTable = require('table-handling-actions.mod');

var loggerFileLabel = 'WBSC-astro-timer-mod';
var log = new Logger(loggerFileLabel);

var DAY_NAMES = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

var ASTRO_EVENT_NAMES = {
  sunrise:       { en: 'Sunrise',          ru: 'Восход' },
  sunset:        { en: 'Sunset',           ru: 'Закат' },
  dawn:          { en: 'Dawn',             ru: 'Рассвет' },
  dusk:          { en: 'Dusk',             ru: 'Сумерки' },
  nauticalDawn:  { en: 'Nautical dawn',    ru: 'Навигационный рассвет' },
  nauticalDusk:  { en: 'Nautical dusk',    ru: 'Навигационные сумерки' },
  nightEnd:      { en: 'Night end',        ru: 'Конец ночи' },
  night:         { en: 'Night',            ru: 'Ночь' },
  goldenHour:    { en: 'Golden hour',      ru: 'Золотой час' },
  goldenHourEnd: { en: 'Golden hour end',  ru: 'Конец золотого часа' },
  solarNoon:     { en: 'Solar noon',       ru: 'Солнечный полдень' },
  nadir:         { en: 'Nadir',            ru: 'Надир' },
};

var DAY_NAME_TO_NUMBER = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

var MS_PER_MINUTE = 60000;
var MAX_DAYS_AHEAD = 8; // today + 7
var OFFSET_MIN_MIN = -720; // -12 hours
var OFFSET_MAX_MIN = 720;  // +12 hours

/**
 * @typedef {Object} Coordinates
 * @property {number} latitude - Geographic latitude (-90 to 90)
 * @property {number} longitude - Geographic longitude (-180 to 180)
 */

/**
 * @typedef {Object} EventSettings
 * @property {string} astroEvent - Type of astronomical event
 *   Valid values: "sunrise", "sunset", "dawn", "dusk", "nauticalDawn", 
 *                 "nauticalDusk", "nightEnd", "night", "goldenHour",
 *                 "goldenHourEnd", "solarNoon", "nadir"
 * @property {number} offset - Offset in minutes (OFFSET_MIN_MIN to OFFSET_MAX_MIN)
 *   Positive values shift event later, negative shift earlier
 */

/**
 * @typedef {Object} AstronomicalTimerConfig
 * @property {string} [idPrefix] - Optional prefix for scenario identification
 *   If not provided, it will be generated from the scenario name
 * @property {Coordinates} coordinates - Geographic coordinates for calculations
 * @property {EventSettings} eventSettings - Astronomical event configuration
 * @property {Array<string>} scheduleDaysOfWeek - Array of selected weekdays
 *   Valid values: "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
 * @property {Array<Object>} outControls - Array of output controls to change
 *   Each object contains:
 *   - control: Control name ('device/control')
 *   - behaviorType: Action type (setEnable, setDisable, setValue, etc.)
 *   - actionValue: Value to set (relevant for setValue)
 */

/**
 * Astronomical Timer scenario implementation
 * @class AstronomicalTimerScenario
 * @extends ScenarioBase
 * @description Triggers actions based on astronomical events (sunrise, sunset, etc.)
 *   calculated locally using SunCalc library. Supports offset adjustment and
 *   day-of-week filtering.
 */
function AstronomicalTimerScenario() {
  ScenarioBase.call(this);
}

// Set up inheritance
AstronomicalTimerScenario.prototype = Object.create(ScenarioBase.prototype);
AstronomicalTimerScenario.prototype.constructor = AstronomicalTimerScenario;

/**
 * Generate names for virtual device and rules
 * @param {string} idPrefix - The prefix for generating names
 * @returns {Object} Generated names
 */
AstronomicalTimerScenario.prototype.generateNames = function generateNames(
  idPrefix
) {
  var scenarioPrefix = 'wbsc_';
  var baseRuleName = scenarioPrefix + idPrefix + '_';

  return {
    vDevice: scenarioPrefix + idPrefix,
    ruleMain: baseRuleName + 'mainRule',
    ruleManual: baseRuleName + 'manualRule',
    ruleTimeUpdate: baseRuleName + 'timeUpdateRule',
  };
};

/**
 * Get configuration for waiting for controls
 * @param {Object} cfg - Configuration object
 * @returns {Object} Waiting configuration object
 */
AstronomicalTimerScenario.prototype.defineControlsWaitConfig =
  function defineControlsWaitConfig(cfg) {
    var allTopics = [];

    for (var i = 0; i < (cfg.outControls || []).length; i++) {
      if (cfg.outControls[i].control) {
        allTopics.push(cfg.outControls[i].control);
      }
    }

    return { controls: allTopics };
  };

/**
 * Check if control type is valid for the action
 * @param {string} controlName - Control name
 * @param {Array} reqCtrlTypes - List of allowed types
 * @returns {boolean} Returns true if control type is allowed, otherwise false
 */
function isControlTypeValid(controlName, reqCtrlTypes) {
  /* If req types in table empty - may use any control type */
  if (!reqCtrlTypes || reqCtrlTypes.length === 0) {
    return true;
  }
  var controlType = dev[controlName + '#type'];

  // Handle case when control doesn't exist
  if (!controlType) {
    log.debug("Control type for {} not found, return: {}", controlName, controlType);
    return false;
  }

  log.debug("Control: {} | Type: {}", controlName, controlType);

  return reqCtrlTypes.indexOf(controlType) !== -1;
}

/**
 * Validate all controls against action table
 * @param {Array} controls - Array of control configurations
 * @param {Object} table - Table containing allowed types for
 *                         each event/action
 * @returns {boolean} - Returns true if all controls have
 *                      allowed types, otherwise false
 */
function validateControls(controls, table) {
  for (var i = 0; i < controls.length; i++) {
    var curCtrlName = controls[i].control;
    var curBehaviorType = controls[i].behaviorType;

    // behaviorType present in table
    if (!table[curBehaviorType]) {
      log.error("Behavior type '{}' not found in table", curBehaviorType);
      return false;
    }

    var reqCtrlTypes = table[curBehaviorType].reqCtrlTypes;
    if (!isControlTypeValid(curCtrlName, reqCtrlTypes)) {
      log.debug("Error: Control '" + curCtrlName + "' is not of a valid type");
      log.debug("  - For '" + curBehaviorType + "' can used only: [" + reqCtrlTypes + "] types");
      return false;
    }
  }
  return true;
}

/**
 * Configuration validation
 * @param {Object} cfg - Configuration object
 * @returns {boolean} True if configuration is valid, false otherwise
 */
AstronomicalTimerScenario.prototype.validateCfg = function validateCfg(cfg) {
  // Validate coordinates object
  if (!cfg.coordinates || typeof cfg.coordinates !== 'object') {
    log.error('Astronomical Timer validation error: coordinates object is required');
    return false;
  }

  // Validate latitude
  if (
    typeof cfg.coordinates.latitude !== 'number' ||
    cfg.coordinates.latitude < -90 ||
    cfg.coordinates.latitude > 90
  ) {
    log.error('Astronomical Timer validation error: latitude must be between -90 and 90');
    return false;
  }

  // Validate longitude
  if (
    typeof cfg.coordinates.longitude !== 'number' ||
    cfg.coordinates.longitude < -180 ||
    cfg.coordinates.longitude > 180
  ) {
    log.error('Astronomical Timer validation error: longitude must be between -180 and 180');
    return false;
  }

  // Validate eventSettings object
  if (!cfg.eventSettings || typeof cfg.eventSettings !== 'object') {
    log.error('Astronomical Timer validation error: eventSettings object is required');
    return false;
  }

  // Validate astroEvent
  if (!ASTRO_EVENT_NAMES.hasOwnProperty(cfg.eventSettings.astroEvent)) {
    log.error('Astronomical Timer validation error: invalid astroEvent: {}', cfg.eventSettings.astroEvent);
    return false;
  }

  // Validate offset
  if (
    typeof cfg.eventSettings.offset !== 'number' ||
    cfg.eventSettings.offset < OFFSET_MIN_MIN ||
    cfg.eventSettings.offset > OFFSET_MAX_MIN
  ) {
    log.error(
    'Astronomical Timer validation error: offset must be between {} and {}',
    OFFSET_MIN_MIN,
    OFFSET_MAX_MIN
  );
    return false;
  }

  // Validate scheduleDaysOfWeek
  if (!Array.isArray(cfg.scheduleDaysOfWeek)) {
    log.error('Astronomical Timer validation error: scheduleDaysOfWeek must be an array');
    return false;
  }
  if (cfg.scheduleDaysOfWeek.length === 0) {
    log.error('Astronomical Timer validation error: at least one day must be selected');
    return false;
  }
  var validDays = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ];
  for (var i = 0; i < cfg.scheduleDaysOfWeek.length; i++) {
    if (validDays.indexOf(cfg.scheduleDaysOfWeek[i]) === -1) {
      log.error(
        'Astronomical Timer validation error: invalid day: {}',
        cfg.scheduleDaysOfWeek[i]
      );
      return false;
    }
  }

  // Validate outControls
  if (!Array.isArray(cfg.outControls)) {
    log.error('Astronomical Timer validation error: outControls must be an array');
    return false;
  }
  if (cfg.outControls.length === 0) {
    log.error('Astronomical Timer validation error: at least one output control required');
    return false;
  }

  // Check control types
  if (!validateControls(cfg.outControls, aTable.actionsTable)) {
    log.error('Astronomical Timer validation error: One or more controls have invalid type');
    return false;
  }

  log.debug('Astronomical Timer configuration validation successful');
  return true;
};

/**
 * Calculate astronomical event time for a given date
 * @param {Object} cfg - Configuration object
 * @param {Date} date - Date now
 * @returns {Date|null} - Calculated event time
 */
function calculateEventTime(cfg, date) {
  var eventName = cfg.eventSettings.astroEvent;

  var times = SunCalc.getTimes(
    date,
    cfg.coordinates.latitude,
    cfg.coordinates.longitude
  );
  var eventTime = times[eventName];

  if (!eventTime || isNaN(eventTime.getTime())) {
    log.warning('Event {} does not occur today at this location', eventName);
    return null;
  }

  // Apply offset
  if (cfg.eventSettings.offset) {
    eventTime = new Date(eventTime.getTime() + cfg.eventSettings.offset * MS_PER_MINUTE);
  }

  // Define day boundaries
  var dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  
  var dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  
  // Define previous day boundary (24 hours before dayStart)
  var prevDayStart = new Date(dayStart);
  prevDayStart.setDate(prevDayStart.getDate() - 1);

  // Check if event time is within allowed range (previous day to current day)
  // Allowed range: from start of previous day to end of current day
  if (eventTime >= prevDayStart && eventTime < dayEnd) {
    return eventTime;
  } else {
    // Event moved more than 24 hours backward or forward
    var direction = eventTime < dayStart ? 'earlier' : 'later';
    log.warning(
      'Offset of {} minutes moves event {} to {} day for date: {}. Event will not fire',
      cfg.eventSettings.offset,
      cfg.eventSettings.astroEvent,
      direction,
      date.toDateString()
    );
    return null;
  }
}

/**
 * Get saved event time, recalculate if date, timezone,
 * event type, offset, coordinates or days changed
 * @param {AstronomicalTimerScenario} self - Reference to the AstronomicalTimerScenario instance
 * @param {Object} cfg - Configuration object
 * @returns {Date|null} - Saved event time or recalculated
 */
function getSavedEventTime(self, cfg) {
  var now = new Date();
  var todayStr = now.toDateString();
  var currentTzOffset = now.getTimezoneOffset();
  var currentEventType = cfg.eventSettings.astroEvent;
  var currentOffset = cfg.eventSettings.offset;
  var currentLatitude = cfg.coordinates.latitude;
  var currentLongitude = cfg.coordinates.longitude;
  
  // Create a copy of the array and sort it for consistent comparison
  var daysCopy = (cfg.scheduleDaysOfWeek || []).slice();
  var currentDaysOfWeekStr = daysCopy.sort().join(',');

  var cachedDate = self.getPsMeta('cachedDate', null);
  var cachedTzOffset = self.getPsMeta('cachedTzOffset', null);
  var cachedEventType = self.getPsMeta('cachedEventType', null);
  var cachedOffset = self.getPsMeta('cachedOffset', null);
  var cachedLatitude = self.getPsMeta('cachedLatitude', null);
  var cachedLongitude = self.getPsMeta('cachedLongitude', null);
  var cachedDaysOfWeekStr = self.getPsMeta('cachedDaysOfWeek', '');

  // Check if any relevant parameter changed
  var needsRecalculation = 
    cachedDate !== todayStr ||
    cachedTzOffset !== currentTzOffset ||
    cachedEventType !== currentEventType ||
    cachedOffset !== currentOffset ||
    cachedLatitude !== currentLatitude ||
    cachedLongitude !== currentLongitude ||
    cachedDaysOfWeekStr !== currentDaysOfWeekStr;

  if (!needsRecalculation) {
    var cachedMs = self.getPsMeta('cachedEventTimeMs', null);
    return cachedMs !== null ? new Date(cachedMs) : null;
  }

  // Recalculate if any relevant parameter changed
  log.debug('Recalculating event time for: {} (reason: date:{}, tz:{}, event:{}, offset:{}, lat:{}, lon:{}, days:{})', 
    todayStr,
    cachedDate !== todayStr,
    cachedTzOffset !== currentTzOffset,
    cachedEventType !== currentEventType,
    cachedOffset !== currentOffset,
    cachedLatitude !== currentLatitude,
    cachedLongitude !== currentLongitude,
    cachedDaysOfWeekStr !== currentDaysOfWeekStr
  );

  var eventTime = calculateEventTime(cfg, now);

  // Reset fired flag if date, tz, event type, offset, coordinates or days changed
  if (cachedDate !== todayStr || 
      cachedTzOffset !== currentTzOffset ||
      cachedEventType !== currentEventType || 
      cachedOffset !== currentOffset ||
      cachedLatitude !== currentLatitude ||
      cachedLongitude !== currentLongitude ||
      cachedDaysOfWeekStr !== currentDaysOfWeekStr) {
    self.setPsMeta('firedToday', false);
    log.debug('Reset firedToday flag due to configuration change');
  }

  // Save all parameters to storage
  self.setPsMeta('cachedDate', todayStr);
  self.setPsMeta('cachedTzOffset', currentTzOffset);
  self.setPsMeta('cachedEventType', currentEventType);
  self.setPsMeta('cachedOffset', currentOffset);
  self.setPsMeta('cachedLatitude', currentLatitude);
  self.setPsMeta('cachedLongitude', currentLongitude);
  self.setPsMeta('cachedDaysOfWeek', currentDaysOfWeekStr !== undefined ? currentDaysOfWeekStr : '');
  self.setPsMeta('cachedEventTimeMs', eventTime ? eventTime.getTime() : null);
  self.setPsMeta('cachedEventTimeStr', eventTime ? formatHHMM(eventTime) : null);

  // Update VD displays after recalculation
  var nextExecution = getNextExecutionTime(cfg);
  dev[self.genNames.vDevice + '/next_execution'] = formatNextExecution(nextExecution);

  if (cfg.eventSettings.offset !== 0) {
    if (nextExecution) {
      var rawTime = new Date(nextExecution.getTime() - cfg.eventSettings.offset * MS_PER_MINUTE);
      dev[self.genNames.vDevice + '/astro_event_time'] = formatHHMM(rawTime);
    } else {
      dev[self.genNames.vDevice + '/astro_event_time'] = '--:--';
    }
  }

  return eventTime;
}

/**
 * Format time as HH:MM
 * @param {Date} date - Raw time for next execution
 * @returns {string} - Formated time
 */
function formatHHMM(date) {
  var hours = ('0' + date.getHours()).slice(-2);
  var minutes = ('0' + date.getMinutes()).slice(-2);
  return hours + ':' + minutes;
}

/**
 * Format current time for display using system time
 * @returns {string} - Formated dateTime
 */
function formatCurrentTime() {
  var currentDate = dev['system_time/current_date'];
  var currentTime = dev['system_time/current_time'];
  var currentDayNum = dev['system_time/current_day'];
  var currentDay = DAY_NAMES[currentDayNum] || 'Unknown';

  return currentDay + ' ' + currentDate + ' ' + currentTime;
}

/**
 * Format date for display
 * @param {Date} date
 * @returns {string} - Formated dateTime
 */
function formatNextExecution(date) {
  if (!date) {
    return 'Event does not occur in next ' + MAX_DAYS_AHEAD + ' days';
  }

  var fullDays = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  var dayName = fullDays[date.getDay()];

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
 * Check if today is a scheduled day
 * @param {Object} cfg - Configuration object
 * @returns {boolean} True if today is a scheduled day
 */
function isTodayScheduled(cfg) {
  var now = new Date();
  var currentDay = now.getDay();

  var scheduledDays = [];
  for (var i = 0; i < cfg.scheduleDaysOfWeek.length; i++) {
    var dayName = cfg.scheduleDaysOfWeek[i];
    if (DAY_NAME_TO_NUMBER.hasOwnProperty(dayName)) {
      scheduledDays.push(DAY_NAME_TO_NUMBER[dayName]);
    }
  }

  return scheduledDays.indexOf(currentDay) !== -1;
}

/**
 * Calculate next execution time considering days
 * @param {Object} cfg - Configuration object
 * @returns {Date|null} - Calculated next execution time
 */
function getNextExecutionTime(cfg) {
  var now = new Date();
  var scheduledDays = [];
  var i;

  // Convert scheduled days to numbers
  for (i = 0; i < cfg.scheduleDaysOfWeek.length; i++) {
    var dayName = cfg.scheduleDaysOfWeek[i];
    if (DAY_NAME_TO_NUMBER.hasOwnProperty(dayName)) {
      scheduledDays.push(DAY_NAME_TO_NUMBER[dayName]);
    }
  }

  if (scheduledDays.length === 0) {
    return null;
  }

  scheduledDays.sort(function sortDays(a, b) {
    return a - b;
  });

  // Check up to MAX_DAYS_AHEAD days ahead
  for (i = 0; i < MAX_DAYS_AHEAD; i++) {
    var checkDate = new Date(now);
    checkDate.setDate(checkDate.getDate() + i);

    var eventTime = calculateEventTime(cfg, checkDate);
    if (!eventTime) {
      continue;
    }

    // Determine what day of the week the event actually falls on
    var actualDay = eventTime.getDay();

    // Let's check if this day is allowed
    if (scheduledDays.indexOf(actualDay) === -1) {
      // Actual day not allowed - skip
      log.debug('Event on {} falls on day {} which is not scheduled', 
        eventTime.toDateString(), actualDay);
      continue;
    }

    if (eventTime > now) {
      return eventTime;
    }
  }

  log.error('No event found in next {} days for: {}',
    MAX_DAYS_AHEAD,
    cfg.eventSettings.astroEvent
  );

  return null;
}

/**
 * Handler for astronomical timer trigger
 * @param {AstronomicalTimerScenario} self - Reference to the AstronomicalTimerScenario instance
 * @param {Object} cfg - Configuration object
 * @returns {void}
 */
function astroHandler(self, cfg) {
  log.debug('Astro timer triggered for scenario: {}', self.idPrefix);

  var isActive = dev[self.genNames.vDevice + '/rule_enabled'];
  if (!isActive) {
    log.debug('Scenario is disabled, skipping');
    return;
  }

  // Execute all configured actions
  for (var i = 0; i < cfg.outControls.length; i++) {
    var outControl = cfg.outControls[i];
    var curCtrlName = outControl.control;
    var curUserAction = outControl.behaviorType;
    var curActionValue = outControl.actionValue;

    try {
      var actualValue = dev[curCtrlName];
      var newCtrlValue = aTable.actionsTable[curUserAction].handler(
        actualValue,
        curActionValue
      );

      log.debug('Control {} will be updated to: {}', curCtrlName, newCtrlValue);
      dev[curCtrlName] = newCtrlValue;
      log.debug('Control {} updated successfully', curCtrlName);
    } catch (error) {
      log.error(
        'Failed to update control ' +
          curCtrlName +
          ': ' +
          (error.message || error)
      );
    }
  }

  // Update next execution time display
  var nextExecution = getNextExecutionTime(cfg);
  var nextExecutionText = formatNextExecution(nextExecution);
  dev[self.genNames.vDevice + '/next_execution'] = nextExecutionText;

  log.debug('Astro timer actions completed for: {}', self.idPrefix);
}

/**
 * Create the minute-check cron rule
 * @param {AstronomicalTimerScenario} self - Reference to the AstronomicalTimerScenario instance
 * @param {Object} cfg - Configuration object
 * @returns {boolean} True if rule created successfully, false otherwise
 */
function createCronRule(self, cfg) {
  log.debug('Creating cron rule for astronomical timer scenario');

  var ruleId = defineRule(self.genNames.ruleMain, {
    when: cron('0 * * * * *'), // Every minute at 0 seconds
    then: function minuteCheckHandler() {
      var eventTime = getSavedEventTime(self, cfg);
      if (!eventTime) {
        return;
      }

      if (self.getPsMeta('firedToday', false)) {
        log.debug('Event already fired today for: {}', self.idPrefix);
        return;
      }

      if (!isTodayScheduled(cfg)) {
        log.debug('Today not scheduled for: {}', self.idPrefix);
        return;
      }

      var now = new Date();
      var nowHHMM = formatHHMM(now);
      var cachedEventTimeStr = self.getPsMeta('cachedEventTimeStr', null);

      if (nowHHMM === cachedEventTimeStr) {
        log.debug('Event time matched: {} for {}', nowHHMM, self.idPrefix);
        self.setPsMeta('firedToday', true);
        dev[self.genNames.vDevice + '/execute_now'] = true;
      }
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
 * Create manual trigger rule for the button
 * @param {AstronomicalTimerScenario} self - Reference to the AstronomicalTimerScenario instance
 * @param {Object} cfg - Configuration object
 * @returns {boolean} True if rule created successfully, false otherwise
 */
function createManualRule(self, cfg) {
  log.debug('Creating manual trigger rule');

  var manualRuleId = defineRule(self.genNames.ruleManual, {
    whenChanged: [self.genNames.vDevice + '/execute_now'],
    then: function manualTriggerHandler(newValue) {
      if (newValue) {
        log.debug('Manual execution for: {}', self.idPrefix);
        astroHandler(self, cfg);
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
 * Creates time update rule to monitor system time changes
 * @param {AstronomicalTimerScenario} self - Reference to the AstronomicalTimerScenario instance
 * @returns {boolean} True if rule created successfully, false otherwise
 */
function createTimeUpdateRule(self) {
  log.debug('Creating time update rule for current time display');

  var timeUpdateRuleId = defineRule(self.genNames.ruleTimeUpdate, {
    whenChanged: [
      'system_time/current_time',
      'system_time/current_date',
      'system_time/current_day',
    ],
    then: function(newValue, devName, cellName) {
      var currentTimeText = formatCurrentTime();
      dev[self.genNames.vDevice + '/current_time'] = currentTimeText;
    },
  });

  if (!timeUpdateRuleId) {
    log.error('Failed to create time update rule');
    return false;
  }

  log.debug('Time update rule created successfully');
  self.addRule(timeUpdateRuleId);

  return true;
}

/**
 * Scenario initialization
 * @param {string} deviceTitle - Virtual device title
 * @param {Object} cfg - Configuration object
 * @returns {boolean} True if initialization succeeded
 */
AstronomicalTimerScenario.prototype.initSpecific = function initSpecific(
  deviceTitle,
  cfg
) {
  log.debug('Start init astronomical timer scenario');
  log.setLabel(loggerFileLabel + '/' + this.idPrefix);

  // Validate configuration
  if (!this.validateCfg(cfg)) {
    log.error('Configuration validation failed');
    this.setState(ScenarioState.ERROR);
    return false;
  }

  // Add manual execution button to virtual device
  this.vd.devObj.addControl('execute_now', {
    title: {
      en: 'Execute now',
      ru: 'Выполнить сейчас',
    },
    type: 'pushbutton',
    order: 2,
  });

  // Add current time display control
  var currentTimeText = formatCurrentTime();
  this.vd.devObj.addControl('current_time', {
    title: {
      en: 'Current time',
      ru: 'Текущее время',
    },
    type: 'text',
    value: currentTimeText,
    forceDefault: true, // Always must start from enabled state
    readonly: true,
    order: 3,
  });

  // Add next execution time display control
  var nextExecution = getNextExecutionTime(cfg);
  var nextExecutionText = formatNextExecution(nextExecution);
  this.vd.devObj.addControl('next_execution', {
    title: {
      en: 'Next execution',
      ru: 'Следующее срабатывание',
    },
    type: 'text',
    value: nextExecutionText,
    forceDefault: true, // Always must start from enabled state
    readonly: true,
    order: 4,
  });

  // Add raw astronomical event time display (only when offset is used)
  if (cfg.eventSettings.offset !== 0) {
    var rawEventTimeStr = '--:--';
    if (nextExecution) {
      var initRawTime = new Date(
        nextExecution.getTime() - cfg.eventSettings.offset * MS_PER_MINUTE
      );
      rawEventTimeStr = formatHHMM(initRawTime);
    }
    this.vd.devObj.addControl('astro_event_time', {
      title: {
        en: 'Astronomical event time',
        ru: 'Время астрособытия',
      },
      type: 'text',
      value: rawEventTimeStr,
      forceDefault: true, // Always must start from enabled state
      readonly: true,
      order: 5,
    });
  }

  // Add event type display with localized enum
  this.vd.devObj.addControl('event_type', {
    title: {
      en: 'Event type',
      ru: 'Тип события',
    },
    type: 'text',
    value: cfg.eventSettings.astroEvent,
    enum: ASTRO_EVENT_NAMES,
    forceDefault: true, // Always must start from enabled state
    readonly: true,
    order: 6,
  });

  // Add offset display (only when offset is used)
  if (cfg.eventSettings.offset !== 0) {
    this.vd.devObj.addControl('offset', {
      title: {
        en: 'Offset (min)',
        ru: 'Смещение (мин)',
      },
      type: 'text',
      value: String(cfg.eventSettings.offset),
      forceDefault: true, // Always must start from enabled state
      readonly: true,
      order: 7,
    });
  }

  // Create rules
  if (!createCronRule(this, cfg)) {
    this.setState(ScenarioState.ERROR);
    return false;
  }

  if (!createManualRule(this, cfg)) {
    this.setState(ScenarioState.ERROR);
    return false;
  }

  if (!createTimeUpdateRule(this)) {
    this.setState(ScenarioState.ERROR);
    return false;
  }

  this.setState(ScenarioState.NORMAL);
  log.debug('Astronomical timer scenario initialized');
  return true;
};

exports.AstronomicalTimerScenario = AstronomicalTimerScenario;
