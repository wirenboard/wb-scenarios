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
function findAllScenariosWithType(listScenario, searchScenarioType) {
  var resScenarios = [];
  for (var i = 0; i < listScenario.length; i++) {
    var scenario = listScenario[i];
    var isTarget = (scenario.scenarioType === searchScenarioType) &&
      (scenario.enable === true);
    if (isTarget) {
      resScenarios.push(scenario);
    }
  }
  return resScenarios;
}

/**
 * Инициализирует сценарий с использованием указанных настроек
 * @param {object} scenario - Объект сценария, содержащий настройки
 */
function initializeScenario(scenario) {
  log("Processing scenario: " + JSON.stringify(scenario));

  moduleInToOut.init(scenario.id_prefix,
    scenario.inControls,
    scenario.outControls);

  log("Initialization successful for: " + scenario.name);
}

function main() {
  var config = readConfig(CONFIG_PATH);
  if (!config) {
    log("Error: Could not read config from " + CONFIG_PATH);
    return;
  }
  log("Input config: " + JSON.stringify(config));

  var listScenario = config.scenarios;
  if (!Array.isArray(listScenario) || listScenario.length === 0) {
    log("Error: 'scenarios' is not an array, does not exist, or is empty.");
    return;
  }

  var resScenarios = findAllScenariosWithType(listScenario, SCENARIO_TYPE_STR);
  if (resScenarios.length === 0) {
    log("Error: No scenarios of type '" + SCENARIO_TYPE_STR + "' found.");
    return;
  }

  for (var i = 0; i < resScenarios.length; i++) {
    initializeScenario(resScenarios[i]);
  }
}

main();
