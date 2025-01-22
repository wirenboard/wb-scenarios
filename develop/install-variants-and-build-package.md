# Варианты установки сценариев и сборка пакета

## Автоматическая установка

Переходим в желаемое место, например в домашнюю дирректорию

```terminal
# cd ~
```

Установить git и make на контроллера

```terminal
# apt update && \
  apt install git -y && \
  apt install make
```

Клонирование на контроллер с помошью гит

```terminal
# git clone https://github.com/wirenboard/wb-scenarios
# cd wb-scenarios
```

В процессе разработки удобно клонировать свою ветку и сразу провести установку

```terminal
# GIT_BRANCH_NAME="feature/implement-counters-processing"
# git clone -b "${GIT_BRANCH_NAME}" --single-branch "https://github.com/wirenboard/wb-scenarios.git" && \
  cd wb-scenarios && \
  make
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

## Ручная установка

Для ручной установки сценариев нужно расставить 5 файлов в контроллере

Простого сценария соединения входа на выход прямого или инверсного где указываешь входной и выходной топики switch и далее автоматом инициализируются виртуальное устройство и правило которое будет выполнять заданный в вебке функционал

Там есть всего 5 файлов которые устанавливаются следующим образом (если делать со стороны пользователя)

Добавление происходит добавлением-изменением следующих файлов

1. Файл правил `*.js` конкретного сценария для инициализации

Файл кладется в системные правила, чтобы его не было видно пользователям

```path
/share/wb-rules-system/rules/*.js
```

Во время отладки можно класть в пользовательские правила
В этом случае можно редактировать файл из WEBUI контроллера

```path
/etc/wb-rules/scenarios.js
```

2. Модуль используемый в конкретном сценарии `*.mod.js`

Файл кладется в системные модули, чтобы его не было видно пользователям

```path
/etc/wb-rules-modules/link-in-to-out.mod.js
```

3. Описание схемы json-editor `*.schema.json`

```path
/usr/share/wb-mqtt-confed/schemas/scenarios.schema.json
```

4. При необходимости изображения `*.png`

```path
/var/www/images/scenarios-link-in-to-out.png
```

5. Сохраненный конфиг из вебки rules/scenarios.conf

```path
/etc/scenarios.conf
```
