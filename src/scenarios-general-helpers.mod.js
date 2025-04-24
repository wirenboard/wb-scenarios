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
 * Finds and returns all scenarios of the specified type
 * @param {Array} listScenario An array of all scenarios from the config
 * @param {string} searchScenarioType The type of scenario to search for
 * @param {number} reqScenarioCfgVer The configuration version number
 *     for the specific scenario type
 * @returns {Array} An array of scenarios with type searchScenarioType
 */
function findAllScenariosWithType(
  listScenario,
  searchScenarioType,
  reqScenarioCfgVer
) {
  var matchedScenarios = [];
  for (var i = 0; i < listScenario.length; i++) {
    var scenario = listScenario[i];
    if (scenario.scenarioType !== searchScenarioType) {
      continue;
    }

    if (scenario.componentVersion !== reqScenarioCfgVer) {
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
  var isIdPrefixProvided = cfg.idPrefix && cfg.idPrefix.trim() !== '';

  var idPrefix = isIdPrefixProvided ? cfg.idPrefix : translit(deviceTitle);
  return idPrefix;
}

/**
 * Gets or creates a global storage for a specific scenario type
 * Ensures the global 'wbScenarios' object exists and has a structure 
 * for the requested scenario type
 * @param {string} scenarioType - The type of scenario (e.g., 'lightControl')
 * @returns {Object} The global storage object for this scenario type
 */
function getGlobalScenarioStore(scenarioType) {
  // Initialize global wbScenarios object if it doesn't exist
  if (!global.wbScenarios) {
    global.wbScenarios = {};
  }

  // Initialize storage for this specific scenario type if it doesn't exist
  if (!global.wbScenarios[scenarioType]) {
    global.wbScenarios[scenarioType] = {};
  }

  return global.wbScenarios[scenarioType];
}


/**
 * @typedef {Object} Device
 * @property {string} mqttTopicName - MQTT topic identifier for the device
 * @property {string} behaviorType - Defines how the device responds to events
 * @property {number} [actionValue] - Optional threshold value for behavior triggers
 */

/**
 * Extracts MQTT topic names from a collection of devices.
 * 
 * Efficiently maps through the provided devices array to extract only the
 * mqttTopicName property from each device object.
 *
 * @param {Device[]} devices - Collection of device configuration objects
 * @returns {string[]} Array of extracted MQTT topic names
 * @throws {TypeError} When provided parameter is not an array
 *
 * @example
 * // Returns ["wb-mr6cv3_127/K6", "wb-msw-v4_34/Current Motion"]
 * extractMqttTopics([
 *   { mqttTopicName: "wb-mr6cv3_127/K6", behaviorType: "setEnable" },
 *   { 
 *     mqttTopicName: "wb-msw-v4_34/Current Motion", 
 *     behaviorType: "whileValueHigherThanThreshold", 
 *     actionValue: 170 
 *   }
 * ]);
 */
function extractMqttTopics(devices) {
  if (!Array.isArray(devices)) {
    throw new TypeError('The devices parameter must be an array');
  }
  
  var result = [];
  for (var i = 0; i < devices.length; i++) {
    result.push(devices[i].mqttTopicName);
  }
  return result;
}

exports.findAllScenariosWithType = findAllScenariosWithType;
exports.findAllActiveScenariosWithType = findAllActiveScenariosWithType;
exports.readAndValidateScenariosConfig = readAndValidateScenariosConfig;
exports.getIdPrefix = getIdPrefix;
exports.getGlobalScenarioStore = getGlobalScenarioStore;
exports.extractMqttTopics = extractMqttTopics;
