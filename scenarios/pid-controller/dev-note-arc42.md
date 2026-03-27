# PID Controller — Архитектурная документация (ARC42)

## 1. Введение и цели

### 1.1. Описание задачи
Сценарий **PID Controller** поддерживает заданное значение
(уставку) с помощью PID-алгоритма и PWM-управления актуаторами.
В отличие от термостата (bang-bang с гистерезисом), PID дозирует
среднюю мощность, обеспечивая плавное поддержание без
характерной «пилы».

### 1.2. Функциональные требования
- PID-регулирование (пропорциональный, интегральный,
  дифференциальный компоненты)
- PWM-управление ON/OFF актуаторами (реле, клапаны)
- Инверсия логики управления (`setEnable`/`setDisable`)
- Deadband — снижение усиления вблизи уставки
- Минимальная длительность включения (защита оборудования)
- Сброс PID при смене уставки и отключении сценария
- Сохранение уставки в persistent storage
- Обработка ошибок датчика и актуаторов с debounce-таймером
- Виртуальное устройство для управления через WebUI

### 1.3. Качественные цели
| Приоритет | Цель | Описание |
|---|---|---|
| 1 | Точность | Поддержание значения в пределах ±deadband |
| 2 | Надёжность | Корректная работа при ошибках датчиков |
| 3 | Простота | Разумные дефолты, минимум параметров |

### 1.4. Стейкхолдеры
| Роль | Ожидания |
|---|---|
| Пользователь контроллера | Стабильное значение без скачков |
| Разработчик wb-scenarios | Соблюдение паттернов ScenarioBase |
| Инсталлятор | Работает из коробки с дефолтами |

---

## 2. Ограничения

### 2.1. Технические
- **ES5 only** — wb-rules использует Duktape, нет ES6+
- **JSON Schema Draft-04** — формат схемы UI
- **Типы контролов**: актуаторы только `switch`, датчик —
  `value` или `temperature`
- **setTimeout** — не переживает рестарт wb-rules,
  PID-состояние (интеграл) теряется

### 2.2. Кодстайл
- 2 пробела отступ, single quotes, semicolons
- 77 символов ширина строки
- camelCase для переменных, kebab-case для файлов
- ES5-совместимые trailing commas

---

## 3. Контекст системы

### 3.1. Технический контекст
```
wb-scenarios.schema.json  -->  wb-mqtt-confed (WebUI)
         |
wb-scenarios.conf         -->  scenario-init-main.js
         |                          |
         |                  scenario-init-pid-controller.mod.js
         |                          |
         |                  pid-controller.mod.js
         |                          |
         |                  pid-engine.mod.js (PID-алгоритм)
         |                          |
         v                     [wb-rules engine]
    /devices/wbsc_*/               |
    (virtual device)          [MQTT актуаторы]
```

### 3.2. Поток данных
```
[Датчик]
    |
    v
pid-engine.mod.js
(вход: measurement, setpoint, dt)
(выход: output 0-100%)
    |
    v
PWM-логика: startWorkCycle()
  computePidOutput()     → PID-расчёт
  calculatePwmTiming()   → ON/OFF времена + minCycle
  updateActiveDisplay()  → VD контролы
  executePwm()           → актуаторы + таймеры
    |
    v
[Реле / клапаны]
```

---

## 4. Стратегия решения

### 4.1. PID-алгоритм

Стандартный PID с anti-windup и фильтрацией производной:

```
error = setpoint - measurement

// Deadband: снижаем усиление вблизи цели
gainFactor = (|error| < deadband) ? 0.1 : 1.0

P = Kp * error * gainFactor

integral += Ki * error * dt * gainFactor
integral = clamp(integral, 0, 100)

dMeasurement = (measurement - lastMeasurement) / dt
filteredD = 0.8 * prevFilteredD + 0.2 * dMeasurement
D = -Kd * filteredD * gainFactor

output = clamp(P + integral + D, 0, 100)
```

**Ключевые решения:**
- **D на measurement** — при изменении setpoint ошибка
  скачкообразно меняется, производная по measurement плавная
- **Low-pass фильтр (0.8/0.2)** — сглаживает шум датчика
- **Clamping интеграла** — простой anti-windup, интеграл
  не превышает диапазон выхода
- **Deadband с gainFactor 0.1** — в зоне ±deadband PID
  работает на 10% усиления, компенсируя дрейф без
  микро-переключений

### 4.2. PWM-управление

PID и PWM работают синхронно — **один цикл = один расчёт**:

```
startWorkCycle() — каждые pwmPeriod секунд:
  1. Читаем measurement и setpoint
  2. computePidOutput() → output (0-100%)
  3. calculatePwmTiming():
     - onTime = pwmPeriod * output / 100
     - minCycleDuration guard (else if):
       onTime < min → onTime = min
       offTime < min → offTime = min
     - output пересчитывается из реального onTime
  4. updateActiveDisplay() → output_power, state,
     on_off_time, actuator_status
  5. executePwm():
     - applyActuators(isHeating)
     - 0 < output < 100: setTimeout(OFF, onTimeMs)
     - setTimeout(nextCycle, periodMs)
```

**Почему один цикл = один расчёт:**
- Нет рассинхронизации между отображаемой и реальной
  мощностью
- Нет сложной логики перерасчёта таймаутов
- Для систем отопления (инерция часы) период 5 мин
  достаточен

### 4.3. Пересоздание цикла

Цикл пересоздаётся (cancelTimers + startWorkCycle) при:
- **Смена setpoint** — `pid.reset()` + немедленный новый
  цикл. Старый интеграл неактуален для новой уставки.
- **Включение сценария** (rule_enabled) — первый цикл
  стартует сразу

### 4.4. Сброс PID (pid.reset)

Вызывается при:
- **Отключение сценария** (rule_enabled=false) — за время
  выключения значение может измениться, старый интеграл
  вызовет выброс мощности
- **Смена setpoint** — интеграл накоплен под старую
  уставку, с новой уставкой он неактуален

reset() обнуляет: integral, lastMeasurement,
filteredDerivative. Первый цикл после reset работает
только на P (I=первый шаг, D=0).

### 4.5. Массив актуаторов с инверсией

Каждый актуатор имеет `behaviorType`:
- **setEnable** — при нагреве включаем
- **setDisable** — инвертированная логика

XNOR-формула: `desired = shouldHeat === isSetEnable`

PWM управляет всеми актуаторами одновременно.

### 4.6. Persistent Storage

Уставка сохраняется через ScenarioBase API:
```
this.getPsUserSetting('setpoint', defaultValue)
this.setPsUserSetting('setpoint', value)
```

Интеграл PID **не сохраняется** — при рестарте wb-rules
PID начинает с нуля. Плавный выход на режим за несколько
циклов.

### 4.7. Обработка ошибок

Аналогично термостату: для каждого контрола (датчик +
актуаторы) правило на топик `#error`:

1. Критическая ошибка → debounce 10 сек
2. Ошибка не исчезла → сценарий отключается
3. Ошибка очищена у ВСЕХ контролов → восстановление

---

## 5. Компоненты

### 5.1. Файлы

```
scenarios/pid-controller/
├── pid-controller.mod.js         # Хардкод для тестирования
├── dev-note-arc42.md             # Архитектурная документация
├── test-cases.md                 # Тест-кейсы
└── test-results-*.md             # Результаты тестов

src/
└── pid-engine.mod.js             # PID-алгоритм (без MQTT)

schema/
└── wb-scenarios.schema.json      # Определение pidController
```

### 5.2. Модуль pid-engine.mod.js

Чистый PID-алгоритм без зависимостей от MQTT/wb-rules:

```
PidEngine(kp, ki, kd, deadband)
│
├── compute(setpoint, measurement, dt)
│   → P + I + D, возвращает output (0..100)
│
├── reset()
│   → обнуляет integral, lastMeasurement,
│     filteredDerivative
│
└── getState()
    → { p, i, d, integral, output }
```

### 5.3. Хардкод-скрипт (текущий этап)

```
pid-controller.mod.js (тестовый хардкод)
│
├── computePidOutput(measurement, setpoint)
│   → pid.compute() + лог компонентов
│
├── calculatePwmTiming(output, periodMs)
│   → {onTimeMs, offTimeMs, output}
│   → minCycleDuration guard + пересчёт output
│
├── updateActiveDisplay(output, onSec, offSec)
│   → output_power, state, on_off_time,
│     actuator_status
│
├── executePwm(output, onMs, offMs, periodMs)
│   → applyActuators + setTimeout OFF/nextCycle
│
├── startWorkCycle()
│   → оркестратор: cancelTimers → compute →
│     timing → display → execute
│
├── Правила:
│   ├── pid_test_enable    (rule_enabled)
│   ├── pid_test_setpoint  (reset + restart)
│   └── pid_test_sensor    (sync VD)
│
└── initialStart (setTimeout 1s)
```

---

## 6. Виртуальное устройство

Создаётся `wbsc_<idPrefix>` с контролами:

| Контрол | Тип | Описание |
|---|---|---|
| `rule_enabled` | switch | Вкл/выкл сценария |
| `setpoint` | range | Уставка (min..max) |
| `current_value` | value, RO | Показание датчика |
| `output_power` | range, RO, 0.1 | Мощность (%) |
| `cycle_period` | value, RO | Интервал регулирования (с) |
| `on_off_time` | text, RO | Вкл/Выкл секунды ("10 / 20") |
| `actuator_status` | switch, RO | Состояние реле |
| `state` | text, RO | Активен / Ожидает / Отключен |

### 6.1. Состояние (state)

- **Активен** — реле включено (ON-фаза PWM)
- **Ожидает** — реле выключено (OFF-фаза или output=0%)
- **Отключен** — rule_enabled = false

---

## 7. Параметры конфигурации

| Параметр | Тип | Default | Описание |
|---|---|---|---|
| `sensor` | string | — | MQTT-топик датчика |
| `setpoint` | number | 22 | Уставка |
| `deadband` | number | 0.2 | Мёртвая зона |
| `setpointLimits` | {min, max} | {5, 35} | Диапазон слайдера |
| `pid` | {kp, ki, kd} | {10, 0.005, 2} | Коэффициенты PID |
| `pwmPeriod` | integer | 300 | Период цикла (сек) |
| `minCycleDuration` | integer | 0 | Мин. ON/OFF (сек) |
| `actuators` | array | — | Массив актуаторов |

### 7.1. Рекомендуемые значения

| Применение | pwmPeriod | Kp | Ki | Kd | deadband |
|---|---|---|---|---|---|
| Радиаторное отопление | 300 | 10 | 0.005 | 2 | 0.2 |
| Тёплый пол | 600 | 5 | 0.002 | 3 | 0.3 |
| Кондиционирование | 120 | 15 | 0.01 | 1 | 0.2 |

---

## 8. Граничные случаи

### 8.1. Рестарт wb-rules
Интеграл PID сбрасывается. Первые циклы PID работает на
P-компоненте, интеграл накапливается постепенно.

### 8.2. Смена setpoint в runtime
`pid.reset()` + немедленный перезапуск цикла. Старые таймеры
отменяются. PID начинает с чистого состояния (I=0, D=0).
D-компонент не скачет (считается по measurement).

### 8.3. output_power = 0% или 100%
При 0% — реле выключено весь период, OFF-таймер не
создаётся. on_off_time = "0 / 30". state = Ожидает.
При 100% — реле включено весь период, ON-таймер не
создаётся. on_off_time = "30 / 0". state = Активен.

### 8.4. minCycleDuration > pwmPeriod / 2
Невалидная конфигурация — validateCfg отклоняет.

### 8.5. minCycleDuration guard
При малом output (onTime < min) — onTime расширяется до
min, offTime = period - onTime. output_power пересчитывается
из фактического onTime. Аналогично для высокого output
(offTime < min). Используется `else if` — только одна
фаза расширяется за раз.

### 8.6. Датчик обновляется реже pwmPeriod
PID использует последнее значение. D-компонент нулевой
(нет изменения measurement).

---

## 9. Отличия от термостата

| | Термостат | PID Controller |
|---|---|---|
| Алгоритм | Bang-bang + гистерезис | PID + PWM |
| Выход | ON/OFF | 0-100% → PWM |
| Точность | ±гистерезис | ±deadband (плавнее) |
| Параметры | hysteresis | Kp, Ki, Kd, pwmPeriod |
| Переключения реле | Редкие | Каждый pwmPeriod |
| Сложность | Простая | Средняя |
| Когда | Простые on/off | Тёплый пол, точный контроль |

---

## 10. Технический долг

| Проблема | Приоритет | Предложение |
|---|---|---|
| Интеграл теряется при рестарте | Низкий | Сохранять в PS при необходимости |
| Нет автонастройки коэффициентов | Низкий | Ziegler-Nichols relay |
| Нет поддержки аналоговых выходов | Средний | Режим analog: прямой выход 0-100% на аналоговый актуатор (0-10V) без программного PWM |
