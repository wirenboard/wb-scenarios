# Процесс разработки сценария

Данный документ описывает пошаговый процесс создания новых сценариев для WB с нуля.

## Общие принципы

При разработке сценариев важно следовать единой архитектуре, основанной на ScenarioBase. Подробнее об архитектуре см. [architecture-guide.md](architecture-guide.md).

### Требования к стилю кода

- **Файлы**: именовать kebab-case `custom-file.js`
- **Переменные в JSON/JS**: camelCase `customVar`
- **Строки в JS**: использовать одинарные кавычки `'text'` вместо `"`
- **JS код**: следовать стилю [Airbnb ES5](https://github.com/airbnb/javascript/tree/es5-deprecated/es5)
- **Форматирование**: обязательно использовать Prettier
- **Линтинг**: желательно использовать ESLint

## Этапы разработки нового сценария

### 1. Планирование и подготовка

**1.1. Определение требований**
- Проанализируйте функциональность сценария
- Определите необходимые входные/выходные контролы
- Спланируйте структуру конфигурации

**1.2. Создание структуры**
```bash
# Создать папку сценария (kebab-case)
mkdir scenarios/your-scenario-name
```

**1.3. Первый коммит**
- Создать папку сценария
- Добавить README.md с описанием сценария
- Создать заготовки основных файлов
- Запушить как первую версию

### 2. Выбор подхода к разработке

Есть несколько подходов к разработке - выберите наиболее удобный:

#### Подход A: От JSON схемы (рекомендуется для новичков)
**Преимущества**: быстро виден результат в веб-интерфейсе, понятна структура конфига

1. Создать/модифицировать JSON схему
2. Протестировать веб-интерфейс
3. Проанализировать генерируемый конфиг
4. Написать модуль инициализации
5. Создать класс сценария
6. Добавить бизнес-логику

#### Подход B: От модуля инициализации
**Преимущества**: подходит при точном понимании требований

1. Написать статичный скрипт с требуемой логикой
2. Вынести переменные в конфигурацию
3. Создать модуль сценария
4. Добавить JSON схему для веб-интерфейса

#### Подход C: От готового модуля
**Преимущества**: максимальная гибкость

1. Сразу создать полноценный модуль сценария
2. Интегрировать с системой инициализации
3. Добавить JSON схему

### 3. Разработка по подходу A (подробно)

#### 3.1. Создание JSON схемы

**Добавить описание в definitions**
```json
"yourScenarioName": {
    "type": "object",
    "title": "Your Scenario Title",
    "description": "Описание функциональности сценария",
    "_format": "grid",
    "properties": {
        "scenarioType": {
            "type": "string",
            "enum": ["yourScenarioName"],
            "default": "yourScenarioName",
            "options": {"hidden": true}
        },
        "enable": {
            "type": "boolean",
            "title": "Enable",
            "default": true,
            "_format": "checkbox",
            "propertyOrder": 1,
            "options": {"grid_columns": 12}
        },
        "name": {
            "type": "string", 
            "title": "Scenario name",
            "default": "Your Scenario",
            "minLength": 1,
            "maxLength": 30,
            "propertyOrder": 2,
            "options": {"grid_columns": 12}
        },
        "id_prefix": {
            "type": "string",
            "title": "ID Prefix", 
            "pattern": "^[0-9a-zA-Z_]+$",
            "default": "your_scenario",
            "minLength": 1,
            "maxLength": 15,
            "propertyOrder": 3,
            "options": {"grid_columns": 12}
        }
        // ... кастомные поля
    },
    "required": ["scenarioType", "enable", "name"]
}
```

**Модифицировать oneOf**
```json
"oneOf": [
    { "$ref": "#/definitions/yourScenarioName" },
    // ... остальные сценарии
]
```

**Добавить переводы** (в конце файла схемы)

#### 3.2. Тестирование веб-интерфейса

1. Сохранить схему
2. Проверить отображение в веб-интерфейсе
3. Протестировать сохранение конфигурации
4. Проанализировать структуру генерируемого JSON

#### 3.3. Создание модуля инициализации

**Структура файла `scenario-init-your-scenario.mod.js`:**
```javascript
// Подключение зависимостей
var ScenarioBase = require('/usr/share/wb-rules-modules/wbsc-scenario-base');
var ScenarioState = require('/usr/share/wb-rules-modules/virtual-device-helpers').ScenarioState;
var YourScenarioClass = require('./your-scenario.mod.js');

var CFG = {
  scenarioTypeStr: 'yourScenarioName',
  reqVerScenario: 1
};

function initializeScenario(scenarioCfg) {
  var scenario = new YourScenarioClass();
  
  // Маппинг конфигурации
  var cfg = {
    idPrefix: scenarioCfg.id_prefix,
    inputControl: scenarioCfg.inputControl,
    outputControl: scenarioCfg.outputControl
    // ... другие поля
  };
  
  // Инициализация сценария
  var isBasicVdCreated = scenario.init(scenarioCfg.name, cfg);
  if (isBasicVdCreated !== true) {
    log.error('Virtual device creation failed: ' + scenarioCfg.name);
    return;
  }
}

function setup() {
  var helpers = require('/usr/share/wb-rules-modules/scenarios-general-helpers');
  
  // Чтение и валидация конфигурации
  var allCfg = helpers.readConfig();
  if (allCfg === null) {
    log.error('Failed to read configuration');
    return;
  }
  
  // Фильтрация и инициализация сценариев
  var scenarios = helpers.filterScenarios(allCfg, CFG.scenarioTypeStr);
  scenarios.forEach(initializeScenario);
  
  log.info('Initialized ' + scenarios.length + ' scenarios of type: ' + CFG.scenarioTypeStr);
}
```

#### 3.4. Создание класса сценария

**Структура файла `your-scenario.mod.js`:**
```javascript
var ScenarioBase = require('/usr/share/wb-rules-modules/wbsc-scenario-base');
var ScenarioState = require('/usr/share/wb-rules-modules/virtual-device-helpers').ScenarioState;

// Конструктор
function YourScenario() {
  ScenarioBase.call(this);
  this.cfg = null;
}

// Наследование от ScenarioBase
YourScenario.prototype = Object.create(ScenarioBase.prototype);
YourScenario.prototype.constructor = YourScenario;

// ОБЯЗАТЕЛЬНЫЙ: Генерация имен
YourScenario.prototype.generateNames = function(idPrefix) {
  return {
    vDevice: 'wbsc_' + idPrefix,
    ruleInput: 'wbsc_' + idPrefix + '_input'
  };
};

// ОБЯЗАТЕЛЬНЫЙ: Валидация конфигурации
YourScenario.prototype.validateCfg = function(cfg) {
  if (!cfg.inputControl) {
    log.error('Input control is required');
    return false;
  }
  
  // Проверка существования контролов
  var parts = cfg.inputControl.split('/');
  if (parts.length !== 2 || !dev[parts[0]] || !dev[parts[0]][parts[1]]) {
    log.error('Input control not found: ' + cfg.inputControl);
    return false;
  }
  
  return true;
};

// ОБЯЗАТЕЛЬНЫЙ: Специфичная инициализация
YourScenario.prototype.initSpecific = function(name, cfg) {
  this.cfg = cfg;
  
  // Создание правил
  var inputRule = defineRule(this.names.ruleInput, {
    whenChanged: cfg.inputControl,
    then: function(newValue, devName, cellName) {
      // Бизнес-логика сценария
      log.info('Input changed: ' + newValue);
    }
  });
  
  // Сохранение ID правил
  this.addRule(inputRule.getId());
  
  // Установка рабочего состояния
  this.setState(ScenarioState.NORMAL);
  
  return true;
};

// НЕОБЯЗАТЕЛЬНЫЙ: Конфигурация ожидания контролов
YourScenario.prototype.defineControlsWaitConfig = function(cfg) {
  return {
    controls: [cfg.inputControl],
    timeout: 10000
  };
};

// Экспорт модуля
module.exports = YourScenario;
```

### 4. Тестирование и отладка

#### 4.1. Базовое тестирование
1. Установить сценарий на контроллер
2. Создать конфигурацию через веб-интерфейс
3. Проверить создание виртуального устройства
4. Протестировать базовую функциональность

#### 4.2. Отладка

**Использование логера проекта**
В проекте используется унифицированная система логирования через модуль `logger.mod.js`. Рекомендуется использовать её вместо стандартного `log`:

```javascript
// Подключение логера
var Logger = require('/usr/share/wb-rules-modules/logger');
var logger = new Logger('YourScenario'); // Имя компонента для логов

// Использование различных уровней логирования
logger.debug('debug');
logger.info('info');

// Примеры логирования в сценарии
YourScenario.prototype.initSpecific = function(name, cfg) {
  logger.info('Initializing scenario: ' + name);
  logger.debug('Configuration: ' + JSON.stringify(cfg));
  
  try {
    // Логика инициализации
    logger.info('Scenario initialized successfully');
    return true;
  } catch (error) {
    logger.error('Failed to initialize scenario: ' + error.message);
    return false;
  }
};
```

**Общие рекомендации по отладке:**
- Использовать структурированное логирование для отслеживания выполнения
- Проверить состояние сценария через виртуальное устройство
- Тестировать различные сценарии ошибок
- Проверить обработку некорректных конфигураций

## Лучшие практики

### Разработка
1. **Итеративный подход**: начинайте с простой версии, постепенно усложняйте
2. **Тестирование**: тестируйте каждый этап разработки
3. **Логирование**: добавляйте подробные логи для отладки
4. **Валидация**: тщательно проверяйте входные данные

### Архитектура
1. **Следуйте ScenarioBase**: не изобретайте велосипед
2. **Разделяйте ответственность**: модуль сценария vs модуль инициализации
3. **Используйте состояния**: активно управляйте состоянием сценария
4. **Обрабатывайте ошибки**: предусматривайте все возможные сбои

### Код
1. **Читаемость**: пишите понятный код с комментариями
2. **Производительность**: избегайте тяжелых операций в обработчиках
3. **Совместимость**: учитывайте различные версии устройств WB
4. **Безопасность**: валидируйте все входные данные