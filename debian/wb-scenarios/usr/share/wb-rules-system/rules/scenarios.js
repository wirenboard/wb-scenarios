/**
 * @file Скрипт для инициализации сценариев с типом LINK_IN_TO_OUT_TYPE
 * @overview Этот скрипт загружает все конфигурации сценарииев с типом
 *           LINK_IN_TO_OUT_TYPE из файла, находит все активные сценарии
 *           данного типа, и инициализирует их согласно настройкам, указанным
 *           в каждом сценарии. Сценарии могут быть инвертированы в
 *           зависимости от указанных параметров
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

var moduleInToOut = require("link-in-to-out.mod");

/**
 * Глобальная переменная, хранящая строку типа сценария для поиска в конфиге
 * Сценарии LINK_IN_TO_OUT_TYPE могут соединять только два MQTT switch топика
 * @type {string}
 */
var LINK_IN_TO_OUT_TYPE = "linkInToOut";

/**
 * Глобальная переменная, хранящая строку пути расположения файла конфигурации
 * @type {string}
 */
var CONFIG_PATH = "/etc/scenarios.conf";

/**
 * Находит и возвращает все включеные сценарии с типом LINK_IN_TO_OUT_TYPE
 * @param {Array} listScenario - Массив всех сценариев из конфигурации
 * @returns {Array} Массив активных сценариев с типом LINK_IN_TO_OUT_TYPE
 */
function findAllLinkInToOutScenarios(listScenario) {
    var scenarios = [];
    for (var i = 0; i < listScenario.length; i++) {
        var scenario = listScenario[i];
        var isTarget = (scenario.scenarioType === LINK_IN_TO_OUT_TYPE) &&
                       (scenario.enable === true);
        if (isTarget) {
            scenarios.push(scenario);
        }
    }
    return scenarios;
}

/**
 * Инициализирует сценарий с использованием указанных настроек
 * @param {object} scenario - Объект сценария, содержащий настройки
 */
function initializeScenario(scenario) {
    log("Scenario found: " + JSON.stringify(scenario));
    log("Control Input: " + scenario.inControl);
    log("Control Output: " + scenario.outControl);

    // Check type prop - must be "switch" and equal
    inputType = dev[scenario.inControl + "#type"];
    outputType = dev[scenario.outControl + "#type"];
    log("Input type: " + inputType);
    log("Output type: " + outputType);

    var isValidTypes = (inputType === outputType) && (inputType === "switch");
    if (!isValidTypes) {
        log("Error: In and Out types are not the same for: " + scenario.name);
        return;
    }

    moduleInToOut.init(scenario.id_prefix,
                       scenario.inControl,
                       scenario.outControl,
                       scenario.inverseLink);
    log("Initialization successful for: " + scenario.name);
}

function main() {
  var config = readConfig("/etc/scenarios.conf");
  log("Input config: " + JSON.stringify(config));

  var listScenario = config.scenarios;
  if (!Array.isArray(listScenario) || listScenario.length === 0) {
      log("Error: 'scenarios' is not an array, does not exist, or is empty.");
      return;
  }

  var linkScenarios = findAllLinkInToOutScenarios(listScenario);
  if (linkScenarios.length === 0) {
      log("Error: No scenarios of type '" + LINK_IN_TO_OUT_TYPE + "' found.");
      return;
  }

  linkScenarios.forEach(initializeScenario);
}

main();