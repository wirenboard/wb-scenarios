/**
 * @file astronomical-timer.mod.js - ES5 module for wb-rules
 * @description Astronomical Timer scenario class that extends
 *   ScenarioBase. Triggers actions based on astronomical events
 *   (sunrise, sunset, twilight, etc.) calculated locally using
 *   suncalc library.
 */

var ScenarioBase =
  require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState =
  require('virtual-device-helpers.mod').ScenarioState;
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

var VALID_ASTRO_EVENTS = [
  'sunrise',
  'sunset',
  'dawn',
  'dusk',
  'nauticalDawn',
  'nauticalDusk',
  'nightEnd',
  'night',
  'goldenHour',
  'goldenHourEnd',
  'solarNoon',
  'nadir',
  'customAngle',
];

var DAY_NAME_TO_NUMBER = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Astronomical Timer scenario implementation
 * @class AstronomicalTimerScenario
 * @extends ScenarioBase
 */
function AstronomicalTimerScenario() {
  ScenarioBase.call(this);

  this.ctx = {
    cachedDate: null,
    cachedTzOffset: null,
    cachedEventTime: null,
    cachedEventTimeStr: null,
    firedToday: false,
  };
}

// Set up inheritance
AstronomicalTimerScenario.prototype = Object.create(
  ScenarioBase.prototype
);
AstronomicalTimerScenario.prototype.constructor =
  AstronomicalTimerScenario;

/**
 * Generate names for virtual device and rules
 * @param {string} idPrefix
 * @returns {Object}
 */
AstronomicalTimerScenario.prototype.generateNames =
  function generateNames(idPrefix) {
    var scenarioPrefix = 'wbsc_';
    var baseRuleName = scenarioPrefix + idPrefix + '_';

    return {
      vDevice: scenarioPrefix + idPrefix,
      ruleMinuteCheck: baseRuleName + 'minuteCheckRule',
      ruleManual: baseRuleName + 'manualRule',
      ruleTimeUpdate: baseRuleName + 'timeUpdateRule',
    };
  };

/**
 * Get configuration for waiting for controls
 * @param {Object} cfg
 * @returns {Object}
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
 * @param {string} controlName
 * @param {Array} reqCtrlTypes
 * @returns {boolean}
 */
function isControlTypeValid(controlName, reqCtrlTypes) {
  if (!reqCtrlTypes || reqCtrlTypes.length === 0) {
    return true;
  }
  var controlType = dev[controlName + '#type'];
  if (!controlType) {
    log.debug(
      'Control type for ' +
        controlName +
        ' not found'
    );
    return false;
  }
  return reqCtrlTypes.indexOf(controlType) !== -1;
}

/**
 * Validate all controls against action table
 * @param {Array} controls
 * @param {Object} table
 * @returns {boolean}
 */
function validateControls(controls, table) {
  for (var i = 0; i < controls.length; i++) {
    var curBehaviorType = controls[i].behaviorType;
    if (!table[curBehaviorType]) {
      log.error(
        'Behavior type not found in table: ' +
          curBehaviorType
      );
      return false;
    }
    var reqCtrlTypes =
      table[curBehaviorType].reqCtrlTypes;
    if (
      !isControlTypeValid(
        controls[i].control,
        reqCtrlTypes
      )
    ) {
      log.error(
        'Control type mismatch for: ' +
          controls[i].control
      );
      return false;
    }
  }
  return true;
}

/**
 * Configuration validation
 * @param {Object} cfg
 * @returns {boolean}
 */
AstronomicalTimerScenario.prototype.validateCfg =
  function validateCfg(cfg) {
    // Validate latitude
    if (
      typeof cfg.latitude !== 'number' ||
      cfg.latitude < -90 ||
      cfg.latitude > 90
    ) {
      log.error(
        'Validation error: latitude must be between -90 and 90'
      );
      return false;
    }

    // Validate longitude
    if (
      typeof cfg.longitude !== 'number' ||
      cfg.longitude < -180 ||
      cfg.longitude > 180
    ) {
      log.error(
        'Validation error: longitude must be between -180 and 180'
      );
      return false;
    }

    // Validate astroEvent
    if (
      VALID_ASTRO_EVENTS.indexOf(cfg.astroEvent) === -1
    ) {
      log.error(
        'Validation error: invalid astroEvent: ' +
          cfg.astroEvent
      );
      return false;
    }

    // Validate offset
    if (
      typeof cfg.offset !== 'number' ||
      cfg.offset < -720 ||
      cfg.offset > 720
    ) {
      log.error(
        'Validation error: offset must be between -720 and 720'
      );
      return false;
    }

    // Validate customAngle fields
    if (cfg.astroEvent === 'customAngle') {
      if (
        typeof cfg.customElevation !== 'number' ||
        cfg.customElevation < -90 ||
        cfg.customElevation > 90
      ) {
        log.error(
          'Validation error: customElevation must be between -90 and 90'
        );
        return false;
      }
      if (
        cfg.customAngleDirection !== 'rising' &&
        cfg.customAngleDirection !== 'setting'
      ) {
        log.error(
          'Validation error: customAngleDirection must be rising or setting'
        );
        return false;
      }
    }

    // Validate scheduleDaysOfWeek
    if (!Array.isArray(cfg.scheduleDaysOfWeek)) {
      log.error(
        'Validation error: scheduleDaysOfWeek must be an array'
      );
      return false;
    }
    if (cfg.scheduleDaysOfWeek.length === 0) {
      log.error(
        'Validation error: at least one day must be selected'
      );
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
      if (
        validDays.indexOf(cfg.scheduleDaysOfWeek[i]) ===
        -1
      ) {
        log.error(
          'Validation error: invalid day: ' +
            cfg.scheduleDaysOfWeek[i]
        );
        return false;
      }
    }

    // Validate outControls
    if (!Array.isArray(cfg.outControls)) {
      log.error(
        'Validation error: outControls must be an array'
      );
      return false;
    }
    if (cfg.outControls.length === 0) {
      log.error(
        'Validation error: at least one output control required'
      );
      return false;
    }
    if (
      !validateControls(
        cfg.outControls,
        aTable.actionsTable
      )
    ) {
      log.error('One or more controls have invalid type');
      return false;
    }

    log.debug('Configuration validation successful');
    return true;
  };

/**
 * Calculate astronomical event time for a given date
 * @param {Object} cfg
 * @param {Date} date
 * @returns {Date|null}
 */
function calculateEventTime(cfg, date) {
  var eventName = cfg.astroEvent;

  // Handle customAngle (addTime called once in initSpecific)
  if (eventName === 'customAngle') {
    eventName =
      cfg.customAngleDirection === 'rising'
        ? '_customRise'
        : '_customSet';
  }

  var times = SunCalc.getTimes(
    date,
    cfg.latitude,
    cfg.longitude
  );
  var eventTime = times[eventName];

  if (!eventTime || isNaN(eventTime.getTime())) {
    return null;
  }

  // Apply offset
  if (cfg.offset) {
    eventTime = new Date(
      eventTime.getTime() + cfg.offset * 60000
    );
  }

  // Check if offset moved time outside current day
  var dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  var dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  if (eventTime < dayStart || eventTime >= dayEnd) {
    log.debug(
      'Event time with offset is outside current day'
    );
    return null;
  }

  return eventTime;
}

/**
 * Get cached event time, recalculate if date or
 * timezone changed
 * @param {AstronomicalTimerScenario} self
 * @param {Object} cfg
 * @returns {Date|null}
 */
function getCachedEventTime(self, cfg) {
  var now = new Date();
  var todayStr = now.toDateString();
  var currentTzOffset = now.getTimezoneOffset();

  // Recalculate if date or timezone changed
  if (
    self.ctx.cachedDate === todayStr &&
    self.ctx.cachedTzOffset === currentTzOffset
  ) {
    return self.ctx.cachedEventTime;
  }

  log.debug(
    'Recalculating event time for: ' + todayStr
  );

  var eventTime = calculateEventTime(cfg, now);

  // Reset fired flag on new day (before overwriting)
  var previousDate = self.ctx.cachedDate;
  if (previousDate !== null && previousDate !== todayStr) {
    self.ctx.firedToday = false;
  }

  self.ctx.cachedDate = todayStr;
  self.ctx.cachedTzOffset = currentTzOffset;
  self.ctx.cachedEventTime = eventTime;
  self.ctx.cachedEventTimeStr = eventTime
    ? formatHHMM(eventTime)
    : null;

  return eventTime;
}

/**
 * Format time as HH:MM
 * @param {Date} date
 * @returns {string}
 */
function formatHHMM(date) {
  var hours = ('0' + date.getHours()).slice(-2);
  var minutes = ('0' + date.getMinutes()).slice(-2);
  return hours + ':' + minutes;
}

/**
 * Format current time for display using system time
 * @returns {string}
 */
function formatCurrentTime() {
  var currentDate = dev['system_time/current_date'];
  var currentTime = dev['system_time/current_time'];
  var currentDayNum = dev['system_time/current_day'];
  var currentDay =
    DAY_NAMES[currentDayNum] || 'Unknown';

  return (
    currentDay + ' ' + currentDate + ' ' + currentTime
  );
}

/**
 * Format date for display
 * @param {Date} date
 * @returns {string}
 */
function formatNextExecution(date) {
  if (!date) {
    return 'Event does not occur today';
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
 * @param {Object} cfg
 * @returns {boolean}
 */
function isTodayScheduled(cfg) {
  var now = new Date();
  var currentDay = now.getDay();

  var scheduledDays = [];
  for (
    var i = 0;
    i < cfg.scheduleDaysOfWeek.length;
    i++
  ) {
    var dayName = cfg.scheduleDaysOfWeek[i];
    if (
      DAY_NAME_TO_NUMBER.hasOwnProperty(dayName)
    ) {
      scheduledDays.push(DAY_NAME_TO_NUMBER[dayName]);
    }
  }

  return scheduledDays.indexOf(currentDay) !== -1;
}

/**
 * Calculate next execution time considering days
 * @param {Object} cfg
 * @returns {Date|null}
 */
function getNextExecutionTime(cfg) {
  var now = new Date();
  var scheduledDays = [];
  var i;

  for (
    i = 0;
    i < cfg.scheduleDaysOfWeek.length;
    i++
  ) {
    var dayName = cfg.scheduleDaysOfWeek[i];
    if (
      DAY_NAME_TO_NUMBER.hasOwnProperty(dayName)
    ) {
      scheduledDays.push(DAY_NAME_TO_NUMBER[dayName]);
    }
  }

  if (scheduledDays.length === 0) {
    return null;
  }

  scheduledDays.sort(function sortDays(a, b) {
    return a - b;
  });

  // Check up to 8 days ahead (today + 7)
  for (i = 0; i < 8; i++) {
    var checkDate = new Date(now);
    checkDate.setDate(checkDate.getDate() + i);
    var checkDay = checkDate.getDay();

    if (scheduledDays.indexOf(checkDay) === -1) {
      continue;
    }

    var eventTime = calculateEventTime(cfg, checkDate);
    if (!eventTime) {
      continue;
    }

    // Skip if event already passed today
    if (i === 0 && eventTime <= now) {
      continue;
    }

    return eventTime;
  }

  log.warning(
    'No event found in next 8 days for: {}',
    cfg.astroEvent
  );
  return null;
}

/**
 * Build event type display string
 * @param {Object} cfg
 * @returns {string}
 */
function buildEventTypeString(cfg) {
  var eventStr = cfg.astroEvent;
  if (cfg.astroEvent === 'customAngle') {
    eventStr =
      cfg.customAngleDirection +
      ' ' +
      cfg.customElevation +
      '\u00B0';
  }
  if (cfg.offset !== 0) {
    var sign = cfg.offset > 0 ? '+' : '';
    eventStr += ' ' + sign + cfg.offset + 'min';
  }
  return eventStr;
}

/**
 * Handler for astronomical timer trigger
 * @param {AstronomicalTimerScenario} self
 * @param {Object} cfg
 */
function astroHandler(self, cfg) {
  log.debug(
    'Astro timer triggered for scenario: ' +
      self.idPrefix
  );

  var isActive =
    dev[self.genNames.vDevice + '/rule_enabled'];
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
      var newCtrlValue =
        aTable.actionsTable[curUserAction].handler(
          actualValue,
          curActionValue
        );

      log.debug(
        'Control ' +
          curCtrlName +
          ' will be updated to: ' +
          newCtrlValue
      );
      dev[curCtrlName] = newCtrlValue;
      log.debug(
        'Control ' +
          curCtrlName +
          ' updated successfully'
      );
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
  var nextExecutionText =
    formatNextExecution(nextExecution);
  dev[self.genNames.vDevice + '/next_event_time'] =
    nextExecutionText;

  log.debug(
    'Astro timer actions completed for: ' +
      self.idPrefix
  );
}

/**
 * Create the minute-check cron rule
 * @param {AstronomicalTimerScenario} self
 * @param {Object} cfg
 * @returns {boolean}
 */
function createMinuteCheckRule(self, cfg) {
  log.debug('Creating minute check rule');

  var ruleId = defineRule(
    self.genNames.ruleMinuteCheck,
    {
      when: cron('0 * * * * *'),
      then: function minuteCheckHandler() {
        var eventTime = getCachedEventTime(self, cfg);
        if (!eventTime) {
          return;
        }

        if (self.ctx.firedToday) {
          return;
        }

        if (!isTodayScheduled(cfg)) {
          return;
        }

        var now = new Date();
        var nowHHMM = formatHHMM(now);

        if (
          nowHHMM === self.ctx.cachedEventTimeStr
        ) {
          log.debug(
            'Event time matched: ' +
              nowHHMM +
              ' for ' +
              self.idPrefix
          );
          self.ctx.firedToday = true;
          dev[
            self.genNames.vDevice + '/execute_now'
          ] = true;
        }
      },
    }
  );

  if (!ruleId) {
    log.error('Failed to create minute check rule');
    return false;
  }

  log.debug('Minute check rule created');
  self.addRule(ruleId);
  return true;
}

/**
 * Create manual trigger rule for the button
 * @param {AstronomicalTimerScenario} self
 * @param {Object} cfg
 * @returns {boolean}
 */
function createManualRule(self, cfg) {
  log.debug('Creating manual trigger rule');

  var manualRuleId = defineRule(
    self.genNames.ruleManual,
    {
      whenChanged: [
        self.genNames.vDevice + '/execute_now',
      ],
      then: function manualTriggerHandler(
        newValue
      ) {
        if (newValue) {
          log.debug(
            'Manual execution for: ' + self.idPrefix
          );
          astroHandler(self, cfg);
        }
      },
    }
  );

  if (!manualRuleId) {
    log.error('Failed to create manual trigger rule');
    return false;
  }

  log.debug('Manual trigger rule created');
  self.addRule(manualRuleId);
  return true;
}

/**
 * Create time update rule for display
 * @param {AstronomicalTimerScenario} self
 * @returns {boolean}
 */
function createTimeUpdateRule(self) {
  log.debug('Creating time update rule');

  var timeUpdateRuleId = defineRule(
    self.genNames.ruleTimeUpdate,
    {
      whenChanged: [
        'system_time/current_time',
        'system_time/current_date',
        'system_time/current_day',
      ],
      then: function timeUpdateHandler() {
        var currentTimeText = formatCurrentTime();
        dev[
          self.genNames.vDevice + '/current_time'
        ] = currentTimeText;
      },
    }
  );

  if (!timeUpdateRuleId) {
    log.error('Failed to create time update rule');
    return false;
  }

  log.debug('Time update rule created');
  self.addRule(timeUpdateRuleId);
  return true;
}

/**
 * Scenario initialization
 * @param {string} deviceTitle
 * @param {Object} cfg
 * @returns {boolean}
 */
AstronomicalTimerScenario.prototype.initSpecific =
  function initSpecific(deviceTitle, cfg) {
    log.debug('Start init astronomical timer scenario');
    log.setLabel(
      loggerFileLabel + '/' + this.idPrefix
    );

    if (!this.validateCfg(cfg)) {
      log.error('Configuration validation failed');
      this.setState(ScenarioState.ERROR);
      return false;
    }

    // Register custom angle with SunCalc (once)
    if (cfg.astroEvent === 'customAngle') {
      SunCalc.addTime(
        cfg.customElevation,
        '_customRise',
        '_customSet'
      );
    }

    // Add manual execution button
    this.vd.devObj.addControl('execute_now', {
      title: {
        en: 'Execute now',
        ru: 'Выполнить сейчас',
      },
      type: 'pushbutton',
      order: 2,
    });

    // Add current time display
    var currentTimeText = formatCurrentTime();
    this.vd.devObj.addControl('current_time', {
      title: {
        en: 'Current time',
        ru: 'Текущее время',
      },
      type: 'text',
      value: currentTimeText,
      forceDefault: true,
      readonly: true,
      order: 3,
    });

    // Add next event time display
    var nextExecution = getNextExecutionTime(cfg);
    var nextExecutionText =
      formatNextExecution(nextExecution);
    this.vd.devObj.addControl('next_event_time', {
      title: {
        en: 'Next event time',
        ru: 'Следующее срабатывание',
      },
      type: 'text',
      value: nextExecutionText,
      forceDefault: true,
      readonly: true,
      order: 4,
    });

    // Add event type display
    var eventTypeStr = buildEventTypeString(cfg);
    this.vd.devObj.addControl('event_type', {
      title: {
        en: 'Event type',
        ru: 'Тип события',
      },
      type: 'text',
      value: eventTypeStr,
      forceDefault: true,
      readonly: true,
      order: 5,
    });

    // Create rules
    log.debug('Creating minute check rule');
    if (!createMinuteCheckRule(this, cfg)) {
      this.setState(ScenarioState.ERROR);
      return false;
    }

    log.debug('Creating manual trigger rule');
    if (!createManualRule(this, cfg)) {
      this.setState(ScenarioState.ERROR);
      return false;
    }

    log.debug('Creating time update rule');
    if (!createTimeUpdateRule(this)) {
      this.setState(ScenarioState.ERROR);
      return false;
    }

    this.setState(ScenarioState.NORMAL);
    log.debug(
      'Astronomical timer scenario initialized'
    );
    return true;
  };

exports.AstronomicalTimerScenario =
  AstronomicalTimerScenario;
