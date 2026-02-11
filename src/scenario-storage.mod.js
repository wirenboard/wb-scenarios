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
  this.allKeysKey = "all_keys"
  this._initStorage();
}

/**
 * Initialize connection to the global persistent storage
 * @private
 */
ScenarioStorage.prototype._initStorage = function() {
  this.ps = new PersistentStorage(this.storageName, { global: true });
};

/**
   * Get a setting value from persistent storage for specific vdName
   * @param {string} vdName - The name of the virtual device
   * @param {string} key - Setting name
   * @param {any} [defaultValue] - Value to return if key not found
   * @returns {any} Stored value or default
   */
ScenarioStorage.prototype.getSetting = function(vdName, key, defaultValue) {
  if (!this.ps || !this.ps[vdName]) {
    return defaultValue;
  }
  
  var val = this.ps[vdName][key];
  return (val !== undefined) ? val : defaultValue;
};

/**
   * Save a setting value to persistent storage for specific vdName
   * @param {string} vdName - The name of the virtual device
   * @param {string} key - Setting name
   * @param {any} value - Value to store
   */
ScenarioStorage.prototype.setSetting = function(vdName, key, value) {
  if (!this.ps) return;

  var data = this.ps[vdName];

  if (!data) {
    data = new StorableObject({});
    this.ps[vdName] = data;
  }

  data[key] = value;

  // Re-assign object to trigger storage write mechanism in wb-rules
  this.ps[vdName] = data;

  // Save the key for subsequent cleaning of the storage from unnecessary keys.
  if (this.ps[this.allKeysKey] !== undefined) {
    this.ps[this.allKeysKey][vdName] = true;
  } else {
    this.ps[this.allKeysKey] = new StorableObject({});
    this.ps[this.allKeysKey][vdName] = true;
  }
};

/**
 * Completely remove the key from the storage
 * @param {string} vdName - Name of the virtual device to delete settings
 * @private
 */
ScenarioStorage.prototype._deleteKey = function(vdName) {
  // Delete device setting
  if (this.ps[vdName] !== undefined) {
    this.ps[vdName] = null;
  }
  
  // Remove from the list of keys (if it exists)
  if (this.ps[this.allKeysKey] !== undefined && this.ps[this.allKeysKey][vdName] !== undefined) {
    var oldKeys = this.ps[this.allKeysKey];
    delete oldKeys[vdName];
    this.ps[this.allKeysKey] = oldKeys;
  }
};

/**
   * Removes all unnecessary keys from the storage, runs once after the scenarios is initialized
   */
ScenarioStorage.prototype.selfCleanup = function() {
  // Get currently active devices from VdList
  var psWBSC = new PersistentStorage("wb-scenarios", {global: true});
  var activeDevices = [];
  
  if (psWBSC["VdList"] !== undefined) {
    activeDevices = Object.keys(psWBSC["VdList"]);
    activeDevices = activeDevices.filter(function(key) {
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
  
  // Find keys to delete (present in storedKeys, but not in activeDevices)
  var keysToDelete = storedKeys.filter(function(key) {
    return activeDevices.indexOf(key) === -1;
  });
  
  // Remove every extra key
  keysToDelete.forEach(function(key) {
    this._deleteKey(key);
  }.bind(this));
};

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
