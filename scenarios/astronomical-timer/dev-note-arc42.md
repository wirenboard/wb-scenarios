# Astronomical Timer — Архитектурная документация (ARC42)

## 1. Введение и цели

### 1.1. Описание задачи

Новый тип сценария **Astronomical Timer** для контроллеров Wiren Board.
Аналогичен сценарию Schedule, но вместо фиксированного времени (HH:MM)
позволяет привязать выполнение действий к астрономическим событиям
(восход, закат, сумерки и т.п.).

### 1.2. Функциональные требования

- Выполнение действий по астрономическим событиям (восход, закат, сумерки и др.)
- Смещение (offset) в минутах до/после события (±12 часов)
- Указание координат (lat/lon) пользователем
- Выбор дней недели с проверкой после применения смещения
- Те же действия (outControls) что и у Schedule
- Локальный расчёт через suncalc (без интернета)
- Отображение рассчитанного времени следующего срабатывания
- Отображение исходного времени астрособытия (при offset ≠ 0)
- Автоматическое определение смены часового пояса

### 1.3. Качественные цели

| Приоритет | Цель         | Описание                                                     |
| --------- | ------------ | ------------------------------------------------------------ |
| 1         | Автономность | Расчёт полностью локальный, без внешних сервисов             |
| 2         | Простота     | UI понятен пользователю без документации                     |
| 3         | Надёжность   | Корректная работа на всех широтах, включая полярные          |
| 4         | Кэширование  | Оптимизация производительности через использование контекста |

### 1.4. Стейкхолдеры

| Роль                     | Ожидания                                       |
| ------------------------ | ---------------------------------------------- |
| Пользователь контроллера | Простая настройка через WebUI, надёжная работа |
| Разработчик wb-scenarios | Соблюдение существующих паттернов и стиля      |
| Инсталлятор              | Минимальная конфигурация при монтаже           |

---

## 2. Ограничения

### 2.1. Технические

- **ES5 only** — wb-rules использует Duktape, нет ES6+
- **JSON Schema Draft-04** — формат схемы UI
- **Нет npm** — библиотеки нужно включать как .mod.js модули
- **Cron wb-rules** — статические выражения, не поддерживает динамическое расписание

### 2.2. Кодстайл (wirenboard/codestyle + локальный eslint/prettier)

- 2 пробела отступ, без табов
- Single quotes для строк
- Semicolons обязательны
- 77 символов ширина строки
- Все функции должны быть именованные (no anonymous functions)
- camelCase для переменных, kebab-case для файлов
- ES5-совместимые trailing commas
- `require()` вместо import
- prettier + eslint (`@wirenboard/eslint`)

### 2.3. Организационные

- Соблюдение паттернов ScenarioBase
- Обязательная локализация (en + ru)
- Документация в develop/

---

## 3. Контекст системы

### 3.1. Бизнес-контекст

```
[Пользователь] --(WebUI)--> [wb-mqtt-confed] --(JSON conf)--> [wb-rules]
                                                                    |
                                                          [Astronomical Timer]
                                                                    |
                                                              [MQTT devices]
```

### 3.2. Технический контекст

```
wb-scenarios.schema.json  -->  wb-mqtt-confed (WebUI рендер)
         |
wb-scenarios.conf         -->  scenario-init-main.js
         |                          |
         |                     scenario-init-astronomical-timer.mod.js
         |                          |
         |                     astronomical-timer.mod.js
         |                          |
         |                     constants.mod.js (общие константы)
         |                          |
         |                     suncalc.mod.js (встроенная библиотека)
         |                          |
         v                     [wb-rules engine]
    /devices/wbsc_*/               |
    (virtual device)          [MQTT output controls]
```

---

## 4. Стратегия решения

### 4.1. Ключевое решение: расчёт времени

**Проблема:** Cron в wb-rules — статический. Время астрономических событий
меняется каждый день. Нельзя задать один cron-expression на весь год.

**Решение: Поминутная проверка**

Создаём cron-правило `0 * * * * *` (каждую минуту, 0-я секунда).

При каждом тике:

1. Получаем время события через updateEventTimeAndDisplay() (кэш или пересчёт)
2. Сравниваем floor(now/min) с floor(eventTime/min) — дата и время в одном числе
3. Если совпало и событие ещё не срабатывало → выполняем

**Почему не setTimeout:** wb-rules не гарантирует сохранение таймеров при перезапуске.
**Почему не пересоздание cron:** wb-rules не поддерживает удаление/пересоздание правил в runtime.

**Оптимизация**: Рассчитываем время события только при изменении параметров
и кэшируем в контекст. Пересчёт происходит при:

- Протухании кеша (cachedNextExecutionMs <= now — событие уже в прошлом)
- Смене дня
- Смене часового пояса
- Изменении типа события
- Изменении offset
- Изменении координат
- Изменении дней недели

### 4.2. Библиотека suncalc

Используем **suncalc** (оригинал от Vladimir Agafonkin):

- Чистый ES5, нет зависимостей
- 3KB минифицированный
- Проверен в production (ioBroker, ~79K скачиваний/нед)
- Обёрнем как `suncalc.mod.js` для require()

### 4.3. Поддерживаемые астрономические события

| ID              | Название EN               | Название RU              | Угол    |
| --------------- | ------------------------- | ------------------------ | ------- |
| `sunrise`       | Sunrise                   | Восход                   | -0.833° |
| `sunset`        | Sunset                    | Закат                    | -0.833° |
| `dawn`          | Civil Dawn                | Гражданский рассвет      | -6°     |
| `dusk`          | Civil Dusk                | Гражданские сумерки      | -6°     |
| `nauticalDawn`  | Nautical Dawn             | Навигационный рассвет    | -12°    |
| `nauticalDusk`  | Nautical Dusk             | Навигационные сумерки    | -12°    |
| `nightEnd`      | Astronomical Dawn         | Астрономический рассвет  | -18°    |
| `night`         | Astronomical Dusk         | Астрономические сумерки  | -18°    |
| `goldenHour`    | Golden Hour (evening)     | Золотой час (вечер)      | +6°     |
| `goldenHourEnd` | Golden Hour End (morning) | Золотой час конец (утро) | +6°     |
| `solarNoon`     | Solar Noon                | Солнечный полдень        | max     |
| `nadir`         | Nadir (darkest)           | Надир (самое тёмное)     | min     |

### 4.4. Кэширование параметров

В контексте сохраняются:

- cachedDate — дата последнего расчёта
- cachedTzOffset — часовой пояс при расчёте
- cachedEventType — тип события
- cachedOffset — смещение
- cachedLatitude / cachedLongitude — координаты
- cachedDaysOfWeekStr — дни недели (как строка)
- cachedNextExecutionMs — время следующего срабатывания в миллисекундах (любой будущий день)
- firedToday — флаг срабатывания за сегодня

### 4.5. Важный нюанс: проверка дней недели ПОСЛЕ offset

В отличие от Schedule, где день фиксирован, Astronomical Timer применяет offset
и затем проверяет фактический день, на который выпало событие.

Пример: Надир (01:00 пятницы) с offset -120 минут → событие происходит
в четверг в 23:00. Проверяется именно четверг, а не пятница.

### 4.6. Разрешенный диапазон смещения

Offset ограничен ±12 часов (-720..720 минут). Offset может свободно переносить
событие на соседний день — например, `nadir` (01:00) с offset -120 мин сработает
в 23:00 предыдущего дня. Поиск в `getNextExecutionTime` начинается с вчерашнего
дня (`i = -1`), чтобы поймать такие случаи.

### 4.7. Автоматическое определение смены часового пояса

В отличие от Schedule (требует перезапуска wb-rules), Astronomical Timer
автоматически определяет смену timezone:

При каждом пересчёте (раз в сутки) проверяем текущий TZ offset, если offset изменился — сбрасываем кэш и пересчитываем. Сохраняем cachedTzOffset в контекст.

---

## 5. Компоненты

### 5.1. Новые файлы

```
scenarios/astronomical-timer/
├── astronomical-timer.mod.js                # Класс AstronomicalTimerScenario
├── scenario-init-astronomical-timer.mod.js  # Модуль инициализации
└── README.md                                # Документация

src/
├── suncalc.mod.js                           # Библиотека suncalc (обёрнутая в exports)
└── constants.mod.js                         # Общие константы (дни недели)

schema/
└── wb-scenarios.schema.json                 # Обновлённая схема (+astronomicalTimer)

scenarios/
└── scenario-init-main.js                    # Обновлён: +setupAstronomicalTimer()
```

### 5.2. Класс AstronomicalTimerScenario

```
AstronomicalTimerScenario extends ScenarioBase
│
├── generateNames(idPrefix)
│   → vDevice, ruleMain, ruleManual, ruleTimeUpdate
│
├── defineControlsWaitConfig(cfg)
│   → controls из outControls
│
├── validateCfg(cfg)
│   → lat (-89.9..89.9), lon (-180..180)
│   → astroEvent (из списка ASTRO_EVENT_NAMES)
│   → offset (-720..720 минут)
│   → scheduleDaysOfWeek (хотя бы 1 день, все валидные)
│   → outControls (хотя бы 1 контрол, валидные типы)
│
├── initSpecific(name, cfg)
│   │
│   ├── addCustomControlsToVirtualDevice()
│   │   ├── execute_now (pushbutton)
│   │   ├── current_time (text, readonly)
│   │   ├── next_execution (text, readonly)
│   │   ├── astro_event_time (text, readonly, offset ≠ 0)
│   │   ├── event_type (text, readonly, с enum)
│   │   └── offset (text, readonly, offset ≠ 0)
│   │
│   └── createRules()
│       ├── createCronRule()         # cron("0 * * * * *")
│       │   └── на каждом тике:
│       │       1. updateEventTimeAndDisplay() — кэш/пересчёт + обновление дисплея
│       │       2. if !firedToday && floor(now/min) === floor(eventTime/min)
│       │       3. → set firedToday = true
│       │       4. → astroHandler() — выполнить outControls
│       │       (кеш протухнет сам: на следующем тике cachedExpired = true → пересчёт)
│       │
│       ├── createManualRule()        # whenChanged execute_now
│       │   └── astroHandler() — только выполнить outControls (без кэша/дисплея)
│       │
│       └── createTimeUpdateRule()    # whenChanged system_time/*
│           └── обновить current_time display
│
├── updateEventTimeAndDisplay()       # Пересчёт + обновление VD дисплея
│   ├── вызывает calculateAndCacheEventTime()
│   ├── обновляет next_execution и astro_event_time только при изменении
│   │   (сравнивает cachedNextExecutionMs до и после, избегает лишних MQTT-записей)
│   └── возвращает nextExecution
│
├── calculateAndCacheEventTime()     # Работа с кэшем
│   ├── проверяет cachedExpired (cachedNextExecutionMs <= now)
│   ├── сравнивает все параметры (дата, TZ, событие, offset, координаты, дни)
│   ├── при изменении или протухании → пересчёт через getNextExecutionTime() и сброс firedToday
│   └── сохраняет в контекст
│
└── getNextExecutionTime()            # Поиск следующего выполнения
    ├── для каждого дня от -1 (вчера) до MAX_DAYS_AHEAD (365)
    ├── calculateEventTime() с offset
    ├── проверка фактического дня недели (ПОСЛЕ offset)
    └── возвращает ближайшее будущее событие
```

---

## 6. Схема JSON (UI)

Определение `astronomicalTimer` добавляется в `definitions` и в `oneOf`.
Поля `idPrefix`, `name`, `scheduleDaysOfWeek`, `outControls` — идентичны schedule.

Новые поля: coordinates (object с latitude/longitude), eventSettings (object с astroEvent/offset).

Переводы en + ru для всех новых полей и значений enum.

---

## 7. Виртуальное устройство

Создаётся `wbsc_<idPrefix>` с контролами:

| Контрол            | Тип            | Описание                               |
| ------------------ | -------------- | -------------------------------------- |
| `rule_enabled`     | switch         | Вкл/выкл сценария (из базового класса) |
| `execute_now`      | pushbutton     | Ручной запуск                          |
| `current_time`     | text, readonly | Текущее время                          |
| `next_execution`   | text, readonly | Время следующего срабатывания          |
| `astro_event_time` | text, readonly | Исходное время астрособытия            |
| `event_type`       | text, readonly | Тип события (локализованный)           |
| `offset`           | text, readonly | Смещение в минутах                     |

---

## 8. Граничные случаи

### 8.1. Полярный день/ночь

`suncalc.getTimes()` возвращает NaN для несуществующих событий.
`calculateEventTime` возвращает null, `getNextExecutionTime` продолжает поиск
до MAX_DAYS_AHEAD (365). Широта ограничена ±89.9° (безопасный порог SunCalc).

Примеры из тестирования:

- Медвежий остров (74.5°N, `night`): 199 дней, 85 мс
- Шпицберген (78°N, `nightEnd`): 209 дней, 90 мс
- Северный полюс (89.5°N, `sunrise`): 3 дня, 2 мс

### 8.2. Смена часового пояса

Автоматическое определение: при каждом пересчёте проверяем TZ offset,
при изменении — сбрасываем кэш и пересчитываем.

### 8.3. Изменение конфигурации после запуска

При изменении любого параметра (событие, offset, координаты, дни) через WebUI:

1. При перезапуске calculateAndCacheEventTime() обнаруживает изменения
2. Кэш сбрасывается, firedToday = false
3. Время пересчитывается с новыми параметрами

### 8.4. Offset, переносящий событие на другой день

Offset может переносить событие на соседний день в обе стороны (вперёд и назад).
День недели проверяется ПОСЛЕ применения offset — по фактическому дню события.
Поиск начинается с вчерашнего дня (`i = -1`), чтобы поймать события, сдвинутые
offset'ом на сегодня.

Пример: Надир в пятницу с offset -120 → сработает в четверг (если четверг разрешён).

### 8.5. Нет события в ближайшие MAX_DAYS_AHEAD дней

Если за 365 дней не найдено ни одного подходящего события (полярный день/ночь
в сочетании с ограничением по дням недели), выводится сообщение:
"No event found in next 365 days for: goldenHour"
Валидация при старте также проверяет наличие события и не допускает запуск сценария.

---

## 9. План реализации

### Этап 1: suncalc.mod.js

- Взять suncalc.js, обернуть в exports формат wb-rules
- Проверить работу на контроллере

### Этап 2: JSON Schema

- Добавить определение astronomicalTimer в wb-scenarios.schema.json
- Добавить в oneOf
- Добавить переводы en + ru
- Деплой на контроллер, проверка WebUI

### Этап 3: Модуль сценария

- astronomical-timer.mod.js — класс AstronomicalTimerScenario
- Поминутный cron, кэширование, расчёт через suncalc
- Кэширование всех параметров в контекст
- Автодетект смены timezone
- Проверка дней ПОСЛЕ offset
- Выполнение outControls (переиспользование из schedule)

### Этап 4: Модуль инициализации

- scenario-init-astronomical-timer.mod.js
- Обновление scenario-init-main.js

### Этап 5: Деплой и тестирование на контроллере

- Создать сценарий через WebUI
- Проверить расчёт времени
- Проверить срабатывание
- Проверить граничные случаи (Надир с offset, смена дней и т.д.)

### Этап 6: Документация

- README для сценария
- Обновление общего README
- Архитектурная документация (ARC42)

---

## 10. Технический долг / Возможные улучшения

| Проблема                                      | Приоритет | Предложение                                                    |
| --------------------------------------------- | --------- | -------------------------------------------------------------- |
| Проверка каждую минуту даже когда события нет | Низкий    | Добавить адаптивный cron (реже проверять, если событие далеко) |
| Нет обработки customAngle                     | Средний   | Можно добавить позже через SunCalc.addTime()                   |
| Дублирование кода валидации с schedule        | Средний   | Вынести общие функции в helpers                                |
