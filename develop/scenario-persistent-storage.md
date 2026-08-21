# Хранилище сценариев ScenarioPersistentStorage

ScenarioPersistentStorage — это синглтон-класс, предназначенный для долговременного хранения данных сценариев в Wiren Board. Данные сохраняются в persistent storage контроллера и не теряются после перезагрузки контроллера или перезапуска wb-rules.

Основное назначение — сохранение состояний сценариев, пользовательских настроек и мета-информации между перезапусками.

## Структура хранилища

```javascript
{
  "scenariosRegistry": {
    "идентификатор_сценария_1": {
      "userSettings": {
        "ключ_настройки_1": значение_1,
        ...
      },
      "meta": {
        "ключ_метаданных_1": значение_2,
        ...
      }
    },
    "идентификатор_сценария_2": {
      ...
    }
  }
}
```

`scenariosRegistry` — корневой ключ, содержащий данные всех сценариев\
`идентификатор_сценария` — уникальный идентификатор (idPrefix) конкретного сценария\
`userSettings` — объект с пользовательскими настройками сценария (например, включен/выключен)\
`meta` — объект с мета-информацией о сценарии (например, имя виртуального устройства)

## Ключи meta, которые ведёт базовый класс

Помимо собственных ключей сценария, в `meta` пишутся три служебных. Все три
проставляются автоматически, вручную их менять не нужно.

| Ключ | Кто пишет | Назначение |
| --- | --- | --- |
| `vdName` | `ScenarioBase.init()` после создания VD | Имя виртуального устройства сценария, вида `wbsc_<idPrefix>` |
| `vdInitScript` | `ScenarioBase.init()` после создания VD | Путь скрипта, создавшего сценарий |
| `vdSwept` | `scenario-init-main.js` при уборке, сбрасывается в `ScenarioBase.init()` | Признак того, что retained-топики этого имени уже удалены |

Пример записи в хранилище:

```javascript
{
  "scenariosRegistry": {
    "raspisanie": {
      "userSettings": { "rule_enabled": true },
      "meta": {
        "vdName": "wbsc_raspisanie",
        "vdInitScript": "/usr/share/wb-rules-system/rules/scenario-init-main.js",
        "vdSwept": false
      }
    }
  }
}
```

### Зачем нужен `vdInitScript`

Значение берётся из `__filename`, который wb-rules держит отдельно для контекста
каждого файла правил. Поэтому у сценария из `/etc/wb-scenarios.conf` там путь
`scenario-init-main.js`, а у созданного напрямую из пользовательского правила —
путь этого правила.

Это позволяет `scenario-init-main.js` при уборке retained-топиков отличить свои
сценарии от чужих. Отличить их по признаку «устройство не создано» нельзя: файлы
из `/etc/wb-rules/` загружаются позже, и на момент уборки их виртуальных
устройств ещё не существует.

### Зачем нужен `vdSwept`

Записи из `scenariosRegistry` не удаляются, поэтому сценарий, удалённый из
конфига, остаётся в реестре навсегда. Без отметки об уборке команда
`mqtt-delete-retained` для его имени запускалась бы на каждом старте, а один её
вызов занимает около трёх секунд независимо от того, есть ли что удалять.

Отметка сбрасывается при повторном создании сценария с тем же `idPrefix` — иначе
его топики нельзя было бы убрать после следующего удаления.

## Использование хранилища

Получение экземпляра хранилища:

```javascript
var scenarioPersistentStorage =
  require('wbsc-persistent-storage.mod').getInstance();
```

Методы API:

- `getUserSetting(idPrefix, key, defaultValue)` - получает пользовательскую настройку из хранилища для указанного сценария.

```javascript
var isEnabled = scenarioPersistentStorage.getUserSetting(
  'raspisanie',
  'rule_enabled',
  false
);
```

- `setUserSetting(idPrefix, key, value)` - сохраняет пользовательскую настройку для указанного сценария.

```javascript
scenarioPersistentStorage.setUserSetting('raspisanie', 'rule_enabled', true);
```

- `getMeta(idPrefix, key, defaultValue)` - получает мета-информацию о сценарии из хранилища.

```javascript
var vdName = scenarioPersistentStorage.getMeta(
  'raspisanie',
  'vdName',
  'wbsc_default'
);
```

- `setMeta(idPrefix, key, value)` - сохраняет мета-информацию о сценарии.

```javascript
scenarioPersistentStorage.setMeta('raspisanie', 'vdName', 'wbsc_raspisanie');
```

## Особенности работы

### Автоматическая инициализация

Хранилище автоматически создает необходимые структуры данных при первом обращении к сценарию. При вызове setUserSetting() или setMeta() для нового сценария, все необходимые объекты создаются автоматически.

### Типы сохраняемых значений

Можно сохранять любые типы данных, поддерживаемые JavaScript. Для хранения объектов, вначале нужно создать пустой объект new StorableObject({}):

- Примитивы (числа, строки, булевы значения)
- Объекты
