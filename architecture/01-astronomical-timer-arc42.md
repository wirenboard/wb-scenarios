# Astronomical Timer — Архитектурная документация (ARC42)

## 1. Введение и цели

### 1.1. Описание задачи
Новый тип сценария **Astronomical Timer** для контроллеров Wiren Board.
Аналогичен сценарию Schedule, но вместо фиксированного времени (HH:MM)
позволяет привязать выполнение действий к астрономическим событиям
(восход, закат, сумерки и т.п.).

### 1.2. Функциональные требования
- Выполнение действий по астрономическим событиям (восход, закат, сумерки и др.)
- Смещение (offset) в минутах до/после события
- Указание координат (lat/lon) пользователем
- Пользовательский угол над горизонтом (для учёта рельефа — гора перед окном и т.п.)
- Выбор дней недели
- Те же действия (outControls) что и у Schedule
- Локальный расчёт (без интернета)
- Отображение рассчитанного времени следующего срабатывания
- Автоматическое определение смены часового пояса

### 1.3. Качественные цели
| Приоритет | Цель | Описание |
|---|---|---|
| 1 | Автономность | Расчёт полностью локальный, без внешних сервисов |
| 2 | Простота | UI понятен пользователю без документации |
| 3 | Надёжность | Корректная работа на всех широтах, включая полярные |
| 4 | Совместимость | Полное соответствие архитектуре wb-scenarios |

### 1.4. Стейкхолдеры
| Роль | Ожидания |
|---|---|
| Пользователь контроллера | Простая настройка через WebUI, надёжная работа |
| Разработчик wb-scenarios | Соблюдение существующих паттернов и стиля |
| Инсталлятор | Минимальная конфигурация при монтаже |

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
1. Рассчитываем время события на сегодня через suncalc
2. Применяем offset
3. Сравниваем с текущим временем (совпадение по HH:MM)
4. Если совпало и сегодня — запланированный день недели → выполняем

**Почему не setTimeout:** wb-rules не гарантирует сохранение таймеров при перезапуске.
**Почему не пересоздание cron:** wb-rules не поддерживает удаление/пересоздание правил в runtime.

**Оптимизация:** Рассчитываем время события один раз в сутки (при первом тике после полуночи
или при инициализации) и кэшируем. Сравнение каждую минуту — просто сверка двух чисел.

### 4.2. Библиотека suncalc

Используем **suncalc** (оригинал от Vladimir Agafonkin):
- Чистый ES5, нет зависимостей
- 3KB минифицированный
- Проверен в production (ioBroker, ~79K скачиваний/нед)
- Обёрнем как `suncalc.mod.js` для require()

### 4.3. Поддерживаемые астрономические события

| ID | Название EN | Название RU | Угол |
|---|---|---|---|
| `sunrise` | Sunrise | Восход | -0.833° |
| `sunset` | Sunset | Закат | -0.833° |
| `dawn` | Civil Dawn | Гражданский рассвет | -6° |
| `dusk` | Civil Dusk | Гражданские сумерки | -6° |
| `nauticalDawn` | Nautical Dawn | Навигационный рассвет | -12° |
| `nauticalDusk` | Nautical Dusk | Навигационные сумерки | -12° |
| `nightEnd` | Astronomical Dawn | Астрономический рассвет | -18° |
| `night` | Astronomical Dusk | Астрономические сумерки | -18° |
| `goldenHour` | Golden Hour (evening) | Золотой час (вечер) | +6° |
| `goldenHourEnd` | Golden Hour End (morning) | Золотой час конец (утро) | +6° |
| `solarNoon` | Solar Noon | Солнечный полдень | max |
| `nadir` | Nadir (darkest) | Надир (самое тёмное) | min |
| `customAngle` | Custom Angle | Свой угол | задаёт пользователь |

### 4.4. Пользовательский угол над горизонтом

suncalc поддерживает `SunCalc.addTime(angle, riseName, setName)` —
добавляет кастомное событие по произвольному углу солнца.

**Сценарий:** Пользователь живёт в горной местности, горы загораживают
горизонт — реальный восход для него наступает когда солнце поднимается
на 10° над горизонтом. Он выбирает событие `customAngle`, указывает угол
и направление (утро/вечер).

**UI:**
- При выборе `astroEvent = "customAngle"` появляются доп. поля:
  - `customElevation` — угол в градусах (number, -90..90, default 0)
  - `customAngleDirection` — "rising" (утро) или "setting" (вечер)

### 4.5. Автоматическое определение смены часового пояса

В отличие от Schedule (требует перезапуска wb-rules), Astronomical Timer
автоматически определяет смену timezone:

- При каждом пересчёте (раз в сутки) проверяем текущий TZ offset
- Если offset изменился — сбрасываем кэш и пересчитываем
- Сохраняем `cachedTzOffset` в context

---

## 5. Компоненты

### 5.1. Новые файлы

```
scenarios/astronomical-timer/
├── astronomical-timer.mod.js          # Класс AstronomicalTimerScenario
├── scenario-init-astronomical-timer.mod.js  # Модуль инициализации
└── README.md                          # Документация

src/
└── suncalc.mod.js                     # Библиотека suncalc (обёрнутая в exports)

schema/
└── wb-scenarios.schema.json           # Обновлённая схема (+astronomicalTimer)

scenarios/
└── scenario-init-main.js              # Обновлён: +setupAstronomicalTimer()
```

### 5.2. Класс AstronomicalTimerScenario

```
AstronomicalTimerScenario extends ScenarioBase
│
├── generateNames(idPrefix)
│   → vDevice, ruleMinuteCheck, ruleManual, ruleTimeUpdate
│
├── defineControlsWaitConfig(cfg)
│   → controls из outControls
│
├── validateCfg(cfg)
│   → lat (-90..90), lon (-180..180)
│   → astroEvent (из списка допустимых)
│   → offset (-720..720 минут)
│   → customElevation (-90..90, только если customAngle)
│   → customAngleDirection (rising/setting, только если customAngle)
│   → scheduleDaysOfWeek (хотя бы 1 день)
│   → outControls (хотя бы 1 контрол, валидные типы)
│
├── initSpecific(name, cfg)
│   │
│   ├── addControl('execute_now', pushbutton)
│   ├── addControl('current_time', text, readonly)
│   ├── addControl('next_event_time', text, readonly)
│   ├── addControl('event_type', text, readonly)
│   │
│   ├── createMinuteCheckRule()    # cron("0 * * * * *")
│   │   └── на каждом тике:
│   │       1. getCachedEventTime(today, tzOffset)
│   │       2. if HH:MM совпало && день недели подходит
│   │       3. → dev[vDevice/execute_now] = true
│   │       4. Обновить next_event_time
│   │
│   ├── createManualRule()         # whenChanged execute_now
│   │   └── astroHandler() — выполнить outControls
│   │
│   └── createTimeUpdateRule()     # whenChanged system_time/*
│       └── обновить current_time display
│
└── context
    ├── cachedDate: null           # дата для которой рассчитано
    ├── cachedTzOffset: null       # TZ offset при расчёте
    ├── cachedEventTime: null      # рассчитанное время (Date)
    └── cachedEventTimeStr: null   # "HH:MM" для сравнения
```

---

## 6. Схема JSON (UI)

Определение `astronomicalTimer` добавляется в `definitions` и в `oneOf`.
Поля `enable`, `name`, `scheduleDaysOfWeek`, `outControls` — идентичны schedule.

Новые поля: `latitude`, `longitude`, `astroEvent`, `offset`,
`customElevation`, `customAngleDirection`.

При `astroEvent != "customAngle"` поля `customElevation` и
`customAngleDirection` скрыты через JSON Schema dependencies.

Переводы en + ru для всех новых полей и значений enum.

---

## 7. Виртуальное устройство

Создаётся `wbsc_<idPrefix>` с контролами:

| Контрол | Тип | Описание |
|---|---|---|
| `rule_enabled` | switch | Вкл/выкл сценария (из базового класса) |
| `execute_now` | pushbutton | Ручной запуск |
| `current_time` | text, readonly | Текущее время |
| `next_event_time` | text, readonly | Время следующего срабатывания |
| `event_type` | text, readonly | Тип события (Sunrise +30min) |

---

## 8. Граничные случаи

### 8.1. Полярный день/ночь
`suncalc.getTimes()` возвращает `NaN` для несуществующих событий.
Показываем "Event does not occur today" / "Событие сегодня не наступает".

### 8.2. Смена часового пояса
Автоматическое определение: при каждом пересчёте проверяем TZ offset,
при изменении — сбрасываем кэш и пересчитываем.

### 8.3. Offset выводит время за пределы суток
Если итоговое время < 00:00 или >= 24:00 — событие не происходит в этот день.

### 8.4. Геолокация из браузера
Отложено. MVP: ручной ввод lat/lon, default — Москва (55.7558, 37.6173).

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
- Поддержка customAngle через SunCalc.addTime()
- Автодетект смены timezone
- Выполнение outControls (переиспользование из schedule)

### Этап 4: Модуль инициализации
- scenario-init-astronomical-timer.mod.js
- Обновление scenario-init-main.js

### Этап 5: Деплой и тестирование на контроллере
- Создать сценарий через WebUI
- Проверить расчёт времени
- Проверить срабатывание
- Проверить граничные случаи

### Этап 6: Документация
- README для сценария
- Обновление общего README
