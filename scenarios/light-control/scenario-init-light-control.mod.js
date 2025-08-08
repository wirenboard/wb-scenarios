/**
 * @file init-light-control.js - ES5 script for wb-rules v2.28
 * @description Script for init scenarios of the SCENARIO_TYPE_STR type
 *     This script:
 *     - Loads all scenario configurations of the specific type from a file
 *     - Initializes them according to the settings specified in each scenario
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 */

var scHelpers = require('scenarios-general-helpers.mod');
var CustomTypeSc = require('light-control.mod').LightControlScenario;
var Logger = require('logger.mod').Logger;

/**
 * Scenario initialization configuration parameters
 * @typedef {Object} ScenarioConfig
 */
var CFG = {
  reqVerGeneralCfg: 1, // Required version of common config structure
  reqVerScenario: 1, // Required version of this scenario type config
  configPath: '/etc/wb-scenarios.conf',
  scenarioTypeStr: 'lightControl',
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
    idPrefix: scenarioCfg.id_prefix,
    isDebugEnabled: scenarioCfg.isDebugEnabled,
    delayByMotionSensors: scenarioCfg.motionSensors.delayToLightOff,
    delayByOpeningSensors: scenarioCfg.openingSensors.delayToLightOff,
    isDelayEnabledAfterSwitch: scenarioCfg.lightSwitches.isDelayEnabled,
    delayBlockAfterSwitch:
      scenarioCfg.lightSwitches.delayToLightOffAndEnable,
    lightDevices: scenarioCfg.lightDevices.sensorObjects,
    motionSensors: scenarioCfg.motionSensors.sensorObjects,
    openingSensors: scenarioCfg.openingSensors.sensorObjects,
    lightSwitches: scenarioCfg.lightSwitches.sensorObjects,
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
    log.debug('Stored in global registry with ID: ' + scenario.idPrefix);
  } catch (error) {
    log.error(
      'Exception during scenario initialization: "{}" for scenario: "{}"', 
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
