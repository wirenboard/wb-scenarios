/**
 * @file scenario-storage.mod.js - ES5 module for wb-rules v2.28
 * @description A module containing a manager for adding and saving settings for scenarios
 *
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var _instance = null;

/**
 * ScenarioStorage class
 */
function ScenarioStorage() {
  this.ps = null;
  this.storageName = "wb-scenarios-common-persistant-data"
  this.currentKeysKey = "currentKeys"
  this.allKeysKey = "allKeys"
  this.userConfigKey = "userConfig"
  this._initStorage();
}

/**
 * Initialize connection to the global persistent storage
 * @private
 * 
 * Example of stored data structure:
 * {
 *   "raspisanie": {
 *     "userConfig": {
 *       "rule_enabled": false,
 *     }
 *   },
 *   "upravlenie_ustroystvami": {
 *     "userConfig": {
 *       "rule_enabled": true,
 *     }
 *   },
 *   "currentKeys": {
 *     "raspisanie": true,
 *     "upravlenie_ustroystvami": true
 *   },
 *   "allKeys": {
 *     "raspisanie": true,
 *     "upravlenie_ustroystvami": true
 *   }
 * }
 * 
 * Where:
 * - raspisanie, upravlenie_ustroystvami - idPrefix scenario
 * - userConfig - Object with settings for a specific scenario
 * - currentKeys - Utility object for tracking all running scenario
 * - allKeys - Utility object to keep track of all saved scenario
 */
ScenarioStorage.prototype._initStorage = function() {
  this.ps = new PersistentStorage(this.storageName, { global: true });
};

/**
   * Get a setting value from persistent storage for specific vdName
   * @param {string} idPrefix Scenario ID prefix
   * @param {string} key Setting name
   * @param {any} [defaultValue] Value to return if key not found
   * @returns {any} Stored value or default
   */
ScenarioStorage.prototype.getSetting = function(idPrefix, key, defaultValue) {
  // Save the key for currentKeys
  if (this.ps[this.currentKeysKey] !== undefined) {
    this.ps[this.currentKeysKey][idPrefix] = true;
  } else {
    this.ps[this.currentKeysKey] = new StorableObject({});
    this.ps[this.currentKeysKey][idPrefix] = true;
  }

  // If no stored value in the storage, then return defaultValue.
  if (!this.ps || !this.ps[idPrefix] || !this.ps[idPrefix][this.userConfigKey]) {
    return defaultValue;
  }
  
  var val = this.ps[idPrefix][this.userConfigKey][key];

  return (val !== undefined) ? val : defaultValue;
};

/**
   * Save a setting value to persistent storage for specific vdName
   * @param {string} idPrefix Scenario ID prefix
   * @param {string} key Setting name
   * @param {any} value Value to store
   */
ScenarioStorage.prototype.setSetting = function(idPrefix, key, value) {
  if (!this.ps) return;

  var data = this.ps[idPrefix];

  // If StorableObject for the key is not ready, create a new one.
  if (!data) {
    data = new StorableObject({});
    this.ps[idPrefix] = data;
  }

  // Make sure userConfigKey exists and is an object
  if (typeof data[this.userConfigKey] !== 'object' || data[this.userConfigKey] === null) {
    data[this.userConfigKey] = new StorableObject({});
  }

  data[this.userConfigKey][key] = value;

  // Re-assign object to trigger storage write mechanism in wb-rules
  this.ps[idPrefix] = data;

  // Save the key for subsequent cleaning of the storage from unnecessary keys.
  if (this.ps[this.allKeysKey] !== undefined) {
    this.ps[this.allKeysKey][idPrefix] = true;
  } else {
    this.ps[this.allKeysKey] = new StorableObject({});
    this.ps[this.allKeysKey][idPrefix] = true;
  }
};

/**
 * Completely remove the key from the storage
 * @param {string} idPrefix Scenario ID prefix
 * @private
 */
ScenarioStorage.prototype._deleteKey = function(idPrefix) {
  // Delete device setting
  if (this.ps[idPrefix] !== undefined) {
    this.ps[idPrefix] = null;
  }
  
  // Remove from the allKeysKey (if it exists)
  if (this.ps[this.allKeysKey] !== undefined && this.ps[this.allKeysKey][idPrefix] !== undefined) {
    var oldKeys = this.ps[this.allKeysKey];
    delete oldKeys[idPrefix];
    this.ps[this.allKeysKey] = oldKeys;
  }
};

/**
 * Preparing for subsequent cleaning
 */
ScenarioStorage.prototype.prepareCleanup = function() {
  this.ps[this.currentKeysKey] = new StorableObject({});
};

/**
 * Removes all unnecessary keys from the storage, runs once after the scenarios is initialized
 */
ScenarioStorage.prototype.doCleanup = function() {
  var currentKeys = [];

  // Get all running keys from our storage
  if (this.ps[this.currentKeysKey] !== undefined) {
    currentKeys = Object.keys(this.ps[this.currentKeysKey]);
    currentKeys = currentKeys.filter(function(key) {
      return key !== '_psself' && key !== 'constructor' && key !== 'prototype';
    });
  }
  
  // Get all keys from our storage
  var storedKeys = [];
  if (this.ps[this.allKeysKey] !== undefined) {
    storedKeys = Object.keys(this.ps[this.allKeysKey]);
    storedKeys = storedKeys.filter(function(key) {
      return key !== '_psself' && key !== 'constructor' && key !== 'prototype';
    });
  }
  
  // Find keys to delete (present in storedKeys, but not in currentKeys)
  var keysToDelete = storedKeys.filter(function(key) {
    return currentKeys.indexOf(key) === -1;
  });
  
  // Remove every extra key
  keysToDelete.forEach(function(key) {
    this._deleteKey(key);
  }.bind(this));
};

// TODO (Valerii) Add a metadata for storing service data
// ScenarioStorage.prototype.getMeta = function() {
// };
// ScenarioStorage.prototype.saveMeta = function() {
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
