# Thermostat — Архитектурная документация (ARC42)

## 1. Введение и цели

### 1.1. Описание задачи
Сценарий **Thermostat** поддерживает заданную температуру с гистерезисом,
управляя одним или несколькими актуаторами (реле, клапаны и т.п.).

### 1.2. Функциональные требования
- Поддержание целевой температуры с настраиваемым гистерезисом
- Управление массивом актуаторов (один или несколько)
- Инверсия логики управления для отдельных актуаторов (`setEnable`/`setDisable`)
- Сохранение целевой температуры в persistent storage между перезапусками
- Обработка ошибок датчика и актуаторов с debounce-таймером
- Автоматическое отключение при критических ошибках
- Виртуальное устройство для управления через WebUI

### 1.3. Качественные цели
| Приоритет | Цель | Описание |
|---|---|---|
| 1 | Надёжность | Корректная работа при ошибках датчиков/актуаторов |
| 2 | Безопасность | Отключение нагрева при критических ошибках |
| 3 | Простота | UI понятен пользователю без документации |

### 1.4. Стейкхолдеры
| Роль | Ожидания |
|---|---|
| Пользователь контроллера | Настройка через WebUI, надёжное поддержание температуры |
| Разработчик wb-scenarios | Соблюдение паттернов ScenarioBase |
| Инсталлятор | Минимальная конфигурация при монтаже |

---

## 2. Ограничения

### 2.1. Технические
- **ES5 only** — wb-rules использует Duktape, нет ES6+
- **JSON Schema Draft-04** — формат схемы UI
- **Типы контролов**: актуаторы только `switch`, датчик — `value` или `temperature`

### 2.2. Кодстайл
- 2 пробела отступ, single quotes, semicolons
- 77 символов ширина строки
- camelCase для переменных, kebab-case для файлов
- ES5-совместимые trailing commas

---

## 3. Контекст системы

### 3.1. Технический контекст
```
wb-scenarios.schema.json  -->  wb-mqtt-confed (WebUI рендер)
         |
wb-scenarios.conf         -->  scenario-init-main.js
         |                          |
         |                     scenario-init-thermostat.mod.js
         |                          |
         |                     thermostat.mod.js
         |                          |
         |                     table-handling-actions.mod (setEnable/setDisable)
         |                          |
         v                     [wb-rules engine]
    /devices/wbsc_*/               |
    (virtual device)          [MQTT output actuators]
```

---

## 4. Стратегия решения

### 4.1. Алгоритм гистерезиса

Классический гистерезис с мёртвой зоной:

```
        OFF зона          Мёртвая зона          ON зона
  ──────────────────┬───────────────────┬──────────────────
                    |                   |
              lowerLimit          upperLimit
         (target - hysteresis)  (target + hysteresis)
```

- При `curTemp >= upperLimit` → выключить нагрев
- При `curTemp <= lowerLimit` → включить нагрев
- В мёртвой зоне → сохранить текущее состояние (без изменений)

### 4.2. Массив актуаторов с инверсией

Каждый актуатор имеет `behaviorType`:
- **setEnable** — при нагреве включаем (`true`), при охлаждении выключаем (`false`)
- **setDisable** — инвертированная логика: при нагреве выключаем, при охлаждении включаем

Формула вычисления значения (XNOR):
```
desiredValue = shouldHeat === (behaviorType === 'setEnable')
```

| shouldHeat | behaviorType | desiredValue |
|---|---|---|
| true | setEnable | true |
| true | setDisable | false |
| false | setEnable | false |
| false | setDisable | true |

Запись в актуатор происходит только при изменении значения (оптимизация MQTT).

### 4.3. Persistent Storage

Целевая температура сохраняется через ScenarioBase API:
```
this.getPsUserSetting('targetTemp', defaultValue)
this.setPsUserSetting('targetTemp', value)
```

Хранится в общем хранилище `wb-scenarios-common-persistent-data`:
```
scenariosRegistry[idPrefix].userSettings.targetTemp = <number>
```

При первом запуске выполняется одноразовая миграция из старого
хранилища `wbscThermostatSettings` (до версии 1.7.6).

### 4.4. Обработка ошибок

Для каждого контрола (датчик + все актуаторы) создаётся
`whenChanged` правило на топик `#error`:

1. При появлении критической ошибки (`r` или `w`) запускается debounce-таймер (10 сек)
2. Если ошибка не исчезла за 10 сек → сценарий отключается, `rule_enabled` ставится readonly
3. При исчезновении ошибки → readonly снимается только когда ВСЕ ошибки (датчика и всех актуаторов) очищены

Ошибка датчика — отображается на контроле `current_temperature`.
Ошибки актуаторов — отображаются на контроле `actuator_status`.
Несколько актуаторов разделяют один VD-контрол, поэтому при очистке
ошибки проверяются ВСЕ актуаторы: красный снимается только когда
ни один актуатор не имеет критической ошибки.

---

## 5. Компоненты

### 5.1. Файлы

```
scenarios/thermostat/
├── thermostat.mod.js                    # Класс ThermostatScenario
├── scenario-init-thermostat.mod.js      # Модуль инициализации
├── README.md                            # Документация пользователя
├── dev-note-arc42.md                    # Архитектурная документация
└── img/                                 # Скриншоты для README

schema/
└── wb-scenarios.schema.json             # Определение thermostat

debian/
└── postinst                             # Миграция actuator → actuators
```

### 5.2. Класс ThermostatScenario

```
ThermostatScenario extends ScenarioBase
│
├── generateNames(idPrefix)
│   → vDevice, ruleTempChanged, ruleSetScStatus,
│     ruleSetTargetTemp, ruleSensorErr
│
├── defineControlsWaitConfig(cfg)
│   → [tempSensor, ...actuators[].control]
│
├── validateCfg(cfg)
│   → limits, targetTemp, hysteresis, sensorType, actuators
│
└── initSpecific(name, cfg)
    │
    ├── restoreTargetTemperature()
    │   ├── getPsUserSetting('targetTemp')
    │   ├── миграция из старого wbscThermostatSettings (если нужно)
    │   └── валидация диапазона
    │
    ├── addCustomControlsToVirtualDevice()
    │   ├── target_temperature (range, min..max)
    │   ├── current_temperature (value, readonly)
    │   └── actuator_status (switch, readonly)
    │
    └── createRules()
        ├── ruleTempChanged        # whenChanged tempSensor
        │   → обновить curTemp VD, пересчитать нагрев
        │
        ├── ruleSetScStatus        # whenChanged rule_enabled
        │   → ON: пересчитать нагрев, OFF: turnOffAllActuators
        │
        ├── ruleSetTargetTemp      # whenChanged target_temperature
        │   → сохранить в PS, пересчитать нагрев
        │
        ├── ruleSensorErr          # whenChanged tempSensor#error
        │   → createErrChangeRule с targetVdCtrl = curTemp
        │
        └── actuator_err_N         # whenChanged actuator[N]#error
            → createErrChangeRule с targetVdCtrl = actuatorStatus
```

---

## 6. Виртуальное устройство

Создаётся `wbsc_<idPrefix>` с контролами:

| Контрол | Тип | Описание |
|---|---|---|
| `rule_enabled` | switch | Вкл/выкл сценария (из базового класса) |
| `state` | enum, readonly | Состояние инициализации (из базового класса) |
| `target_temperature` | range | Целевая температура (min..max) |
| `current_temperature` | value, readonly | Текущее показание датчика |
| `actuator_status` | switch, readonly | Общий статус нагрева (логический) |

Per-actuator VD контролы НЕ создаются (решение: не засорять интерфейс).

---

## 7. Миграция конфига (postinst)

При обновлении с версий до 1.7.6, `debian/postinst` конвертирует
старый формат конфига:

```json
// Было (до 1.7.6):
{ "actuator": "relay_module/K2" }

// Стало (1.7.6+):
{ "actuators": [{ "control": "relay_module/K2", "behaviorType": "setEnable" }] }
```

Миграция через `jq`: находит все thermostat-сценарии с полем `actuator`,
создаёт массив `actuators` и удаляет старое поле.

---

## 8. Граничные случаи

### 8.1. Все актуаторы с ошибками
Readonly на `rule_enabled` снимается только когда ВСЕ ошибки очищены
(и датчик, и все актуаторы). Функция `tryClearReadonly` проверяет полный набор.

### 8.2. Температура вне диапазона после изменения лимитов
Если сохранённая температура выходит за новые границы `tempLimitsMin`/`tempLimitsMax`,
она сбрасывается на `cfg.targetTemp` с предупреждением в лог.

### 8.3. Оптимизация записи
Запись в актуаторы и VD-контрол `actuator_status` выполняется
только при изменении значения (проверка `!==` перед записью).

---

## 9. Технический долг

| Проблема | Приоритет | Предложение |
|---|---|---|
| Миграция из старого PS `wbscThermostatSettings` | Низкий | Удалить код миграции после 2027-04 |
| Per-actuator статус не отображается | Низкий | Добавить если будет запрос от пользователей |
| Дублирование error-handling логики | Средний | Вынести в ScenarioBase |
