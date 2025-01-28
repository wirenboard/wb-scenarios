/**
 * @file scenario-init-thermostat.js
 * @description Скрипт для инициализации сценариев с типом SCENARIO_TYPE_STR
 *     Этот скрипт:
 *     - Загружает все конфигурации сценарииев с типом
 *       SCENARIO_TYPE_STR из файла
 *     - Находит все активные сценарии данного типа
 *     - Инициализирует их согласно настройкам, указанным
 *       в каждом сценарии
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

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
var SCENARIO_TYPE_STR = 'thermostat';

var helpers = require('scenarios-general-helpers.mod');
var scenarioModule = require('thermostat.mod');

/**
 * Инициализирует сценарий с использованием указанных настроек
 * @param {object} scenario - Объект сценария, содержащий настройки
 * @returns {void}
 */
function initializeScenario(scenario) {
  log.debug('Processing scenario: ' + JSON.stringify(scenario));

  var cfg = {
    idPrefix: scenario.idPrefix,
    targetTemperature: scenario.targetTemperature,
    hysteresis: scenario.hysteresis,
    temperatureSensor: scenario.temperatureSensor,
    actuator: scenario.actuator,
  };
  var isInitSucess = scenarioModule.init(scenario.name, cfg);

  if (isInitSucess !== true) {
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

  log.debug(
    'Number of matched scenarios: ' + JSON.stringify(matchedScenarios.length)
  );
  log.debug('Matched scenarios JSON: ' + JSON.stringify(matchedScenarios));

  for (var i = 0; i < matchedScenarios.length; i++) {
    initializeScenario(matchedScenarios[i]);
  }
}

main();
