/**
 * @file scenario-init-pid-controller.mod.js - ES5 module for wb-rules v2.34
 * @description Script for init scenarios of the pidController type.
 *     Loads all scenario configurations of the specific type from a file
 *     and initializes them according to the settings specified in each scenario.
 *
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var scHelpers = require('scenarios-general-helpers.mod');
var CustomTypeSc = require('pid-controller.mod').PidControllerScenario;
var Logger = require('logger.mod').Logger;

var CFG = {
  reqVerGeneralCfg: 1,
  reqVerScenario: 1,
  configPath: '/etc/wb-scenarios.conf',
  scenarioTypeStr: 'pidController'
};

var log = new Logger('WBSC-' + CFG.scenarioTypeStr + '-init');

/**
 * Initializes a single PID controller scenario
 * @param {Object} scenarioCfg - Scenario config object from wb-scenarios.conf
 */
function initializeScenario(scenarioCfg) {
  log.debug('Processing scenario config: "{}"', JSON.stringify(scenarioCfg));

  var scenario = new CustomTypeSc();
  var cfg = {
    idPrefix: scenarioCfg.idPrefix,
    sensor: scenarioCfg.sensor,
    setpoint: scenarioCfg.setpoint,
    setpointLimits: scenarioCfg.setpointLimits,
    pid: scenarioCfg.pid,
    calculationPeriodSec: scenarioCfg.calculationPeriodSec,
    deadBand: scenarioCfg.deadBand,
    actuators: scenarioCfg.actuators,
  };

  try {
    var isBasicVdCreated = scenario.init(scenarioCfg.name, cfg);
    if (isBasicVdCreated !== true) {
      log.error(
        'VD creation failed for scenario: "{}" with idPrefix: "{}"',
        scenarioCfg.name,
        scenario.idPrefix
      );
      return;
    }

    log.debug(
      'VD created, init continues async for scenario: "{}" with idPrefix: "{}"',
      scenarioCfg.name,
      scenario.idPrefix
    );

    var scenarioStorage = scHelpers.getGlobalScenarioStore(
      CFG.scenarioTypeStr
    );
    scenarioStorage[scenario.idPrefix] = scenario;
    log.debug('Stored in global registry with ID: ' + scenario.idPrefix);
  } catch (error) {
    log.error(
      'Exception during scenario init: "{}" for scenario: "{}"',
      error.message || error,
      scenarioCfg.name
    );
  }
}

function setup() {
  log.debug('Start initialisation "{}" type scenarios', CFG.scenarioTypeStr);
  var listAllScenarios = scHelpers.readAndValidateScenariosConfig(
    CFG.configPath,
    CFG.reqVerGeneralCfg
  );
  if (!listAllScenarios) return;

  var matchedScenarios = scHelpers.findAllScenariosWithType(
    listAllScenarios,
    CFG.scenarioTypeStr,
    CFG.reqVerScenario
  );
  if (matchedScenarios.length === 0) {
    log.debug(
      'No correct and active scenarios of type "{}" found',
      CFG.scenarioTypeStr
    );
    return;
  }

  log.debug('Number of matched scenarios: {}', matchedScenarios.length);
  for (var i = 0; i < matchedScenarios.length; i++) {
    initializeScenario(matchedScenarios[i]);
  }
}

exports.setup = setup;
