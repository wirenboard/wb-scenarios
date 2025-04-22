/**
 * @file wbsc-scenario-base.mod.js - ES5 module for wb-rules v2.28
 * @description Minimal abstract base class for all WB‑rules scenarios
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 */

var getIdPrefix = require('scenarios-general-helpers.mod').getIdPrefix;
var createBasicVd = require('virtual-device-helpers.mod').createBasicVd;
var Logger = require('logger.mod').Logger;

var loggerFileLabel = 'WBSC‑base-mod';
var log = new Logger(loggerFileLabel);

/**
 * Scenario state enum - defines all possible scenario states
 * Used for setting and checking scenario state in the virtual device
 * @enum {number}
 */
var ScenarioState = {
  CREATED: 0,
  INIT_STARTED: 1,
  WAITING_CONTROLS: 2,
  LINKED_CONTROLS_READY: 3,
  CONFIG_INVALID: 4,
  LINKED_CONTROLS_TIMEOUT: 5,
  NORMAL: 6
};

/**
 * Abstract base class for all scenarios
 * This class provides core functionality that all scenarios should inherit
 * 
 * @abstract Should not be instantiated directly, only extended by child
 * @constructor
 */
function ScenarioBase() {
  if (this.constructor === ScenarioBase) {
    throw new Error('ScenarioBase is abstract class – extend it by child');
  }

  /**
   * Human-readable name of the scenario
   * @type {string|null}
   */
  this.name = null;

  /**
   * Configuration object for the scenario
   * @type {Object|null}
   */
  this.cfg = null;

  /**
   * Prefix for all IDs generated within this scenario
   * Used for virtual devices, rules, etc.
   * Generate default by 'translit(name)' or 'cfg.idPrefix' if set by user
   * @type {string|null}
   */
  this.idPrefix = null;

  /**
   * Collection of generated unique names/IDs
   * @type {Object|null}
   * @property {string} vdId - Virtual device ID
   * @property {Array<string>} ruleIds - Rule IDs
   */
  this.genNames    = null;  // generated names (vd‑id, rule‑id’s …)


  /**
   * Enhanced virtual device object with additional methods and properties
   * @type {Object|null}
   * @property {Function} setTotalError - Set error state with message on the device
   * @property {Object} devObj - Reference to the actual device object
   */
  this.vd = null;

  /**
   * Collection of rule IDs for management
   * @type {Array<number>}
   * @private
   */
  this._rules = [];
}

/**
 * Get current state of the scenario
 * @returns {number} Current state code from ScenarioState enum
 */
ScenarioBase.prototype.getState = function() {
  if (this.vd && this.vd.devObj) {
    return this.vd.devObj.getControl('state').getValue();
  }
  return ScenarioState.INIT_STARTED; // Default state
};

/**
 * Sets the state of the scenario in the virtual device
 * @param {number} stateCode - State code from ScenarioState enum
 * @returns {boolean} True if state was set successfully
 */
ScenarioBase.prototype.setState = function(stateCode) {
  var valid = false;
  for (var key in ScenarioState) {
      if (ScenarioState[key] === stateCode) {
          valid = true;
          break;
      }
  }
  if (!valid) {
      throw new Error('Invalid scenario state: ' + stateCode);
  }

  if (this.vd && this.vd.devObj) {
    try {
      this.vd.devObj.getControl('state').setValue(stateCode);
      return true;
    } catch (e) {
      log.error('Failed to set state: {}', e.message);
      return false;
    }
  }
  return false;
};

/**
 * Initialize the scenario with name and configuration
 * 
 * @note This is single entry point called by user code.
 *       Do not override unless you really need.
 * @param {string} name - Scenario title / virtual‑device title
 * @param {Object} cfg - Raw configuration object supplied by user
 * @returns {boolean} Initialisation result
 *   - True on success
 *   - Throws on error
 */
ScenarioBase.prototype.init = function(name, cfg) {
  if (this.getState() !== ScenarioState.CREATED) {
    throw new Error('Scenario was already launched earlier');
  }

  this.name = name;
  this.cfg = cfg;
  this.idPrefix = getIdPrefix(name, cfg);
  log.setLabel(loggerFileLabel + '/' + this.idPrefix);

  if (this.generateNames === ScenarioBase.prototype.generateNames) {
    throw new Error('generateNames() must be implemented in subclass');
  }
  if (this.validateCfg === ScenarioBase.prototype.validateCfg) {
    throw new Error('validateCfg() must be implemented in subclass');
  }
  if (this.initSpecific === ScenarioBase.prototype.initSpecific) {
    throw new Error('initSpecific(cfg) must be implemented in subclass');
  }

  this.genNames = this.generateNames(this.idPrefix);
  
  var devObj = createBasicVd(this.genNames.vDevice, this.name, this._rules);
  if (!devObj) {
    throw new Error('Basic VD creation failed');
  }

  this.vd = {
    devObj: devObj,
    setTotalError: function (errorMsg) {
      if (!this.devObj) {
        log.error('VD does not exist in the system or devObj not defined');
        return;
      }
  
      log.error(errorMsg);
      var controls = this.devObj.controlsList();
      for (var i = 0; i < controls.length; i++) {
        /**
         * Our goal - is to highlight the control in red
         * The error type:
         * - Can be any type 'r', 'w' (select 'r' randomly)
         * - Not use 'p' — it does not produce a visible red highlight in UI
         */
        controls[i].setError('r');
      }
    }
  };
  this.setState(ScenarioState.INIT_STARTED);

  if (this.validateCfg(cfg) !== true) {
    this.vd.setTotalError('Config validation failed');
    this.setState(ScenarioState.CONFIG_INVALID);
    throw new Error('Config validation failed "' + this.name + '"');
  }
  log.debug('All checks pass successfuly!');

  var ok = this.initSpecific(name, cfg);
  if (ok === false) {
    this.vd.setTotalError('initSpecific() returned false');
    throw new Error('initSpecific() returned false');
  }

  // TODO:(vg) write optional wait topics and call initAfterWait()
  //           if we need wait - _initialized must be set after wait?

  this.setState(ScenarioState.NORMAL);
  log.info('Scenario "{}" initialized successfully', this.name);
  return true;
};

/**
 * Convenience wrapper to collect rule IDs created inside subclasses.
 *
 * @param {number} id - ID from defineRule
 */
ScenarioBase.prototype.addRule = function (id) {
  this._rules.push(id);
};

/**
 * Enables all rules of the scenario
 */
ScenarioBase.prototype.enable = function () {
  if (this.vd && this.vd.devObj) {
    var ctrl = this.vd.devObj.getControl('rule_enabled');
    if (ctrl) ctrl.setValue(true);
  }
};

/**
 * Disables all rules of the scenario
 */
ScenarioBase.prototype.disable = function () {
  if (this.vd && this.vd.devObj) {
    var ctrl = this.vd.devObj.getControl('rule_enabled');
    if (ctrl) ctrl.setValue(false);
  }
};

/* ------------------------------------------------------------------ */
/*        Abstract methods stubs — MUST be overridden                 */
/* ------------------------------------------------------------------ */

/**
 * Generates map object with names (VD ID, rule IDs, etc.)
 * @abstract
 * @param {string} idPrefix - Transliteration of scenario title
 * @returns {Object}
 */
ScenarioBase.prototype.generateNames = function () {
    throw new Error('generateNames() must be overridden by derived class');
};

/**
 * Validates the configuration object before call {@link initSpecific()}
 *
 * @abstract
 * @param   {Object} cfg  Raw configuration
 * @returns {boolean} True if configuration is acceptable
 */
ScenarioBase.prototype.validateCfg = function () {
  throw new Error('validateCfg() must be overridden by derived class');
  // If all OK - must return - true
};


/**
 * Initializes custom scenario logic, rules, timers, etc
 * Must be implemented in subclass
 * Use {@link addRule} to store rule IDs if you need later clean‑up
 * 
 * @abstract
 * @param {string} name - Scenario name
 * @param {Object} cfg - Configuration object
 * @returns {boolean} True if initialized successfully, false if not
 */
ScenarioBase.prototype.initSpecific = function () {
  throw new Error('initSpecific() must be overridden by derived class');
};

exports.ScenarioState = ScenarioState;
exports.ScenarioBase = ScenarioBase;
