# Готовые сценарии

Данный репозиторий содержит готовые сценарии которые помогают
быстрее подключать устройства и связывать их между собой

На данный момент реализованы сценарии:

- [Управление устройствами](scenarios/devices-control/README.md)
- [Управление светом](scenarios/light-control/README.md)

## Установка

Пакет `wb-scenarios` можно установить из репозиториев wirenboard
стандартной командой через apt:

```terminal
# apt install wb-scenarios
```

После этого у вас в пункте `Настройки` -> `Конфигурационные файлы`
должен появится пункт `Сценарии автоматизации`

## Разарботчикам

### Разработка новых сценариев

Для информации о разработке новых сценариев - смотрите
файл для разработчиков [README](develop/README.md).

### Руководства по стилю

Style guide от Airbnb для js ES5
https://github.com/airbnb/javascript/tree/es5-deprecated/es5

Style guide от Google для jsdoc
https://google.github.io/styleguide/jsguide.html#jsdoc
