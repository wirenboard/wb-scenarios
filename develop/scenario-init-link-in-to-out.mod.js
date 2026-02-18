/**
 * @file scenario-init-link-in-to-out.mod.js - ES5 script for wb-rules 2.35
 * @description Module for initializing scenarios with SCENARIO_TYPE_STR type
 *
 * @author Ivan Ivanov <ivan.ivanov@wirenboard.com>         //@todo:Change 1
 */

var scHelpers = require('scenarios-general-helpers.mod');
var LinkInToOutScenario = require('link-in-to-out.mod').LinkInToOutScenario;  //@todo:Change 2,3
var Logger = require('logger.mod').Logger;

/**
 * Scenario initialization configuration
 * @typedef {Object} ScenarioConfig
 */
var CFG = {
  reqVerGeneralCfg: 1,        // Required version of general config structure
  reqVerScenario: 1,          // Required version of this scenario type config
  configPath: '/etc/wb-scenarios.conf', // TODO(Valerii): Need refactor into a constant
  scenarioTypeStr: 'linkInToOut',  //@todo:Change 4
};

var log = new Logger('WBSC-' + CFG.scenarioTypeStr + '-init');

/**
 * Initialize scenario using specified settings
 * @param {object} scenarioCfg - Scenario object containing settings
 * @returns {void}
 */
function initializeScenario(scenarioCfg) {
  log.debug('Processing scenario config: "{}"', JSON.stringify(scenarioCfg));

  var scenario = new LinkInToOutScenario();   //@todo:Change 5
  var cfg = {
    idPrefix: scenarioCfg.idPrefix,
    inControl: scenarioCfg.inControl,         //@todo:Change 6
    outControl: scenarioCfg.outControl,       //@todo:Change 7
    inverseLink: scenarioCfg.inverseLink,     //@todo:Change 8
  };

  try {
    // Returns true if VD created successfully; full initialization continues asynchronously
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
