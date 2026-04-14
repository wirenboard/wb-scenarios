# Thermostat — Архитектурная документация (ARC42)

## 1. Введение и цели

### 1.1. Описание задачи
Сценарий **Thermostat** поддерживает заданную температуру с помощью одного из двух алгоритмов:

- Гистерезис (двухпозиционное регулирование),
- PID + ШИМ (пропорционально-интегрально-дифференциальный регулятор с широтно-импульсной модуляцией).

Управление осуществляется одним или несколькими актуаторами (реле, клапаны и т.п.).

### 1.2. Функциональные требования
- Поддержание целевой температуры с настраиваемым гистерезисом или с помощью PID‑регулятора и ШИМ
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
| 4 | Гибкость | Поддержка двух принципиально разных алгоритмов управления |

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
- **PID-движок**: используется модуль pid-engine.mod, реализующий ПИД с защитой
от интегрального насыщения и зоной нечувствительности

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
         |                          ├── table-handling-actions.mod (setEnable/setDisable)
         |                          ├── pid-engine.mod (PID computation)
         |                          |
         v                     [wb-rules engine]
    /devices/wbsc_*/               |
    (virtual device)          [MQTT output actuators]
```

---

## 4. Стратегия решения

### 4.1. Режимы управления

Сценарий поддерживает два взаимоисключающих алгоритма, выбираемых параметром `controlMode`:

1) Гистерезис (hysteresis)

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

2) PID + ШИМ (pid)

Используется пропорционально-интегрально-дифференциальный регулятор, выход которого (0–100%)
преобразуется в длительность включения актуатора внутри фиксированного периода ШИМ.

Все параметры PID-режима сгруппированы в объекте `pidSettings`:
- deadBand — зона нечувствительности (°C). Внутри неё П-, И- и Д-составляющие умножаются на 0.1 для предотвращения микропереключений.
- pidCoefficients (Kp, Ki, Kd) — коэффициенты регулятора (вложенный объект).
- pwmPeriodSec — период ШИМ (целое число секунд). Должен быть больше minOffTimeSec.
- pidRecalcCycles — PID пересчитывается не каждый цикл, а раз в N периодов (экономия ресурсов, допускается инерционность тепловых процессов).
- minOnTimeSec / minOffTimeSec — минимальное время включения и выключения за период. Защищает реле от слишком коротких импульсов (например, при 100% мощности гарантируется пауза minOffTimeSec).

Алгоритм цикла ШИМ (runPwmCycle):

1) Если наступило время пересчёта PID (pwmCycleCount === 0), вычислить выход.
2) Перевести выход (%) в длительность включения onTime = (pidOutput / 100) * pwmPeriodSec.
3) Применить ограничения minOnTimeSec / minOffTimeSec (может обнулить onTime или скорректировать offTime).
4) Если onTime >= pwmPeriodSec → держать включённым весь период. Если onTime <= 0 → держать выключенным весь период.
Иначе включаем сейчас и планируем выключение через onTime секунд (setTimeout).
5) Запланировать следующий цикл через pwmPeriodSec.

Таймеры управляются централизованно (startPidMode, stopPidMode), чтобы избежать утечек при выключении сценария.

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
│     ruleSetTargetTemp, ruleSensorErr, rulePidReset (только PID)
│
├── defineControlsWaitConfig(cfg)
│   → [tempSensor, ...actuators[].mqttTopicName]
│
├── validateCfg(cfg)
│   → limits, targetTemp, hysteresis, pidSettings (deadBand,
│     pidCoefficients, pwmPeriodSec, pidRecalcCycles, minOn/OffTime),
│     sensorType, actuators
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
    │   ├── actuator_status (switch, readonly)
    │   ├── output_power (value, %, readonly)        # только PID
    │   ├── output_timing (text, readonly)           # только PID
    │   └── pid_reset (pushbutton)                   # только PID
    │
    └── createRules()
        ├── Режим гистерезиса:
        │   ├── ruleTempChanged        # whenChanged tempSensor
        │   │   → обновить curTemp VD, пересчитать нагрев
        │   ├── ruleSetScStatus        # whenChanged rule_enabled
        │   │   → ON: пересчитать нагрев, OFF: turnOffAllActuators
        │   └── ruleSetTargetTemp      # whenChanged target_temperature
        │       → сохранить в PS, пересчитать нагрев
        │
        ├── Режим PID:
        │   ├── ruleTempChanged        # whenChanged tempSensor
        │   │   → только обновить curTemp VD
        │   ├── ruleSetScStatus        # whenChanged rule_enabled
        │   │   → ON: startPidMode(), OFF: stopPidMode()
        │   ├── ruleSetTargetTemp      # whenChanged target_temperature
        │   │   → сохранить в PS (PID подхватит на следующем цикле)
        │   └── rulePidReset           # whenChanged pid_reset
        │       → сброс интегральной суммы и перезапуск цикла
        │
        └── Общие правила ошибок:
            ├── ruleSensorErr          # whenChanged tempSensor#error
            │   → createErrChangeRule с targetVdCtrl = curTemp
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
| `output_power` | value, readonly | только PID,	Выход ПИД-регулятора (0–100%) |
| `output_timing` | text, readonly | только PID, Длительности вкл/выкл в текущем ШИМ-цикле, формат "on / off" (сек) |
| `pid_reset` | pushbutton | только PID, Кнопка сброса интегральной суммы ПИД |

Per-actuator VD контролы НЕ создаются (решение: не засорять интерфейс).

---

## 7. Миграция конфига (postinst)

При обновлении с версий до 1.7.6, `debian/postinst` конвертирует
старый формат конфига:

```json
// Было (до 1.7.6):
{ "actuator": "relay_module/K2" }

// Стало (1.7.6+):
{ "actuators": [{ "mqttTopicName": "relay_module/K2", "behaviorType": "setEnable" }] }
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

### 8.4. Защита реле в PID-режиме
minOnTimeSec предотвращает слишком короткие импульсы включения (если рассчитанное
время меньше, цикл пропускается). minOffTimeSec гарантирует минимальную паузу даже
при 100% мощности (напр., при pwmPeriodSec=60, minOffTimeSec=5 реальное включение составит 55 с).

### 8.5. Подавление ложного выключения при старте
При восстановлении rule_enabled = false из хранилища после перезагрузки wb-rules
первое событие выключения игнорируется (suppressNextDisable), чтобы не сбрасывать
вручную включенные актуаторы.

---

## 9. Технический долг

| Проблема | Приоритет | Предложение |
|---|---|---|
| Миграция из старого PS `wbscThermostatSettings` | Низкий | Удалить код миграции после 2027-04 |
| Per-actuator статус не отображается | Низкий | Добавить если будет запрос от пользователей |
| Дублирование error-handling логики | Средний | Вынести в ScenarioBase |
| PID-движок не поддерживает адаптивное изменение dt | Низкий |	Сейчас dt фиксирован, это допустимо для тепловых процессов |
