# Сценарий термостата `thermostat`

Позволяет управлять нагревателями, например теплым полом

Конфигурация выглядит следующим образом

<p align="center">
    <img width="400" src="src/scenario-config.png" alt="Scenario config">
</p>

## Использование модуля

Вы можете использовать функционал управления светом из своих правил wb-rules
Для этого нужно сделать 3 шага:

1) Подключить модуль
2) Создать объект настроек где прописать что вы хотите использовать
3) Инициализировать алгоритм указав
   - Имя виртуального устройства
   - Созданный объект конфигурации

```js
/**
 * @file: init-heating.js
 */

// Step 1: include module
var scenarioModule = require('thermostat.mod');

function main() {
  log.debug('Start init logic for: Bathroom light');

  // Step 2: Configure algorithm
  var cfg = {
    idPrefix: 'bathroom_floor',
    targetTemp: 22,
    tempLimitsMin: 16,
    tempLimitsMax: 29,
    hysteresis: 2,
    tempSensor: 'wb-msw-v4_34/Temperature',
    actuator: 'wb-mr6cv3_127/K6',
  };

  // Step 3: init algorithm
  var isInitSuccess = scenarioModule.init('Bathroom: heat floor', cfg);
  if (!isInitSuccess) {
    log.error('Error: Init aborted for "idPrefix": {}', cfg.idPrefix);
    return;
  }

  log.debug('Initialization successful for "idPrefix": {}', cfg.idPrefix);
}

main();
```

После запуска скрипта у вас с устройствах появится новое устройство
для управления:

![Virtual device view](src/vd-view.png)
