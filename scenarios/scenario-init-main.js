/**
 * @file scenario-init-main.js - ES5 script for wb-rules v2.34
 * @description Main initialization script for WB scenarios management
 *     This script performs:
 *     - Removal of retained topics left by virtual devices of the scenarios,
 *       see collectNamesToClean()
 *     - Publishing of the readiness flag other scenarios wait for
 *     - Sequential initialization of all scenario types from the config
 *
 * @author Mikhail Burchu <mikhail.burchu@wirenboard.com>
 */

var scenarioPersistentStorage =
  require('wbsc-persistent-storage.mod').getInstance();
var constants = require('constants.mod');
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

var READY_VD = constants.READY_FLAG_VD;
var READY_CTRL = constants.READY_FLAG_CTRL;
var DRAIN_PERIOD_MS = 100;
var DRAIN_TIMEOUT_MS = 5000;

/**
 * Publishes the readiness flag, reset to false
 *
 * The flag lives on a control and not in a JS variable or in the persistent
 * storage: 'forceDefault' resets it on every wb-rules start by itself, and a
 * control is readable from the context of any rule file
 *
 * @returns {boolean} True if the flag is published and readable
 */
function publishReadyFlagVd() {
  var vdObj = null;
  try {
    vdObj = defineVirtualDevice(READY_VD, {
      title: { en: 'Scenarios init', ru: 'Инициализация сценариев' },
      cells: {},
    });
  } catch (err) {
    log.error('Cannot publish readiness flag: {}', err.message || err);
    return false;
  }

  vdObj.addControl(READY_CTRL, {
    title: { en: 'Cleanup done', ru: 'Очистка завершена' },
    type: 'switch',
    value: false,
    forceDefault: true,
    readonly: true,
    order: 1,
  });

  /** addControl() reports failures to syslog only, so check the result */
  if (!vdObj.isControlExists(READY_CTRL)) {
    log.error('Readiness flag control "{}" not created', READY_CTRL);
    return false;
  }

  /**
   * Older versions build their cleanup list from 'VdList', and this device is
   * not a scenario, so nothing else would ever remove its topics after
   * a downgrade
   */
  var psWBSC = new PersistentStorage('wb-scenarios', { global: true });
  if (psWBSC['VdList'] === undefined) {
    psWBSC['VdList'] = new StorableObject({});
  }
  psWBSC['VdList'][READY_VD] = true;

  return true;
}

/**
 * Checks whether the topics of this name must be left alone
 *
 * Two kinds of devices are kept: those of scenarios running right now, and
 * those published by somebody else - a python daemon, a zigbee gateway. The
 * '/meta/driver' topic would tell them apart, but it is only reachable
 * through trackMqtt(), which answers in a callback - too late for a decision
 * made here. So the controls that createBasicVd() always adds serve as the
 * fingerprint of a scenario device.
 *
 * The fingerprint is reliable at this point: wb-rules waits for the driver to
 * process the retained flood before it loads any rule file, so a leftover
 * device is already assembled in full.
 *
 * @param {string} vdName - Virtual device name
 * @returns {boolean} True if the topics must not be removed
 */
function mustKeepVdTopics(vdName) {
  try {
    var vdObj = getDevice(vdName);
    if (vdObj === undefined) {
      return true;
    }
    if (vdObj.isVirtual() === true) {
      return true;
    }

    return !vdObj.isControlExists('rule_enabled');
  } catch (err) {
    /** Treat an unreadable device as kept: skipping is the safe choice */
    log.warning(
      'Cannot check virtual device "{}", keeping its topics: {}',
      vdName,
      err.message || err
    );
    return true;
  }
}

/**
 * Collects names of devices whose retained topics have to be removed
 *
 * Leftovers of scenarios defined in user rules are removed as well: nobody
 * else cleans them, and their controls would outlive the version of the
 * scenario that created them. Names without a device behind them are skipped -
 * there is nothing to remove, and every name costs a call of the removal tool.
 *
 * @returns {Array<string>} Names to remove
 */
function collectNamesToClean() {
  var vdNames = [];

  scenarioPersistentStorage
    .getStoredScenarioKeys()
    .forEach(function checkOne(idPrefix) {
      var vdName = scenarioPersistentStorage.getMeta(
        idPrefix,
        'vdName',
        null
      );
      if (!vdName) {
        return;
      }
      if (mustKeepVdTopics(vdName)) {
        log.debug(
          'Keep "{}": nothing to remove, in use or not ours',
          vdName
        );
        return;
      }

      vdNames.push(vdName);
    });

  return vdNames;
}

/**
 * Waits until the engine stops reporting the given devices
 *
 * Removal of the topics and the update of the device list in wb-rules are
 * separate events: the tool exits once the broker acknowledges the empty
 * payloads, and the engine processes them a moment later. A device created
 * inside that window is taken over together with the controls of its previous
 * version, and those stay in the user interface until the next restart
 *
 * @param {Array<string>} vdNames - Names that have just been removed
 * @param {Function} onDone - Called when the engine caught up or gave up
 * @returns {void}
 */
function waitDevicesForgotten(vdNames, onDone) {
  var deadline = new Date().getTime() + DRAIN_TIMEOUT_MS;

  var timerId = setInterval(function onTick() {
    var left = vdNames.filter(function isStillKnown(vdName) {
      return getDevice(vdName) !== undefined;
    });

    if (left.length === 0) {
      clearInterval(timerId);
      onDone();
      return;
    }

    if (new Date().getTime() >= deadline) {
      clearInterval(timerId);
      log.warning(
        'Devices still known to the engine {}s after cleanup: {}',
        DRAIN_TIMEOUT_MS / 1000,
        left.join(', ')
      );
      onDone();
    }
  }, DRAIN_PERIOD_MS);
}

/**
 * Removes retained topics of the given devices and reports the failed ones
 *
 * The tool prints a progress bar and a warning about an empty topic mask, and
 * both are of no use here, so only the marks of the failed removals are kept
 *
 * @param {Array<string>} vdNames - Names to remove
 * @param {Function} onDone - Called when the removal is over
 * @returns {void}
 */
function removeVdTopics(vdNames, onDone) {
  if (vdNames.length === 0) {
    log.debug('No leftover devices to remove');
    onDone();
    return;
  }

  log.info('Removing topics of devices: {}', vdNames.join(', '));

  var cmdList = '';
  vdNames.forEach(function addOne(vdName) {
    cmdList =
      cmdList +
      'mqtt-delete-retained /devices/' +
      vdName +
      '/# >/dev/null || echo "FAILED ' +
      vdName +
      '";';
  });

  runShellCommand('{ ' + cmdList + ' } 2>/dev/null', {
    captureOutput: true,
    exitCallback: function onRemovalDone(exitCode, capturedOutput) {
      if (capturedOutput) {
        log.error('Some topics were not removed: {}', capturedOutput);
      }
      waitDevicesForgotten(vdNames, onDone);
    },
  });
}

/**
 * Drops the device list kept for rollback to 1.10.1 and older
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
  var isFlagPublished = publishReadyFlagVd();

  removeVdTopics(collectNamesToClean(), function onCleanupDone() {
    if (isFlagPublished) {
      dev[READY_VD + '/' + READY_CTRL] = true;
    }
    log.info('Cleanup done, starting scenarios');

    setupDevicesControl();
    setupLightControl();
    setupThermostat();
    setupSchedule();
    setupAstronomicalTimer();
    setupPeriodicTimer();
    setupChannelMap();
    setupPidController();
  });
}

main();
