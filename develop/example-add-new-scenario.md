# Пример добавления сценария

***ВНИМАНИЕ:***
В процессе создания нового сценария вы можете испортить файл конфигурации
уже имеющихся сценариев - поэтому ОБЯЗАТЕЛЬНО сделайте копию работающего
конфиг файла!

Цель данного мануала - предоставить пример добавления базового сценария
для пользователей. Данный сценарий рабочий и уже на базе этого готового
простого сценария можно создать свой кастомный изменив его логику работы.

@todo: Синхронизировать схему с кодом
       На данный момент схема приведена для прмера и не синхронизирована с кодом

Ниже показано как создать сценарий связывающий один вход с одним выходом путем
копирования значения входа на выход. Сценарий и все пути указаны относительно
репозитория. Для того чтобы проверять данные файлы - их нужно скопировать на
контроллер в соотстветствующие папки расположения схем, скриптов и модулей.

Что куда копировать на контроллере для проверки:

1) Schema
- Отсюда `schema/wb-scenarios.schema.json`
- На контроллер `usr/share/wb-mqtt-confed/schemas/wb-scenarios.schema.json`

2) Script
- Отсюда `scenarios/link-in-to-out/scenario-init-link-in-to-out.js`
- На контроллер `usr/share/wb-rules-system/rules/scenario-init-link-in-to-out.js`

3) Module
- Отсюда `scenarios/link-in-to-out/link-in-to-out.mod.js`
- На контроллер `usr/share/wb-rules-modules/link-in-to-out.mod.js`

Архитектурно каждый сценарий должен иметь модуль который инициализирует работу
сценария, поэтому создание нового сценария разделено на несколько этапов:

- Добавляем в схему новый сценарий
- Создание дирректории нового сценария
- Создание скрипта инициализации
- Добавляем модуль
- Проверить работу базового сценария из примера
- Добавить свой кастомный фукнционал

Заранее обратим внимание на используемый стиль:

- Файлы нужно именовать кебаб кейсом `custom-file.js`
- Элементы и переменные внутри json и js файлов камел кейсом `customVar`
- Внутри js кода нужно использовать для строк одиночные скобки `'` а не `"`
- При программировании js нужно соответствоать стилю airbnb es5
  https://github.com/airbnb/javascript/tree/es5-deprecated/es5  

## 1. Добавляем в схему новый сценарий

***Обратите внимание:***
Мы будем создавать сценарий с именем `linkInToOut` и положим
его в папку `scenarios\link-in-to-out`. Если вы хотите дать своему сценарию
другое имя - то можете сразу менять имена папок и переменных, чтобы
не возвращаться к этому потом. Иначе после создания сценария вам прийдется
довольно много менять в именах файлов и переменных.

### 1.1. Добавление описания

Ниже в примере описание сценария с именем 'linkInToOut' - именно это имя будет
искать скрипт инициализации который мы напишем на следующем шаге.

Обратите внимание на

- Наименование типа сценаря - написано в первой строке `"linkInToOut": {`
  Имя должно быть уникальным

- Поле `componentVersion` - версия данного вида сценариев.
  Данное поле важно для проверки пользовательского конфига перед началом
  работы. Версию нужно инкрементировать каждый раз когда меняется структура
  конфигурации сценариев.

- Поле `scenarioType` - строка типа сценария, должна быть уникальной
  Скрытое поле которое добавляет в каждый созданный инстанс данного
  вида сценария его тип. Нужно для того чтобы при инициализации сценариев
  находить в массиве конфигураций нужные типы сценариев.
  Данное поле лучше делать таким же как название главной секции сценария,
  то есть - так как у нас в первой строке написоано `"linkInToOut": {` - то
  в поле `scenarioType` так же пишем linkInToOut.

- idPrefix (раньше id_prefix) - поле необходимое для кастомных префиксов
  создаваемым правилам и виртуальным устройствам. Поле по дефолту дожно быть
  пустым - если пользователь туда ничего не вводит, то оно не используется
  и префикс генерируется транслитерацией из имени.

Последовательность действий:

- Открываем файл `schema\wb-scenarios.schema.json`

- Добавляем описание внутрь раздела `"definitions":`
  после последнего сценария:

```json
  "linkInToOut": {
    "type": "object",
    "title": "linkInToOutScenarioName",
    "description":"linkInToOutScenarioDescription",
    "_format": "grid",
    "properties": {
      "componentVersion": {
        "type": "integer",
        "title": "Config version",
        "minimum": 1,
        "maximum": 256,
        "default": 1,
        "options": {
          "hidden": true
        }
      },
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
        "title": "generalScenarioGenerateRuleTitle",
        "default": true,
        "_format": "checkbox",
        "propertyOrder": 1,
        "options": {
          "grid_columns": 12
        }
      },
      "name": {
        "type": "string",
        "title": "generalScenarioName",
        "default": "linkInToOutScenarioNameDefaultValue",
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
        "description": "id_prefix_description",
        "_pattern_comment": "Запрещает пробелы, /, +, и #, а также ограничивает строку использованием только цифр, нижнего подчеркивания и английских букв",
        "pattern": "^[0-9a-zA-Z_]+$",
        "default": "link_from_to",
        "minLength": 1,
        "maxLength": 15,
        "propertyOrder": 3,
        "options": {
          "grid_columns": 12,
          "patternmessage": "generalErrorRegexpPatternMessage"
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
  },
```

### 1.2. Добавление в список сценариев

Для того чтобы сценарий появился в выпадающем списке - нужно добавить его
в definitions.scenario.oneOf[] вверху файла схемы:

```json
      "oneOf": [
        {
          "$ref": "#/definitions/devicesControl"
        },
        {
          "$ref": "#/definitions/lightControl"
        },
        {
          "$ref": "#/definitions/linkInToOut"
        }
      ],
```

### 1.3. Добавляем переводы

Переводы делать обязательно

Желательно делать это учитывая два момента

- Создавать промежуточное названия поля и уже это название использовать
  в переводе на английский и на русский
- Поле нужно называть начиная с названия сценария, например darkroom

Последовательность следующая:

- Полям присваиваем промежуточные условные названия, например
  Вместо:

  ```json
  "title": "Link in to out",
  "description":"Данный сценарий предоставляет возможность прямого соединения дискретного входа с дискретным выходом",
  ```

  Пишем:

  ```json
  "title": "linkInToOutScenarioName",
  "description":"linkInToOutScenarioDescription",
  ```

- В конце файла `schema\wb-scenarios.schema.json` находим `"translations": {`
  И внутри этого блока добавляем все переводы в "en" и "ru". Поля `"default"`
  строковых парметров не переводятся - поэтому там нужно написать текстом
  прямо в поле.

  Например:

  ```json
  "translations": {
    "en": {
      "linkInToOutScenarioName": "Link in to out",
      "linkInToOutScenarioDescription": "This scenario provides the ability to directly connect a discrete input to a discrete output"
    },
    "ru": {
      "linkInToOutScenarioName": "Связь входа с выходом",
      "linkInToOutScenarioDescription": "Данный сценарий предоставляет возможность прямого соединения дискретного входа с дискретным выходом"
    }
  ```

В итоге получаем более простое отслеживание наличия переводов полей
и при необходимости их измененение.

### 1.4. Создание конфиг файла

Данный пункт не актуален при создании дополнительного сценария - так как
конфиг уже был создан ранее по пути на контроллере `etc/wb-scenarios.conf`.

### 1.5. Проверка работы WEBUI

Проверка состоит из нескольких этапов:

- Открывается ли конфигуратор сценариев после изменении схемы

После того как вы внесли изменения в файл схемы есть вероятность что в файле
появились ошибки - если это так и синтаксис или структура файла были нарушены,
то при попытке открытия конфигуратора сценариев вы увидите ошибку.

![Ошибка при открытии конфигуратора](example-error-scenario-configurator.png)

Это может произойти, например при вставке одиного из блоков схемы в не
правильное место - что вызвало нарушение структуры файла.

- Проверяем отображается ли новый сценарий в выпадающем списке

![Отображение нового сценария в выпадающем списке](example-new-scenario-in-dropdown.png)

- Смотрим как отображается WEBUI зайдя на страницу вашего сценария
  Здесь вы можете увидеть что не корректно работают переводы или вам что то
  не нравится в структуре отображаемого WEBUI, возможно вы поменяете тип
  отображения каких-то элементов на более удобные или заметите неточности или
  ошибки в тексте.

  Внешне созданный сценарий будет выглядеть следующим образом

  ![Внешний вид созданного сценария](example-simple-scenario.png)

- Попробовать сконфигурировать - проверив корректно ли работают проверки полей
- Сохранить файл - проверить что сохраняется и конфиг изменяется при ваших
  сохранениях в WEBUI.
- Проверить внутренности конфиг файла и его структуру - все ли вас устраивает.
  Например, вы можете заметить что некоторые элементы лучше упаковать
  в массив для дальнейшей более удобной обработки внутри кода правил.

Если вы все проверили и WEBUI корректно работает и создает конфиг со
удовлетворяющей вас структурой, то можно переходить к созданию
скрипта инициализации - который уже будет обрабатывать данный файл
конфигурации.

## 2. Создание дирректории нового сценария

Структура проекта сценариев предпологает что файлы каждого сценария находятся
в подпапках каталога `scenarios`. Поэтому для нового сценария нужно создать
отдельную папку, например `scenarios\link-in-to-out`. Важно что имена файлов
и папок нужно писать через тире кебаб кейсом.

Все файлы общие для нескольких сценариев нужно распологать в папке `src`.

## 3. Создание скрипта инициализации

Ниже приведен пример файла инициализации сценария.

Так как архитектура сценариев подразумевает что каждый сценарий должен иметь
модуль - чтобы его можно было использовать из других правил wb-rules, то нужно
создать файл инициализации сценария который должен выполнить несколько задач:

- Открыть общий файл конфигурации сценариев
- Проверить общую версию конфига, чтобы она совпала с REQUIRED_GENERAL_CFG_VER
- Выбрать из файла все сценарии данного типа - в нашем случае "linkInToOut"
- Проверить чтобы каждый сценарий имел версию равную REQUIRED_SCENARIO_CFG_VER
- Отфильтровать только сценарии, включенные галочкой "enable"
- Для инициализации и начала работы вызвать последовательно
  `initializeScenario()` передавая каждый объект из выбранных сценариев
  в функцию init(), которая реализована уже внутри модуля.

Данный файл не должен иметь никакого функционала кроме передачи данных функции
инициализации. Отдельно отметим, что он не должен содержать проверок топиков
это все должно быть уже внутри модуля которому вы передадите настройки
пользователя, иначе при работе с модулем из других правил wb-rules, модуль
не будет работать корректно.

- Создаем новый файл js скрипта в папке сценария - полный путь получится
  `scenarios\link-in-to-out\scenario-init-link-in-to-out.js`
- Вставляем туда код написанный ниже

```javascript
/**
 * @file scenario-init-link-in-to-out.js
 * @description Скрипт для инициализации сценариев с типом SCENARIO_TYPE_STR
 *     Этот скрипт:
 *     - Загружает все конфигурации сценарииев с типом
 *       SCENARIO_TYPE_STR из файла
 *     - Находит все активные сценарии данного типа
 *     - Инициализирует их согласно настройкам, указанным
 *       в каждом сценарии
 * @author Ivan Ivanov <ivan.ivanov@wirenboard.com>         //@todo:Change 1
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
var SCENARIO_TYPE_STR = 'linkInToOut';                      //@todo:Change 2

var helpers = require('scenarios-general-helpers.mod');
var linkInToOut = require('link-in-to-out.mod');            //@todo:Change 3,4

/**
 * Инициализирует сценарий с использованием указанных настроек
 * @param {object} scenario - Объект сценария, содержащий настройки
 * @returns {void}
 */
function initializeScenario(scenario) {
  log.debug('Processing scenario: ' + JSON.stringify(scenario));

  var isInitSucess = linkInToOut.init(scenario.id_prefix,   //@todo:Change 5
                                      scenario.name,
                                      scenario.inControl,
                                      scenario.outControl,
                                      scenario.inverseLink);

  if (isInitSucess !== true) {
    log.error(
      'Error: Init operation aborted for ' +
      'scenario name: "' + scenario.name + '" ' +
      'with idPrefix: "' + scenario.id_prefix + '"'
    );
    return;
  }

  log.debug('Initialization successful for: ' + scenario.name);
}

function main() {
  log.debug('Start initialisation ' + SCENARIO_TYPE_STR + ' scenario');
  var listAllScenarios = helpers.readAndValidateScenariosConfig(CONFIG_PATH,
                                                                REQUIRED_GENERAL_CFG_VER);
  if (!listAllScenarios) return;

  var matchedScenarios = helpers.findAllActiveScenariosWithType(listAllScenarios,
                                                                SCENARIO_TYPE_STR,
                                                                REQUIRED_SCENARIO_CFG_VER);
  if (matchedScenarios.length === 0) {
    log.debug('No correct and active scenarios of type "' + SCENARIO_TYPE_STR + '" found');
    return;
  }
  
  log.debug('Number of matched scenarios: ' + JSON.stringify(matchedScenarios.length));
  log.debug('Matched scenarios JSON: ' + JSON.stringify(matchedScenarios));

  for (var i = 0; i < matchedScenarios.length; i++) {
    initializeScenario(matchedScenarios[i]);
  }
}

main();

```

## 4. Добавляем модуль

Модуль должен содержать только функцию `init()`, внутри которой реализовано
три части:

1) Создание виртуального устройства с контролом активации правила сценария
2) Логика работы сценария в правиле - чаше всего состоит из двух частей
   - Отслеживание входных контролов для поиска нужных событий
   - Когда произошло событие - выполнение действий над выходными контролами
3) Создание правила wb-rules

Так же не забудьте в конце файла указать экспотрт функции с учетом
возвращаемого значения.

Обратите внимание, что в js в отличие от других языков, например от Си - можно
класть функции после их использования. Поэтому используя эту тонкость
мы разделим функцию `init()` на две части: в первой будет описана логика
инициализации, а во второй после разделителя будут все определения
используемых функций - это упрощает понимание общего алгоритма.

- Создаем файл `scenarios/link-in-to-out/link-in-to-out.mod.js`
- Вставляем в файл код ниже

```javascript
/**
 * @file link-in-to-out.mod.js
 * @description Модуль для инициализации алгоритма соединения входа
 *     и выхода (link-in-to-out) на основе указанных пользователем параметров
 *
 * @author Ivan Ivanov <ivan.ivanov@wirenboard.com>           //@todo:Change 1
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */


/**
 * Инициализирует виртуальное устройство и определяет правило для управления
 * устройством
 * @param {string} idPrefix Префикс сценария, используемый для идентификации
 *     виртуального устройства и правила
 * @param {string} deviceTitle Имя виртуального девайса указанный
 *     пользователем
 * @param {string} inControl Идентификатор входного отслеживаемого контрола,
 *     значение которого следует слушать. Пример: 'vd_wall_switch/enabled'
 * @param {string} outControl Идентификатор выходного контроля, значение
 *     которого следует контролировать. Пример: 'vd_pump/enabled'
 * @param {boolean} inverseLink Указывает, должна ли связь быть
 *     инвертированной
 * @returns {boolean} Возвращает true, при успешной инициализации
 *     иначе false
 */
function init(idPrefix, deviceTitle, inControl, outControl, inverseLink) {   //@todo:Change 2
  // @todo: Проверка входящей в функцию конфигурации параметров
  log.debug('inControl: "' + inControl + '"');
  log.debug('outControl: "' + outControl + '"');
  log.debug('inverseLink: "' + inverseLink + '"');

  var genNames = generateNames(idPrefix);

  var vdev = defineVirtualDevice(genNames.vDevice, {
    title: deviceTitle,
    cells: {
      ruleEnabled: {
        title: {
          en: 'Enable rule',
          ru: 'Включить правило'
        },
        type: 'switch',
        value: true,
        order: 1,
      },
    }
  });
  if (!vdev) {
    log.debug('Error: Virtual device "' + deviceTitle + '" not created.');
    return false;
  }
  log.debug('Virtual device "' + deviceTitle + '" created successfully');

  var ruleIdNum = defineRule(genNames.rule, {
    whenChanged: [inControl], // @todo: изменить на нужный
    then: thenHandler
  });
  if (!ruleIdNum) {
    log.debug('Error: WB-rule "' + genNames.rule + '" not created.');
    return false;
  }
  log.debug('WB-rule with IdNum "' + ruleIdNum + '" created successfully');
  return true;

  // ======================================================
  //                  Определения функций
  // ======================================================

  function generateNames(idPrefix) {
    var delimeter = '_';
    var scenarioPrefix = 'wbsc' + delimeter;
    var rulePrefix = 'wbru' + delimeter;

    var generatedNames = {
      vDevice: scenarioPrefix + idPrefix,
      rule: rulePrefix + idPrefix
    };

    return generatedNames;
  }

  function thenHandler(newValue, devName, cellName) {
    var isActive = dev[genNames.vDevice + '/ruleEnabled'];
    if (!isActive) {
      // OK: Сценарий с корректным конфигом, но выключен внутри virtual device
      return true;
    }
    log.debug('WB-rule "' + genNames.rule + '" action handler started');

    // @todo: Выполняем действия нужные в сценарии
    // Проверка инверсии и присваивание значения в зависимости от него
    if (inverseLink) {
      dev[outControl] = !newValue; // Инвертирование входного значения
    } else {
      dev[outControl] = newValue; // Прямое присваивание входного значения
    }
  }
}

// @todo: Добавить кастомные параметры
exports.init = function (
  idPrefix,
  deviceTitle,
  inControl,
  outControl,
  inverseLink) {
  // @todo: Добавить кастомные параметры
  var res = init(
    idPrefix,
    deviceTitle,
    inControl,
    outControl,
    inverseLink);
  return res;
};

```

## 5. Проверить работу базового сценария

### 5.1. Выбор контролов которые можем использовать для проверки

  Созданный сценарий будет работать корректно только с контролами типа switch
  которые сохраняют свое состояние в переменной типа bool.

  Вы можете использовать для этого любое подходящее реальное устройство или
  для удобства можете создать файл скрипта с описанием двух простых
  виртуальных устройств `virtual-devices.js`

```javascript
var name_postfix;
var gen_vd_name;

name_postfix = "_1";
gen_vd_name = "vd_wall_switch" + name_postfix;

defineVirtualDevice(gen_vd_name, {
  title: {
    en: "Virt. wall switch" + name_postfix,
    ru: "Вирт. настенный выключатель" + name_postfix,
  },
  cells: {
    enabled: {
      title: "Статус выключателя" + name_postfix,
      type: "switch",
      value: false,
    },
  },
});

name_postfix = "_1";
gen_vd_name = "vd_pump" + name_postfix;

defineVirtualDevice(gen_vd_name, {
  title: {
    en: "Virt. pump" + name_postfix,
    ru: "Вирт. насос" + name_postfix,
  },
  cells: {
    enabled: {
      title: "Статус насоса" + name_postfix,
      type: "switch",
      value: false,
    },
  },
});
```

В итоге получим на странице девайсов два новых виртуальных девайса

- Выключатель
![Внешний вид виртуального девайса выключателя](example-vd-wall-switch.png)

- Насос
![Внешний вид виртуального девайса насоса](example-vd-pump.png)

### 5.2. Конфигурация сценария

Указываем, обязательно пользуясь автодополнением чтобы не допускать ошибок:

- В поле входа `vd_wall_switch_1/enabled`
- В поле выхода `vd_pump_1/enabled`

Сохраненяем и начинаем проверять

### 5.2. Проверка работоспособности

После создания всех файлов нужно проверить что все работает так как задумано.

1) Проверка прямого копирования:

- Заходим на страницу виртуальных девайсов
- Кликаем на выключатель
- Проверяем что состояние насоса так же переключается в соотсветствии
  с настройками сценария

2) Проверка инверсного копирования:

- Ставим галочку для инверсии в сценарии
- Повторно проверяем что теперь поведение сценария изменилось

3) Проверка приостановки работы правила:

- В виртуальном девайсе сценария (не в настройках сценария) отключаем
  его работу галочкой
- Проверяем что копирование состояний прекратилось

4) Проверка деактивации сценария:

- Заходим в настройки сценария (не в виртуальном девайсе)
  и устанавливаем галочку активации сценария
- Сохраняем
- Переходим на страницу виртуальных девайсов и проверяем что виртуальное
  устройство удалилось - это означает что ни виртуальное устройство
  ни правило теперь не создаются

Поздравляем - вы создали свой первый сценарий!

## 6. Добавить документацию

1) Создать README файл для нового сценария в папке самого сценария.
   Например для сценария `link-in-to-out` файл будет распологаться по пути:
   `scenarios\link-in-to-out\README.md`

   Описание должно содержать:
   - Внешний вид конфигуратора созданного сценария
   - Тонкости работы сценария, его логики и тд
   - Пример работы с модулем сценария из кода правил (подключение и тд)
     Текст примера должен быть однообразным с остальными.

2) Добавить в общий README файл ссылку на реализованный  сценарий
   - Открыть файл `README.md` находящийся в корне проекта
   - Добавить в список реализованных сценариев ссылку на файл README
     конкрентного сценария созданный выше

## 7. Добавить свой кастомный фукнционал

Теперь, когда реализован работающий минимальный сценарий - его можно изменять
и добавлять тот фунцкионал который нужен именно вам.

Например если вы хотите добавить новую калочку в настройку сценария,
то это можно сделать начав с добавления в WEBUI и прокинуть до модуля:

1) Добавить галочку в файл схемы
2) Добавить новое поле в скрипте инициализации, чтобы оно передавалось
  в функцию init() внутрь модуля
3) Прокинуть в модуль новые поля, для этого внутри файла модуля:
   - В export добавить новое поле
   - Добавить новое поле в параметры самой функции init()
4) В модуле реализовать функционал использующий данные поля

## 8. Переименование

После того как вы в первый раз создали свой сценарий - можно переименовать
его.

Переименование довольно обширное, поэтому будьте осторожны,
не забудьте поменять:

1) Внутри схемы:
   - Ссылка внутри `"oneOf"`
   `"$ref": "#/definitions/linkInToOut"` -> `"$ref": "#/definitions/thermostat"`

   - Название - корневой элемент схемы сценария
   `"linkInToOut": {` -> `"thermostat": {`

   - Элементы схемы сценария в имени которых содержится старое название
   `linkInToOut` -> `<!customName!>`, например `thermostat`
  
   - Переводы

2) Проверить работу WEBUI и пофиксить конфиг

  Если вы ранее уже сконфигурировали какие-то сценарии, то после
  переименования элементов схемы - у вас перестанет открываться конфигуратор.
  Вы увидете ошибку:

  ```text
  Ошибка загрузки файла: Invalid config file EditorError
  ```

  Для решения этой проблеммы вам нужно привести файл конфигурации
  в соответствие с новой схемой. Это можно сделать тремя способами

- Радикально и быстро не разбираясь удалить все настройки сценариев внутри
  массива "scenarios": []
- Удалить только те сценарии из файла конфига которые были изменены
- Точечно переименовать все поля внутри конфига так, чтобы они
  соответствоали новым полям в схеме.  

3) Папку сценария
  `scenarios\link-in-to-out` -> `scenarios\<!custom-name!>`

4) Файл скрипта инициализации

   - Имя файла:
   `scenario-init-link-in-to-out.js` -> `scenario-init-<!custom-name!>.js`

В простом случае - для модификации файла под новый сценарий достаточно сделать
три действия (Помечены в коде комментарием вида `//@todo:Change X`):

- Поменяйте автора в верхнем комментарии

  ```javascript
   * @author Ivan Ivanov <ivan.ivanov@wirenboard.com>
  ```

- Установить тип строки сценария в переменную `SCENARIO_TYPE_STR`
  `var SCENARIO_TYPE_STR = 'linkInToOut';` -> `... = '<!customName!>';`
  Например:

  ```javascript
  var SCENARIO_TYPE_STR = 'darkroom';
  ```

- При подключении модуля поправить имя модуля и имя переменной

  ```javascript
  var linkInToOut = require('link-in-to-out.mod');
  ```

- Внутри функции `initializeScenario()` поправить вызов `init()`

  так чтобы параметры отражали структуру вашей схемы.

  ```javascript
  var isInitSucess = darkroom.init(scenario.id_prefix,
                                  scenario.name,
                                  ... custom parameters ...)
  ```

5) Файл модуля

   - Имя файла:
   `link-in-to-out.mod.js` -> `<!custom-name!>.mod.js`

6) И другие элементы которые имеют старое имя ...
