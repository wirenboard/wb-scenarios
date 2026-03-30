# Virtual Link — Архитектурная документация (ARC42)

## 1. Введение и цели

### 1.1. Описание задачи

Новый тип сценария **Virtual Link** (Виртуальная связка)
для контроллеров Wiren Board. Создаёт программные связи между
MQTT-контролами: при изменении значения source-контрола оно
автоматически копируется в destination-контрол.

Типичные применения: привязка выключателя к реле, зеркалирование
датчика на панель, прокидывание значений между устройствами разных
протоколов (Zigbee → Modbus).

### 1.2. Функциональные требования

- Массив связок (links): каждая связывает source → destination
- При изменении source значение копируется в destination как есть
- Несколько links в одном сценарии
- Несколько links с одним source — все destinations обновляются
- Включение/выключение через rule_enabled
- Версия 1: только прямое копирование, без трансформаций

### 1.3. Качественные цели

| Приоритет | Цель | Описание |
|---|---|---|
| 1 | Надёжность | Копирование без потерь при любой частоте изменений |
| 2 | Простота | Минимальный UI, понятный без документации |
| 3 | Безопасность | Защита от петель (source === destination) |
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
                                                          [Virtual Link]
                                                           /              \
                                                  [Source MQTT]    [Destination MQTT]
```

### 3.2. Технический контекст

```
wb-scenarios.schema.json  -->  wb-mqtt-confed (WebUI рендер)
         |
wb-scenarios.conf         -->  scenario-init-main.js
         |                          |
         |                     scenario-init-virtual-link.mod.js
         |                          |
         |                     virtual-link.mod.js
         |                          |
         v                     [wb-rules engine]
    /devices/wbsc_*/               |
    (virtual device)     [Source controls] --> [Destination controls]
```

---

## 4. Стратегия решения

### 4.1. Ключевое решение: один whenChanged на все source

**Проблема:** В массиве links может быть много source-топиков.
Нужно подписаться на изменения всех.

**Решение:** Один `defineRule` с `whenChanged` на массив всех
уникальных source-топиков. В обработчике определяем какие
links сработали по `devName + '/' + cellName` и копируем
значение в соответствующие destination.

```
defineRule({
  whenChanged: [source1, source2, ...],
  then: function(newValue, devName, cellName) {
    var sourceKey = devName + '/' + cellName;
    // Найти все links с этим source
    // Скопировать newValue в каждый destination
  }
});
```

**Преимущества:**
- Один rule вместо N — экономия ресурсов
- Простая логика — нет дублирования обработчиков
- wb-rules эффективно обрабатывает массив whenChanged

### 4.2. Lookup-таблица source → destinations

Для быстрого поиска destination по source строится map при
инициализации:

```
buildSourceMap(links):
  map = {}
  for each link:
    source = link.source
    if !map[source]:
      map[source] = []
    map[source].push(link.destination)
  return map
```

Это позволяет за O(1) найти все destinations для сработавшего
source, вместо перебора всего массива links.

### 4.3. Защита от петель

**Проблема:** Если source === destination, запись в destination
вызовет повторное срабатывание whenChanged, создавая бесконечный
цикл.

**Решение:** Проверка в `validateCfg` — link с
source === destination отклоняется, сценарий не инициализируется.

Также возможна непрямая петля (A→B + B→A в разных сценариях).
Защита на уровне одного сценария: проверяем что ни один destination
не является source в другом link этого же сценария.
Кросс-сценарные петли не проверяются — ответственность пользователя.

### 4.4. Проверка совместимости типов

При инициализации (`initSpecific`), после того как контролы готовы,
для каждого link сравниваются типы source и destination через
`dev[device][control + '#type']`. Если типы отличаются — логируется
warning. Сценарий при этом **не блокируется** — копирование работает
как обычно.

```
checkTypeMismatch(links):
  for each link:
    sourceType = dev[srcDev][srcCtrl + '#type']
    destType = dev[dstDev][dstCtrl + '#type']
    if sourceType !== destType:
      log.warning('Type mismatch: {} ({}) → {} ({})',
        source, sourceType, dest, destType)
```

### 4.5. Начальная синхронизация

**Проблема:** После старта или перезапуска wb-rules destination-контролы
могут содержать устаревшие значения, не совпадающие с текущими source.

**Решение:** В `initSpecific`, после создания правила, выполняется
однократная синхронизация — обход `sourceMap`, чтение текущего
значения каждого source через `dev[source]` и запись во все
связанные destinations.

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
пользователь может изменить source-контролы. При повторном
включении destinations содержат устаревшие значения.

**Решение:** Отдельное правило `createEnableRule` наблюдает за
`rule_enabled`. При переключении в `true` вызывает `initialSync`.
Правило **не регистрируется** через `addRule()` — оно остаётся
активным даже когда сценарий выключен (аналогично
`createDisableRule` в periodic-timer).

### 4.7. Поведение при перезапуске wb-rules

При перезапуске wb-rules сценарий переинициализируется:
- Подписки на source-топики восстанавливаются автоматически
- Начальная синхронизация копирует текущие source в destinations
- Далее whenChanged-правило обрабатывает все последующие изменения

---

## 5. Компоненты

### 5.1. Файлы

```
scenarios/virtual-link/
├── virtual-link.mod.js                # Класс VirtualLinkScenario
├── scenario-init-virtual-link.mod.js  # Модуль инициализации
├── README.md                          # Документация пользователя
└── dev-note-arc42.md                  # Архитектурная документация

schema/
└── wb-scenarios.schema.json           # Обновлённая схема (+virtualLink)

scenarios/
└── scenario-init-main.js              # Обновлён: +setupVirtualLink()
```

### 5.2. Класс VirtualLinkScenario

```
VirtualLinkScenario extends ScenarioBase
│
├── generateNames(idPrefix)
│   → vDevice, ruleLink, ruleEnable
│
├── defineControlsWaitConfig(cfg)
│   → controls: все source + destination топики
│
├── validateCfg(cfg)
│   → links: непустой массив
│   → каждый link: source и destination заполнены
│   → source !== destination (нет прямых петель)
│   → нет непрямых петель внутри сценария
│
└── initSpecific(name, cfg)
    │
    ├── checkTypeMismatch(links)
    │   → warning в лог при несовпадении типов source/destination
    │
    ├── buildSourceMap(links)
    │   → { 'device/control': ['dest1/ctrl', 'dest2/ctrl'] }
    │
    ├── createLinkRule()
    │   defineRule({
    │     whenChanged: uniqueSources,
    │     then: function(newValue, devName, cellName) {
    │       var key = devName + '/' + cellName;
    │       var destinations = sourceMap[key];
    │       for each dest in destinations:
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
          копирует во все destinations
```

---

## 6. Схема JSON (UI)

Определение `virtualLink` добавлено в `definitions` и `oneOf`.

Поля сценария (в порядке отображения):

- `name` — название сценария (обязательное, maxLength: 30)
- `idPrefix` — опциональный (скрыт через display_required_only)
- `links` — массив связок (minItems: 1)
  - `source` — MQTT-топик источника (wb-autocomplete)
  - `destination` — MQTT-топик приёмника (wb-autocomplete)

Скрытые поля:
- `scenarioType` — `"virtualLink"` (hidden)
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
| `links` | array | да | Массив связок |

**Структура элемента `links`:**

| Поле | Тип | Описание |
|---|---|---|
| `source` | string | MQTT-топик источника: `"device/control"` |
| `destination` | string | MQTT-топик приёмника: `"device/control"` |

---

## 9. Граничные случаи

### 9.1. Source === destination (прямая петля)

`validateCfg` отклоняет link с совпадающими source и destination.
Логируется ошибка, сценарий не инициализируется.

### 9.2. Непрямая петля внутри сценария (A→B + B→A)

`validateCfg` строит множество всех source и destination.
Если пересечение непусто — это потенциальная петля. Сценарий
отклоняется. Кросс-сценарные петли не проверяются.

### 9.3. Source-топик не существует

`defineControlsWaitConfig` включает все source-топики в список
ожидания. Если топик не появится за timeout — сценарий перейдёт
в состояние `LINKED_CONTROLS_TIMEOUT`.

### 9.4. Destination-топик readonly

Запись через `dev[device][control] = value` в readonly-контрол
wb-rules VD работает без ошибок — readonly блокирует только
изменение через UI. Это штатное поведение wb-rules, используемое
во всех сценариях (например, output_power в PID).

Для контролов внешних драйверов (не VD) readonly запись может
вызвать ошибку от драйвера. Это ожидаемое поведение — сценарий
при этом не падает.

### 9.5. Несколько links с одним source

`buildSourceMap` группирует все destinations для каждого source.
При изменении source значение копируется во все destinations
за одно срабатывание правила.

### 9.6. Перезапуск wb-rules

Подписки восстанавливаются автоматически при реинициализации.
Начальная синхронизация копирует текущие значения source
в destinations, после чего whenChanged-правило обрабатывает
все последующие изменения.

### 9.7. Частые изменения source

Каждое изменение приводит к копированию. Throttle не применяется —
это ожидаемое поведение для привязки контролов. wb-rules обработает
все изменения последовательно.

---

## 10. Статус реализации

### Этап 1: JSON Schema

- Определение `virtualLink` в `wb-scenarios.schema.json`
- `links` как массив объектов с `source`/`destination`
- Переводы en + ru для всех полей

### Этап 2: Модуль сценария + инициализация

- `virtual-link.mod.js` — класс `VirtualLinkScenario`
- `scenario-init-virtual-link.mod.js` с маппингом конфига
- `scenario-init-main.js` обновлён: `setupVirtualLink()`

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
| Кросс-сценарные петли не проверяются | Низкий | Глобальный реестр всех links |
| Нет индикации последней активности | Низкий | Контрол `last_activity` с временем последнего копирования |
