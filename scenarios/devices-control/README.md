# Сценарий управления устройствами `devices-control`

Позволяет управлять светом соединив один или несколько выключателей с одним или несколькими световыми приборами
Удобен для реализации разных случаев:

- Мастер выключателя - один выключатель выключает весь свет в помешениях
- Проходной выключатель - несколько выключателей управляют одним световым прибором
- Управление шторами

Конфигурация выглядит следующим образом

![alt text](doc/scenario-config.png)

Каждому сценарию создается виртуальное устройство

![virtual-device](doc/virtual-device.png)

## Использование модуля

Вы можете использовать модуль управления устройствами прямо из своих
правил `wb-rules`.

Для этого нужно сделать 2 действия:

1) Подключить модуль в коде скрипта
2) Инициализировать алгоритм с помошью `init()`, указав необходимые параметры,
   описанные ниже

### Описание параметров конфигурации

Функция `init()` имеет 4 параметра:

1. `id_prefix` {string} Обязательный параметр (в данном сценарии)
   Задает строку префикса, добавляемого к идентификаторам
   виртуального устройства и правила:
   - Вирт. устройство будет иметь имя вида `wbsc_<!id_prefix!>`
   - Правила будут иметь имена вида `wbru_<!id_prefix!>`
2. `name` {number} Имя виртуального устройства
3. `inControls` {Array} Массив входящих отслеживаемых контролов.
   При возникновении указанного события на любом из контролов, сразу начнется
   выполнение логики над выходными контролами.
   Каждый элемент имеет два параметра:
   - `control`: строка MQTT контрола
   - `behaviorType`: строка с типом отслеживаемого действия.
     Может быть следующих типов (в скобках разрешенные типы контролов):
     "whenChange" ('switch', 'value'),
     "whenEnabled" ('switch'),
     "whenDisabled" ('switch')
4. `outControls` {Array} Массив исходяших управляемых контролов. Над всеми
   контролами в списке будут произведены указанные пользователем действия.
   Каждый элемент имеет три параметра:
   - `control`: строка MQTT контрола
   - `behaviorType`: строка с типом действия над контролом.
     Может быть следующих типов (в скобках разрешенные типы контролов):
     "toggle" ('switch'),
     "setEnable" ('switch'),
     "setDisable" ('switch'),
     "setValue" ('value'),
     "increaseValueBy" ('value'),
     "decreaseValueBy" ('value')
   - `actionValue`: значение используемое в действии (если требуется)

   Например, чтобы сделать мастер выключатель используя выключатель
   без фиксации, который управляет двумя лампами можно указать:

   - `inControls` два контрола счетчиков и поведение "whenChange"

   ```json
   [
       {
           "control": "wb-mr6cv3_127/Input 0 counter",
           "behaviorType": "whenChange"
       }, // Далее можно указать другие контролы
     //{
     //    "control": "wb-mr6cv3_127/Input 1 counter",
     //    "behaviorType": "whenChange"
     //}
   ]
   ```

   - `outControls` два контрола и поведение "whenChange"

   ```json
   [
       {
           "control": "wb-mr6cv3_127/K5",
           "behaviorType": "setEnable",
           "actionValue": 0 // Не используется в случае "setEnable"
       },
       {
           "control": "wb-mr6cv3_127/K6",
           "behaviorType": "setEnable",
           "actionValue": 0 // Не используется в случае "setEnable"
       }, // Далее можно указать другие контролы
     //{
     //    "control": "wb-mr6cv3_127/K4",
     //    "behaviorType": "setEnable",
     //    "actionValue": 0
     //}
   ]
   ```

### Пример кода

```js
/**
 * @file: devices-control.js
 */

// Step 1: include module
var scenarioModule = require("devices-control.mod");

function main() {
  log.debug('Start init logic for: Bathroom light');

  // Step 2: init algorithm
  var inControls = [
      {
          "control": "wb-mr6cv3_127/Input 0 counter",
          "behaviorType": "whenChange"
      }
  ];

  var outControls = [
      {
          "control": "wb-mr6cv3_127/K5",
          "behaviorType": "setEnable",
          "actionValue": 0 // Не используется в случае "setEnable"
      },
      {
          "control": "wb-mr6cv3_127/K6",
          "behaviorType": "setEnable",
          "actionValue": 0 // Не используется в случае "setEnable"
      }
  ];

  var isInitSuccess = moduleInToOut.init('bathroom_light',
                                        'Bathroom: light',
                                        inControls,
                                        outControls);

  var isInitSuccess = scenarioModule.init('Bathroom: heat floor', cfg);
  if (!isInitSuccess) {
    log.error('Error: Init aborted for "id_prefix": {}', cfg.id_prefix);
    return;
  }

  log.debug('Initialization successful for "id_prefix": {}', cfg.id_prefix);
}

main();
```

После запуска скрипта у вас с устройствах появится новое устройство
для управления - которое будет аналогично тому, что вы можете создать через
визульный конфигуратор в WEBUI контроллера:

<p align="center">
    <img width="400"
         src="doc/virtual-device.png"
         alt="Virtual device view" />
</p>

## Добавление новых типов операций

В сценарии используются следующие термины описанные ниже

### События и действия

В сценарии есть два типа сущностей которые конфигурирует пользователь

- Событие (event) которые нужно отслеживать и реагировать на них
- Действие (action) которые будут активированы когда мы поймем
  что событие произошло

### Воздействие (impact)

Это понятние объединяющее события и действия одним словом:
- Входное воздействие получаемое контроллером называться событием
- Выходное воздействие активируемое контроллером называется действием

Например
- событие нажатия на клавишу или температура больше 15 градусов это воздействие которое мы отслеживали
- действие включения света это воздействие которым мы реагируем в ответ

Для удобного описания воздействий созданы таблицы в которых рядом хранятся
обработчкики и допустимые типы данных воздействий. Таким образом при добавлении
нового обрабатываемого воздействия не нужно смотреть исходники модулей, а достаточно
только добавить то что вы хотите в соответствующую таблицу событий или действий

Понятие воздействия необходимо для унификации структур массивов датчиков которые
указываются пользователями в сценариях. Таким образом возможно добавлять уже описанные в других
сценариях действия в свои новые сценарии - повторно используя уже описанные.

Например можно
- добавить себе массив устройств назвав его произвольно,
- сохранив структуру где внутри каждого члена есть поле mqttTopicName и BehType
- Далее в своем сценарии вызвать setAllValuesByBehavior
- Все ваши значения установятся нужным образом

С другой стороны
- Добавленные вами новые типы поведений можно будет потом переиспользовать в старых сценариях

### Тип поведения

Поведение - это параметр позволяющий описать конкретный тип воздействия
Например
- Температура может по разному воздействовать на систему - либо уменьшаться, либо увеличиваться
Чтобы точно понять что нужно реагировать не просто на воздействие температуры - нам нужно описать ожидаемое поведение на которое мы будем реагировать

Например
Для событий типы поведений
- Когда включится переключатель
- Когда температура превысит определенное числовое значение
Для действий
- Выключить переключатель
- Установить температуру теплого пола на определенное значение



Для добавления новых типов отслеживаемых событий или действий над контролом - нужно
1) Изменить WEBUI

Добавить в файл схемы `wb-scenarios.schema.json` новый тип события/действия в соответствующий выпадающий список

- Для событий: `inControls.items.properties.behaviorType`
- Для действий: `outControls.items.properties.behaviorType`

2) Реализовать логику обработки

Описания событий и действий находятся в отдельных файл с таблицами:

- Для событий: `table-handling-events.mod.js`
- Для действий:  `table-handling-actions.mod.js`

Процесс добавления выглядит следующим образом:

- Добавить в таблицу событие или действие с тем же названием enum которое выбрали в схеме
- Описать функцию хендлер которая
  - Событие - вернет тру если событие произошло
  - Действие - вернет новое значение параметра в зависимости от логики действия
- В действиях должен быть так же метод reset
  Который будет откатывать включение до дефолтной установки, например когда свет нужно отключить - то для каждого типа топиков нужно свое значение прописать для отката с помошь

## Таблицы событий и действий

Так как логика сценариев подразумевает связь трех сущностей между собой
Каждое событие или действие имеет
- ключ, который соответствует типу события/действия и
включает параметры:
- @param {Array<string>} reqCtrlTypes - Required Control Types
                    Разрешенные типы контрол топиков MQTT для данного
                    события/действия
- @param {function} handler - Функция обработчика события или действия
При изменении состояния любого из входных топиков, согласно настроенным событиям,
все выходные топики изменяют своё состояние в соответствии с настроенным действием.

Хендлер события должен содержать логику обработки события и отвечать на вопрос - произошел ли данный тип события
Возвращать должна для ясности переменную с именем `isEventTriggered`

Хендлер действия должен содержать логику вычисления нового значения контрола и отвечать на вопрос - какое новое значение контрола нужно записать в соответствии с данным типом действия
Возвращать должна для ясности переменную с именем `newControlValue`
