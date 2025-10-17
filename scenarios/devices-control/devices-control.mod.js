/**
 * @file devices-control.mod.js - ES5 module for wb-rules v2.34
 * @description Input-Output link scenario class that extends ScenarioBase
 *              Module for initializing connections between multiple input and output
 *              MQTT topics. Supported control types see in tables:
 *                - eTable
 *                - aTable
 *              When any input topic changes according to configured
 *              event - all output topics change state according
 *              to configured action
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState = require('virtual-device-helpers.mod').ScenarioState;
var Logger = require('logger.mod').Logger;

var eTable = require("table-handling-events.mod");
var aTable = require("table-handling-actions.mod");
var hasCriticalErr = require('wbsc-wait-controls.mod').hasCriticalErr;

var loggerFileLabel = 'WBSC-input-output-link-mod';
var log = new Logger(loggerFileLabel);

/**
 * @typedef {Object} DevicesControlConfig
 * @property {string} [idPrefix] - Optional prefix for scenario identification
 *   If not provided, it will be generated from the scenario name
 * @property {Array<Object>} inControls - Array of input controls to monitor
 *   Each object contains:
 *   - control: Control name ('device/control')
 *   - behaviorType: Event type to catch (whenChange, whenEnabled, etc.)
 * @property {Array<Object>} outControls - Array of output controls to change
 *   Each object contains:
 *   - control: Control name ('device/control')
 *   - behaviorType: Action type (setEnable, setDisable, setValue, etc.)
 *   - actionValue: Value to set (relevant for setValue)
 */

/**
 * Input-Output link scenario implementation
 * @class DevicesControlScenario
 * @extends ScenarioBase
 */
function DevicesControlScenario() {
  ScenarioBase.call(this);
  
  /**
   * Context object for storing scenario runtime state
   * @type {Object}
   */
  this.ctx = {
    errorTimers: {}, // Timers for error handling debounce
    errorCheckTimeoutMs: 10000 // 10s debounce time for errors
  };
}
DevicesControlScenario.prototype = Object.create(ScenarioBase.prototype);
DevicesControlScenario.prototype.constructor = DevicesControlScenario;

/**
 * Generates name identifiers for virtual device and rules
 * @param {string} idPrefix - ID prefix for this scenario instance
 * @returns {Object} Generated names
 */
DevicesControlScenario.prototype.generateNames = function(idPrefix) {
  var scenarioPrefix = 'wbsc_';
  var baseRuleName = scenarioPrefix + idPrefix + '_';
  
  return {
    vDevice: scenarioPrefix + idPrefix,
    ruleMain: baseRuleName + 'mainRule',
    ruleInputErrorsBase: baseRuleName + 'input_error_',
    ruleOutputErrorsBase: baseRuleName + 'output_error_',
  };
};

/**
 * Get configuration for waiting for controls
 * @param {Object} cfg - Configuration object
 * @returns {Object} Waiting configuration object
 */
DevicesControlScenario.prototype.defineControlsWaitConfig = function (cfg) {
  var allTopics = [];
  
  // Extract input control names
  for (var i = 0; i < (cfg.inControls || []).length; i++) {
    if (cfg.inControls[i].control) {
      allTopics.push(cfg.inControls[i].control);
    }
  }
  
  // Extract output control names
  for (var j = 0; j < (cfg.outControls || []).length; j++) {
    if (cfg.outControls[j].control) {
      allTopics.push(cfg.outControls[j].control);
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
  /* If req types in table empty - may use any control type */
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
 * @param {DevicesControlConfig} cfg - Configuration object
 * @returns {boolean} True if configuration is valid, false otherwise
 */
DevicesControlScenario.prototype.validateCfg = function(cfg) {
  // Check for array presence
  if (!Array.isArray(cfg.inControls) || !Array.isArray(cfg.outControls)) {
    log.error('Input-output link initialization error: cfg.inControls and cfg.outControls must be arrays');
    return false;
  }
  
  // Check that there is at least one input and output
  if (cfg.inControls.length === 0) {
    log.error('Input-output link initialization error: no input controls specified');
    return false;
  }
  if (cfg.outControls.length === 0) {
    log.error('Input-output link initialization error: no output controls specified');
    return false;
  }
  
  // Check control types
  var isInputControlsValid = validateControls(cfg.inControls, eTable.eventsTable);
  var isOutputControlsValid = validateControls(cfg.outControls, aTable.actionsTable);
  
  if (!isInputControlsValid || !isOutputControlsValid) {
    log.error("One or more controls are not of a valid type");
    return false;
  }
  
  log.debug("All controls have valid types");
  return true;
};

/**
 * Updates the readonly state of the rule enable control
 * Removes readonly only when all errors (input and output controls) are cleared
 * @param {Object} vdCtrlEnable - Control "Enable rules" in scenario virtual dev
 * @param {DevicesControlConfig} cfg - Configuration parameters
 */
function tryClearReadonly(vdCtrlEnable, cfg) {
  var hasAnyError = false;
  
  // Check input controls for errors
  for (var i = 0; i < cfg.inControls.length; i++) {
    if (hasCriticalErr(dev[cfg.inControls[i].control + '#error'])) {
      hasAnyError = true;
      break;
    }
  }
  
  // Check output controls for errors if no input errors found
  if (!hasAnyError) {
    for (var j = 0; j < cfg.outControls.length; j++) {
      if (hasCriticalErr(dev[cfg.outControls[j].control + '#error'])) {
        hasAnyError = true;
        break;
      }
    }
  }
  
  if (!hasAnyError) {
    vdCtrlEnable.setReadonly(false);
  }
}

/**
 * Creates an error handling rule for a control
 * @param {Object} self - Reference to the DevicesControlScenario instance
 * @param {string} ruleName - The name of the rule to be created
 * @param {string} sourceErrTopic - The MQTT topic where error events published
 * @param {Object} vdCtrlEnable - Control "Enable rules" in scenario virtual dev
 * @param {DevicesControlConfig} cfg - Configuration parameters
 * @returns {boolean} True if rule created successfully
 */
function createErrChangeRule(
  self,
  ruleName,
  sourceErrTopic,
  vdCtrlEnable,
  cfg
) {
  var ruleCfg = {
    whenChanged: [sourceErrTopic],
    then: function (newValue, devName, cellName) {
      if (!hasCriticalErr(newValue)) {
        log.debug(
          'Error cleared or non-critical error detected for topic "{}". New state: "{}"',
          sourceErrTopic,
          newValue
        );
        tryClearReadonly(vdCtrlEnable, cfg);
        self.setState(ScenarioState.NORMAL);

        // If on this topic was running timer - disable this timer
        if (self.ctx.errorTimers[sourceErrTopic]) {
          clearTimeout(self.ctx.errorTimers[sourceErrTopic]);
          self.ctx.errorTimers[sourceErrTopic] = null;
          log.debug(
            'Debounce timer for error for topic "{}" disabled',
            sourceErrTopic
          );
        }
        return;
      }

      log.warning(
        'Get critical error (r/w) for topic "{}". New error state: "{}"',
        sourceErrTopic,
        newValue
      );

      // Create new timer only if not have running already
      if (self.ctx.errorTimers[sourceErrTopic]) {
        return;
      }

      self.ctx.errorTimers[sourceErrTopic] = setTimeout(function () {
        // When timer stop - check still critical errors r/w
        var currentErrorVal = dev[sourceErrTopic];
        if (hasCriticalErr(currentErrorVal)) {
          log.error(
            'Scenario disabled: critical error (r/w) for topic "{}" not cleared for {} ms. Current error state: "{}"',
            sourceErrTopic,
            self.ctx.errorCheckTimeoutMs,
            currentErrorVal
          );
          self.setState(ScenarioState.USED_CONTROL_ERROR);
          vdCtrlEnable.setReadonly(true);
          vdCtrlEnable.setValue(false);
        } else {
          log.debug(
            'Error in topic "{}" cleared before timer disabled. Scenario still running.',
            sourceErrTopic
          );
        }
        self.ctx.errorTimers[sourceErrTopic] = null;
      }, self.ctx.errorCheckTimeoutMs);
    },
  };

  var ruleId = defineRule(ruleName, ruleCfg);
  return ruleId;
}

/**
 * Creates all required rules for the InputOutputLink scenario
 * @param {Object} self - Reference to the DevicesControlScenario instance
 * @param {Object} cfg - Configuration object
 * @returns {boolean} True if rule created successfully
 */
function createRules(self, cfg) {
  // Extract control names for the rule
  var inControlNames = [];
  for (var i = 0; i < self.cfg.inControls.length; i++) {
    inControlNames.push(self.cfg.inControls[i].control);
  }
  
  var ruleId = defineRule(self.genNames.ruleMain, {
    whenChanged: inControlNames,
    then: function(newValue, devName, cellName) {
      inputChangeHandler(self, newValue, devName, cellName);
    }
  });
  
  if (!ruleId) {
    log.error('Failed to create main rule');
    return false;
  }
  
  log.debug('Main rule created successfully with ID: ' + ruleId);
  self.addRule(ruleId);
  
  // Create error handling rules for input controls
  var vdCtrlEnable = self.vd.devObj.getControl('rule_enabled');
  
  for (var j = 0; j < cfg.inControls.length; j++) {
    var inControlErrTopic = cfg.inControls[j].control + '#error';
    var inErrRuleName = self.genNames.ruleInputErrorsBase + j;
    
    ruleId = createErrChangeRule(
      self,
      inErrRuleName,
      inControlErrTopic,
      vdCtrlEnable,
      cfg
    );
    if (!ruleId) {
      log.error('Failed to create input control error handling rule for: {}', cfg.inControls[j].control);
      return false;
    }
    log.debug('Input control error handling rule created with ID="{}"', ruleId);
  }
  
  // Create error handling rules for output controls
  for (var k = 0; k < cfg.outControls.length; k++) {
    var outControlErrTopic = cfg.outControls[k].control + '#error';
    var outErrRuleName = self.genNames.ruleOutputErrorsBase + k;
    
    ruleId = createErrChangeRule(
      self,
      outErrRuleName,
      outControlErrTopic,
      vdCtrlEnable,
      cfg
    );
    if (!ruleId) {
      log.error('Failed to create output control error handling rule for: {}', cfg.outControls[k].control);
      return false;
    }
    log.debug('Output control error handling rule created with ID="{}"', ruleId);
  }
  
  return true;
}

/**
 * Handler for input control changes
 * @param {Object} self - Reference to the DevicesControlScenario instance
 * @param {any} newValue - New value of the input control
 * @param {string} devName - Device name
 * @param {string} cellName - Cell name
 */
function inputChangeHandler(self, newValue, devName, cellName) {
  log.debug('Input control changed: ' + devName + '/' + cellName + ' = ' + newValue);
  var isActive = dev[self.genNames.vDevice + "/rule_enabled"];
  if (!isActive) {
    // OK: Scenario with correct config, but disabled
    log.debug('Scenario is disabled, skipping action');
    return true;
  }
  
  var controlFullName = devName + '/' + cellName;
  var matchedInControl = null;
  
  // Find the control that triggered the change, get the monitored event type
  for (var i = 0; i < self.cfg.inControls.length; i++) {
    if (self.cfg.inControls[i].control === controlFullName) {
      matchedInControl = self.cfg.inControls[i];
      break;
    }
  }
  if (!matchedInControl) {
    log.debug('No matching input control found for: ' + controlFullName);
    return;
  }
  var eventType = matchedInControl.behaviorType;
  
  // Check the configured trigger condition
  // @note: For "whenChange" we always continue
  if (!eTable.eventsTable[eventType].handler(newValue)) {
    log.debug('Event condition not met for behaviorType: ' + eventType);
    return;
  }
  
  // Execute actions on output controls
  // No complex checks as we validated everything during initialization
  for (var j = 0; j < self.cfg.outControls.length; j++) {
    var curCtrlName = self.cfg.outControls[j].control;
    var curUserAction = self.cfg.outControls[j].behaviorType;
    var curActionValue = self.cfg.outControls[j].actionValue;
    var actualValue = dev[curCtrlName];
    var newCtrlValue = aTable.actionsTable[curUserAction].handler(actualValue, curActionValue);
    
    log.debug("Control " + curCtrlName + " will updated to state: " + newCtrlValue);
    dev[curCtrlName] = newCtrlValue;
    log.debug("Control " + curCtrlName + " successfull updated");
  }
  
  log.debug("Output controls updated for scenario: " + self.idPrefix);
}

/**
 * Scenario initialization
 * @param {string} deviceTitle - Virtual device title
 * @param {DevicesControlConfig} cfg - Configuration object
 * @returns {boolean} True if initialization succeeded
 */
DevicesControlScenario.prototype.initSpecific = function (deviceTitle, cfg) {
  log.debug('Start init input-output link scenario');
  log.setLabel(loggerFileLabel + '/' + this.idPrefix);
  
  // Virtual device already created by base class
  // Additional controls can be added here if needed
  
  log.debug('Start all required rules creation');
  var ruleCreated = createRules(this, cfg);

  this.setState(ScenarioState.NORMAL);
  log.debug('Input-output link scenario initialized successfully');
  return ruleCreated;
};

exports.DevicesControlScenario = DevicesControlScenario;
