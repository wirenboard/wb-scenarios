/**
 * @file scenario-init-main.js - ES5 script for wb-rules v2.34
 * @description Main initialization script for WB scenarios management
 *     This script performs:
 *     - Cleanup of previous MQTT retained messages for virtual devices
 *     - Sequential initialization of:
 *       * Devices control scenarios
 *       * Light control scenarios
 *       * Thermostat scenarios
 *     - Persistent storage reset for scenario devices
 *
 * @author Mikhail Burchu <mikhail.burchu@wirenboard.com>
 */

var scenarioPersistentStorage = require("wbsc-persistent-storage.mod").getInstance();
var setupDevicesControl = require("scenario-init-devices-control.mod").setup;
var setupLightControl = require("scenario-init-light-control.mod").setup;
var setupThermostat = require("scenario-init-thermostat.mod").setup;
var setupSchedule = require("scenario-init-schedule.mod").setup;
var Logger = require('logger.mod').Logger;

var log = new Logger('WBSC-init-main');

var CONFIG_PATH = '/etc/wb-scenarios.conf';

/**
 * List of migrations. Each has a version number and a function
 * that mutates the config object. Migrations run in order,
 * only if configMigrationVersion < migration version.
 */
var MIGRATIONS = [
  {
    version: 1,
    description:
      'Set default days for schedule scenarios with empty scheduleDaysOfWeek',
    run: function migrateEmptyDaysOfWeek(config) {
      var ALL_DAYS = [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ];
      for (var i = 0; i < config.scenarios.length; i++) {
        var s = config.scenarios[i];
        if (
          s.scenarioType === 'schedule' &&
          Array.isArray(s.scheduleDaysOfWeek) &&
          s.scheduleDaysOfWeek.length === 0
        ) {
          s.scheduleDaysOfWeek = ALL_DAYS;
        }
      }
    },
  },
];

/**
 * Runs all pending migrations on the config file.
 * Reads config, applies migrations with version > current,
 * writes back if changed.
 */
function migrateConfig() {
  var config = readConfig(CONFIG_PATH);
  if (!config || !Array.isArray(config.scenarios)) return;

  var currentVersion = config.configMigrationVersion || 0;
  var latestVersion = currentVersion;

  for (var i = 0; i < MIGRATIONS.length; i++) {
    var migration = MIGRATIONS[i];
    if (migration.version > currentVersion) {
      log.info(
        'Running migration v{}: {}',
        migration.version,
        migration.description
      );
      migration.run(config);
      latestVersion = migration.version;
    }
  }

  if (latestVersion > currentVersion) {
    config.configMigrationVersion = latestVersion;
    var json = JSON.stringify(config, null, 4);
    runShellCommand('cat > ' + CONFIG_PATH, {
      input: json,
      captureErrorOutput: true,
      exitCallback: function exitWriteConfig(
        exitCode,
        capturedOutput,
        capturedErrorOutput
      ) {
        if (exitCode !== 0) {
          log.error(
            'Failed to write migrated config (exit code {}): {}',
            exitCode,
            capturedErrorOutput
          );
          return;
        }
        log.info(
          'Config migrated from v{} to v{}',
          currentVersion,
          latestVersion
        );
      },
    });
  }
}

function main() {
  migrateConfig();

  log.debug('Start initialisation all types scenarios');

  // Retrieving all previously created virtual devices from persistent storage
  var psWBSC = new PersistentStorage("wb-scenarios", {global: true});
  var cmdList = '';
  if (psWBSC["VdList"] !== undefined) {
    var VdList = Object.keys(psWBSC["VdList"]);
    VdList.forEach(function(Vdevice) {
      cmdList = cmdList + 'mqtt-delete-retained /devices/' + Vdevice + '/# > /dev/null 2>&1;'
    });
  }

  var registeredScenarios = scenarioPersistentStorage.getStoredScenarioKeys();
  if (registeredScenarios.length > 0) {
    log.debug('Found saved scenarios in storage: ' + registeredScenarios.join(', '));
  } else {
    log.debug('Persistent storage registry is empty');
  }

  runShellCommand(cmdList, { //Removing all previously created virtual devices from topics
    captureOutput: true,
    captureErrorOutput: true,
    exitCallback: function (exitCode, capturedOutput, capturedErrorOutput) {
      setupDevicesControl();
      setupLightControl();
      setupThermostat();
      setupSchedule();
    }
  });
  psWBSC["VdList"] = null; // Removing all previously created virtual devices from persistent storage
}

main();
