/**
 * @file Модуль содержащий фукнции используемые при инициализации сценариев
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

/**
 * Находит и возвращает все включеные сценарии с типом searchScenarioType
 * @param {Array} listScenario - Массив всех сценариев из конфигурации
 * @param {string} searchScenarioType - Тип сценария который ищем
 * @param {number} reqScenarioCfgVer - Номер версии конфига конкретного
 *                                     типа сценария
 * @returns {Array} Массив активных сценариев с типом searchScenarioType
 */
function findAllActiveScenariosWithType(listScenario,
                                        searchScenarioType,
                                        reqScenarioCfgVer) {
  var matchedScenarios = [];
  for (var i = 0; i < listScenario.length; i++) {
    var scenario = listScenario[i];
    var isTarget = (scenario.scenarioType === searchScenarioType) &&
                   (scenario.enable === true);
    if (!isTarget) {
      continue;
    }

    var isValidCfgVer = (scenario.componentVersion === reqScenarioCfgVer);
    if (!isValidCfgVer) {
      log.error("Scenario with name '" + scenario.name + "' config version mismatch. Expected version: " + reqScenarioCfgVer + ", but got: " + scenario.componentVersion);
      continue;
    }

    matchedScenarios.push(scenario);
  }

  return matchedScenarios;
}

/**
 * Читает конфигурационный файл и возвращает 
 * @param {string} configPath - Путь к конфигурационному файлу
 * @param {number} reqGeneralCfgVer - Номер версии общей структуры конфига сценариев
 * @returns {Object|null} Возвращает:
 *                          - Массив: конфигурации всех сценариев
 *                                    (если проверки пройденыили)
 *                          - null: говорит о невозможности прочесть конфиг
 *                                  (в случае ошибки или отстутсвия конфигов)
 */
function readAndValidateScenariosConfig(configPath, reqGeneralCfgVer) {
  log.debug("Input config path: " + configPath);
  var config = readConfig(configPath);

  if (!config) {
    log.error("Error: Could not read config from " + configPath);
    return null;
  }
  log.debug("The input config contains: " + JSON.stringify(config));

  if (!config.hasOwnProperty('configVersion')) {
    log.error("Error: 'configVersion' does not exist in the configuration.");
    return null;
  }
  if (config.configVersion !== reqGeneralCfgVer) {
    log.error("Global config version mismatch. Expected version: " + reqGeneralCfgVer + ", but got: " + config.configVersion);
    return null;
  }

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

exports.findAllActiveScenariosWithType = function (listScenario,
                                                   searchScenarioType,
                                                   reqScenarioCfgVer) {
  var res = findAllActiveScenariosWithType(listScenario,
                                           searchScenarioType,
                                           reqScenarioCfgVer);
  return res;
};

exports.readAndValidateScenariosConfig = function (configPath,
                                                   reqGeneralCfgVer) {
  var res = readAndValidateScenariosConfig(configPath,
                                           reqGeneralCfgVer);
  return res;
};
