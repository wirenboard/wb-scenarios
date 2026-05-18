# Periodic Timer — Архитектурная документация (ARC42)

## 1. Введение и цели

### 1.1. Описание задачи

Новый тип сценария **Periodic Timer** для контроллеров Wiren Board.
Выполняет циклические действия с заданным интервалом внутри настраиваемого
временного окна в выбранные дни недели. После каждой рабочей фазы контролы
автоматически возвращаются в обратное состояние.

Типичные применения: полив, вентиляция, импульсное управление нагрузкой.

### 1.2. Функциональные требования

- Повторяющееся выполнение действий с интервалом N секунд/минут/часов
- Выбор дней недели, когда сценарий активен
- Настраиваемое временное окно активности (`activeFrom` / `activeTo`)
- Действия (`outControls`) выполняются при старте цикла
- По истечении времени работы (`workTime`) каждый контрол автоматически
  возвращается в обратное состояние (reverse-логика)
- Очистка состояния при выходе из временного окна
- Ручной запуск через кнопку в виртуальном устройстве
- Отображение статуса, следующего запуска и отключения

### 1.3. Качественные цели

| Приоритет | Цель               | Описание                                          |
| --------- | ------------------ | ------------------------------------------------- |
| 1         | Точность таймингов | setTimeout обеспечивает точность до секунды       |
| 2         | Предсказуемость    | Первый цикл стартует сразу при входе в окно       |
| 3         | Простота           | UI понятен пользователю без документации          |
| 4         | Совместимость      | Те же паттерны что у Schedule и AstronomicalTimer |

### 1.4. Стейкхолдеры

| Роль                     | Ожидания                                                   |
| ------------------------ | ---------------------------------------------------------- |
| Пользователь контроллера | Простая настройка через WebUI, надёжная циклическая работа |
| Разработчик wb-scenarios | Соблюдение существующих паттернов и стиля                  |
| Инсталлятор              | Минимальная настройка при монтаже                          |

---

## 2. Ограничения

### 2.1. Технические

- **ES5 only** — wb-rules использует Duktape, нет ES6+
- **JSON Schema Draft-04** — формат схемы UI
- **Нет npm** — библиотеки нужно включать как .mod.js модули
- **Cron wb-rules** — статические выражения, не поддерживает динамическое расписание
- **setTimeout не персистентен** — не выживает при перезапуске wb-rules
- **ctx не персистентен** — `this.ctx` сбрасывается при перезапуске wb-rules

### 2.2. Кодстайл (wirenboard/codestyle + локальный eslint/prettier)

- 2 пробела отступ, без табов
- Single quotes для строк
- Semicolons обязательны
- 77 символов ширина строки
- Все функции должны быть именованными (no anonymous functions)
- camelCase для переменных, kebab-case для файлов
- ES5-совместимые trailing commas
- `require()` вместо import
- prettier + eslint (`@wirenboard/eslint`)

### 2.3. Организационные

- Соблюдение паттернов ScenarioBase
- Обязательная локализация (en + ru)

---

## 3. Контекст системы

### 3.1. Бизнес-контекст

```
[Пользователь] --(WebUI)--> [wb-mqtt-confed] --(JSON conf)--> [wb-rules]
                                                                    |
                                                          [Periodic Timer]
                                                                    |
                                                              [MQTT devices]
```

### 3.2. Технический контекст

```
wb-scenarios.schema.json  -->  wb-mqtt-confed (WebUI рендер)
         |
wb-scenarios.conf         -->  scenario-init-main.js
         |                          |
         |                     scenario-init-periodic-timer.mod.js
         |                          |
         |                     periodic-timer.mod.js
         |                          |
         |                     constants.mod.js (общие константы)
         |                          |
         v                     [wb-rules engine]
    /devices/wbsc_*/               |
    (virtual device)          [MQTT output controls]
```

---

## 4. Стратегия решения

### 4.1. Ключевое решение: цепочка setTimeout

**Проблема:** Интервал может быть задан в секундах, минутах или часах.
Cron wb-rules срабатывает только раз в минуту — этого недостаточно
для точных интервалов в секундах.

**Решение: setTimeout chain**

Первый цикл стартует немедленно (при входе в окно или при инициализации
внутри окна). Каждый цикл сам планирует следующий через `setTimeout`:

```
startWorkCycle():
  executeStart()
  setTimeout(workTimeMs):           ← first timer
    executeReverse()
    setTimeout(remainingMs):        ← second timer
      startWorkCycle()                  ← recursion
```

Cron (каждую минуту) выполняет только две функции:

- Вход в окно + цикл не запущен → `startWorkCycle()`
- Выход из окна или отключение → `stopWorkCycle()`

**Преимущества:**

- Точность до секунды (против минуты у cron-based подхода)
- Первый цикл запускается сразу, не ждёт следующей минуты
- Цепочка самодостаточна — не требует внешних триггеров

### 4.2. Reverse-логика

**Проблема:** Нужно автоматически возвращать контролы в исходное состояние
после рабочей фазы.

**Решение:** Для каждого `behaviorType` определено симметричное обратное действие:

| При старте               | При стопе                   |
| ------------------------ | --------------------------- |
| `setEnable`              | `setDisable`                |
| `setDisable`             | `setEnable`                 |
| `setValue` с `initValue` | `setValue` с `reverseValue` |

Типы `toggle`, `increaseValueBy`, `decreaseValueBy` исключены — у них нет
однозначного обратного действия.

### 4.3. Флаг inWorkPhase — защита от двойного reverse

**Проблема:** `stopWorkCycle` вызывается и при выходе из окна, и при отключении
сценария. Если в момент вызова цикл находится в паузе между фазами
(контролы уже выключены), reverse нельзя вызывать повторно — это
неожиданно включит их снова.

**Решение:** флаг `ctx.inWorkPhase`:

- `true` — контролы сейчас включены (между `executeStart` и `executeReverse`)
- `false` — контролы выключены (пауза между циклами)

`stopWorkCycle` вызывает `executeReverse` только если `inWorkPhase = true`.

### 4.4. Временное окно активности (`activeFrom` / `activeTo`)

Поля `activeFrom` и `activeTo` задают временное окно (формат `HH:MM`),
внутри которого выполняется цикличная логика.

Поддерживается перенос через полночь (`activeFrom > activeTo`),
например `22:00`–`06:00`. Вычисляется в `isInActiveWindow()`.

**Граница activeTo эксклюзивна** — cron в минуту `activeTo` уже видит
`isInActiveWindow = false` и останавливает цикл.

### 4.5. Контекст ctx и поведение при перезапуске

`this.ctx` — объект в памяти экземпляра сценария. При перезапуске wb-rules
сбрасывается в начальные значения. Последствия:

- setTimeout-таймеры не переживают рестарт
- При рестарте внутри окна `initSpecific` сразу вызывает `startWorkCycle()`
  (не ждёт следующей минуты cron) — **только если сценарий включён**.
  Состояние `rule_enabled` читается из Persistent Storage через
  `getPsUserSetting`, потому что VD-контрол на этом этапе ещё содержит
  forceDefault `true` (база восстанавливает его из PS после `initSpecific`).
- При рестарте вне окна — ждём cron на следующей минуте

Это осознанный trade-off в пользу простоты. Собственный Persistent Storage
не используется — читается только инфраструктурный `rule_enabled` базового класса.

---

## 5. Компоненты

### 5.1. Файлы

```
scenarios/periodic-timer/
├── periodic-timer.mod.js                # Класс PeriodicTimerScenario
├── scenario-init-periodic-timer.mod.js  # Модуль инициализации
├── README.md                            # Документация пользователя
└── dev-note-arc42.md                    # Архитектурная документация

schema/
└── wb-scenarios.schema.json             # Обновлённая схема (+periodicTimer)

scenarios/
└── scenario-init-main.js                # Обновлён: +setupPeriodicTimer()
```

### 5.2. Класс PeriodicTimerScenario

```
PeriodicTimerScenario extends ScenarioBase
│
├── generateNames(idPrefix)
│   → vDevice, ruleMain, ruleManual, ruleTimeUpdate, ruleDisable
│
├── defineControlsWaitConfig(cfg)
│   → controls из outControls
│
├── validateCfg(cfg)
│   → workTime: объект { unit, value }, unit ∈ {hours|minutes|seconds},
│              value — положительное целое
│   → interval: аналогично workTime
│   → scheduleDaysOfWeek: хотя бы 1 день, все валидные
│   → activeFrom / activeTo: формат HH:MM, не равны между собой
│   → outControls: хотя бы 1 элемент, валидные типы,
│                    для setValue — initValue и reverseValue числа
│
└── initSpecific(deviceTitle, cfg)
    │
    ├── addCustomControlsToVirtualDevice()
    │   ├── execute_now (pushbutton, order 2)
    │   ├── current_time (text, readonly, order 3)
    │   ├── active_window (text, readonly, order 4)
    │   ├── next_start (text, readonly, order 5)
    │   └── next_stop (text, readonly, order 6)
    │
    └── createRules()
        ├── createCronRule()          # cron("0 * * * * *") — каждую минуту
        │   └── cronTick():
        │       В окне + !isRunning   → startWorkCycle()
        │       Вне окна + isRunning  → stopWorkCycle() + refreshDisplay()
        │
        ├── createManualRule()        # whenChanged execute_now
        │   └── manualHandler():
        │       stopWorkCycle() → startWorkCycle()
        │       startWorkCycle сам управляет цепочкой: после work phase проверяет
        │       окно и продолжает или останавливается без ожидания cron-тика.
        │
        ├── createTimeUpdateRule()    # whenChanged system_time/*
        │   └── refreshDisplay(): current_time, state, next_start, next_stop
        │
        └── createDisableRule()       # whenChanged rule_enabled (не в addRule!)
            ├── выключение: stopWorkCycle() → refreshDisplay() → next_start/next_stop='--:--'
            └── включение:  refreshDisplay() → cronTick()
```

### 5.3. Цикл startWorkCycle подробно

```
startWorkCycle(self, cfg):
  intervalMs = timeObjToMs(cfg.interval)
  workTimeMs = timeObjToMs(cfg.workTime)

  Проверяем попадёт ли следующий цикл в окно (для отображения next_start):
    nextCycleTime = now + intervalMs
    nextCycleInWindow = isScheduledDay(nextCycleTime) && isInActiveWindow(nextCycleTime)

  ctx.isRunning    = true
  ctx.inWorkPhase  = true
  ctx.nextCycleStartMs = nextCycleInWindow ? nextCycleTime : null
  ctx.workTimeEndMs    = now + workTimeMs

  executeStart()
  refreshDisplay()

  setTimeout(workTimeMs):                    ← first timer (onWorkTimeExpired)
    ctx.inWorkPhase  = false
    ctx.workTimeEndMs = null
    executeReverse()

    if (intervalMs - workTimeMs) < MIN_CYCLE_DELAY_MS:
      remainingMs = MIN_CYCLE_DELAY_MS
    else:
      remainingMs = intervalMs - workTimeMs
    nextCycleTime = now + remainingMs

    if isInWindow(nextCycleTime):
      ctx.nextCycleStartMs = now + remainingMs
      refreshDisplay()
      setTimeout(remainingMs):               ← second timer
        startWorkCycle()                         ← next cycle
    else:
      ctx.isRunning = false
      refreshDisplay()
      (cronTick возобновит при следующем входе в окно)
```

---

## 6. Схема JSON (UI)

Определение `periodicTimer` добавлено в `definitions` и в `oneOf`.

Поля сценария (в порядке отображения):

- `name` — название сценария (обязательное)
- `idPrefix` — скрытый, технический
- `activeFrom` / `activeTo` — временное окно, `_format: "time"`, HH:MM
- `workTime` — объект `{ workTimeUnit, workTimeValue }`, время работы контролов
- `interval` — объект `{ intervalUnit, intervalValue }`, период повторения
- `scheduleDaysOfWeek` — дни недели
- `outControls` — действия (setEnable / setDisable / setValue с reverseValue)

Типы `toggle`, `increaseValueBy`, `decreaseValueBy` исключены —
не имеют однозначного обратного действия.

**Маппинг полей схемы → внутренний формат** (в `scenario-init-periodic-timer.mod.js`):

```js
interval: {
  unit:  rawInterval.intervalUnit,   // 'hours'|'minutes'|'seconds'
  value: rawInterval.intervalValue,  // number
},
workTime: {
  unit:  rawWorkTime.workTimeUnit,
  value: rawWorkTime.workTimeValue,
},
```

---

## 7. Виртуальное устройство

Создаётся `wbsc_<idPrefix>` с контролами:

| Контрол         | Тип             | Описание                                                          |
| --------------- | --------------- | ----------------------------------------------------------------- |
| `rule_enabled`  | switch          | Вкл/выкл сценария (из базового класса)                            |
| `execute_now`   | pushbutton      | Ручной немедленный запуск                                         |
| `current_time`  | text, readonly  | Текущее системное время                                           |
| `active_window` | text, readonly  | Временное окно: «18:00 - 19:00»                                   |
| `next_start`    | text, readonly  | Следующий старт цикла (или открытие окна); `--:--` при отключении |
| `next_stop`     | text, readonly  | Конец текущей или следующей рабочей фазы; `--:--` при отключении  |
| `state`         | value, readonly | NORMAL=6 / WAITING=8 / DISABLED=9                                 |

`next_start` и `next_stop` обновляются в реальном времени через ctx:

- Во время work phase: `next_start` = следующий цикл (если в окне), `next_stop` = конец текущей фазы
- В паузе между циклами: `next_start` = следующий цикл, `next_stop` = next_start + workTime (но не позже конца окна)
- Вне окна: `next_start` = следующее открытие окна, `next_stop` = next_start + workTime
- Сценарий отключён: оба поля = `--:--`

---

## 8. Параметры конфигурации

| Параметр             | Тип             | Обязательный | Описание                                              |
| -------------------- | --------------- | ------------ | ----------------------------------------------------- |
| `name`               | string          | да           | Название сценария                                     |
| `idPrefix`           | string          | нет          | Технический префикс MQTT-устройства                   |
| `activeFrom`         | string (HH:MM)  | да           | Начало временного окна (включительно)                 |
| `activeTo`           | string (HH:MM)  | да           | Конец временного окна (исключительно)                 |
| `interval`           | объект          | да           | `{ intervalUnit, intervalValue }` — период повторения |
| `workTime`           | объект          | да           | `{ workTimeUnit, workTimeValue }` — время работы      |
| `scheduleDaysOfWeek` | array of string | да           | Дни недели активности                                 |
| `outControls`        | array of object | да           | Действия с reverse-логикой                            |

**Единицы времени** (`unit`): `"hours"`, `"minutes"`, `"seconds"`

**Структура элемента `outControls`:**

| Поле            | Тип    | Описание                              |
| --------------- | ------ | ------------------------------------- |
| `mqttTopicName` | string | Имя контрола: `"device/control"`      |
| `behaviorType`  | string | `setEnable`, `setDisable`, `setValue` |
| `initValue`     | number | Для `setValue`: значение при старте   |
| `reverseValue`  | number | Для `setValue`: значение при стопе    |

---

## 9. Граничные случаи

### 9.1. Перезапуск wb-rules внутри окна активности

`initSpecific` немедленно вызывает `startWorkCycle()` если сценарий
включён (по `getPsUserSetting('rule_enabled', true)`) и мы в окне.
Задержки до следующего cron-тика нет. Если сценарий был выключен —
цикл не запускается; cron на следующей минуте увидит `rule_enabled=false`
во VD (база к тому моменту восстановит) и тоже не запустит.

### 9.2. workTime >= interval

`remainingMs = intervalMs - workTimeMs` может быть 0 или отрицательным.
Гарантия через `MIN_CYCLE_DELAY_MS = 100ms` — минимальная пауза между
циклами. Контролы при этом почти всегда включены (ON почти всё время, OFF 100ms).

Схема не запрещает `workTime >= interval` намеренно — это граничный, но
валидный кейс. Пользователь видит что происходит.

### 9.3. Следующий цикл попадает на границу окна

`startWorkCycle` заранее проверяет попадёт ли следующий цикл в окно.
Если нет — `nextCycleStartMs = null` (показывается следующее открытие окна).
Цепочка завершается, cronTick возобновит её при следующем входе в окно.

Аналогично `getNextStopTime` ограничивает результат по `windowEndMs` —
`next_stop` никогда не показывает время за пределами окна.

### 9.4. Сценарий выключен в середине work phase

`createDisableRule` (не зарегистрирован в `addRule`, всегда активен):

- Вызывает `stopWorkCycle()` — таймеры отменяются, если `inWorkPhase` → reverse
- Затем `refreshDisplay()` — устанавливает state=DISABLED и `next_start`/`next_stop` = `--:--`

### 9.5. Ручной запуск во время активного цикла

`manualHandler` реализован как:

```
stopWorkCycle(self, cfg)   ← cancel timers, reverse if inWorkPhase
startWorkCycle(self, cfg)  ← start fresh cycle with full chain
```

`startWorkCycle` обрабатывает всё стандартно: вычисляет `next_start`/`next_stop`,
запускает таймеры, и после work phase проверяет, попадает ли следующий цикл
в окно — если да, продолжает цепочку; если нет, останавливается и cronTick
возобновит её при следующем входе в окно.

### 9.6. Wrap-around окно (22:00–06:00)

`isInActiveWindow` использует OR-логику для переноса через полночь.
`getWindowEndMs` корректно вычисляет конец окна на следующий день.

**Ограничение: дни недели проверяются по текущему календарному дню.**
Для окна 22:00–06:00 с расписанием «только понедельник»: в вторник 02:00
`isTodayScheduled` вернёт `false` (сегодня вторник), хотя фактически мы внутри
понедельничного окна. Cron в 00:00 (смена суток) остановит цикл через `stopWorkCycle`.

Это осознанное упрощение: проверка по «текущему дню» проста и предсказуема.
Альтернатива (проверять день начала окна для ночного времени) усложнит логику
при минимальной практической пользе — большинство пользователей выбирают
одинаковые дни для обоих «кусков» ночного окна.

---

## 10. Статус реализации

### ✅ Этап 1: JSON Schema

- Определение `periodicTimer` в `wb-scenarios.schema.json`
- `interval` и `workTime` как объекты с `unit`/`value`
- `outControls` с `reverseValue` для `setValue`
- Переводы en + ru для всех полей

### ✅ Этап 2: Модуль сценария

- `periodic-timer.mod.js` — класс `PeriodicTimerScenario`
- setTimeout-цепочка с reverse-логикой
- Флаг `inWorkPhase` для защиты от двойного reverse
- Корректное отображение `next_start` / `next_stop` с учётом окна

### ✅ Этап 3: Модуль инициализации

- `scenario-init-periodic-timer.mod.js` с маппингом полей схемы
- `scenario-init-main.js` обновлён: добавлен `setupPeriodicTimer()`

### ✅ Этап 4: Тестирование на контроллере

Тесты выполнены на контроллере 192.168.1.144, 2026-03-13.
Конфиг теста: `buzzer/frequency`, interval=10s, workTime=5s, окно 11:00–11:16.

- TC1: init вне окна (14:50 MSK, окно 11:00–11:16) — state=WAITING=8,
  next_start = следующий день 11:00:00 ✅
- TC2: init внутри окна (14:54 MSK, окно 14:00–15:00) — state=ACTIVE=6,
  цикл стартует сразу, next_start/next_stop показывают корректные значения ✅
- TC3: setTimeout chain (interval=10s, workTime=5s) —
  `buzzer/frequency` меняется 3333→2222→3333→2222... каждые 10s,
  reverse через 5s, next_start обновляется корректно ✅
- TC4: execute_now вне окна (окно 11:00–11:16, время ~15:00) —
  buzzer=3333 (старт), через 5s buzzer=2222 (reverse),
  next_stop корректно обновился ✅
- TC5: disable mid-cycle (buzzer=3333 → rule_enabled=0) —
  buzzer немедленно=2222 (reverse), state=DISABLED=9 ✅

### ✅ Этап 5: Документация

- README написан и актуализирован
- arc42 актуализирован

---

## 11. Технический долг / Возможные улучшения

| Проблема                                                            | Приоритет | Предложение                                                |
| ------------------------------------------------------------------- | --------- | ---------------------------------------------------------- |
| setTimeout не переживает рестарт                                    | Низкий    | Для критичных сценариев рассмотреть PS для workTimerId     |
| workTime >= interval не валидируется                                | Низкий    | Добавить предупреждение в лог при конфиге с нулевой паузой |
| Wrap-around окно + дни недели: при смене суток цикл останавливается | Низкий    | см. секцию 9.6 — осознанное упрощение                      |
