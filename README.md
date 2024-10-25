# Готовые сценарии

Содержит готовые сценарии которые помогают быстрее реализовать функционал интеграторам

## Добавление нового сценария
Для добавления нового сценария нужно:
1) Создать в папке scenarios подпапку с именем вашего сценария.
Имя маленькими латинскими буквами через тире.
Тут хранятся файлы относяшиеся к конкретному сценарию:
- Модуль js
- Системный скрипт читающий конфиг
- Ридми для данного сценария - здесь должен быть внешний вид и краткая инструкция по использованию
2) Добавить описание схемы webui для вашего нового сценария
3) Поменять конфиг чтобы он корректно открывался в соответствии с вашими изменениями в схеме


## Ручная установка
Для ручной установки сценариев нужно расставить 5 файлов в контроллере

Простого сценария соединения входа на выход прямого или инверсного где указываешь входной и выходной топики switch и далее автоматом инициализируются виртуальное устройство и правило которое будет выполнять заданный в вебке функционал

Там есть всего 5 файлов которые устанавливаются следующим образом (если это со стороны пользователя делать)

Добавление происходит добавлением-изменением следующих файлов
1. Файл системных правил rules/scenarios.js
Во время отладки можно класть в пользовательские правила
```path
/etc/wb-rules/scenarios.js
```

2. Модуль modules/link-in-to-out/link-in-to-out.mod.js
```path
/etc/wb-rules-modules/link-in-to-out.mod.js
```

3. Описание схемы json-editor rules/scenarios.schema.json
```path
/usr/share/wb-mqtt-confed/schemas/scenarios.schema.json
```

4. При необходимости изображения rules/scenarios-link-in-to-out.png
```path
/var/www/images/scenarios-link-in-to-out.png
```

5. Сохраненный конфиг из вебки rules/scenarios.conf
```path
/etc/scenarios.conf
```

Файлы из папки DELETE-virtual-devices-for-tests я удалю, они просто для удобства пока там лежат

## Автоматическая установка
Клонирование на контроллер
```terminal
# cd ~
# git clone https://github.com/wirenboard/wb-scenarios
# cd wb-scenarios
```

Далее можно либо установить с помошью мейк, либо собрать деб пакет
### Установка через make
Нужно вызвать мейк - увидим что и куда копируется

```make
# make
Starting installation process...
Copying scenarios.conf to //etc
Copying image schema/scenarios-link-in-to-out.png to //var/www/images
Copying schema schema/scenarios.schema.json to //usr/share/wb-mqtt-confed/schemas
Installing from directory scenarios/link-in-to-out...
  + Processing directory scenarios/link-in-to-out...
    - Copying rule files: scenarios/link-in-to-out/scenarios.js to //usr/share/wb-rules-system/rules
    - Copying module files: scenarios/link-in-to-out/link-in-to-out.mod.js to //etc/wb-rules-modules
#
```

### Сборка пакета и установка через apt

Соберем пакет
```terminal
# dpkg-buildpackage -rfakeroot -us -uc
```

После успешного завершения появится файл выше в папке `../`
Установим его
```terminal
# apt install -y ./wb-scenarios_1.0.0_all.deb
```

Если нужно удалить - то выполняем
```terminal
# apt remove wb-scenarios
```
