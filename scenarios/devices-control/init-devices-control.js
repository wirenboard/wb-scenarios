/**
 * @file Скрипт для инициализации сценариев с типом SCENARIO_TYPE_STR
 * @overview Этот скрипт:
 *             - Загружает все конфигурации сценарииев с типом
 *               SCENARIO_TYPE_STR из файла
 *             - Находит все активные сценарии данного типа
 *             - Инициализирует их согласно настройкам, указанным
 *               в каждом сценарии
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

var moduleInToOut = require("devices-control.mod");

/**
 * Глобальная переменная, хранящая строку пути расположения файла конфигурации
 * @type {string}
 */
var CONFIG_PATH = "/etc/wb-scenarios.conf";

/**
 * Глобальная переменная, хранящая строку типа сценария для поиска в конфиге
 * @type {string}
 */
var SCENARIO_TYPE_STR = "devicesControl";

/**
 * Находит и возвращает все включеные сценарии с типом searchScenarioType
 * @param {Array} listScenario - Массив всех сценариев из конфигурации
 * @param {string} searchScenarioType - Тип сценария который ищем
 * @returns {Array} Массив активных сценариев с типом searchScenarioType
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

/**
 * Инициализирует сценарий с использованием указанных настроек
 * @param {object} scenario - Объект сценария, содержащий настройки
 * @returns {void}
 */
function initializeScenario(scenario) {
  log.debug("Processing scenario: " + JSON.stringify(scenario));

  var isInitSucess = moduleInToOut.init(scenario.id_prefix,
                                        scenario.name,
                                        scenario.inControls,
                                        scenario.outControls);
  if (!isInitSucess) {
    log.error("Error: Init operation aborted for scenario with 'idPrefix': " + scenario.id_prefix);
    return;
  }

  log.debug("Initialization successful for: " + scenario.name);
}

/**
 * Читает конфигурационный файл и возвращает объект конфигурации.
 * @param {string} configPath Путь к конфигурационному файлу.
 * @returns {Object|null} Возвращает:
 *                          - Массив: сценариев если проверки пройденыили
 *                          - null: в случае ошибки
 */
function readAndValidateConfig(configPath) {
  log.debug("Input config path: " + configPath);
  var config = readConfig(configPath);

  if (!config) {
    log.error("Error: Could not read config from " + configPath);
    return null;
  }
  log.debug("Input config contain: " + JSON.stringify(config));

  // Проверяем существование поля, тип массив, что не пуст
  if (!config.hasOwnProperty('scenarios')) {
    log.error("Error: 'scenarios' does not exist in the configuration.");
    return null;
  }

  var listAllScenarios = config.scenarios;
  if (!Array.isArray(listAllScenarios)) {
    log.error("Error: 'scenarios' is not an array.");
    return null;
  }

  if (listAllScenarios.length === 0) {
    log.debug("'scenarios' array is empty.");
    return null;
  }

  return listAllScenarios;
}

function main() {
  var listAllScenarios = readAndValidateConfig(CONFIG_PATH);
  if (!listAllScenarios) return;

  var matchedScenarios = findAllActiveScenariosWithType(listAllScenarios,
                                                  SCENARIO_TYPE_STR);
  if (matchedScenarios.length === 0) {
    log.debug("No correct and active scenarios of type '" + SCENARIO_TYPE_STR + "' found.");
    return;
  }
  
  log.debug("Number of matched scenarios: " + JSON.stringify(matchedScenarios));

  for (var i = 0; i < matchedScenarios.length; i++) {
    initializeScenario(matchedScenarios[i]);
  }
}

main();
