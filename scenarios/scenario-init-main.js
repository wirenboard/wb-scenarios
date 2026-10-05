/**
 * @file scenario-init-main.js - ES5 script for wb-rules v2.47
 * @description Main initialization script for WB scenarios management
 *     This script performs:
 *     - Removal of scenario devices left by the previous wb-rules session
 *     - Sequential initialization of all scenario types from the config
 *
 * @author Mikhail Burchu <mikhail.burchu@wirenboard.com>
 */

var scenarioPersistentStorage =
  require('wbsc-persistent-storage.mod').getInstance();
var removeLeftoverVd =
  require('virtual-device-helpers.mod').removeLeftoverVd;
var setupDevicesControl = require('scenario-init-devices-control.mod').setup;
var setupLightControl = require('scenario-init-light-control.mod').setup;
var setupThermostat = require('scenario-init-thermostat.mod').setup;
var setupSchedule = require('scenario-init-schedule.mod').setup;
var setupAstronomicalTimer =
  require('scenario-init-astronomical-timer.mod').setup;
var setupPeriodicTimer = require('scenario-init-periodic-timer.mod').setup;
var setupChannelMap = require('scenario-init-channel-map.mod').setup;
var setupPidController = require('scenario-init-pid-controller.mod').setup;
var Logger = require('logger.mod').Logger;

var log = new Logger('WBSC-init-main');

/**
 * Removes leftover devices of all scenarios, including the deleted ones
 * @returns {void}
 */
function removeLeftoverScenarioVds() {
  var scenarioPrefix = 'wbsc_';

  getDevicesList().forEach(function removeIfLeftover(devObj) {
    if (devObj.getId().indexOf(scenarioPrefix) === 0) {
      removeLeftoverVd(devObj);
    }
  });
}

function main() {
  log.debug('Start initialisation all types scenarios');

  removeLeftoverScenarioVds();

  var registeredScenarios =
    scenarioPersistentStorage.getStoredScenarioKeys();
  if (registeredScenarios.length > 0) {
    log.debug(
      'Found saved scenarios in storage: ' + registeredScenarios.join(', ')
    );
  } else {
    log.debug('Persistent storage registry is empty');
  }

  setupDevicesControl();
  setupLightControl();
  setupThermostat();
  setupSchedule();
  setupAstronomicalTimer();
  setupPeriodicTimer();
  setupChannelMap();
  setupPidController();
}

main();
