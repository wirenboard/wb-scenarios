/**
 * @file wbsc-persistent-storage.mod.js - ES5 module for wb-rules v2.28
 * @description A module containing a manager for adding and saving settings for scenarios
 *
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var _instance = null;

/**
 * We store values ​​of all scenarios in a StorableObject using the key this.iterableRootObjKey.
 * 
 * PersistentStorage is a proxy and we can't retrieve all available keys. But, we can retrieve all stored keys within a StorableObject.
 */
function ScenarioPersistentStorage() {
  this.ps = null;
  this.storageName = "wb-scenarios-common-persistent-data"
  this.iterableRootObjKey = "scenariosRegistry"
  this.userSettingsKey = "userSettings"
  this._initStorage();
}

/**
 * Initialize connection to the global persistent storage
 * @private
 * 
 * Example of stored data structure:
 * {
 *  "scenariosRegistry": {
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
 *   }
 * }
 * 
 * Where:
 * scenariosRegistry - key in the persistent storage that stores all the data about the scenarios
 * raspisanie, upravlenie_ustroystvami - idPrefix scenario
 * userSettings - Object with settings for a specific scenario
 */
ScenarioPersistentStorage.prototype._initStorage = function() {
  this.ps = new PersistentStorage(this.storageName, { global: true });
};

/**
 * Get a user setting value from persistent storage for specific ID prefix
 * @param {string} idPrefix Scenario ID prefix
 * @param {string} key Setting name
 * @param {any} [defaultValue] Value to return if key not found
 * @returns {any} Stored value or default
 */
ScenarioPersistentStorage.prototype.getUserSetting = function(idPrefix, key, defaultValue) {
  // If no stored value in the storage, then return defaultValue
  if (!this.ps || !this.ps[this.iterableRootObjKey] || !this.ps[this.iterableRootObjKey][idPrefix] || !this.ps[this.iterableRootObjKey][idPrefix][this.userSettingsKey]) {
    return defaultValue;
  }
  
  var val = this.ps[this.iterableRootObjKey][idPrefix][this.userSettingsKey][key];

  return (val !== undefined) ? val : defaultValue;
};

/**
 * Set a user setting value to persistent storage for specific ID prefix
 * @param {string} idPrefix Scenario ID prefix
 * @param {string} key Setting name
 * @returns {void}
 */
ScenarioPersistentStorage.prototype.setUserSetting = function(idPrefix, key, value) {
  // If not StorableObject for the scenarios storage, create a new one.
  if (!this.ps[this.iterableRootObjKey]) {
    this.ps[this.iterableRootObjKey] = new StorableObject({});
  }

  // If not StorableObject for the specific scenario, create a new one.
  if (!this.ps[this.iterableRootObjKey][idPrefix]) {
    this.ps[this.iterableRootObjKey][idPrefix] = new StorableObject({});
    this.ps[this.iterableRootObjKey][idPrefix][this.userSettingsKey] = new StorableObject({});
  }

  this.ps[this.iterableRootObjKey][idPrefix][this.userSettingsKey][key] = value;
};

/**
 * Get all created scenario keys from from persistent storage
 * @returns {any} Array of all created scenario keys
 */
ScenarioPersistentStorage.prototype.getStoredScenarioKeys = function() {
  var rootObj = this.ps[this.iterableRootObjKey];
  if (!rootObj) {
    return [];
  }

  return Object.keys(rootObj).filter(function(key) {
    return key !== '_psself';
  });
};

// TODO (Valerii) Add auto cleanup for storage
// ScenarioPersistentStorage.prototype.cleanup = function() {
// };

// TODO (Valerii) Add a metadata for storing service data
// ScenarioPersistentStorage.prototype.getMeta = function() {
// };
// ScenarioPersistentStorage.prototype.setMeta = function() {
// };

/**
 * Singleton getInstance
 */
function getInstance() {
  if (!_instance) {
    _instance = new ScenarioPersistentStorage();
  }
  return _instance;
}

exports.getInstance = getInstance;
