/**
 * @file schedule.mod.js - ES5 module for wb-rules v2.34
 * @description Schedule scenario class that extends ScenarioBase
 * @author Ivan Praulov <ivan.praulov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState = require('virtual-device-helpers.mod').ScenarioState;
var Logger = require('logger.mod').Logger;

var aTable = require("table-handling-actions.mod");

var loggerFileLabel = 'WBSC-schedule-mod';
var log = new Logger(loggerFileLabel);

var DAY_NAMES = {
  0: 'Sunday',
  1: 'Monday', 
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday'
};

/**
 * @typedef {Object} ScheduleConfig
 * @property {string} [idPrefix] - Optional prefix for scenario identification
 *   If not provided, it will be generated from the scenario name
 * @property {string} scheduleTime - Time to trigger in HH:MM format
 * @property {Array<string>} scheduleDaysOfWeek - Array of selected weekdays
 *   Valid values: "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
 * @property {Array<Object>} outControls - Array of output controls to change
 *   Each object contains:
 *   - control: Control name ('device/control')
 *   - behaviorType: Action type (setEnable, setDisable, setValue, etc.)
 *   - actionValue: Value to set (relevant for setValue)
 */

/**
 * Schedule scenario implementation
 * @class ScheduleScenario
 * @extends ScenarioBase
 */
function ScheduleScenario() {
  ScenarioBase.call(this);
  
  /**
   * Context object for storing scenario runtime state
   * @type {Object}
   */
  this.context = {
    cronRule: null
  };
}

// Set up inheritance
ScheduleScenario.prototype = Object.create(ScenarioBase.prototype);
ScheduleScenario.prototype.constructor = ScheduleScenario;

/**
 * Generate names for virtual device and rules
 * @param {string} idPrefix - The prefix for generating names
 * @returns {Object} Generated names
 */
ScheduleScenario.prototype.generateNames = function(idPrefix) {
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
ScheduleScenario.prototype.defineControlsWaitConfig = function (cfg) {
  var allTopics = [];
  
  // Extract output control names
  for (var i = 0; i < (cfg.outControls || []).length; i++) {
    if (cfg.outControls[i].control) {
      allTopics.push(cfg.outControls[i].control);
    }
  }
  
  return { controls: allTopics };
};

/**
 * Checks if control type is in the list of allowed types
 * @private
 * @param {string} controlName - Control name
 * @param {Array<string>} reqCtrlTypes - List of allowed types
 * @returns {boolean} Returns true if control type is allowed, otherwise false
 */
function isControlTypeValid(controlName, reqCtrlTypes) {
  /* If req types in table empty - may use any control type */
  if (!reqCtrlTypes || reqCtrlTypes.length === 0) {
    return true;
  }
  var controlType = dev[controlName + "#type"];
  
  // Handle case when control doesn't exist
  if (!controlType) {
    log.debug("Control type for " + controlName + " not found, return: " + controlType);
    return false;
  }
  log.debug("Control: " + controlName + " | Type: " + controlType);
  
  var isTypeValid = (reqCtrlTypes.indexOf(controlType) !== -1);
  return isTypeValid;
}

/**
 * Validates types of all controls in array against
 * requirements in the table
 * @private
 * @param {Array<Object>} controls - Array of control configurations
 * @param {Object} table - Table containing allowed types for
 *                         each event/action
 * @returns {boolean} - Returns true if all controls have
 *                      allowed types, otherwise false
 */
function validateControls(controls, table) {
  for (var i = 0; i < controls.length; i++) {
    var curCtrlName = controls[i].control;
    var curBehaviorType = controls[i].behaviorType;
    var reqCtrlTypes = table[curBehaviorType].reqCtrlTypes;

    // behaviorType present in table
    if (!table[curBehaviorType]) {
      log.error("Behavior type '" + curBehaviorType + "' not found in table");
      return false;
    }

    if (!isControlTypeValid(curCtrlName, reqCtrlTypes)) {
      log.debug("Error: Control '" + curCtrlName + "' is not of a valid type");
      log.debug("  - For '" + curBehaviorType + "' can used only: [" + reqCtrlTypes + "] types");
      return false;
    }
  }
  return true;
}

/**
 * Parses scheduleTime string and adds hours/minutes/seconds to config
 * @param {ScheduleConfig} cfg - Configuration object
 * @returns {boolean} True if parsing successful, false otherwise
 */
function parseScheduleTime(cfg) {
  if (typeof cfg.scheduleTime !== 'string') {
    log.error('Schedule validation error: scheduleTime must be a string');
    return false;
  }
  
  var timeParts = cfg.scheduleTime.split(':');
  if (timeParts.length !== 2) {
    log.error('Schedule validation error: scheduleTime must be in HH:MM format');
    return false;
  }
  
  var hours = parseInt(timeParts[0], 10);
  var minutes = parseInt(timeParts[1], 10);
  
  if (isNaN(hours) || isNaN(minutes)) {
    log.error('Schedule validation error: invalid time format in scheduleTime');
    return false;
  }
  
  cfg.hours = hours;
  cfg.minutes = minutes;
  cfg.seconds = 0; // Always set seconds to 0 for schedule scenarios
  
  return true;
}

/**
 * Configuration validation
 * @param {ScheduleConfig} cfg - Configuration object
 * @returns {boolean} True if configuration is valid, false otherwise
 */
ScheduleScenario.prototype.validateCfg = function(cfg) {
  // Parse scheduleTime first
  if (!parseScheduleTime(cfg)) {
    return false;
  }
  
  // Check time values
  if (typeof cfg.hours !== 'number' || cfg.hours < 0 || cfg.hours > 23) {
    log.error('Schedule validation error: hours must be a number between 0 and 23');
    return false;
  }
  
  if (typeof cfg.minutes !== 'number' || cfg.minutes < 0 || cfg.minutes > 59) {
    log.error('Schedule validation error: minutes must be a number between 0 and 59');
    return false;
  }
  
  if (typeof cfg.seconds !== 'number' || cfg.seconds < 0 || cfg.seconds > 59) {
    log.error('Schedule validation error: seconds must be a number between 0 and 59');
    return false;
  }
  
  // Check scheduleDaysOfWeek array
  if (!Array.isArray(cfg.scheduleDaysOfWeek)) {
    log.error('Schedule validation error: scheduleDaysOfWeek must be an array');
    return false;
  }
  
  // Check that at least one day is selected
  if (cfg.scheduleDaysOfWeek.length === 0) {
    log.error('Schedule validation error: at least one day of the week must be selected');
    return false;
  }
  
  // Validate scheduleDaysOfWeek values
  var validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (var i = 0; i < cfg.scheduleDaysOfWeek.length; i++) {
    var day = cfg.scheduleDaysOfWeek[i];
    if (typeof day !== 'string' || validDays.indexOf(day) === -1) {
      log.error('Schedule validation error: invalid scheduleDaysOfWeek value: ' + day);
      return false;
    }
  }
  
  // Check outControls array
  if (!Array.isArray(cfg.outControls)) {
    log.error('Schedule validation error: outControls must be an array');
    return false;
  }
  
  if (cfg.outControls.length === 0) {
    log.error('Schedule validation error: at least one output control must be specified');
    return false;
  }
  
  // Check control types
  var isOutputControlsValid = validateControls(cfg.outControls, aTable.actionsTable);
  
  if (!isOutputControlsValid) {
    log.error("One or more controls are not of a valid type");
    return false;
  }
  
  log.debug('Schedule configuration validation successful');
  return true;
};

/**
 * Creates the main cron rule for the schedule
 * @param {ScheduleScenario} self - Reference to the ScheduleScenario instance
 * @param {ScheduleConfig} cfg - Configuration object
 * @returns {boolean} True if rule created successfully, false otherwise
 */
function createCronRule(self, cfg) {
  log.debug('Creating cron rule for schedule scenario');
  
  // Build cron expression: seconds minutes hours * * dayOfWeek
  var cronExpression = buildCronExpression(cfg);
  if (!cronExpression) {
    log.error('Failed to build cron expression');
    return false;
  }
  log.debug('Cron expression built: ' + cronExpression);

  var ruleId = defineRule(self.genNames.ruleMain, {
    when: cron(cronExpression),
    then: function() {
      // Trigger the button press programmatically
      log.debug('Cron triggered, pressing execute button for scenario: ' + self.idPrefix);
      dev[self.genNames.vDevice + "/execute_now"] = true;
    }
  });
  
  if (!ruleId) {
    log.error('Failed to create cron rule');
    return false;
  }
  
  log.debug('Cron rule created successfully with ID: ' + ruleId);
  self.addRule(ruleId);
  
  // Create manual trigger rule for the button
  var manualRuleId = defineRule(self.genNames.ruleManual, {
    whenChanged: [self.genNames.vDevice + "/execute_now"],
    then: function(newValue, devName, cellName) {
      if (newValue) {
        log.debug('Button execution triggered for scenario: ' + self.idPrefix);
        scheduleHandler(self, cfg);
      }
    }
  });
  
  if (!manualRuleId) {
    log.error('Failed to create manual trigger rule');
    return false;
  }
  
  log.debug('Manual trigger rule created successfully');
  self.addRule(manualRuleId);
  
  return true;
}

/**
 * Creates time update rule to monitor system time changes
 * @param {ScheduleScenario} self - Reference to the ScheduleScenario instance
 * @returns {boolean} True if rule created successfully, false otherwise
 */
function createTimeUpdateRule(self) {
  log.debug('Creating time update rule for current time display');
  
  var timeUpdateRuleId = defineRule(self.genNames.ruleTimeUpdate, {
    whenChanged: ["system_time/current_time", "system_time/current_date", "system_time/current_day"],
    then: function(newValue, devName, cellName) {
      var currentTimeText = formatCurrentTime();
      dev[self.genNames.vDevice + "/current_time"] = currentTimeText;
      log.debug('Current time updated: ' + currentTimeText);
    }
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
 * Calculates next execution time based on schedule configuration
 * @param {ScheduleConfig} cfg - Configuration object
 * @returns {Date|null} Next execution date or null if invalid
 */
function getNextExecutionTime(cfg) {
  var now = new Date();
  var currentDay = now.getDay(); // 0=Sunday, 1=Monday, etc.
  
  log.debug('Calculating next execution. Current time: ' + now.toISOString() + ', current day: ' + currentDay);
  log.debug('Schedule: ' + cfg.scheduleTime + ' on days: [' + cfg.scheduleDaysOfWeek.join(', ') + ']');
  
  var dayNameToNumber = {
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6
  };
  
  // Convert scheduleDaysOfWeek array to day numbers and sort
  var scheduledDays = [];
  for (var i = 0; i < cfg.scheduleDaysOfWeek.length; i++) {
    var dayName = cfg.scheduleDaysOfWeek[i];
    if (dayNameToNumber.hasOwnProperty(dayName)) {
      scheduledDays.push(dayNameToNumber[dayName]);
    }
  }
  
  if (scheduledDays.length === 0) {
    log.error('No valid scheduled days found');
    return null;
  }
  
  scheduledDays.sort(function(a, b) { return a - b; });
  log.debug('Scheduled day numbers (sorted): [' + scheduledDays.join(', ') + ']');
  
  // Create potential execution time for today
  var todayExecution = new Date(now.getTime());
  todayExecution.setHours(cfg.hours, cfg.minutes, cfg.seconds, 0);
  
  // Check if we can execute today
  if (scheduledDays.indexOf(currentDay) !== -1 && todayExecution > now) {
    log.debug('Next execution is today: ' + todayExecution.toISOString());
    return todayExecution;
  }
  
  // Find next scheduled day
  var nextDay = null;
  for (var j = 0; j < scheduledDays.length; j++) {
    if (scheduledDays[j] > currentDay) {
      nextDay = scheduledDays[j];
      break;
    }
  }
  
  // If no day found this week, take first day of next week
  if (nextDay === null) {
    nextDay = scheduledDays[0];
  }
  
  log.debug('Next scheduled day number: ' + nextDay);
  
  // Calculate days until next execution
  var daysUntilNext;
  if (nextDay > currentDay) {
    daysUntilNext = nextDay - currentDay;
  } else {
    // Next week
    daysUntilNext = 7 - currentDay + nextDay;
  }
  
  log.debug('Days until next execution: ' + daysUntilNext);
  
  // Create next execution date
  var nextExecution = new Date(now.getTime());
  nextExecution.setDate(nextExecution.getDate() + daysUntilNext);
  nextExecution.setHours(cfg.hours, cfg.minutes, cfg.seconds, 0);
  
  log.debug('Calculated next execution: ' + nextExecution.toISOString());
  return nextExecution;
}

/**
 * Formats current time for display using system time
 * @returns {string} Formatted current time string in format "YYYY-MM-DD HH:MM DayName"
 */
function formatCurrentTime() {
  var currentDate = dev["system_time/current_date"];
  var currentTime = dev["system_time/current_time"];
  var currentDayNum = dev["system_time/current_day"];
  var currentDay = DAY_NAMES[currentDayNum] || 'Unknown';
  
  return currentDay + ' ' + currentDate + ' ' + currentTime;
}

/**
 * Formats date for display
 * @param {Date} date - Date to format
 * @returns {string} Formatted date string in format "YYYY-MM-DD HH:MM DayName"
 */
function formatNextExecution(date) {
  if (!date) {
    return 'Invalid schedule';
  }
  
  var fullDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var dayName = fullDays[date.getDay()];
  
  var day = ('0' + date.getDate()).slice(-2);
  var month = ('0' + (date.getMonth() + 1)).slice(-2);
  var year = date.getFullYear();
  var hours = ('0' + date.getHours()).slice(-2);
  var minutes = ('0' + date.getMinutes()).slice(-2);

  return dayName + ' ' + year + '-' + month + '-' + day + ' ' + hours + ':' + minutes;
}

/**
 * Builds cron expression from configuration
 * @param {ScheduleConfig} cfg - Configuration object
 * @returns {string|null} Cron expression or null if invalid
 */
function buildCronExpression(cfg) {
  // Validate time values
  if (cfg.hours < 0 || cfg.hours > 23) {
    log.error('Invalid hours value: ' + cfg.hours);
    return null;
  }
  if (cfg.minutes < 0 || cfg.minutes > 59) {
    log.error('Invalid minutes value: ' + cfg.minutes);
    return null;
  }
  if (cfg.seconds < 0 || cfg.seconds > 59) {
    log.error('Invalid seconds value: ' + cfg.seconds);
    return null;
  }
  
  // Build day of week string (0=Sunday, 1=Monday, etc.)
  var dayMap = {
    'sunday': '0',
    'monday': '1', 
    'tuesday': '2',
    'wednesday': '3',
    'thursday': '4',
    'friday': '5',
    'saturday': '6'
  };
  
  var daysOfWeek = [];
  for (var i = 0; i < cfg.scheduleDaysOfWeek.length; i++) {
    var dayName = cfg.scheduleDaysOfWeek[i];
    if (dayMap[dayName]) {
      daysOfWeek.push(dayMap[dayName]);
    }
  }
  
  if (daysOfWeek.length === 0) {
    log.error('No valid days of week found');
    return null;
  }
  
  var dayString = daysOfWeek.join(',');
  
  // Format: "seconds minutes hours day_of_month month day_of_week"
  // Use numeric values directly - cron parser handles formatting
  var cronExpr = cfg.seconds + ' ' + cfg.minutes + ' ' + cfg.hours + ' * * ' + dayString;
  return cronExpr;
}

/**
 * Handler for schedule trigger
 * @param {ScheduleScenario} self - Reference to the ScheduleScenario instance
 * @param {ScheduleConfig} cfg - Configuration object
 */
function scheduleHandler(self, cfg) {
  log.debug('Schedule triggered for scenario: ' + self.idPrefix);
  
  var isActive = dev[self.genNames.vDevice + "/rule_enabled"];
  if (!isActive) {
    log.debug('Scenario is disabled, skipping actions');
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
      var newCtrlValue = aTable.actionsTable[curUserAction].handler(actualValue, curActionValue);
      
      log.debug("Control " + curCtrlName + " will be updated to state: " + newCtrlValue);
      dev[curCtrlName] = newCtrlValue;
      log.debug("Control " + curCtrlName + " successfully updated");
    } catch (error) {
      log.error("Failed to update control " + curCtrlName + ": " + (error.message || error));
    }
  }
  
  // Update next execution time display
  var nextExecution = getNextExecutionTime(cfg);
  var nextExecutionText = formatNextExecution(nextExecution);
  dev[self.genNames.vDevice + "/next_execution"] = nextExecutionText;
  
  log.debug("Schedule actions completed for scenario: " + self.idPrefix);
}



/**
 * Scenario initialization
 * @param {string} deviceTitle - Virtual device title
 * @param {ScheduleConfig} cfg - Configuration object
 * @returns {boolean} True if initialization succeeded
 */
ScheduleScenario.prototype.initSpecific = function (deviceTitle, cfg) {
  log.debug('Start init schedule scenario');
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
      ru: 'Выполнить сейчас'
    },
    type: 'pushbutton',
    order: 2
  });
  
  // Add current time display control
  var currentTimeText = formatCurrentTime();
  this.vd.devObj.addControl('current_time', {
    title: {
      en: 'Current time',
      ru: 'Текущее время'
    },
    type: 'text',
    value: currentTimeText,
    forceDefault: true, // Always must start from enabled state
    readonly: true,
    order: 3
  });
  
  // Add next execution time display control
  var nextExecution = getNextExecutionTime(cfg);
  var nextExecutionText = formatNextExecution(nextExecution);
  this.vd.devObj.addControl('next_execution', {
    title: {
      en: 'Next execution',
      ru: 'Следующее выполнение'
    },
    type: 'text',
    value: nextExecutionText,
    forceDefault: true, // Always must start from enabled state
    readonly: true,
    order: 4
  });
  
  log.debug('Start cron rule creation');
  var ruleCreated = createCronRule(this, cfg);
  
  if (!ruleCreated) {
    this.setState(ScenarioState.ERROR);
    return false;
  }
  
  log.debug('Start time update rule creation');
  var timeRuleCreated = createTimeUpdateRule(this);
  
  if (!timeRuleCreated) {
    this.setState(ScenarioState.ERROR);
    return false;
  }
  
  this.setState(ScenarioState.NORMAL);
  log.debug('Schedule scenario initialized successfully');
  return true;
};

exports.ScheduleScenario = ScheduleScenario;