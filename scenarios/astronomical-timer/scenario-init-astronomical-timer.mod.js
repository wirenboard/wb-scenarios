/**
 * @file scenario-init-astronomical-timer.mod.js
 * @description Script for init scenarios of the
 *   astronomicalTimer type
 */

var scHelpers = require('scenarios-general-helpers.mod');
var CustomTypeSc =
  require('astronomical-timer.mod').AstronomicalTimerScenario;
var Logger = require('logger.mod').Logger;

var CFG = {
  reqVerGeneralCfg: 1,
  reqVerScenario: 1,
  configPath: '/etc/wb-scenarios.conf',
  scenarioTypeStr: 'astronomicalTimer',
};

var log = new Logger('WBSC-' + CFG.scenarioTypeStr + '-init');

/**
 * Initializes a scenario using the specified settings
 * @param {object} scenarioCfg
 * @returns {void}
 */
function initializeScenario(scenarioCfg) {
  log.debug('Processing scenario config: "{}"', JSON.stringify(scenarioCfg));

  var scenario = new CustomTypeSc();
  var cfg = {
    idPrefix: scenarioCfg.idPrefix,
    latitude: scenarioCfg.latitude != null ? scenarioCfg.latitude : 55.7558,
    longitude:
      scenarioCfg.longitude != null ? scenarioCfg.longitude : 37.6173,
    astroEvent: scenarioCfg.astroEvent || 'sunrise',
    offset: scenarioCfg.offset != null ? scenarioCfg.offset : 0,
    customElevation:
      scenarioCfg.customElevation != null ? scenarioCfg.customElevation : 0,
    customAngleDirection: scenarioCfg.customAngleDirection || 'rising',
    scheduleDaysOfWeek: scenarioCfg.scheduleDaysOfWeek || [],
    outControls: scenarioCfg.outControls || [],
  };

  try {
    var isBasicVdCreated = scenario.init(scenarioCfg.name, cfg);
    if (isBasicVdCreated !== true) {
      log.error(
        'VD creation failed for scenario: "{}" idPrefix: "{}"',
        scenarioCfg.name,
        scenario.idPrefix
      );
      return;
    }

    log.debug(
      'VD created, init continues async for: "{}" idPrefix: "{}"',
      scenarioCfg.name,
      scenario.idPrefix
    );

    var scenarioStorage = scHelpers.getGlobalScenarioStore(
      CFG.scenarioTypeStr
    );
    scenarioStorage[scenario.idPrefix] = scenario;
    log.debug('Stored in global registry: {}', scenario.idPrefix);
  } catch (error) {
    log.error(
      'Exception during init: "{}" for: "{}"',
      error.message || error,
      scenarioCfg.name
    );
  }
}

/**
 * Find all enabled scenarios of the requested type
 * @param {Array} listScenario
 * @param {string} searchScenarioType
 * @returns {Array}
 */
function findAllActiveScenariosWithType(listScenario, searchScenarioType) {
  var matchedScenarios = [];
  for (var i = 0; i < listScenario.length; i++) {
    var scenario = listScenario[i];
    var isTarget =
      scenario.scenarioType === searchScenarioType &&
      scenario.enable === true;
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
  if (!listAllScenarios) {
    return;
  }

  var targetScenarios = findAllActiveScenariosWithType(
    listAllScenarios,
    CFG.scenarioTypeStr
  );

  if (targetScenarios.length === 0) {
    log.debug('No active scenarios found of type: {}', CFG.scenarioTypeStr);
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

  log.debug('Initialization of "{}" completed', CFG.scenarioTypeStr);
}

exports.setup = setup;
