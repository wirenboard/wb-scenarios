/**
 * @file scenario-init-periodic-timer.mod.js
 * @description Script for init scenarios of the periodicTimer type
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var scHelpers = require('scenarios-general-helpers.mod');
var CustomTypeSc =
  require('periodic-timer.mod').PeriodicTimerScenario;
var Logger = require('logger.mod').Logger;

/**
 * Scenario initialization configuration parameters
 * @typedef {Object} ScenarioConfig
 */
var CFG = {
  reqVerGeneralCfg: 1,
  reqVerScenario: 1,
  configPath: '/etc/wb-scenarios.conf',
  scenarioTypeStr: 'periodicTimer',
};

var log = new Logger('WBSC-' + CFG.scenarioTypeStr + '-init');

/**
 * Initializes a scenario using the specified settings
 * @param {object} scenarioCfg - The scenario object from config
 * @returns {void}
 */
function initializeScenario(scenarioCfg) {
  log.debug(
    'Processing scenario config: "{}"',
    JSON.stringify(scenarioCfg)
  );

  var scenario = new CustomTypeSc();
  var rawInterval = scenarioCfg.interval;
  var rawWorkTime = scenarioCfg.workTime;

  var cfg = {
    idPrefix: scenarioCfg.idPrefix,
    interval: {
      unit: rawInterval.intervalUnit,
      value: rawInterval.intervalValue,
    },
    workTime: {
      unit: rawWorkTime.workTimeUnit,
      value: rawWorkTime.workTimeValue,
    },
    activeFrom: scenarioCfg.activeFrom,
    activeTo: scenarioCfg.activeTo,
    scheduleDaysOfWeek: scenarioCfg.scheduleDaysOfWeek || [],
    startControls: scenarioCfg.startControls || [],
  };

  try {
    var isBasicVdCreated = scenario.init(scenarioCfg.name, cfg);
    if (isBasicVdCreated !== true) {
      log.error(
        'Virtual device creation failed for scenario: ' +
        '"{}" with idPrefix: "{}"',
        scenarioCfg.name,
        scenario.idPrefix
      );
      return;
    }

    log.debug(
      'VD created successfully, init continues async ' +
      'for scenario: "{}" with idPrefix: "{}"',
      scenarioCfg.name,
      scenario.idPrefix
    );

    var scenarioStorage = scHelpers.getGlobalScenarioStore(
      CFG.scenarioTypeStr
    );
    scenarioStorage[scenario.idPrefix] = scenario;
    log.debug(
      'Stored in global registry with ID: {}',
      scenario.idPrefix
    );
  } catch (error) {
    log.error(
      'Exception during scenario initialization: ' +
      '"{}" for scenario: "{}"',
      error.message || error,
      scenarioCfg.name
    );
  }
}

/**
 * Find and return all scenarios of the requested type
 * @param {Array}  listScenario       - All scenarios from config
 * @param {string} searchScenarioType - Type to look for
 * @returns {Array}
 */
function findAllActiveScenariosWithType(
  listScenario,
  searchScenarioType
) {
  var matchedScenarios = [];
  for (var i = 0; i < listScenario.length; i++) {
    var scenario = listScenario[i];
    if (scenario.scenarioType === searchScenarioType) {
      matchedScenarios.push(scenario);
    }
  }
  return matchedScenarios;
}

function setup() {
  log.debug(
    'Start initialisation "{}" type scenarios',
    CFG.scenarioTypeStr
  );

  var listAllScenarios = scHelpers.readAndValidateScenariosConfig(
    CFG.configPath,
    CFG.reqVerGeneralCfg
  );
  if (!listAllScenarios) {
    return;
  }

  var targetScenarios = findAllActiveScenariosWithType(
    listAllScenarios,
    CFG.scenarioTypeStr
  );

  if (targetScenarios.length === 0) {
    log.debug(
      'No active scenarios found of type: {}',
      CFG.scenarioTypeStr
    );
    return;
  }

  log.debug(
    'Found {} active scenarios of type: {}',
    targetScenarios.length,
    CFG.scenarioTypeStr
  );

  for (var i = 0; i < targetScenarios.length; i++) {
    initializeScenario(targetScenarios[i]);
  }

  log.debug(
    'Initialization of "{}" type scenarios completed',
    CFG.scenarioTypeStr
  );
}

exports.setup = setup;
