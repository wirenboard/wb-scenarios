# Channel Map — Архитектурная документация (ARC42)

## 1. Введение и цели

### 1.1. Описание задачи

Новый тип сценария **Channel Map** (Виртуальная связка)
для контроллеров Wiren Board. Создаёт программные связи между
MQTT-контролами: при изменении значения mqttTopicInput-контрола оно
автоматически копируется в mqttTopicOutput-контрол.

Типичные применения: привязка выключателя к реле, зеркалирование
датчика на панель, прокидывание значений между устройствами разных
протоколов (Zigbee → Modbus).

### 1.2. Функциональные требования

- Массив связок (mqttTopicsLinks): каждая связывает mqttTopicInput → mqttTopicOutput
- При изменении mqttTopicInput значение копируется в mqttTopicOutput как есть
- Несколько mqttTopicsLinks в одном сценарии
- Несколько mqttTopicsLinks с одним mqttTopicInput — все mqttTopicOutputs обновляются
- Включение/выключение через rule_enabled
- Версия 1: только прямое копирование, без трансформаций

### 1.3. Качественные цели

| Приоритет | Цель | Описание |
|---|---|---|
| 1 | Надёжность | Копирование без потерь при любой частоте изменений |
| 2 | Простота | Минимальный UI, понятный без документации |
| 3 | Безопасность | Защита от петель (mqttTopicInput === mqttTopicOutput) |
| 4 | Совместимость | Паттерны ScenarioBase, стиль как у других сценариев |

### 1.4. Стейкхолдеры

| Роль | Ожидания |
|---|---|
| Пользователь контроллера | Простая настройка связок через WebUI |
| Разработчик wb-scenarios | Соблюдение паттернов и стиля |
| Инсталлятор | Замена аппаратных связей программными |

---

## 2. Ограничения

### 2.1. Технические

- **ES5 only** — wb-rules использует Duktape, нет ES6+
- **JSON Schema Draft-04** — формат схемы UI
- **Нет npm** — библиотеки нужно включать как .mod.js модули

### 2.2. Кодстайл

- 2 пробела отступ, без табов
- Single quotes для строк
- Semicolons обязательны
- 77 символов ширина строки
- Все функции должны быть именованными
- camelCase для переменных, kebab-case для файлов

### 2.3. Организационные

- Соблюдение паттернов ScenarioBase
- Обязательная локализация (en + ru)

---

## 3. Контекст системы

### 3.1. Бизнес-контекст

```
[Пользователь] --(WebUI)--> [wb-mqtt-confed] --(JSON conf)--> [wb-rules]
                                                                    |
                                                          [Channel Map]
                                                           /              \
                                                  [mqttTopicInput MQTT]    [mqttTopicOutput MQTT]
```

### 3.2. Технический контекст

```
wb-scenarios.schema.json  -->  wb-mqtt-confed (WebUI рендер)
         |
wb-scenarios.conf         -->  scenario-init-main.js
         |                          |
         |                     scenario-init-channel-map.mod.js
         |                          |
         |                     channel-map.mod.js
         |                          |
         v                     [wb-rules engine]
    /devices/wbsc_*/               |
    (virtual device)     [mqttTopicInput controls] --> [mqttTopicOutput controls]
```

---

## 4. Стратегия решения

### 4.1. Ключевое решение: один whenChanged на все mqttTopicInput

**Проблема:** В массиве mqttTopicsLinks может быть много mqttTopicInput-топиков.
Нужно подписаться на изменения всех.

**Решение:** Один `defineRule` с `whenChanged` на массив всех
уникальных mqttTopicInput-топиков. В обработчике определяем какие
mqttTopicsLinks сработали по `devName + '/' + cellName` и копируем
значение в соответствующие mqttTopicOutput.

```
defineRule({
  whenChanged: [mqttTopicInput1, mqttTopicInput2, ...],
  then: function(newValue, devName, cellName) {
    var mqttTopicInputKey = devName + '/' + cellName;
    // Найти все mqttTopicsLinks с этим mqttTopicInput
    // Скопировать newValue в каждый mqttTopicOutput
  }
});
```

**Преимущества:**
- Один rule вместо N — экономия ресурсов
- Простая логика — нет дублирования обработчиков
- wb-rules эффективно обрабатывает массив whenChanged

### 4.2. Lookup-таблица mqttTopicInput → mqttTopicOutputs

Для быстрого поиска mqttTopicOutput по mqttTopicInput строится map при
инициализации:

```
buildSourceMap(mqttTopicsLinks):
  map = {}
  for each link:
    source = link.mqttTopicInput
    if !map[source]:
      map[source] = []
    map[source].push(link.mqttTopicOutput)
  return map
```

Это позволяет за O(1) найти все mqttTopicOutputs для сработавшего
mqttTopicInput, вместо перебора всего массива mqttTopicsLinks.

### 4.3. Защита от петель

**Проблема:** Если mqttTopicInput === mqttTopicOutput, запись в mqttTopicOutput
вызовет повторное срабатывание whenChanged, создавая бесконечный
цикл.

**Решение:** Проверка в `validateCfg` — link с
mqttTopicInput === mqttTopicOutput отклоняется, сценарий не инициализируется.

Также возможна непрямая петля (A→B + B→A в разных сценариях).
Защита на уровне одного сценария: проверяем что ни один mqttTopicOutput
не является mqttTopicInput в другом link этого же сценария.
Кросс-сценарные петли не проверяются — ответственность пользователя.

### 4.4. Проверка совместимости типов

При инициализации (`initSpecific`), после того как контролы готовы,
для каждого link сравниваются типы mqttTopicInput и mqttTopicOutput через
`dev[device][control + '#type']`. Если типы отличаются — логируется
warning. Сценарий при этом **не блокируется** — копирование работает
как обычно.

```
checkTypeMismatch(mqttTopicsLinks):
  for each link:
    sourceType = dev[srcDev][srcCtrl + '#type']
    destType = dev[dstDev][dstCtrl + '#type']
    if sourceType !== destType:
      log.warning('Type mismatch: {} ({}) → {} ({})',
        source, sourceType, dest, destType)
```

### 4.5. Начальная синхронизация

**Проблема:** После старта или перезапуска wb-rules mqttTopicOutput-контролы
могут содержать устаревшие значения, не совпадающие с текущими mqttTopicInput.

**Решение:** В `initSpecific`, после создания правила, выполняется
однократная синхронизация — обход `sourceMap`, чтение текущего
значения каждого mqttTopicInput через `dev[mqttTopicInput]` и запись во все
связанные mqttTopicOutputs.

```
initialSync(sourceMap):
  for each source in sourceMap:
    var parts = source.split('/');
    var value = dev[parts[0]][parts[1]];
    for each dest in sourceMap[source]:
      var dParts = dest.split('/');
      dev[dParts[0]][dParts[1]] = value;
```

Синхронизация выполняется после `defineControlsWaitConfig` —
все контролы гарантированно доступны.

### 4.6. Ресинхронизация при re-enable

**Проблема:** Пока сценарий выключен (`rule_enabled = false`),
пользователь может изменить mqttTopicInput-контролы. При повторном
включении mqttTopicOutputs содержат устаревшие значения.

**Решение:** Отдельное правило `createEnableRule` наблюдает за
`rule_enabled`. При переключении в `true` вызывает `initialSync`.
Правило **не регистрируется** через `addRule()` — оно остаётся
активным даже когда сценарий выключен (аналогично
`createDisableRule` в periodic-timer).

### 4.7. Поведение при перезапуске wb-rules

При перезапуске wb-rules сценарий переинициализируется:
- Подписки на mqttTopicInput-топики восстанавливаются автоматически
- Начальная синхронизация копирует текущие mqttTopicInput в mqttTopicOutputs
- Далее whenChanged-правило обрабатывает все последующие изменения

---

## 5. Компоненты

### 5.1. Файлы

```
scenarios/channel-map/
├── channel-map.mod.js                # Класс ChannelMapScenario
├── scenario-init-channel-map.mod.js  # Модуль инициализации
├── README.md                          # Документация пользователя
└── dev-note-arc42.md                  # Архитектурная документация

schema/
└── wb-scenarios.schema.json           # Обновлённая схема (+channelMap)

scenarios/
└── scenario-init-main.js              # Обновлён: +setupChannelMap()
```

### 5.2. Класс ChannelMapScenario

```
ChannelMapScenario extends ScenarioBase
│
├── generateNames(idPrefix)
│   → vDevice, ruleLink, ruleEnable
│
├── defineControlsWaitConfig(cfg)
│   → controls: все mqttTopicInput + mqttTopicOutput топики
│
├── validateCfg(cfg)
│   → mqttTopicsLinks: непустой массив
│   → каждый link: mqttTopicInput и mqttTopicOutput заполнены
│   → mqttTopicInput !== mqttTopicOutput (нет прямых петель)
│   → нет непрямых петель внутри сценария
│
└── initSpecific(name, cfg)
    │
    ├── checkTypeMismatch(mqttTopicsLinks)
    │   → warning в лог при несовпадении типов mqttTopicInput/mqttTopicOutput
    │
    ├── buildSourceMap(mqttTopicsLinks)
    │   → { 'device/control': ['dest1/ctrl', 'dest2/ctrl'] }
    │
    ├── createLinkRule()
    │   defineRule({
    │     whenChanged: uniqueSources,
    │     then: function(newValue, devName, cellName) {
    │       var key = devName + '/' + cellName;
    │       var mqttTopicOutputs = sourceMap[key];
    │       for each dest in mqttTopicOutputs:
    │         dev[dest] = newValue;
    │     }
    │   });
    │
    ├── createEnableRule()
    │   defineRule({
    │     whenChanged: [vDevice + '/rule_enabled'],
    │     then: function(newValue) {
    │       if (newValue) initialSync(sourceMap);
    │     }
    │   });
    │   ⚠ Не регистрируется через addRule() — работает
    │     даже при выключенном сценарии
    │
    └── initialSync(sourceMap)
        → для каждого source: читает текущее значение,
          копирует во все mqttTopicOutputs
```

---

## 6. Схема JSON (UI)

Определение `channelMap` добавлено в `definitions` и `oneOf`.

Поля сценария (в порядке отображения):

- `name` — название сценария (обязательное, maxLength: 30)
- `idPrefix` — опциональный (скрыт через display_required_only)
- `mqttTopicsLinks` — массив связок (minItems: 1)
  - `mqttTopicInput` — MQTT-топик источника (wb-autocomplete)
  - `mqttTopicOutput` — MQTT-топик приёмника (wb-autocomplete)

Скрытые поля:
- `scenarioType` — `"channelMap"` (hidden)
- `componentVersion` — `1` (hidden)

---

## 7. Виртуальное устройство

Создаётся `wbsc_<idPrefix>` с минимальным набором контролов
(только базовые из ScenarioBase):

| Контрол | Тип | Описание |
|---|---|---|
| `rule_enabled` | switch | Вкл/выкл сценария (из базового класса) |
| `state` | value, readonly | Статус: NORMAL / WAITING / DISABLED |

Дополнительные контролы не создаются — сценарий работает
«прозрачно», без видимого состояния.

---

## 8. Параметры конфигурации

| Параметр | Тип | Обязательный | Описание |
|---|---|---|---|
| `name` | string | да | Название сценария |
| `idPrefix` | string | нет | Технический префикс MQTT-устройства |
| `mqttTopicsLinks` | array | да | Массив связок |

**Структура элемента `mqttTopicsLinks`:**

| Поле | Тип | Описание |
|---|---|---|
| `mqttTopicInput` | string | MQTT-топик источника: `"device/control"` |
| `mqttTopicOutput` | string | MQTT-топик приёмника: `"device/control"` |

---

## 9. Граничные случаи

### 9.1. mqttTopicInput === mqttTopicOutput (прямая петля)

`validateCfg` отклоняет link с совпадающими mqttTopicInput и mqttTopicOutput.
Логируется ошибка, сценарий не инициализируется.

### 9.2. Непрямая петля внутри сценария (A→B + B→A)

`validateCfg` строит множество всех mqttTopicInput и mqttTopicOutput.
Если пересечение непусто — это потенциальная петля. Сценарий
отклоняется. Кросс-сценарные петли не проверяются.

### 9.3. mqttTopicInput-топик не существует

`defineControlsWaitConfig` включает все mqttTopicInput-топики в список
ожидания. Если топик не появится за timeout — сценарий перейдёт
в состояние `LINKED_CONTROLS_TIMEOUT`.

### 9.4. mqttTopicOutput-топик readonly

Запись через `dev[device][control] = value` в readonly-контрол
wb-rules VD работает без ошибок — readonly блокирует только
изменение через UI. Это штатное поведение wb-rules, используемое
во всех сценариях (например, output_power в PID).

Для контролов внешних драйверов (не VD) readonly запись может
вызвать ошибку от драйвера. Это ожидаемое поведение — сценарий
при этом не падает.

### 9.5. Несколько mqttTopicsLinks с одним mqttTopicInput

`buildSourceMap` группирует все mqttTopicOutputs для каждого source.
При изменении source значение копируется во все mqttTopicOutputs
за одно срабатывание правила.

### 9.6. Перезапуск wb-rules

Подписки восстанавливаются автоматически при реинициализации.
Начальная синхронизация копирует текущие значения mqttTopicInput
в mqttTopicOutputs, после чего whenChanged-правило обрабатывает
все последующие изменения.

### 9.7. Частые изменения mqttTopicInput

Каждое изменение приводит к копированию. Throttle не применяется —
это ожидаемое поведение для привязки контролов. wb-rules обработает
все изменения последовательно.

---

## 10. Статус реализации

### Этап 1: JSON Schema

- Определение `channelMap` в `wb-scenarios.schema.json`
- `mqttTopicsLinks` как массив объектов с `mqttTopicInput`/`mqttTopicOutput`
- Переводы en + ru для всех полей

### Этап 2: Модуль сценария + инициализация

- `channel-map.mod.js` — класс `ChannelMapScenario`
- `scenario-init-channel-map.mod.js` с маппингом конфига
- `scenario-init-main.js` обновлён: `setupChannelMap()`

### Этап 3: Тестирование на контроллере

Тесты выполнены на контроллере.

### Этап 4: Документация

- README.md написан
- arc42 актуализирован

---

## 11. Технический долг / Возможные улучшения

| Проблема | Приоритет | Предложение |
|---|---|---|
| Нет трансформаций | Средний | v2: опциональное поле `transform` в каждом link |
| Кросс-сценарные петли не проверяются | Низкий | Глобальный реестр всех mqttTopicsLinks |
| Нет индикации последней активности | Низкий | Контрол `last_activity` с временем последнего копирования |
