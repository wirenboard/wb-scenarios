/**
 * @file scenarios-general-helpers.mod.js
 * @description A module containing general func used in several scenarios
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Comments formatted in JSDoc <https://jsdoc.app/> - Google styleguide
 */

var translit = require('translit.mod').translit;
var Logger = require('logger.mod').Logger;
var log = new Logger('WBSC-helper');

/**
 * Finds and returns all enabled scenarios of the specified type
 * @param {Array} listScenario An array of all scenarios from the config
 * @param {string} searchScenarioType The type of scenario to search for
 * @param {number} reqScenarioCfgVer The configuration version number
 *     for the specific scenario type
 * @returns {Array} An array of active scenarios with type searchScenarioType
 */
function findAllActiveScenariosWithType(
  listScenario,
  searchScenarioType,
  reqScenarioCfgVer
) {
  var matchedScenarios = [];
  for (var i = 0; i < listScenario.length; i++) {
    var scenario = listScenario[i];
    var isTarget =
      scenario.scenarioType === searchScenarioType &&
      scenario.enable === true;
    if (!isTarget) {
      continue;
    }

    var isValidCfgVer = scenario.componentVersion === reqScenarioCfgVer;
    if (!isValidCfgVer) {
      log.error(
        'Scenario with name "{}" cfg ver mismatch. Expected: "{}", got: "{}"',
        scenario.name,
        reqScenarioCfgVer,
        scenario.componentVersion
      );
      continue;
    }
    matchedScenarios.push(scenario);
  }

  return matchedScenarios;
}

/**
 * Reads the configuration file and returns its contents
 * @param {string} configPath The path to the configuration file
 * @param {number} reqGeneralCfgVer The version number of the general
 *     scenario configuration structure
 * @returns {Object|null} Returns:
 *     - array: the configuration of all scenarios if validation is successful
 *     - null: indicates that the configuration could not be read
 *       due to an error or missing configuration files
 */
function readAndValidateScenariosConfig(configPath, reqGeneralCfgVer) {
  log.debug('Input config path: "{}"', configPath);
  var config = readConfig(configPath);

  if (!config) {
    log.error('Error: Could not read config from "{}"', configPath);
    return null;
  }
  log.debug('The input config contains: "{}"', JSON.stringify(config));

  if (!config.hasOwnProperty('configVersion')) {
    log.error('"configVersion" does not exist in the configuration');
    return null;
  }

  if (config.configVersion !== reqGeneralCfgVer) {
    log.error(
      'Global config version mismatch. Expected version: "{}", but got: "{}"',
      reqGeneralCfgVer,
      config.configVersion
    );
    return null;
  }

  if (!config.hasOwnProperty('scenarios')) {
    log.error('"scenarios" does not exist in the configuration');
    return null;
  }

  var listAllScenarios = config.scenarios;
  if (!Array.isArray(listAllScenarios)) {
    log.error('"scenarios" is not an array');
    return null;
  }

  if (listAllScenarios.length === 0) {
    log.debug('"scenarios" array is empty');
    return null;
  }

  log.debug('Config "scenarios" array is correct');
  return listAllScenarios;
}

/**
 * Returns the ID prefix based on the provided configuration or
 *     transliterates the device title
 * @param {string} deviceTitle The device title used for transliteration
 *     if 'idPrefix' is not provided
 * @param {Object} cfg The configuration object containing
 *     the 'idPrefix' property
 * @return {string} The ID prefix
 */
function getIdPrefix(deviceTitle, cfg) {
  var idPrefix = '';
  var isIdPrefixProvided = cfg.idPrefix && cfg.idPrefix.trim() !== '';

  if (isIdPrefixProvided === true) {
    idPrefix = cfg.idPrefix;
  } else {
    idPrefix = translit(deviceTitle);
  }
  return idPrefix;
}

exports.findAllActiveScenariosWithType = findAllActiveScenariosWithType;
exports.readAndValidateScenariosConfig = readAndValidateScenariosConfig;
exports.getIdPrefix = getIdPrefix;
