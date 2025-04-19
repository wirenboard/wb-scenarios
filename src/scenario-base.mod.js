/**
 * @file scenario-base.mod.js
 * @description Minimal abstract ES5 base class for all WB‑rules scenarios
 */

var getIdPrefix = require('scenarios-general-helpers.mod').getIdPrefix;
var createBasicVd = require('virtual-device-helpers.mod').createBasicVd;
var setVdTotalError = require('virtual-device-helpers.mod').setVdTotalError;
var Logger    = require('logger.mod').Logger;

var log = new Logger('WBSC‑base');

/**
 * Abstract base class every scenario must extend
 * @abstract Should not be instantiated directly, only inherited
 * @constructor
 */
function ScenarioBase() {
  if (this.constructor === ScenarioBase) {
    throw new Error('ScenarioBase is abstract class – extend it by child');
  }

  // Basic properties that will be set during initialization
  this.name = null;
  this.cfg = null;
  this.idPrefix = null;  // 'translit(name)' or 'cfg.idPrefix' if set by user
  this.genNames    = null;  // generated names (vd‑id, rule‑id’s …)
  this.vd = null;  // Automatically created scenario virtual device

  // Internal state
  this._rules = [];  // Collection of rule IDs for management
  this._initialized = false;
}

/**
 * Initialize the scenario with name and configuration
 * 
 * @note This is single entry point called by user code.
 *       Do not override unless you really need.
 * @param {string} name Scenario title / virtual‑device title
 * @param {Object} cfg Raw configuration object supplied by user
 * @returns {boolean} True on success, throws on error
 */
ScenarioBase.prototype.init = function(name, cfg) {
  if (this._initialized) {
    throw new Error('Scenario already initialized');
  }

  this.name = name;
  this.cfg = cfg;
  this.idPrefix = getIdPrefix(name, cfg);

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
  this.vd = createBasicVd(
    this.genNames.vDevice,
    this.name,
    this._rules);
  if (!this.vd) throw new Error('Basic VD creation failed');

  if (this.validateCfg(cfg) !== true) {
    this.setTotalError('Config validation failed');
    throw new Error('Config validation failed "' + this.name + '"');
  }
  log.debug('All checks pass successfuly!');

  var ok = this.initSpecific(name, cfg);
  if (ok === false) {
    this.setTotalError('initSpecific() returned false');
    throw new Error('initSpecific() returned false');
  }

  // TODO:(vg) write optional wait topics and call initAfterWait()
  //           if we need wait - _initialized must be set after wait?

  this._initialized = true;
  log.info('[{}] Scenario initialized successfully', this.name);
  return true;
};

/**
 * Convenience wrapper to collect rule IDs created inside subclasses.
 *
 * @param {number} id  ID from defineRule
 */
ScenarioBase.prototype.addRule = function (id) {
  this._rules.push(id);
};

ScenarioBase.prototype.setTotalError = function (msg) {
    if (this.vd) setVdTotalError(this.vd, msg);
    else log.error('[{}] {}', this.name || 'Unknown', msg);
  };

/* ------------------------------------------------------------------ */
/*        Abstract methods stubs — MUST be overridden                 */
/* ------------------------------------------------------------------ */


/**
 * Build map with virtual‑device id, rule names, etc.
 * @abstract
 * @param   {string} idPrefix Transliteration of scenario title
 * @returns {Object}
 */
ScenarioBase.prototype.generateNames = function () {
    throw new Error('generateNames() must be overridden by derived class');
};

/**
 * Validate configuration object before logic creation
 * Should throw/return false if cfg is invalid
 *
 * @abstract
 * @param   {Object} cfg  Raw configuration
 * @returns {boolean}     True if configuration is acceptable
 */
ScenarioBase.prototype.validateCfg = function () {
  throw new Error('validateCfg() must be overridden by derived class');
  // If all OK - must return - true
};

/**
 * Create all rules, virtual devices, timers, etc.
 * Must be implemented in subclass. Use {@link addRule} to
 * store rule IDs if you need later clean‑up.
 *
 * @abstract
 */
ScenarioBase.prototype.initSpecific = function () {
  throw new Error('initSpecific() must be overridden by derived class');
};

exports.ScenarioBase = ScenarioBase;
