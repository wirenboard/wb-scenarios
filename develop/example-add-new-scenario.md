Пример добавления базового простого сценария 

@todo: Синхронизировать схему с кодом
       На данный момент схема приведена для прмера и не синхронизирована с кодом

1. Добавляем базовую новую в схему

Обратите внимание на поле версии данного вида сценариев.
Данное поле важно для проверки пользовательского конфига перед началом работы.
Версию нужно инкрементировать каждый раз когда меняется структура конфигурации сценариев.

```
"linkInToOut": {
    "type": "object",
    "title": "Link in to out",
    "description":"Данный сценарий предоставляет возможность прямого соединения дискретного входа с дискретным выходом<br><img src=\"images/scenarios-link-in-to-out.png\">",
    "_format": "grid",
    "properties": {
        "scenarioType": {
            "type": "string",
            "enum": ["linkInToOut"],
            "default": "linkInToOut",
            "options": {
                "hidden": true
            }
        },
        "enable": {
            "type": "boolean",
            "title": "Enable",
            "default": true,
            "_format": "checkbox",
            "propertyOrder": 1,
            "options": {
                "grid_columns": 12
            }
        },
        "name": {
            "type": "string",
            "title": "Scenario name",
            "default": "Управление нагрузкой",
            "minLength": 1,
            "maxLength": 30,
            "propertyOrder": 2,
            "options": {
                "grid_columns": 12
            }
        },
        "id_prefix": {
            "type": "string",
            "title": "ID Prefix",
            "description": "Одно слово на английском языке исключая: пробел, /, +, #. Длина до 15 символов.",
            "_pattern_comment": "Запрещает пробелы, /, +, и #, а также ограничивает строку использованием только цифр, нижнего подчеркивания и английских букв",
            "pattern": "^[0-9a-zA-Z_]+$",
            "default": "link_from_to",
            "minLength": 1,
            "maxLength": 15,
            "propertyOrder": 3,
            "options": {
                "grid_columns": 12
            }
        },
        "inControl": {
            "type": "string",
            "_format": "wb-autocomplete",
            "title": "Input control",
            "description": "What input control we need use in format: device/control",
            "pattern": "^[^/+#]+/[^/+#]+$",
            "propertyOrder": 4,
            "options": {
                "grid_columns": 12,
                "wb": {
                    "data": "devices"
                }
            },
            "minLength": 1
        },
        "inverseLink": {
            "type": "boolean",
            "title": "Inverse link behavior",
            "default": false,
            "_format": "checkbox",
            "propertyOrder": 5,
            "options": {
                "grid_columns": 12
            }
        },
        "outControl": {
            "type": "string",
            "_format": "wb-autocomplete",
            "title": "Output control",
            "description": "What output control we need use in format: device/control",
            "pattern": "^[^/+#]+/[^/+#]+$",
            "propertyOrder": 6,
            "options": {
                "grid_columns": 12,
                "wb": {
                    "data": "devices"
                }
            },
            "minLength": 1
        }
    },
    "required": ["scenarioType", "enable", "name", "id_prefix"]
}
```


1. Добавляем скрипт общий

```
/**
 * @file Скрипт для инициализации сценариев с типом SCENARIO_TYPE
 * @overview Этот скрипт:
 *             - Загружает все конфигурации сценарииев с типом
 *               SCENARIO_TYPE из файла
 *             - Находит все активные сценарии данного типа
 *             - Инициализирует их согласно настройкам, указанным
 *               в каждом сценарии
 * @author Ivan Ivanov <ivan.ivanov@wirenboard.com>
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
var CONFIG_PATH = "/etc/wb-scenarios.conf";

/**
 * Строка типа сценария для поиска в массиве конфигов всех сценариев
 * @type {string}
 */
var SCENARIO_TYPE_STR = "darkroom";

var helpers = require("scenarios-general-helpers.mod");
var darkroom = require("darkroom.mod");

/**
 * Инициализирует сценарий с использованием указанных настроек
 * @param {object} scenario - Объект сценария, содержащий настройки
 * @returns {void}
 */
function initializeScenario(scenario) {
  log.debug("Processing scenario: " + JSON.stringify(scenario));

  var isInitSucess = darkroom.init(scenario.id_prefix,
                                   scenario.name,
                                   "buzzer/enabled") // @todo: поменять
  // @todo: add custom current scenario parameters, for example:
  //        - scenario.inControls
  //        - scenario.outControls

  if (!isInitSucess) {
    log.error("Error: Init operation aborted for scenario with 'idPrefix': " + scenario.id_prefix);
    return;
  }

  log.debug("Initialization successful for: " + scenario.name);
}

function main() {
  var listAllScenarios = helpers.readAndValidateScenariosConfig(CONFIG_PATH,
                                                                REQUIRED_GENERAL_CFG_VER);
  if (!listAllScenarios) return;

  var matchedScenarios = helpers.findAllActiveScenariosWithType(listAllScenarios,
                                                        SCENARIO_TYPE_STR);
  if (matchedScenarios.length === 0) {
    log.debug("No correct and active scenarios of type '" + SCENARIO_TYPE_STR + "' found.");
    return;
  }
  
  log.debug("Number of matched scenarios: " + JSON.stringify(matchedScenarios.length));
  log.debug("Matched scenarios JSON: " + JSON.stringify(matchedScenarios));

  for (var i = 0; i < matchedScenarios.length; i++) {
    initializeScenario(matchedScenarios[i]);
  }
}

main();

```

2. Добавляем модуль
```
/**
 * @file Модуль для инициализации алгоритма темной комнаты (darkroom) на
 *       основе указанных
 *       - Входного MQTT топика сенсора
 *       - Выходного MQTT топика оборудования
 *
 * @author Ivan Ivanov <ivan.ivanov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */


/**
 * Инициализирует виртуальное устройство и определяет правило для работы
 * темной комнаты
 * @param {string} idPrefix - Префикс сценария, используемый для идентификации
 *                            виртуального устройства и правила
 * @param {string} deviceTitle - Имя виртуального девайса указанный
 *                               пользователем
 * @param {string} trackingControlName - Отслеживаемый контрол
 * @returns {boolean} - Возвращает true, при успешной инициализации
 *                      иначе false
 */
// @todo: Добавить в инит кастомные параметры нужные для реализуемого
//        фукнционала
function init(idPrefix, deviceTitle, trackingControlName) {
  // @todo: Проверка входящей в функцию конфигурации параметров
    log.debug("trackingControlName: '" + trackingControlName + "'");

  var genVirtualDeviceName = "wbsc_" + idPrefix;
  var genRuleName = "wbru_" + idPrefix;

  var vdev = defineVirtualDevice(genVirtualDeviceName, {
      title: deviceTitle,
      cells: {
        active: {
          title: {en: 'Activate scenario rule', ru: 'Активировать правило сценария'},
          type: "switch",
          value: true
        },
      }
    });
  if (!vdev) {
    log.debug("Error: Virtual device '" + deviceTitle + "' not created.");
    return false;
  }
  log.debug("Virtual device '" + deviceTitle + "' created successfully");

  function thenHandler(newValue, devName, cellName) {
    log.debug("WB-rule '" + genRuleName + "' action handler started");
    var isActive = dev[genVirtualDeviceName + "/active"];
    if (!isActive) {
      // OK: Сценарий с корректным конфигом, но выключен внутри virtual device
      return true;
    }

    // @todo: Выполняем действия нужные в сценарии
    log.debug("WB-rule useful actions triggered");
  }

  var ruleIdNum = defineRule(genRuleName, {
                        whenChanged: [trackingControlName], // @todo: изменить на нужный
                        then: thenHandler
                        });
  if (!ruleIdNum) {
    log.debug("Error: WB-rule '" + genRuleName + "' not created.");
    return false;
  }
  log.debug("WB-rule with IdNum '" + ruleIdNum + "' created successfully");
  return true;
}

// @todo: Добавить кастомные параметры
exports.init = function (idPrefix, deviceTitle, trackingControlName) {
  // @todo: Добавить кастомные параметры
  res = init(idPrefix, deviceTitle, trackingControlName);
  return res;
};

```


4. Проверить работу базового сценария
- Сохранение
- ...
5. Добавить свой кастомный фукнционал
- в схему
- Прокинуть в модуль новые поля
- реализовать функционал