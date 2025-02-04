# Руководство Topic Manager (TM)

Для быстрого знакомства смотрите [**пример использования в правилах WB-rules**](#пример-использования-в-правилах-wb-rules)

## Общее описание

При работе с `wb-rules` пользователь обычно имеет доступ только к имени
топика и к новому значению записанному в топик, а так же может достать
некоторую информацию из meta топика - весь остальной функционал вокруг
нужно писать каждый раз заново, хотя большая часть задач повторяется
у разных людей.

С точки зрения обычного пользователя, задачу упрощения взаимодействия с
контроллером должны решить сценарии `wb-scenarios`, а для упрощения
написания скриптов в ходе работы над сценариями был создан `Topic manager`
или кратко `TM`.

> **TM не является заменой `wb-rules` и в первую очередь разработан
> для создания новых сценариев, которые фокусируются на обработке
> событий и реакции на изменения.**

Основная идея TM - вместо того чтобы каждый раз придумывать заново
структуру хранения данных для нового скрипта wb-rules: предоставить
типовую структуру данных и часто используемые методы работы со структурами
данных которые полезны при работе с правилами `wb-rules`. Что позволит
накапливать хорошие решения в пространстве пользователя, без изменения
самого движка `wb-rules`.

TM идейно похож на фраемворк для веб разработки, например плагины
устанавливаются так же как в `vue.js` с его `Vue.use(MyPlugin)`.
Однако TM разработан специально для работы с `wb-rules` и учитывает
специфику работы с окружением контроллера `WirenBoard` и его конвенции.

## Возможности

Топик менеджер позволяет решать задачи начального уровня проще,
так как предоставляет возможность детектировать разные именованные
события топика (плагин событий) и дает другие вспомогательные инструменты,
например создает виртуальное устройство для контроля используемых топиков
и включения/отключения созданного правила и отображения ошибки
при необходимости.

Базовый модуль топик менеджера почти не имеет полезного функционала и содержит
минимальный набор для реализации двух целей:

- Проксирование через себя частых методов взаимодействия с `wb-rules`.
  (Например определение правила `wb-rules`)
- Методы для работы плагинов (Например установка, добавление процессора)

В базе TM имеет только функционал управления правилами - можно добавлять
правила внутрь объекта `tm.rules = {};`. Далее можно управлять правилами
работающими в режиме `general` с помошью методов `tm.disableAllRules()`
и `tm.enableAllRules()`.

Для добавления полезного функционала нужно подключать соответствующие плагины
такие как `historyPlugin` и `eventPlugin`.

При работе с TM - вся информация о правилах и используемых топиках
собирается в одном локальном объекте внутри каждого правила.

```javascript
var tm = new TopicManager();
```

Далее с помошью этого объекта можно удобно управлять сущностями, например:

- Все созданные правила юзера можно отключить одним вызовом (базовая функция)
- Найти историю значений используемых топиков и зарегистрированных
событий для каждого топика (плагин history)
- Зарегистрировать для топиков именованные события (плагин events)

Так же предоставляет вспомогательные средства для разработки и отладки
своих правил - например для TM с помощью плагина basicVd можно создать
правило которое поможет включать и выклдчать обработку пользовательских
событий - TM сам проанализирует какие вы создавали правила и с какими
топиками, создав нужное виртуальное устройство куда вы уже сможете добавить
нужные вам контролы для взаимодействия.

## Решаемые задачи

Модуль топик менеджера помогает создать реестр топиков с которыми вам нужно
работать и решать три главные задачи:

1) Гибко обрабатывать плагинами через tm.runProcessors()
   Для этого есть гибкая цепь обработки куда плагины могут добавлять свои
   процессоры в цепочку - pluginsProcessorsChain[] в базовом объекте.
   Например:
   - Плагин истории значений добавляет процессор запоминиющий в массив
     приходящие значения топиков
   - Последующий процессор событий может исопльзовать эти данные для
     детектирования именованных событий, например whenEnabled,
     whenDisabled и тд.
   Польза - подключая новые плагины можно добавлять функционал не меняя код
   правила.

2) Хранить данные относящиеся к топикам централизованно на протяжении работы
   вашего правила wb-rules.
   Для этого есть реестр топиков. Под данными понимается любая информация,
   флаги, состояния, таблицы и тд - то есть что может быть необходимо
   в работе.
   Например:
   - При подключении расширения event можно для каждого из топиков хранить
     отдельные обработчики (callback) конкретных именованных событий, типа
     whenEnabled, whenDisabled и тд.
     (@todo: реализация плагина истории значений позволит реализовать более
     сложные типы именованных событий, например: whenCrossUpperThenValue,
     whenCrossDownThenValue и тд)
   Польза - из коробки имеем структуру данных для хранения стандартной или
   кастомной информации о статусе топиков и настроек работы с ними.

3) Создание и управление одним правилом для всех используемых топиков.
   После того как вы добавили топики в реестр - создается одно правило
   и управление топиками переходит топик менеджеру.

4) Получение пользы от плагинов.
   Например плагин событий позволяет кратко записывать создание разных
   обработчиков для разных типов событий.

## Использование

### 1. Подключение TM и плагинов

TM и плагины являются модулями и находятся глобально из любого скрипта.

```javascript
var TopicManager = require('tm-main.mod').TopicManager;
var eventPlugin = require('tm-event-main.mod').eventPlugin;
var historyPlugin = require('tm-history-main.mod').historyPlugin;
```

### 2. Создание объекта топик менеджера

Удобно пользоваться одним объектом TM на один скрипт чтобы у всех топиков
и событий был один контекст выполнения, но при необходимости - в одном скрипте
можно создать один или больше объектов топик менеджера, каждый из которых
будут независимыми друг от друга.

```javascript
var tm = new TopicManager();
```

### 3. Установка плагинов в созданный объект TM

Обратите внимание что порядок важен так как в плагине eventPlugin
есть зависимость `eventPlugin.dependencies: ['historyPlugin']`:

```javascript
tm.installPlugin(historyPlugin);
tm.installPlugin(eventPlugin);
```

### 4. Использование функционала

#### 4.1. Работа с правилами

Внутри TM работа с правилами основана на взаимодействии с реестром
правил `tm.rules{}`, внутри которого сохраняются все созданные правила.
У каждого правила есть его режим работы `mode` - он может быть двух видов:

- `general` - реестр общих пользовательских правил
- `service` - реестр сервисных правил которые не отключаются

Есть два метода которые нужно использовать как внутри TM так и снаружи для
добавления правил в один из реестров:

- `tm.defineRule()` - создает правило и добавляет его в реестр `rules`
  Отличается от обычного `defineRule()` только тем что автоматически
  сохраняет информацию о созданном правиле в локальный реестр.
- `tm.defineServiceRule()` - создает сервисное правило помечая его
  mod равным `service`

Сервисные правила TM отличаются от обычных тем что на них не действуют методы
`tm.disableAllRules()` и `tm.enableAllRules()`

#### 4.2. Инициализация событий топиков

Для использования событий - можно настроить детектирование событий следующим
образом:

```javascript
function cbFuncDisabled(topic, event, ctx) {
  log.debug('Run cbFuncDisabled()');
  return true;
}

function cbFuncCrossUpper(topic, event, ctx) {
  log.debug('Run cbFuncCrossUpper()');
  return true;
}

function cbFuncCrossLower(topic, event, ctx) {
  log.debug('Run cbFuncCrossLower()');  
  return true;
}

tm.registerSingleEvent('wall_switch_9/enabled', 'whenDisabled', cbFuncDisabled);
tm.registerSingleEvent('vd-water-meter-1/litres_used_value', 'whenCrossUpper', cbFuncCrossUpper, {actionValue: 15});
tm.registerSingleEvent('vd-water-meter-1/litres_used_value', 'whenCrossLower', cbFuncCrossLower, {actionValue: 17});
```

### 5. Создание и запуск правила

После инициализации всех топиков нужно выбрать один из типов запуска
правила с топик менеджером - самый простой способ, это запустить правило:

При использовании initRulesForAllTopics() будет создано два правила,
одно для `general`, другое для `service` задач - которые срабатывают каждый
раз при изменении любого из используемых в скрипте топиков. Данные правила
запускают процессоры всех установленных в данный момент плагинов,
например детектируют настроенные ранее события топиков:

```javascript
tm.initRulesForAllTopics('GenRuleName');
```

Важно: без установки плагинов запуск `initRulesForAllTopics()` не будет
иметь смысла, так как правила будут пустыми.

### 6. Создание виртуального девайса (Опционально)

Для облегчения работы с топик менеджером можно создать виртуальное устроство,
которое имеет две цели

1) Функционально имеет сразу выключатель правил, поэтому поможет:

   - Включать/выключать все правила TM. Например для веременной остановки
     работы алгоритмов. Например используется в сценариях для остановки работы
     сценария.

2) Сохраняется как tm.vd и имеет внутри себя методы для взаимодействия

### 7. Управление правилом

Созданное ранее правило можно отключить, включить или запустить принудительно.

Пример:

```javascript
tm.rules['GenRuleName'].disable();
```

## Пример использования в правилах WB-rules

### Основной файл

В данном примере мы зарегистрируем несколько именованных событий, а так же
получим доступ к истории топиков внутри коллбек функций.
Например:

1. При выключении топика `wall_switch_4/enabled`
2. Выполнится функция `cbFuncDisabled()`
3. В коллбеке мы можем получить доступ к:
   - Истории топика
   - Контексту конкретно этого топика в этом событии - запишем туда
     колличество раз которое это событие сработало для данного топика.
     Обратите внимание что при работе коллбека для wall_switch_3
     и wall_switch_4 контекст автоматически возьмется правильный для нужного
     топика и нужного вида события.

```javascript
var TopicManager = require('tm-main.mod').TopicManager;
var eventPlugin = require('tm-event-main.mod').eventPlugin;
var historyPlugin = require('tm-history-main.mod').historyPlugin;
var basicVdPlugin = require('tm-basicvd-main.mod').basicVdPlugin;

var tm = new TopicManager();

// Установка плагинов
// Обратите внимание что порядок важен
// так как в eventPlugin.dependencies: ['historyPlugin']
tm.installPlugin(historyPlugin);
tm.installPlugin(eventPlugin);
tm.installPlugin(basicVdPlugin);

// Более функциональный коллбек с доступом к истории значения с помошью плагина
// "topic" является расширяемым объектом которому можно добавить другие поля
function cbFuncDisabled(topic, event) {
  log.debug('Run cbFuncDisabled()');
  log.debug('- Topic name: "' + topic.name + '"');
  log.debug('- New value: "' + topic.val.new + '"');
  log.debug('- Prev value: "' + topic.val.prev + '"');
  log.debug(
    '- Value history: ' + JSON.stringify(topic.val.history, null, 2)
  );
  log.debug('- Event type: "' + event.type + '"');

  /**
   * Инициализация или увеличение счетчика в контексте
   *   Запишем в контекст события данного топика нужную информацию
   *   создав переменную в 'ctx'
   *   - Если счетчик еще не создан, создаем его с начальным значением 1
   *   - Если уже существует, то увеличиваем существующее значение счетчика
   */
  if (!event.ctx.counter) {
    event.ctx.counter = 1;
  } else {
    event.ctx.counter += 1;
  }
  log.debug('Current counter value: ' + event.ctx.counter);

  return true;
}

function cbFuncCrossUpper(topic, event) {
  log.debug('Run cbFuncCrossUpper()');
  log.debug('- Topic name: "' + topic.name + '"');
  log.debug('- New value: "' + topic.val.new + '"');
  log.debug('- Prev value: "' + topic.val.prev + '"');
  log.debug(
    '- Value history: ' + JSON.stringify(topic.val.history, null, 2)
  );
  log.debug('- Event type: "' + event.type + '"');
  return true;
}

function cbFuncCrossLower(topic, event) {
  log.debug('Run cbFuncCrossLower()');
  log.debug('- Topic name: "' + topic.name + '"');
  log.debug('- New value: "' + topic.val.new + '"');
  log.debug('- Prev value: "' + topic.val.prev + '"');
  log.debug(
    '- Value history: ' + JSON.stringify(topic.val.history, null, 2)
  );
  log.debug('- Event type: "' + event.type + '"');

  // Управлять правилами TM можно двумя способами
  // - Конкретное правило по имени
  tm.rules['GenRuleName'].disable();
  // - Все правила пользователя (не отключит сервисные правила)
  tm.disableAllRules();
  // Далее мы сможем включить отключенные правила переключателем
  // виртуального девайса (так как оно сервисное)
  
  return true;
}

function main() {
  // Регистрация событий - "когда выключится" и "когда пересечет границу вверх"
  tm.registerSingleEvent(
    'wall_switch_8/enabled',
    'whenDisabled',
    cbFuncDisabled
  );
  tm.registerSingleEvent(
    'wall_switch_9/enabled',
    'whenDisabled',
    cbFuncDisabled
  );
  tm.registerSingleEvent(
    'vd-water-meter-1/litres_used_value',
    'whenCrossUpper',
    cbFuncCrossUpper,
    { actionValue: 15 }
  );
  tm.registerSingleEvent(
    'vd-water-meter-1/litres_used_value',
    'whenCrossLower',
    cbFuncCrossLower,
    { actionValue: 17 }
  );

  // Создаем виртуальное базовое виртуальное устройство
  // которое может управлять правилом TM (отключать/включать)
  tm.createBasicVD('my_dev', 'Мое устройство кульное');
  
  // Так же можем выставлять ошибку виртуального устройства - все контролы
  // станут красными
  tm.vd.setTotalError('Hello');

  // Для особо опасных состояний можно создать аларм
  tm.vd.addAlarm('Ошибка');
  
  // И добавлять другие контролы - например добавить аларм в рантайм
  tm.vd.addCell('test_cell', {
    title: {
      en: 'cellTitleEn',
      ru: 'cellTitleRu',
    },
    type: 'alarm',
    readonly: true,
    value: true,
  });

  // Если сильно хочется работать с девайсом старыми способами - то можно
  // либо получить имя, либо сразу объект
  log.debug('Виртуальное устройство с именем: "{}"', tm.vd.name)
  tm.vd.devObj.addControl('test_text', {
    title: {
      en: 'cellTitleTextEn',
      ru: 'cellTitleTextRu',
    },
    type: 'Text',
    readonly: true,
    value: 'Новое поле',
  });

  // Генерация и запуск правила TM для начала работы
  // Созданное правило будет
  // - Обрабатывать все сконфигурированные ранее события для топиков
  // - При детектировании события вызывать коллбеки юзера
  tm.initRulesForAllTopics('GenRuleName');
}

main();
```

### Вспомогательные файлы

Файл `vd-wall-switch.js` для создания виртуальных выключателей
Просто создает 5 виртуальных девайсов - выключателей

```javascript
// Функция для создания виртуального устройства
function initVirtualDevice(device_name, prefix_start, index) {
  var name_postfix = prefix_start + index;
  if (device_name == undefined || prefix_start == undefined || index == undefined) {
    log("Инициализация устройства не выполнена. Проверьте переданные параметры.");
    return;
  }
  var gen_vd_name = device_name + name_postfix;

  defineVirtualDevice(gen_vd_name, {
    title: {
      en: "Virt. " + device_name + name_postfix,
      ru: "Вирт. " + device_name + name_postfix
    },
    cells: {
      enabled: {
        title: "Статус " + device_name + name_postfix,
        type: "switch",
        value: false
      }
    }
  });

  log("Виртуальное устройство '" + gen_vd_name + "' успешно создано.");
}

// Функция создания нескольких VD
function createDevicesInLoop(device_name, prefix_start, count) {
  for (var cur_index = 0; cur_index < count; cur_index++) {
    initVirtualDevice(device_name, prefix_start, cur_index);
    alert('Button action');
  }
}

// Запускаем цикл создания 5 устройств с префиксами от _0 до _4
createDevicesInLoop("wall_switch", "_", 5);
```

Файл `vd-water-meter.js` создания виртуального счетчика воды

```javascript
var name_postfix = "-1";
var gen_vd_name = "vd-water-meter" + name_postfix;

defineVirtualDevice(gen_vd_name, {
  title: {
    en: "Virt. water meter" + name_postfix,
    ru: "Вирт. счетчик воды" + name_postfix,
  },
  cells: {
    litres_used_value: {
      title: "Счетчик воды" + name_postfix,
      type: "value",
      value: 0,
    },
    click_button_plus: {
      title: "Инкремент +1",
      type: "pushbutton",
    },
    click_button_minus: {
      title: "Декремент -1",
      type: "pushbutton",
    },
  },
});

defineRule({
  whenChanged: [gen_vd_name + "/click_button_plus"],
  then: function (newValue, devName, cellName) {
    dev[gen_vd_name + "/litres_used_value"]++;
  },
});

defineRule({
  whenChanged: [gen_vd_name + "/click_button_minus"],
  then: function (newValue, devName, cellName) {
    dev[gen_vd_name + "/litres_used_value"]--;
  },
});
```
