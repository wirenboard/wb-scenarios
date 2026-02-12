/**
 * @file scenario-storage.mod.js - ES5 module for wb-rules v2.28
 * @description A module containing a manager for adding and saving settings for scenarios
 *
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var _instance = null;

function ScenarioStorage() {
  this.ps = null;
  this.storageName = "wb-scenarios-common-persistant-data"
  this.storageKey = "scenariosStorage"
  this.userSettingsKey = "userSettings"
  this._initStorage();
}

/**
 * Initialize connection to the global persistent storage
 * @private
 * 
 * Example of stored data structure:
 * {
 *  "scenariosStorage": {
 *    "raspisanie": {
 *      "userSettings": {
 *        "rule_enabled": false
 *      }
 *    },
 *    "upravlenie_ustroystvami": {
 *      "userSettings": {
 *        "rule_enabled": true
 *      }
 *    }
 *  }
 *}
 * 
 * Where:
 * scenariosStorage - key in the persistent storage that stores all the data about the scenarios
 * raspisanie, upravlenie_ustroystvami - idPrefix scenario
 * userSettings - Object with settings for a specific scenario
 */
ScenarioStorage.prototype._initStorage = function() {
  this.ps = new PersistentStorage(this.storageName, { global: true });
};

/**
   * Get a user setting value from persistent storage for specific ID prefix
   * @param {string} idPrefix Scenario ID prefix
   * @param {string} key Setting name
   * @param {any} [defaultValue] Value to return if key not found
   * @returns {any} Stored value or default
   */
ScenarioStorage.prototype.getUserSetting = function(idPrefix, key, defaultValue) {
  // If no stored value in the storage, then return defaultValue.
  if (!this.ps || !this.ps[this.storageKey] || !this.ps[this.storageKey][idPrefix] || !this.ps[this.storageKey][idPrefix][this.userSettingsKey]) {
    return defaultValue;
  }
  
  var val = this.ps[this.storageKey][idPrefix][this.userSettingsKey][key];

  return (val !== undefined) ? val : defaultValue;
};

/**
   * Set a user setting value to persistent storage for specific ID prefix
   * @param {string} idPrefix Scenario ID prefix
   * @param {string} key Setting name
   * @param {any} value Value to store
   */
ScenarioStorage.prototype.setUserSetting = function(idPrefix, key, value) {
  // If not StorableObject for the scenarios storage, create a new one.
  if (!this.ps[this.storageKey]) {
    this.ps[this.storageKey] = new StorableObject({});
  }

  // If not StorableObject for the specific scenario, create a new one.
  if (!this.ps[this.storageKey][idPrefix]) {
    this.ps[this.storageKey][idPrefix] = new StorableObject({});
    this.ps[this.storageKey][idPrefix][this.userSettingsKey] = new StorableObject({});
  }

  this.ps[this.storageKey][idPrefix][this.userSettingsKey][key] = value;
};

// TODO (Valerii) Add auto cleanup for storage
// ScenarioStorage.prototype.cleanup = function() {
// };

// TODO (Valerii) Add a metadata for storing service data
// ScenarioStorage.prototype.getMeta = function() {
// };
// ScenarioStorage.prototype.setMeta = function() {
// };

/**
 * Singleton getInstance
 */
function getInstance() {
  if (!_instance) {
    _instance = new ScenarioStorage();
  }
  return _instance;
}

exports.getInstance = getInstance;
