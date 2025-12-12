/**
 * @file scenario-init-schedule.mod.js - ES5 module for wb-rules v2.34
 * @description Script for init scenarios of the schedule type
 * @author Ivan Praulov <ivan.praulov@wirenboard.com>
 */

var scHelpers = require('scenarios-general-helpers.mod');
var CustomTypeSc = require('schedule.mod').ScheduleScenario;
var Logger = require('logger.mod').Logger;

/**
 * Scenario initialization configuration parameters
 * @typedef {Object} ScenarioConfig
 */
var CFG = {
  reqVerGeneralCfg: 1, // Required version of common config structure
  reqVerScenario: 1, // Required version of this scenario type config
  configPath: '/etc/wb-scenarios.conf',
  scenarioTypeStr: 'schedule'
};

var log = new Logger('WBSC-' + CFG.scenarioTypeStr + '-init');

/**
 * Initializes a scenario using the specified settings
 * @param {object} scenarioCfg - The scenario object containing the settings
 * @returns {void}
 */
function initializeScenario(scenarioCfg) {
  log.debug('Processing scenario config: "{}"', JSON.stringify(scenarioCfg));

  var scenario = new CustomTypeSc();
  var cfg = {
    idPrefix: scenarioCfg.idPrefix,
    scheduleTime: scenarioCfg.scheduleTime || "12:00",
    scheduleDaysOfWeek: scenarioCfg.scheduleDaysOfWeek || [],
    outControls: scenarioCfg.outControls || []
  };

  try {
    // Returns true if VD created successfully; full initialization continue asynchronously
    var isBasicVdCreated = scenario.init(scenarioCfg.name, cfg);
    if (isBasicVdCreated !== true) {
      log.error(
        'Virtual device creation failed for scenario name: "{}" with idPrefix: "{}"',
        scenarioCfg.name,
        scenario.idPrefix
      );
      return;
    }

    log.debug(
      'VD created successfully, init continue asynchronously for scenario name: "{}" with idPrefix: "{}"',
      scenarioCfg.name,
      scenario.idPrefix
    );

    var scenarioStorage = scHelpers.getGlobalScenarioStore(
      CFG.scenarioTypeStr
    );
    scenarioStorage[scenario.idPrefix] = scenario;
    log.debug('Stored in global registry with ID: {}', scenario.idPrefix);
  } catch (error) {
    log.error(
      'Exception during scenario initialization: "{}" for scenario: "{}"', 
      error.message || error, 
      scenarioCfg.name
    );
  }
}

/**
 * Find and return all enabled scenarios of the requested type
 * @param {Array} listScenario - Array of all scenarios from the config
 * @param {string} searchScenarioType - Scenario type we are looking for
 * @returns {Array} Array of active scenarios of that type
 */
function findAllActiveScenariosWithType(listScenario, searchScenarioType) {
  var matchedScenarios = [];
  for (var i = 0; i < listScenario.length; i++) {
    var scenario = listScenario[i];
    var isTarget = (scenario.scenarioType === searchScenarioType) &&
      (scenario.enable === true);
    if (isTarget) {
      matchedScenarios.push(scenario);
    }
  }
  return matchedScenarios;
}

function setup() {
  log.debug('Start initialisation "{}" type scenarios', CFG.scenarioTypeStr);
  var listAllScenarios = scHelpers.readAndValidateScenariosConfig(
    CFG.configPath,
    CFG.reqVerGeneralCfg
  );
  if (!listAllScenarios) return;

  var targetScenarios = findAllActiveScenariosWithType(
    listAllScenarios, 
    CFG.scenarioTypeStr
  );
  
  if (targetScenarios.length === 0) {
    log.debug('No active scenarios found of type: {}', CFG.scenarioTypeStr);
    return;
  }

  log.debug('Found {} active scenarios of type: {}', 
    targetScenarios.length, 
    CFG.scenarioTypeStr
  );

  for (var i = 0; i < targetScenarios.length; i++) {
    initializeScenario(targetScenarios[i]);
  }
  
  log.debug('Initialization of "{}" type scenarios completed', CFG.scenarioTypeStr);
}

exports.setup = setup;