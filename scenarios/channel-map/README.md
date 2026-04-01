# Сценарий виртуальной связки `channelMap`

## Общее описание

Сценарий создаёт программные связи между MQTT-контролами.
При изменении значения mqttTopicInput-контрола оно автоматически
копируется в mqttTopicOutput-контрол.

Типичные применения:

- Программная привязка выключателя к реле (вместо аппаратной)
- Зеркалирование показаний датчика на панель или дисплей
- Прокидывание значений между устройствами разных протоколов
  (Zigbee → Modbus)

Конфигуратор сценария выглядит следующим образом:

<p align="center">
    <img width="400"
         src="img/scenario-cfg-view.png"
         alt="Scenario cfg view" />
</p>

## Логика работы

### Связки (mqttTopicsLinks)

Сценарий содержит массив связок, каждая из которых определяет
пару mqttTopicInput → mqttTopicOutput. При изменении mqttTopicInput значение
копируется в mqttTopicOutput как есть, без трансформаций.

Несколько связок могут иметь один и тот же mqttTopicInput — все
соответствующие mqttTopicOutput получат значение одновременно.

### Начальная синхронизация

При запуске или перезапуске wb-rules сценарий однократно
считывает текущие значения всех mqttTopicInput и копирует их
в mqttTopicOutput. Это гарантирует консистентность после рестарта.

При повторном включении (`rule_enabled`) также выполняется
синхронизация — значения mqttTopicInput, изменившиеся пока сценарий
был выключен, копируются в mqttTopicOutput.

### Проверка типов

При инициализации сценарий сравнивает типы mqttTopicInput и mqttTopicOutput.
Если типы отличаются — в лог пишется предупреждение (warning).
Сценарий при этом не блокируется.

### Защита от петель

- **Прямая петля** (`mqttTopicInput === mqttTopicOutput`) — связка
  отклоняется при валидации
- **Непрямая петля** (A→B + B→A в одном сценарии) —
  обнаруживается и отклоняется при валидации
- Кросс-сценарные петли не проверяются

### Состояние (`state`)

| Значение | Описание |
|---|---|
| **Активен** | Включён, все контролы доступны |
| **Ожидает** | Включён, ожидание доступности контролов |
| **Отключен** | Сценарий выключен (`rule_enabled = false`) |

---

## Параметры конфигурации

### Наименование (`name`)

Имя сценария, используется как заголовок виртуального устройства.
Максимум 30 символов.

### Связки (`mqttTopicsLinks`)

Массив связок mqttTopicInput → mqttTopicOutput. Минимум 1 элемент.

| Поле | Тип | Описание |
|---|---|---|
| `mqttTopicInput` | string | Топик источника: `устройство/контрол` |
| `mqttTopicOutput` | string | Топик приёмника: `устройство/контрол` |

---

## Пример конфигурации

### Привязка выключателя к реле

```json
{
  "scenarioType": "channelMap",
  "componentVersion": 1,
  "name": "Выключатель → Реле",
  "mqttTopicsLinks": [
    {
      "mqttTopicInput": "wb-gpio/A1_OUT",
      "mqttTopicOutput": "wb-gpio/A2_OUT"
    }
  ]
}
```

### Зеркалирование датчика на несколько приёмников

```json
{
  "scenarioType": "channelMap",
  "componentVersion": 1,
  "name": "Датчик на панель",
  "mqttTopicsLinks": [
    {
      "mqttTopicInput": "wb-msw-v4_34/Temperature",
      "mqttTopicOutput": "panel/display_temp"
    },
    {
      "mqttTopicInput": "wb-msw-v4_34/Humidity",
      "mqttTopicOutput": "panel/display_hum"
    }
  ]
}
```

---

## Виртуальное устройство

Сценарий создаёт виртуальное устройство `wbsc_<idPrefix>` с контролами:

| Контрол | Тип | Описание |
|---|---|---|
| `rule_enabled` | switch | Включение/выключение сценария |
| `state` | value | Состояние: «Активен» / «Ожидает» / «Отключен» |

### Внешний вид

Создаваемое сценарием виртуальное устройство выглядит следующим образом:

<p align="center">
    <img width="400"
         src="img/scenario-vd-view.png"
         alt="Virtual device view" />
</p>

---

## Особенности использования

1. **Readonly mqttTopicOutput:** запись в readonly-контролы виртуальных
   устройств wb-rules работает без ошибок. Readonly блокирует только
   изменение через UI, программная запись проходит штатно.

2. **Перезапуск wb-rules:** при перезапуске сценарий переинициализируется,
   подписки восстанавливаются, начальная синхронизация копирует текущие
   значения mqttTopicInput в mqttTopicOutput.

3. **Частые изменения mqttTopicInput:** каждое изменение приводит к копированию.
   Throttle не применяется — это ожидаемое поведение.

---

## Использование модуля

Вы можете использовать модуль виртуальной связки напрямую из своих
правил `wb-rules`. Для этого нужно сделать 4 шага:

1) Импортировать класс `ChannelMapScenario`
2) Создать новый экземпляр класса
3) Создать объект настроек
4) Инициализировать сценарий, передав имя и конфигурацию

### Описание параметров конфигурации

`ChannelMapConfig`:

1. `idPrefix` {string} — необязательный. Префикс MQTT-имён виртуального
   устройства и правил. Если не указан, генерируется транслитерацией из имени.
2. `mqttTopicsLinks` {array} — массив связок. Минимум 1 элемент. Каждый элемент:
   - `mqttTopicInput` {string}: топик источника `'device/control'`
   - `mqttTopicOutput` {string}: топик приёмника `'device/control'`

### Пример кода

```js
/**
 * @file: init-link.js
 */

// Step 1: import module
var CustomTypeSc =
  require('channel-map.mod').ChannelMapScenario;

function main() {
  var scenarioName = 'Switch to relay';

  // Step 2: create instance
  var scenario = new CustomTypeSc();

  // Step 3: configuration
  var cfg = {
    idPrefix: 'switch_relay',
    mqttTopicsLinks: [
      {
        mqttTopicInput: 'wb-gpio/A1_OUT',
        mqttTopicOutput: 'wb-gpio/A2_OUT',
      },
    ],
  };

  // Step 4: init algorithm
  try {
    var isInitSuccess = scenario.init(scenarioName, cfg);

    if (!isInitSuccess) {
      log.error('Init failed for: "{}"', scenarioName);
      return;
    }

    log.debug('Init successful for: "{}"', scenarioName);
  } catch (error) {
    log.error(
      'Exception during init: "{}" for: "{}"',
      error.message || error,
      scenarioName
    );
  }
}

main();
```
