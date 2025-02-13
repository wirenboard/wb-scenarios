/**
 * @file scenario-init-thermostat.js
 * @description Script for init scenarios of the SCENARIO_TYPE_STR type
 *     This script:
 *     - Loads all scenario configurations of the specific type from a file
 *     - Finds all active scenarios of this type
 *     - Initializes them according to the settings specified in each scenario
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link JSDoc comments format <https://jsdoc.app/> - Google styleguide
 */

/**
 * Required version of the common scenario configuration file structure
 *   The version changes rarely, only when there are modifications
 *   to the schema at the same level as the scenarios[] array
 * @type {number}
 */
var REQUIRED_GENERAL_CFG_VER = 1;

/**
 * Required version of the configuration for this type of scenarios
 *   The version changes every time the structure of the configuration
 *   for this scenario type is modified
 * @type {number}
 */
var REQUIRED_SCENARIO_CFG_VER = 1;

/**
 * String of the absolute path to the scenario configuration file
 * @type {string}
 */
var CONFIG_PATH = '/etc/wb-scenarios.conf';

/**
 * Scenario type for searching in the array of all scenario configurations
 * @type {string}
 */
var SCENARIO_TYPE_STR = 'thermostat';

var helpers = require('scenarios-general-helpers.mod');
var scenarioModule = require('thermostat.mod');

/**
 * Initializes a scenario using the specified settings
 * @param {object} scenario - The scenario object containing the settings
 * @returns {void}
 */
function initializeScenario(scenario) {
  log.debug('Processing scenario: ' + JSON.stringify(scenario));

  var cfg = {
    idPrefix: scenario.idPrefix,
    targetTemp: scenario.targetTemperature,
    tempLimitsMin: scenario.temperatureLimits.min,
    tempLimitsMax: scenario.temperatureLimits.max,
    hysteresis: scenario.hysteresis,
    tempSensor: scenario.temperatureSensor,
    actuator: scenario.actuator,
  };
  var isInitSuccess = scenarioModule.init(scenario.name, cfg);

  if (isInitSuccess !== true) {
    log.error(
      'Error: Init operation aborted for ' +
        'scenario name: "' +
        scenario.name +
        '" ' +
        'with idPrefix: "' +
        scenario.idPrefix +
        '"'
    );
    return;
  }

  log.debug('Initialization successful for: ' + scenario.name);
}

function main() {
  log.debug('Start initialisation ' + SCENARIO_TYPE_STR + ' scenario');
  var listAllScenarios = helpers.readAndValidateScenariosConfig(
    CONFIG_PATH,
    REQUIRED_GENERAL_CFG_VER
  );
  if (!listAllScenarios) return;

  var matchedScenarios = helpers.findAllActiveScenariosWithType(
    listAllScenarios,
    SCENARIO_TYPE_STR,
    REQUIRED_SCENARIO_CFG_VER
  );
  if (matchedScenarios.length === 0) {
    log.debug(
      'No correct and active scenarios of type "' +
        SCENARIO_TYPE_STR +
        '" found'
    );
    return;
  }

  log.debug('Number of matched scenarios: ' + matchedScenarios.length);
  log.debug('Matched scenarios JSON: ' + JSON.stringify(matchedScenarios));

  for (var i = 0; i < matchedScenarios.length; i++) {
    initializeScenario(matchedScenarios[i]);
  }
}

main();
