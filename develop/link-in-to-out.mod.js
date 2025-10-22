/**
 * @file link-in-to-out.mod.js
 * @description Module for initializing link-in-to-out algorithm
 *     based on user-specified parameters
 *
 * @author Ivan Ivanov <ivan.ivanov@wirenboard.com>           //@todo:Change 1
 * @link JSDoc format comments <https://jsdoc.app/>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState = require('virtual-device-helpers.mod').ScenarioState;
var Logger = require('logger.mod').Logger;

var loggerFileLabel = 'WBSC-link-in-to-out-mod';
var log = new Logger(loggerFileLabel);

/**
 * Scenario class for linking input to output
 * @constructor
 */
function LinkInToOutScenario() {
  ScenarioBase.call(this);
  
  // Store scenario parameters
  this.inControl = null;
  this.outControl = null;
  this.inverseLink = false;
}

// Inherit from ScenarioBase
LinkInToOutScenario.prototype = Object.create(ScenarioBase.prototype);
LinkInToOutScenario.prototype.constructor = LinkInToOutScenario;

/**
 * Generates identifier names for virtual device and rules
 * @param {string} idPrefix - ID prefix for this scenario instance
 * @returns {Object} Generated names
 */
LinkInToOutScenario.prototype.generateNames = function(idPrefix) {
  var scenarioPrefix = 'wbsc_';
  var baseRuleName = scenarioPrefix + idPrefix + '_';

  return {
    vDevice: scenarioPrefix + idPrefix,
    ruleInputChange: baseRuleName + 'inputChange',
  };
};

/**
 * Configuration validation
 * @param {Object} cfg - Scenario configuration
 * @returns {boolean} True if configuration is valid
 */
LinkInToOutScenario.prototype.validateCfg = function(cfg) {
  if (!cfg.inControl || typeof cfg.inControl !== 'string') {
    log.error('Invalid inControl configuration');
    return false;
  }
  
  if (!cfg.outControl || typeof cfg.outControl !== 'string') {
    log.error('Invalid outControl configuration');
    return false;
  }
  
  return true;
};

/**
 * Get controls wait configuration
 * @param {Object} cfg - Scenario configuration
 * @returns {Object} Wait configuration
 */
LinkInToOutScenario.prototype.defineControlsWaitConfig = function(cfg) {
  return {
    controls: [cfg.inControl, cfg.outControl]
  };
};

/**
 * Add custom controls to virtual device
 * @param {Object} cfg - Scenario configuration
 */
LinkInToOutScenario.prototype.addCustomControlsToVirtualDevice = function(cfg) {
  // Base controls are already added in ScenarioBase
  // Here you can add scenario-specific controls
};

/**
 * Create scenario rules
 * @param {Object} cfg - Scenario configuration
 * @returns {boolean} True if all rules created successfully
 */
function createRules(self, cfg) {
  var gName = self.genNames;
  
  // Rule to track input control changes
  var ruleId = defineRule(gName.ruleInputChange, {
    whenChanged: [cfg.inControl],
    then: function(newValue, devName, cellName) {
      handleInputChange(self, newValue, devName, cellName);
    }
  });
  
  if (!ruleId) {
    log.error('Failed to create input change rule');
    return false;
  }
  
  log.debug('Input change rule created successfully');
  self.addRule(ruleId);
  return true;
}

/**
 * Input control change handler
 * @param {Object} self - Reference to LinkInToOutScenario instance
 * @param {*} newValue New value
 * @param {string} devName Device name
 * @param {string} cellName Control name
 */
function handleInputChange(self, newValue, devName, cellName) {
  // Check scenario state
  var currentState = self.getState();
  if (currentState !== ScenarioState.NORMAL) {
    log.debug('Scenario is not in NORMAL state ({}), ignoring input change', currentState);
    return;
  }
  
  log.debug('Input changed: ' + newValue);
  
  // Apply inversion logic
  var outputValue = self.inverseLink ? !newValue : newValue;
  
  // Check that output control is defined
  if (!self.outControl) {
    log.error('Output control is not defined');
    return;
  }
  
  // Set value to output control
  dev[self.outControl] = outputValue;
  
  log.debug('Output set to: ' + outputValue);
}

/**
 * Specific scenario initialization
 * @param {string} deviceTitle Virtual device title
 * @param {Object} cfg Scenario configuration
 * @returns {boolean} True on successful initialization
 */
LinkInToOutScenario.prototype.initSpecific = function(deviceTitle, cfg) {
  log.debug('Start init link-in-to-out scenario');
  log.setLabel(loggerFileLabel + '/' + this.idPrefix);
  
  // Store parameters
  this.inControl = cfg.inControl;
  this.outControl = cfg.outControl;
  this.inverseLink = cfg.inverseLink || false;
  
  // Add custom controls to virtual device
  this.addCustomControlsToVirtualDevice(cfg);
  
  // Create rules
  log.debug('Start rules creation');
  var rulesCreated = createRules(this, cfg);
  
  this.setState(ScenarioState.NORMAL);
  log.debug('Link-in-to-out scenario initialized successfully');
  return rulesCreated;
};

exports.LinkInToOutScenario = LinkInToOutScenario;