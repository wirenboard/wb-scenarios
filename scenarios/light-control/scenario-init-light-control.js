/**
 * @file init-light-control.js - script for WirenBoard wb-rules v2.28.4
 * @description Script for init scenarios of the SCENARIO_TYPE type
 *     This script:
 *     - Loads all scenario configurations of the specific type from a file
 *     - Finds all active scenarios of this type
 *     - Initializes them according to the settings specified in each scenario
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Comments formatted in JSDoc <https://jsdoc.app/> - Google styleguide
 */

var scGenHelpers = require('scenarios-general-helpers.mod');
var LightControlSc  = require('light-control.mod').LightControlScenario;
var Logger = require('logger.mod').Logger;

var log = new Logger('WBSC-light-init');

/**
 * Требуемая версия общей структуры файла конфигурации сценариев
 *   Версия меняется редко, только при изменениях в схеме
 *   на одном уровне с array scenarios[]
 * @type {number}
 */
var REQUIRED_GENERAL_CFG_VER = 1;

/**
 * Требуемая версия конфигурации данного вида сценариев
 *   Версия меняется каждый раз когда изменяется структура конфига
 *   данного типа сценария
 * @type {number}
 */
var REQUIRED_SCENARIO_CFG_VER = 1;

/**
 * Строка абсолютного пути расположения файла конфигурации сценариев
 * @type {string}
 */
var CONFIG_PATH = '/etc/wb-scenarios.conf';

/**
 * Строка типа сценария для поиска в массиве конфигов всех сценариев
 * @type {string}
 */
var SCENARIO_TYPE = 'lightControl';

/**
 * Инициализирует сценарий с использованием указанных настроек
 * @param {object} scenarioCfg - Объект сценария, содержащий настройки
 * @returns {void}
 */
function initializeScenario(scenarioCfg) {
  log.debug('Processing scenario: ' + JSON.stringify(scenarioCfg));

  var cfg = {
    idPrefix: scenarioCfg.id_prefix,
    isDebugEnabled: scenarioCfg.isDebugEnabled,
    delayByMotionSensors: scenarioCfg.motionSensors.delayToLightOff,
    delayByOpeningSensors: scenarioCfg.openingSensors.delayToLightOff,
    isDelayEnabledAfterSwitch: scenarioCfg.lightSwitches.isDelayEnabled,
    delayBlockAfterSwitch: scenarioCfg.lightSwitches.delayToLightOffAndEnable,
    lightDevices: scenarioCfg.lightDevices.sensorObjects,
    motionSensors: scenarioCfg.motionSensors.sensorObjects,
    openingSensors: scenarioCfg.openingSensors.sensorObjects,
    lightSwitches: scenarioCfg.lightSwitches.sensorObjects,
  };
  var scenario = new LightControlSc();
  var isInitSucess = scenario.init(scenarioCfg.name, cfg);
  if (!isInitSucess) {
    log.error('Init aborted for idPrefix=' + scenarioCfg.id_prefix);
    return;
  }

  log.debug('Initialization successful for: ' + scenarioCfg.name);
}

function main() {
  log.debug('Start initialisation light control scenario.');
  var listAllScenarios = scGenHelpers.readAndValidateScenariosConfig(
    CONFIG_PATH,
    REQUIRED_GENERAL_CFG_VER
  );
  if (!listAllScenarios) return;

  var matchedScenarios = scGenHelpers.findAllActiveScenariosWithType(
    listAllScenarios,
    SCENARIO_TYPE,
    REQUIRED_SCENARIO_CFG_VER
  );
  if (matchedScenarios.length === 0) {
    log.debug(
      'No valid and active scenarios of type "' + SCENARIO_TYPE + '" found'
    );
    return;
  }

  log.debug(
    'Number of matched scenarios: ' + JSON.stringify(matchedScenarios.length)
  );
  log.debug('Matched scenarios JSON: ' + JSON.stringify(matchedScenarios));

  for (var i = 0; i < matchedScenarios.length; i++) {
    initializeScenario(matchedScenarios[i]);
  }
}

main();
