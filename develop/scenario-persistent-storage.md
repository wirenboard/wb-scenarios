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

## Использование хранилища

Получение экземпляра хранилища:
```javascript
var scenarioPersistentStorage = require("wbsc-persistent-storage.mod").getInstance();
```

Методы API:
- `getUserSetting(idPrefix, key, defaultValue)` - получает пользовательскую настройку из хранилища для указанного сценария.
```javascript
var isEnabled = scenarioPersistentStorage.getUserSetting('raspisanie', 'rule_enabled', false);
```

- `setUserSetting(idPrefix, key, value)` - сохраняет пользовательскую настройку для указанного сценария.
```javascript
scenarioPersistentStorage.setUserSetting('raspisanie', 'rule_enabled', true);
```

- `getMeta(idPrefix, key, defaultValue)` - получает мета-информацию о сценарии из хранилища.
```javascript
var vdName = scenarioPersistentStorage.getMeta('raspisanie', 'vdName', 'wbsc_default');
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
