/**
 * @file Скрипт для инициализации сценариев с типом SCENARIO_TYPE_STR
 * @overview Этот скрипт загружает все конфигурации сценарииев с типом
 *           SCENARIO_TYPE_STR из файла, находит все активные сценарии
 *           данного типа, и инициализирует их согласно настройкам, указанным
 *           в каждом сценарии.
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

var moduleInToOut = require("devices-control.mod");

/**
 * Глобальная переменная, хранящая строку типа сценария для поиска в конфиге
 * Сценарии SCENARIO_TYPE_STR могут соединять только два MQTT switch топика
 * @type {string}
 */
var SCENARIO_TYPE_STR = "devicesControl";

/**
 * Глобальная переменная, хранящая строку пути расположения файла конфигурации
 * @type {string}
 */
var CONFIG_PATH = "/etc/wb-scenarios.conf";

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
  log("Scenario found: " + JSON.stringify(scenario));

  var inControls = scenario.inControls;
  var outControls = scenario.outControls;
  log("Input Controls conf: " + inControls);
  log("Output Controls conf: " + outControls);

  // Check type prop - must be "switch" and equal
  // var isAllInputsSwitchTypes = true;
  // for (var i = 0; i < inControls.length; i++) {
  //   var curInControl = inControls[i].control;
  //   var inputType = dev[curInControl + "#type"];
  //   log("Input control: " + curInControl + " | Type: " + inputType);

  //   if (inputType !== "switch") {
  //     isAllInputsSwitchTypes = false;
  //     log("Error: Input control '" + curInControl + "' is not of type 'switch'");
  //     break;
  //   }
  // }

  var isAllOutputsSwitchTypes = true;
  for (var j = 0; j < outControls.length; j++) {
    var curOutControl = outControls[j].control;
    var outputType = dev[curOutControl + "#type"];
    log("Output control: " + curOutControl + " | Type: " + outputType);

    if (outputType !== "switch") {
      isAllOutputsSwitchTypes = false;
      log("Error: Output control '" + curOutControl + "' is not of type 'switch'");
      break;
    }
  }

  // var isValidTypes = (isAllInputsSwitchTypes && isAllOutputsSwitchTypes);
  var isValidTypes = (isAllOutputsSwitchTypes);
  if (!isValidTypes) {
    log("Error: One or more controls are not of type 'switch' for: " + scenario.name);
    return;
  }

  moduleInToOut.init(scenario.id_prefix,
    scenario.inControls,
    scenario.outControls);
  log("Initialization successful for: " + scenario.name);
}

function main() {
  var config = readConfig(CONFIG_PATH);
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
