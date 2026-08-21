/**
 * @file scenario-init-main.js - ES5 script for wb-rules v2.34
 * @description Main initialization script for WB scenarios management
 *     This script performs:
 *     - Sequential initialization of all scenario types from the config
 *     - Cleanup of retained MQTT topics left by scenarios that are gone,
 *       see sweepAbandonedVdTopics()
 *
 * @author Mikhail Burchu <mikhail.burchu@wirenboard.com>
 */

var scenarioPersistentStorage =
  require('wbsc-persistent-storage.mod').getInstance();
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
 * Path of this script, as seen by wb-rules. Scenarios created while it was
 * loading store the same value in their 'vdInitScript' meta, which is how the
 * sweep below tells its own scenarios from those defined in user rules.
 *
 * If wb-rules ever stops exposing __filename, this stays empty and matches
 * nothing, so the sweep does nothing instead of removing the wrong topics
 * @type {string}
 */
var vdInitScript = typeof __filename !== 'undefined' ? __filename : '';

/**
 * Checks whether the name is held by a virtual device of a running scenario
 * @param {string} vdName Virtual device name
 * @returns {boolean} True if the device is alive in this wb-rules instance
 */
function isVdInUse(vdName) {
  try {
    var vdObj = getDevice(vdName);
    return vdObj !== undefined && vdObj.isVirtual() === true;
  } catch (err) {
    /** Treat an unreadable device as in use: skipping is the safe choice */
    log.warning(
      'Cannot check virtual device "{}", keeping its topics: {}',
      vdName,
      err.message || err
    );
    return true;
  }
}

/**
 * Collects virtual device names left by scenarios that are gone
 *
 * Only scenarios created by this script are considered: they are all
 * initialized by the time this runs, so one that is not alive any more is
 * gone for good. Scenarios created from user rules store a different
 * 'vdInitScript' - those files are loaded after this one, their devices do not
 * exist yet and must not be swept.
 *
 * @returns {Array<string>} Names whose retained topics can be removed
 */
function collectAbandonedVdNames() {
  var abandoned = [];

  scenarioPersistentStorage
    .getStoredScenarioKeys()
    .forEach(function checkOne(idPrefix) {
      var isOurScenario =
        scenarioPersistentStorage.getMeta(idPrefix, 'vdInitScript', null) ===
        vdInitScript;
      if (!isOurScenario) {
        log.debug('Skip "{}": created by another script', idPrefix);
        return;
      }

      var isSwept = scenarioPersistentStorage.getMeta(
        idPrefix,
        'vdSwept',
        false
      );
      if (isSwept === true) {
        log.debug('Skip "{}": topics already removed', idPrefix);
        return;
      }

      // Always stored next to 'vdInitScript' by ScenarioBase
      var vdName = scenarioPersistentStorage.getMeta(idPrefix, 'vdName', null);

      if (isVdInUse(vdName)) {
        log.debug('Skip "{}": virtual device is in use', idPrefix);
        return;
      }

      abandoned.push(vdName);
      scenarioPersistentStorage.setMeta(idPrefix, 'vdSwept', true);
    });

  return abandoned;
}

/**
 * Removes retained topics of virtual devices nobody owns any more
 *
 * Devices of running scenarios are never touched: wiping their topics would
 * leave them incomplete in MQTT, because controls that are not written again
 * are never republished.
 *
 * @param {Array<string>} vdNames Names to remove
 * @returns {void}
 */
function sweepAbandonedVdTopics(vdNames) {
  if (vdNames.length === 0) {
    log.debug('No abandoned virtual devices found');
    return;
  }

  log.info('Removing topics of abandoned devices: ' + vdNames.join(', '));

  var cmdList = '';
  vdNames.forEach(function addOne(vdName) {
    cmdList = cmdList + 'mqtt-delete-retained /devices/' + vdName + '/#;';
  });

  runShellCommand(cmdList, {
    captureErrorOutput: true,
    exitCallback: function onSweepDone(exitCode, output, errorOutput) {
      if (exitCode !== 0) {
        log.error(
          'Removing abandoned device topics failed with code {}: {}',
          exitCode,
          errorOutput
        );
      }
    },
  });
}

/**
 * Resets the device list kept for rollback to 1.10.1 and older
 *
 * Those versions rebuild the list on every start and read it to know what to
 * clean up. It is not used here, but createBasicVd() keeps filling it, so a
 * downgrade finds the same data it used to
 * @returns {void}
 */
function resetVdListForRollback() {
  var psWBSC = new PersistentStorage('wb-scenarios', { global: true });
  psWBSC['VdList'] = null;
}

function main() {
  log.debug('Start initialisation all types scenarios');

  resetVdListForRollback();

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

  /**
   * Runs after the scenarios above claimed their names, so a device that is
   * still missing belongs to nobody
   */
  sweepAbandonedVdTopics(collectAbandonedVdNames());
}

main();
