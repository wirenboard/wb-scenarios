# Архитектура сценариев

Все сценарии основаны на единой архитектуре ScenarioBase, которая предоставляет стандартизированный подход к созданию и управлению сценариями в контроллерах WB.

## Базовые компоненты

### ScenarioBase - базовый класс для всех сценариев
Находится в `src/wbsc-scenario-base.mod.js` и предоставляет:
- Унифицированный жизненный цикл сценария
- Управление состояниями
- Создание и управление виртуальными устройствами
- Система валидации конфигурации

### Вспомогательные модули
- **ScenarioState** - перечисление состояний сценария (`src/virtual-device-helpers.mod.js`)
- **Logger** - система логирования (`src/logger.mod.js`)
- **scenarios-general-helpers** - общие вспомогательные функции
- **virtual-device-helpers** - утилиты для работы с виртуальными устройствами
- **wbsc-wait-controls** - ожидание готовности контролов
- **ScenarioPersistentStorage** - [хранилище сценариев](scenario-persistent-storage.md)

## ScenarioBase - обязательные методы для наследников

Каждый сценарий должен наследоваться от ScenarioBase и реализовать следующие обязательные методы:

### 1. `generateNames(idPrefix)`
Генерирует имена для виртуального устройства и правил сценария.

**Пример:**
```javascript
YourScenario.prototype.generateNames = function(idPrefix) {
  return {
    vDevice: 'wbsc_' + idPrefix,
    ruleInput: 'wbsc_' + idPrefix + '_input',
    ruleOutput: 'wbsc_' + idPrefix + '_output'
    // ... другие имена по необходимости
  };
};
```

### 2. `validateCfg(cfg)`
Валидирует конфигурацию перед инициализацией сценария.

**Пример:**
```javascript
YourScenario.prototype.validateCfg = function(cfg) {
  if (!cfg.requiredField) {
    log.error('Missing required field: requiredField');
    return false;
  }
  
  if (!dev[cfg.inputDevice]) {
    log.error('Input device not found: ' + cfg.inputDevice);
    return false;
  }
  
  return true;
};
```

### 3. `initSpecific(name, cfg)`
Специфичная инициализация сценария - создание правил, сохранение параметров.

**Пример:**
```javascript
YourScenario.prototype.initSpecific = function(name, cfg) {
  // Сохранение конфигурации
  this.cfg = cfg;
  
  // Создание правил wb-rules
  var inputRule = defineRule(this.names.ruleInput, {
    whenChanged: cfg.inputControl,
    then: function(newValue, devName, cellName) {
      // Логика обработки события
    }
  });
  
  // Сохранение ID правил для управления ими
  this.addRule(inputRule.getId());
  
  // Установка состояния сценария
  this.setState(ScenarioState.NORMAL);
  
  return true;
};
```

## Необязательные методы

### `defineControlsWaitConfig(cfg)`
Настройка ожидания готовности контролов перед инициализацией.

**Пример:**
```javascript
YourScenario.prototype.defineControlsWaitConfig = function(cfg) {
  return {
    controls: [cfg.inputControl, cfg.outputControl],
    timeout: 10000,  // опционально, мс (по умолчанию 5000)
    period: 500      // опционально, мс (по умолчанию 200)
  };
};
```

## Доступные методы базового класса

- **`getState()`** - получить текущее состояние сценария
- **`setState(stateCode)`** - установить состояние сценария
- **`addRule(ruleId)`** - сохранить ID правила для управления
- **`enable()`** - включить все правила сценария
- **`disable()`** - отключить все правила сценария
- **`init(name, cfg)`** - основной метод инициализации (**НЕ переопределять!**)
- **`getPsUserSetting()`** - получить значение сценария по ключу из хранилища
- **`setPsUserSetting()`** - сохранить значение сценария по ключу в хранилище

## Жизненный цикл сценария

Сценарий проходит через следующие состояния:

1. **CREATED (0)** - сценарий создан, начальное состояние
2. **INIT_STARTED (1)** - началась инициализация базового класса
3. **WAITING_CONTROLS (2)** - ожидание готовности контролов из `defineControlsWaitConfig()`
4. **LINKED_CONTROLS_READY (3)** - все необходимые контролы готовы к использованию
5. **CONFIG_INVALID (4)** - ошибка валидации конфигурации в `validateCfg()`
6. **LINKED_CONTROLS_TIMEOUT (5)** - таймаут ожидания готовности контролов
7. **NORMAL (6)** - сценарий работает нормально (**основное рабочее состояние**)
8. **USED_CONTROL_ERROR (7)** - ошибка при работе с контролами во время выполнения

## Стандартная структура сценария

Каждый сценарий должен включать:

1. **Класс сценария** - наследник ScenarioBase с реализацией обязательных методов
2. **Виртуальное устройство** - для управления и отображения состояния сценария
3. **Правила wb-rules** - для обработки событий от контролов
4. **Система валидации** - проверка конфигурации и готовности контролов

## Модуль инициализации

Каждый тип сценария должен иметь модуль инициализации `scenario-init-<name>.mod.js`, который:

1. Читает конфигурационный файл `/etc/wb-scenarios.conf`
2. Фильтрует сценарии по типу
3. Создает экземпляры класса сценария
4. Инициализирует их через метод `init()`

**Пример структуры:**
```javascript
var CFG = {
  scenarioTypeStr: 'yourScenarioType',
  reqVerScenario: 1
};

function initializeScenario(scenarioCfg) {
  var scenario = new YourScenarioClass();
  
  var cfg = {
    idPrefix: scenarioCfg.idPrefix,
    // ... маппинг полей из scenarioCfg
  };
  
  var isBasicVdCreated = scenario.init(scenarioCfg.name, cfg);
  if (isBasicVdCreated !== true) {
    log.error('Virtual device creation failed for scenario: ' + scenarioCfg.name);
    return;
  }
}
```

## Лучшие практики

1. **Наследование**: Всегда наследуйтесь от ScenarioBase
2. **Валидация**: Тщательно валидируйте конфигурацию в `validateCfg()`
3. **Состояния**: Используйте `setState()` для отслеживания состояния сценария
4. **Ошибки**: Логируйте ошибки через Logger для единообразия
5. **Правила**: Сохраняйте ID всех создаваемых правил через `addRule()`
6. **Контролы**: Используйте `defineControlsWaitConfig()` для критически важных контролов
