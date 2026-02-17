/**
 * @file wbsc-scenario-base.mod.js - ES5 module for wb-rules v2.28
 * @description Minimal abstract base class for all WB‑rules scenarios
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 */

var scenarioPersistentStorage = require("wbsc-persistent-storage.mod").getInstance();
var getIdPrefix = require('scenarios-general-helpers.mod').getIdPrefix;
var createBasicVd = require('virtual-device-helpers.mod').createBasicVd;
var ScenarioState = require('virtual-device-helpers.mod').ScenarioState;
var WAIT_DEF = require('wbsc-wait-controls.mod').WAIT_DEF;
var waitControls = require('wbsc-wait-controls.mod').waitControls;
var Logger = require('logger.mod').Logger;

var loggerFileLabel = 'WBSC‑base-mod';
var log = new Logger(loggerFileLabel);

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
  this.genNames = null; // generated names (vd‑id, rule‑id’s …)

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

  /**
   * Context object for storing scenario-specific runtime variables
   * @type {Object}
   */
  this.ctx = {};

  /**
   * Reference to the singleton class for working with the persistent storage
   * @type {Object}
   */
  this._ps = null;
}

/**
 * Get current state of the scenario from the virtual device
 * @returns {number|null} Scenario state:
 *   - Code from ScenarioState base VD enum control
 *   - Or null if VD/control is not initialized yet
 */
ScenarioBase.prototype.getState = function () {
  if (!this.vd || !this.vd.devObj) {
    return null;
  }

  return this.vd.devObj.getControl('state').getValue();
};

/**
 * Sets the state of the scenario in the virtual device
 * @param {number} stateCode - State code from ScenarioState enum
 * @returns {boolean} True if state was set successfully
 */
ScenarioBase.prototype.setState = function (stateCode) {
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
ScenarioBase.prototype.init = function (name, cfg) {
  if (this.getState() !== null) {
    throw new Error('Scenario was already launched earlier');
  }

  this.name = name;
  this.cfg = cfg;
  this._ps = scenarioPersistentStorage;
  this.idPrefix = getIdPrefix(name, cfg);
  log.setLabel(loggerFileLabel + '/' + this.idPrefix);

  if (this.generateNames === ScenarioBase.prototype.generateNames) {
    throw new Error('generateNames() must be implemented in subclass');
  }
  if (this.validateCfg === ScenarioBase.prototype.validateCfg) {
    throw new Error('validateCfg() must be implemented in subclass');
  }
  if (this.initSpecific === ScenarioBase.prototype.initSpecific) {
    throw new Error('initSpecific() must be implemented in subclass');
  }

  this.genNames = this.generateNames(this.idPrefix);

  // TODO (Valerii) Need refactor for OOP
  var devObj = createBasicVd(this.idPrefix, this.genNames.vDevice, this.name, this._rules);
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
    },
  };
  this.setState(ScenarioState.INIT_STARTED);

  var waitConfig = this.defineControlsWaitConfig(cfg);
  var isNeedWaitControls = waitConfig.controls && waitConfig.controls.length > 0;
  if (isNeedWaitControls) {
    log.debug('Waiting for {} controls to be ready', waitConfig.controls.length);
    this.setState(ScenarioState.WAITING_CONTROLS);

    var self = this;
    var controlsOptions = {};
    if (typeof waitConfig.timeout !== 'undefined') {
      controlsOptions.timeout = waitConfig.timeout;
    }
    if (typeof waitConfig.period !== 'undefined') {
      controlsOptions.period = waitConfig.period;
    }

    waitControls(
      waitConfig.controls,
      controlsOptions,
      function(err) {
        if (err) {
          log.error('Controls not ready within timeout: {}', err.notReadyCtrlList.join(', '));
          self.setState(ScenarioState.LINKED_CONTROLS_TIMEOUT);
          self.vd.setTotalError('Linked controls not ready in ' + 
                              ((waitConfig.timeout || WAIT_DEF.CONTROLS_WAIT_TIMEOUT_MS) / 1000) + 's: ' + 
                              err.notReadyCtrlList.join(', '));

          self.disable();
          return;
        }
        self.setState(ScenarioState.LINKED_CONTROLS_READY);
        self._continueInitAfterControlsReady();
      }
    );
    return true; // Return from init() - continuation will happen in callback
  } else {
    log.debug('No controls to wait for, continue immediately');
    return this._continueInitAfterControlsReady();
  }
};


/**
 * Continue initialization after controls are ready
 * @private
 * @returns {boolean} True if initialization succeeds
 */
ScenarioBase.prototype._continueInitAfterControlsReady = function() {
  if (this.validateCfg(this.cfg) !== true) {
    this.setState(ScenarioState.CONFIG_INVALID);
    this.disable();

    var errMsg = 'Config validation failed for scenario: "' + this.name + '"';
    this.vd.setTotalError(errMsg);
    throw new Error(errMsg);
  }
  log.debug('Configuration validation passed successfully!');
  
  var ok = this.initSpecific(this.name, this.cfg);
  if (ok === false) {
    this.disable();

    var errMsg = 'Specific scenario initialization failed';
    this.vd.setTotalError(errMsg);
    throw new Error(errMsg);
  }

  this._setScenarioEnableStatusFromStorage()

  log.info('Scenario "{}" base initialization completed', this.name);
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

/**
 * Get the user setting value from storage
 * @param {string} key Setting name
 * @param {any} [defaultValue] Value to return if key not found
 * @returns {any} Stored value or default
 */
ScenarioBase.prototype.getPsUserSetting = function (key, defaultValue) {
  if (!this._ps) {
    return defaultValue;
  }

  return this._ps.getUserSetting(this.idPrefix, key, defaultValue);
};

/**
 * Set the user setting value to storage
 * @param {string} key Setting name
 * @param {any} value Value to store
 * @returns {void}
 */
ScenarioBase.prototype.setPsUserSetting = function (key, value) {
  if (!this._ps) {
    return;
  }

  return this._ps.setUserSetting(this.idPrefix, key, value);
};

/**
 * Set the scenario enable status from the storage if they differ
 */
ScenarioBase.prototype._setScenarioEnableStatusFromStorage = function () {
  if (this.vd && this.vd.devObj) {
    var ctrlRuleEnabled = 'rule_enabled'
    var ctrl = this.vd.devObj.getControl(ctrlRuleEnabled);
    var initialValue = this.getPsUserSetting(ctrlRuleEnabled, true);

    if (ctrl !== initialValue) {
      ctrl.setValue(initialValue);
    }
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
ScenarioBase.prototype.generateNames = function (idPrefix) {
  throw new Error('generateNames() must be overridden by derived class');
};

/**
 * Validates the configuration object before call {@link initSpecific()}
 *
 * @abstract
 * @param   {Object} cfg  Raw configuration
 * @returns {boolean} True if configuration is acceptable
 */
ScenarioBase.prototype.validateCfg = function (cfg) {
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
ScenarioBase.prototype.initSpecific = function (name, cfg) {
  throw new Error('initSpecific() must be overridden by derived class');
};


/* ------------------------------------------------------------------ */
/*        Abstract methods stubs — optionaly MAY be overridden        */
/* ------------------------------------------------------------------ */

/**
 * Get configuration for waiting for controls
 * Override in subclass to customize waiting behavior
 * 
 * @param {Object} cfg Configuration object
 * @returns {Object} Waiting configuration object or empty object for no waiting
 * 
 * @example Returned object structure:
 *   - List of controls to wait for
 *   - Maximum wait time in milliseconds (default from WAIT_DEF.CONTROLS_WAIT_TIMEOUT_MS)
 *   - Polling period in milliseconds (default from WAIT_DEF.CONTROLS_WAIT_PERIOD_MS)
 * {
 *   controls: ['device1/control1', 'device2/control2'],
 *   timeout: 10000,  // Optional
 *   period: 500  // Optional
 * }
 */
ScenarioBase.prototype.defineControlsWaitConfig = function(cfg) {
  return {}; // Empty object by default - no waiting
};

exports.ScenarioBase = ScenarioBase;
