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
var scenarioBase = require('wbsc-scenario-base.mod');
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

var DRAIN_PERIOD_MS = 100;
var DRAIN_TIMEOUT_MS = 5000;

/**
 * Topics that make up a device in the MQTT conventions of Wiren Board
 *
 * The lists are fixed on purpose: an empty payload is published to every one
 * of them, whether the topic exists or not. A device whose meta was lost -
 * for example one the engine republished only partially - has nothing for a
 * tool that deletes only the topics it can see, and stays in the system
 */
var DEV_META_TOPICS = [
  'meta',
  'meta/name',
  'meta/driver',
  'meta/title',
  'meta/model',
  'meta/error',
];
var CTRL_TOPIC_SUFFIXES = [
  '',
  '/meta',
  '/meta/type',
  '/meta/order',
  '/meta/readonly',
  '/meta/units',
  '/meta/min',
  '/meta/max',
  '/meta/precision',
  '/meta/enum',
  '/meta/error',
  '/meta/description',
  '/meta/title',
];

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
        'Devices are present again {}s after their topics were removed: ' +
          '{}. Either the engine has not processed the removal yet, or ' +
          'something keeps republishing these topics - an external client ' +
          'or an MQTT bridge',
        DRAIN_TIMEOUT_MS / 1000,
        left.join(', ')
      );
      onDone();
    }
  }, DRAIN_PERIOD_MS);
}

/**
 * Removes retained topics of one device by publishing empty payloads
 *
 * Virtual devices are never touched here: their topics are a projection of
 * the engine state, removing them leaves the device alive but invisible
 *
 * @param {string} vdName - Virtual device name
 * @returns {boolean} True if the topics were published for removal
 */
function wipeVdTopics(vdName) {
  var vdObj = getDevice(vdName);
  if (vdObj === undefined || vdObj.isVirtual() === true) {
    return false;
  }

  vdObj.controlsList().forEach(function wipeControl(ctrl) {
    var ctrlName;
    try {
      ctrlName = ctrl.getId();
    } catch (err) {
      log.warning(
        'Cannot read a control of "{}", its topics are kept: {}',
        vdName,
        err.message || err
      );
      return;
    }

    CTRL_TOPIC_SUFFIXES.forEach(function wipeOne(suffix) {
      publish(
        '/devices/' + vdName + '/controls/' + ctrlName + suffix,
        '',
        2,
        true
      );
    });
  });

  DEV_META_TOPICS.forEach(function wipeOne(topic) {
    publish('/devices/' + vdName + '/' + topic, '', 2, true);
  });

  return true;
}

/**
 * Removes retained topics of the given devices
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
  vdNames.forEach(wipeVdTopics);

  waitDevicesForgotten(vdNames, onDone);
}

function main() {
  log.debug('Start initialisation all types scenarios');

  scenarioBase.closeCleanupGate();

  /**
   * Versions 1.10.1 and older rebuild this list on every start and clean up
   * by it. It is not used here, but createBasicVd() keeps filling it, so a
   * downgrade finds the same data it used to
   */
  var psWBSC = new PersistentStorage('wb-scenarios', { global: true });
  psWBSC['VdList'] = null;

  removeVdTopics(collectNamesToClean(), function onCleanupDone() {
    scenarioBase.openCleanupGate();
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
