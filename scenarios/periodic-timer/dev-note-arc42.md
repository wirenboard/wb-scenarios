# Periodic Timer — Архитектурная документация (ARC42)

## 1. Введение и цели

### 1.1. Описание задачи
Новый тип сценария **Periodic Timer** для контроллеров Wiren Board.
Позволяет выполнять циклические действия с заданным интервалом в минутах
в заданные дни недели внутри настраиваемого временного окна.
Через заданную паузу после первой группы действий автоматически
выполняется вторая группа (например: включить → подождать → выключить).

Типичные применения: полив, вентиляция, импульсное управление нагрузкой.

### 1.2. Функциональные требования
- Повторяющееся выполнение действий с интервалом N минут (от `activeFrom`)
- Выбор дней недели, когда сценарий активен
- Настраиваемое временное окно активности (`activeFrom` / `activeTo`)
- Первая группа действий (`startControls`) — выполняется в фазе запуска
- Пауза (`duration`) в минутах — продолжительность фазы запуска
- Вторая группа действий (`stopControls`) — выполняется в фазе остановки
- Очистка состояния при выходе из временного окна
- Ручной запуск через кнопку в виртуальном устройстве
- Отображение статуса активности, следующего запуска и отключения

### 1.3. Качественные цели
| Приоритет | Цель | Описание |
|---|---|---|
| 1 | Идемпотентность | Каждую минуту определяем текущую фазу и применяем состояние, а не отслеживаем события |
| 2 | Предсказуемость | Интервал отсчитывается от `activeFrom` |
| 3 | Простота | UI понятен пользователю без документации |
| 4 | Совместимость | Те же паттерны что у Schedule и AstronomicalTimer |

### 1.4. Стейкхолдеры
| Роль | Ожидания |
|---|---|
| Пользователь контроллера | Простая настройка через WebUI, надёжная циклическая работа |
| Разработчик wb-scenarios | Соблюдение существующих паттернов и стиля |
| Инсталлятор | Минимальная настройка при монтаже |

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
- `duration` должно быть строго меньше `interval`

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

### 4.1. Ключевое решение: отсчёт интервала

**Проблема:** Пользователь задаёт интервал в минутах (например, 60).
Непонятно, от какого момента считать — от старта wb-rules или от начала суток.

**Решение: Отсчёт от activeFrom**

Интервал отсчитывается от начала временного окна (`activeFrom`).
Формула определения фазы:

```js
var fromMin = timeStrToMinutes(cfg.activeFrom);
var elapsed = minuteOfDay >= fromMin
  ? minuteOfDay - fromMin
  : minuteOfDay + 1440 - fromMin;  // wrap-around
var phase = elapsed % cfg.interval;
```

**Преимущества:**
- Предсказуемость: первое срабатывание всегда точно в `activeFrom`
- Независимость от времени старта wb-rules
- Интуитивно: при interval=60 и activeFrom=22:00 сценарий срабатывает в 22:00, 23:00, 00:00, …

### 4.2. Идемпотентная фазовая логика

**Проблема:** Нужен механизм для надёжного чередования startControls и
stopControls без отслеживания событий и без Persistent Storage.

**Решение: Определение фазы по текущему времени**

Каждую минуту cron определяет текущую фазу цикла:

```
elapsed = minuteOfDay - fromMin  (+ 1440 при wrap-around)
phase   = elapsed % interval

duration > 0:
  phase < duration  → startControls (включить)
  phase >= duration → stopControls  (выключить)

duration = 0:
  phase === 0       → startControls (однократно за интервал)
```

**Преимущества:**
- Не требует Persistent Storage — состояние всегда вычисляется из времени
- Идемпотентность: повторный вызов не меняет состояния
- Устойчивость к ручному вмешательству: в следующую минуту нужное
  состояние будет восстановлено

**Следствие для типов действий:**
Так как действия выполняются каждую минуту, они должны быть идемпотентными.
Поэтому в схеме UI для periodicTimer доступны только `setEnable`, `setDisable`,
`setValue`. Типы `toggle`, `increaseValueBy`, `decreaseValueBy` исключены —
их многократный вызов даёт нежелательный накопительный эффект.

### 4.3. Порядок проверок в cron-тике

```
cron tick (каждую минуту):
  1. Вычислить inWindow = isEnabled && isTodayScheduled && isInActiveWindow

  2. Если НЕ inWindow:
     a. Если ctx.wasInActiveWindow == true (только что вышли из окна):
        → fire stopControls (очистка хвоста)
     b. ctx.wasInActiveWindow = false
     c. Выход

  3. ctx.wasInActiveWindow = true

  4. elapsed = minuteOfDay - fromMin  (+ 1440 при wrap-around)
     phase = elapsed % interval
     duration > 0:
       phase < duration  → fire startControls
       phase >= duration → fire stopControls
     duration = 0:
       phase === 0       → fire startControls

execute_now (ручной запуск):
  1. Проверить rule_enabled → если выключен → выход
  2. fire startControls немедленно
  3. Если duration > 0 → setTimeout(stopControls, duration * 60000)
```

### 4.4. Ограничения на duration

**duration < interval** — обязательное условие корректной работы.

Если `duration ≥ interval`, фаза запуска (`phase < duration`) перекрывает
следующий интервал. StartControls и stopControls будут чередоваться
непредсказуемо в одном и том же цикле.

**Пример:** interval=15 мин, duration=20 мин, phase:
- 0..14: phase < 20 → startControls (15 минут запуска)
- Следующий интервал начинается с phase=0 снова → startControls

Логика никогда не доходит до фазы stopControls (phase >= 20 при interval=15
невозможно). Поведение некорректно.

Проверяется в `validateCfg()`: `duration > 0 && duration >= interval` → ошибка.

Дополнительно: `interval + duration ≤ 1440` — сумма не должна превышать сутки.

### 4.5. duration = 0 → stopControls не используется

Если `duration = 0`, сценарий работает как простой повторяющийся таймер:
только `startControls` один раз за интервал (`phase === 0`). `stopControls`
в этом случае не выполняются.

### 4.6. Условное отображение stopControls в UI

`stopControls` всегда показывается в конфигураторе.
Механизм `options.dependencies` применим только внутри `items` массивов
и не поддерживает числовые диапазоны, поэтому `if/then/else` не используется.
Описание поля явно указывает: «Используется только если пауза > 0».

### 4.7. Временное окно активности (`activeFrom` / `activeTo`)

Поля `activeFrom` и `activeTo` задают временное окно (формат `HH:MM`),
внутри которого выполняется фазовая логика.
Реализованы как плоские поля объекта, по аналогии с другими полями конфигурации.

Поддерживается перенос через полночь (`activeFrom > activeTo`),
например `22:00`–`06:00`. Вычисляется в `isInActiveWindow()`.

**Граница activeTo эксклюзивна**

`isInActiveWindow` использует `minuteOfDay < toMin` (строгое неравенство).
Минута `activeTo` уже вне окна. Это означает:
- статус переключается с «Активен» на «Ожидает» ровно в момент `activeTo`
- `startControls` никогда не срабатывают в минуту `activeTo`

Рекомендуемая формула:

```
activeTo = время_последнего_старта + duration + 1 мин
```

Пример: последний старт в 19:00, duration=5 → activeTo = 19:06.
При этом:
- 19:00–19:04: start phase (startControls каждую минуту)
- 19:05: stop phase (stopControls)
- 19:06: вне окна, cleanup (idempotent)

Для переноса через полночь аналогично: `activeTo` — первая минута вне окна.

### 4.8. Контекст ctx и поведение при перезапуске

`this.ctx` — объект в памяти экземпляра сценария. Хранит:
- `wasInActiveWindow` (boolean) — было ли прошлое срабатывание cron внутри окна

При перезапуске wb-rules `ctx` сбрасывается. Последствия:
- Очистка при выходе из окна (`ctx.wasInActiveWindow → true`) не сработает
  если wb-rules перезапустился снаружи окна
- `setTimeout` для ручного запуска не переживает рестарт

Это осознанный trade-off в пользу простоты. Persistent Storage не используется.

---

## 5. Компоненты

### 5.1. Файлы

```
scenarios/periodic-timer/
├── periodic-timer.mod.js                # Класс PeriodicTimerScenario
├── scenario-init-periodic-timer.mod.js  # Модуль инициализации
└── README.md                            # Документация пользователя

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
│   → controls из startControls + stopControls
│
├── validateCfg(cfg)
│   → interval: целое число, >= 1, <= 1440
│   → duration: целое число, >= 0, < interval (если > 0)
│   → scheduleDaysOfWeek: хотя бы 1 день, все валидные
│   → startControls: хотя бы 1 элемент, валидные типы
│   → stopControls: хотя бы 1 элемент, валидные типы (если duration > 0)
│
└── initSpecific(name, cfg)
    │
    ├── addCustomControlsToVirtualDevice()
    │   ├── execute_now (pushbutton, order 2)
    │   ├── current_time (text, readonly, order 3)
    │   ├── active_window (text, readonly, order 4)
    │   ├── next_start (text, readonly, order 5)
    │   └── next_stop (text, readonly, order 6) — только если duration > 0
    │
    └── createRules()
        ├── createCronRule()          # cron("0 * * * * *")
        │   └── cronTick():
        │       1. Вычислить inWindow
        │       2. Если !inWindow → очистка + выход
        │       3. phase = minuteOfDay % interval
        │       4. Применить фазу: start или stop
        │
        ├── createManualRule()        # whenChanged execute_now
        │   └── fire startControls + setTimeout(stopControls)
        │
        ├── createTimeUpdateRule()   # whenChanged system_time/*
        │   └── обновить current_time, state (computeState),
        │       next_start, next_stop
        │
        └── createDisableRule()      # whenChanged rule_enabled (unmanaged)
            ├── выключение: если duration > 0 → fire stopControls,
            │   сбросить wasInActiveWindow; setState(DISABLED)
            └── включение: setState(computeState), обновить current_time/
                next_start/next_stop, вызвать cronTick() немедленно
```

---

## 6. Схема JSON (UI)

Определение `periodicTimer` добавлено в `definitions` и в `oneOf`.

Поля сценария (в порядке отображения):
- `name` — название сценария (обязательное)
- `idPrefix` — скрытый, технический (не в `required`, не в `defaultProperties`)
- `activeFrom` / `activeTo` — временное окно, `_format: "time"`, тип string HH:MM
- `interval` (integer, 1–1440) — интервал повторения
- `duration` (integer, 0–1440) — длительность фазы запуска
- `scheduleDaysOfWeek` — дни недели
- `startControls` — первая группа действий (только setEnable/setDisable/setValue)
- `stopControls` — вторая группа действий (только setEnable/setDisable/setValue)

Типы `toggle`, `increaseValueBy`, `decreaseValueBy` исключены из схемы
periodicTimer — они не идемпотентны и несовместимы с поминутным повтором.

---

## 7. Виртуальное устройство

Создаётся `wbsc_<idPrefix>` с контролами:

| Контрол | Тип | Описание |
|---|---|---|
| `rule_enabled` | switch | Вкл/выкл сценария (из базового класса) |
| `execute_now` | pushbutton | Ручной запуск startControls |
| `current_time` | text, readonly | Текущее время системы |
| `active_window` | text, readonly | Временное окно: «18:00 - 19:00» |
| `next_start` | text, readonly | Дата и время следующего запуска (формат «Понедельник 2026-03-10 14:00») |
| `next_stop` | text, readonly | Дата и время следующего отключения (только если duration > 0) |
| `state` | value, readonly | Состояние из ScenarioState: «Активен» (NORMAL=6) / «Ожидает» (WAITING=8) / «Отключен» (DISABLED=9) |

---

## 8. Параметры конфигурации

| Параметр | Тип | Обязательный | Описание |
|---|---|---|---|
| `name` | string | да | Название сценария |
| `idPrefix` | string | нет | Технический префикс MQTT-устройства |
| `activeFrom` | string (HH:MM) | да | Начало временного окна активности |
| `activeTo` | string (HH:MM) | да | Конец временного окна активности |
| `interval` | integer (1–1440) | да | Интервал повторения в минутах |
| `duration` | integer (0–1440) | да | Длительность фазы запуска в минутах. 0 = вторая фаза отключена |
| `scheduleDaysOfWeek` | array of string | да | Дни недели активности |
| `startControls` | array of object | да | Действия фазы запуска |
| `stopControls` | array of object | нет | Действия фазы остановки (игнорируется при duration = 0) |

**Ограничения (проверяются в `validateCfg`):**
- `interval >= 1`
- `duration >= 0`
- `duration < interval` (если `duration > 0`)
- `interval + duration <= 1440`
- `startControls` — минимум 1 элемент всегда
- `stopControls` — минимум 1 элемент только если `duration > 0`
- `activeFrom !== activeTo`

---

## 9. Граничные случаи

### 9.1. Перезапуск wb-rules внутри окна активности

`this.ctx` сбрасывается при перезапуске. Последствия:
- `ctx.wasInActiveWindow = false` → очистка при выходе из окна **не сработает**
  если wb-rules перезапустился снаружи окна после того, как был внутри
- Если wb-rules перезапустился внутри окна, cron подхватит правильную фазу
  на следующей минуте — логика восстановится автоматически

Это осознанный trade-off. Persistent Storage намеренно не используется.

### 9.2. interval не делит 1440 нацело

Последнее срабатывание за день может дать "неполный" цикл. Например,
при interval=7 последний startControls может сработать в 23:58,
а stopControls — уже после полуночи (если duration > 0 и окно позволяет).
UI это не запрещает.

### 9.3. Ручной запуск через execute_now

Выполняет startControls немедленно. При `duration > 0` планирует stopControls
через `setTimeout` — best-effort, не переживает перезапуск wb-rules.
Следующий автоматический тик произойдёт в ближайшую минуту независимо
от ручного запуска.

### 9.4. Сценарий выключен в середине цикла

Если пользователь отключил сценарий (`rule_enabled = false`), срабатывает
`createDisableRule` (неуправляемое правило, не зависит от `rule_enabled`):
- Если `duration > 0` — немедленно выполняются `stopControls` и сбрасывается
  `ctx.wasInActiveWindow`, чтобы контролы вернулись в состояние остановки.
- `state` устанавливается в «Отключен» (DISABLED=9).

При повторном включении `state` сразу обновляется по
`computeState()` (Активен или Ожидает).

### 9.5. Формула activeTo

`activeTo` — эксклюзивная граница. Рекомендуемая формула:

```
activeTo = время_последнего_старта + duration + 1 мин
```

**Пример:** interval=60, duration=5, последний старт в 19:00 →
activeTo = 19:06.
- 19:00–19:04: start phase ✓
- 19:05: stop phase ✓ (внутри окна)
- 19:06: вне окна, cleanup (idempotent)

---

## 10. Статус реализации

### ✅ Этап 1: JSON Schema — выполнено
- Определение `periodicTimer` добавлено в `wb-scenarios.schema.json`
- Поля `activeFrom`, `activeTo` добавлены как плоские поля формата `time`
- `stopControls` всегда отображается (без if/then/else)
- Типы `toggle`, `increaseValueBy`, `decreaseValueBy` исключены из схемы
- Переводы en + ru для всех полей

### ✅ Этап 2: Модуль сценария — выполнено
- `periodic-timer.mod.js` — класс `PeriodicTimerScenario`
- Идемпотентная фазовая логика (без Persistent Storage)
- Очистка при выходе из окна через `ctx.wasInActiveWindow`
- `setTimeout` для ручного запуска
- Контрол `state` (Активен/Ожидает/Отключен)
- Контролы `active_window`, `next_start`, `next_stop`

### ✅ Этап 3: Модуль инициализации — выполнено
- `scenario-init-periodic-timer.mod.js`
- `scenario-init-main.js` обновлён: добавлен `setupPeriodicTimer()`

### ✅ Этап 4: Тестирование на контроллере — выполнено
- Базовая инициализация проверена
- Деплой и рестарт wb-rules без ошибок

### ✅ Этап 5: Документация — выполнено
- README написан и актуализирован
- arc42 актуализирован

---

## 11. Технический долг / Возможные улучшения

| Проблема | Приоритет | Предложение |
|---|---|---|
| Условное отображение stopControls в UI | Средний | Если wb-mqtt-confed добавит if/then/else или value-based dependencies — скрывать stopControls при duration = 0 |
| Очистка не выживает перезапуск | Низкий | Если понадобится — добавить PS для `wasInActiveWindow` |
| setTimeout не выживает перезапуск | Низкий | Для критичных сценариев рассмотреть PS для manual stop |
| interval не обязан делить 1440 | Низкий | Добавить предупреждение в лог при нестандартном значении |
