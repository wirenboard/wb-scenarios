/**
 * @file schedule.mod.js - ES5 module for wb-rules v2.34
 * @description Schedule scenario class that extends ScenarioBase
 * @author Ivan Praulov <ivan.praulov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState = require('virtual-device-helpers.mod').ScenarioState;
var Logger = require('logger.mod').Logger;

var aTable = require("schedule-table-handling-actions.mod");

var loggerFileLabel = 'WBSC-schedule-mod';
var log = new Logger(loggerFileLabel);

/**
 * @typedef {Object} ScheduleConfig
 * @property {string} [idPrefix] - Optional prefix for scenario identification
 *   If not provided, it will be generated from the scenario name
 * @property {number} hours - Hour to trigger (0-23)
 * @property {number} minutes - Minute to trigger (0-59) 
 * @property {number} seconds - Second to trigger (0-59)
 * @property {Object} weekDays - Days of week to trigger
 *   - monday: boolean
 *   - tuesday: boolean
 *   - wednesday: boolean
 *   - thursday: boolean
 *   - friday: boolean
 *   - saturday: boolean
 *   - sunday: boolean
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
 * Configuration validation
 * @param {ScheduleConfig} cfg - Configuration object
 * @returns {boolean} True if configuration is valid, false otherwise
 */
ScheduleScenario.prototype.validateCfg = function(cfg) {
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
  
  // Check weekDays object
  if (!cfg.weekDays || typeof cfg.weekDays !== 'object') {
    log.error('Schedule validation error: weekDays must be an object');
    return false;
  }
  
  // Check that at least one day is enabled
  var weekDaysArray = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  var hasEnabledDay = false;
  for (var i = 0; i < weekDaysArray.length; i++) {
    var day = weekDaysArray[i];
    if (typeof cfg.weekDays[day] !== 'boolean') {
      log.error('Schedule validation error: weekDays.' + day + ' must be a boolean');
      return false;
    }
    if (cfg.weekDays[day]) {
      hasEnabledDay = true;
    }
  }
  
  if (!hasEnabledDay) {
    log.error('Schedule validation error: at least one day of the week must be enabled');
    return false;
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
 * @returns {boolean} True if rule creation succeeded
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
  log.info('Created cron expression: "' + cronExpression + '" for scenario: ' + self.idPrefix);

  var ruleId = defineRule(self.genNames.ruleMain, {
    when: cron(cronExpression),
    then: function() {
      scheduleHandler(self, cfg);
    }
  });
  
  if (!ruleId) {
    log.error('Failed to create cron rule');
    return false;
  }
  
  log.debug('Cron rule created successfully with ID: ' + ruleId);
  self.addRule(ruleId);
  return true;
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
  var daysOfWeek = [];
  if (cfg.weekDays.sunday) daysOfWeek.push('0');
  if (cfg.weekDays.monday) daysOfWeek.push('1');
  if (cfg.weekDays.tuesday) daysOfWeek.push('2');
  if (cfg.weekDays.wednesday) daysOfWeek.push('3');
  if (cfg.weekDays.thursday) daysOfWeek.push('4');
  if (cfg.weekDays.friday) daysOfWeek.push('5');
  if (cfg.weekDays.saturday) daysOfWeek.push('6');
  
  if (daysOfWeek.length === 0) {
    log.error('No days of week selected');
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
  
  log.debug('Start cron rule creation');
  var ruleCreated = createCronRule(this, cfg);
  
  if (!ruleCreated) {
    this.setState(ScenarioState.ERROR);
    return false;
  }
  
  this.setState(ScenarioState.NORMAL);
  log.debug('Schedule scenario initialized successfully');
  return true;
};

exports.ScheduleScenario = ScheduleScenario;