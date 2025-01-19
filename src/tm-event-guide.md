
# Руководство по модулю `registry-event-processing`

## Описание

Модуль `registry-event-processing` предназначен для управления событиями с
использованием реестров событий и резолверов. Его работа похожа на роутеры
в библиотеках для написания HTTP сервера - для каждого топика ишется свой
обработчик.

Плагин объединяет функционал:

- Регистрации событий и их обработчиков
- Проверки условий срабатывания событий через резолверы
- Обработки событий с вызовом обратных вызовов (callback функций)

Модуль полностью совместим с ES5 и легко интегрируется в скрипты описания
wb-rules

## Польза

Модуль позволяет
1) Иметь перечень именованных событий для простого конфигурирования
   целенаправленных коллбеков, например не только whenChange, но и
   whenEnabled, whenDisabled и тд.
2) Расширенный перечень доступной информации о топике в коллбеке и в резолвере
   позволяет создавать более сложные события и пользовательскую логику:
   - Доступ к истории значений позволяет реализовывать события учитывающие
   направление
   - Доступ к времени изменения позволяет создавать события учитывающие
   скорость изменения и другие более сложные математические модели
   - У каждого события есть локальное пользовательское хранилище где
   резолвер и/или коллбек могут хранить свои данные для работы. Например можно
   создать счетчик срабатываний и записывать значения в это хранилище - для
   каждого топика оно будет уникальным.
3) Сам список событий находится в легком доступе пользователей и дает
   возможность создвать свои собственные, кастомные события и делиться
   ими при желании

Вместо создания подобной конструкции для топика:

```javascript
defineRule
if ...
Action for enabled
else ...
Action for disabled
```

Можно написать код с именованными событиями и все запустится в одном
правиле автоматически:
tm.runProcessingRule() - создает правило wb-rules которое само обрабатывает
все ранее зарегистрированные события для топиков и вызывает соответствующие
коллбеки
```javascript
tm.registerEvent(topicString, eventName)

tm.runProcessingRule()
```

Либо можно создать правило вручную и пользоваться обработчиком только точечно
tm.runProcessorsChain() - ищет нужный обработчик события и вызывает
зарегистрированный ранее коллбек

```javascript
tm.registerEvent(topicString, eventName)

defineRule
tm.runProcessorsChain()
```

## Функциональность

### 1. Резолверы событий

Резолверы определяют, сработало событие или нет, исходя из нового значения
топика. Поддерживаются следующие резолверы:
- `whenEnabled`: Срабатывает, если новое значение `true`
- `whenDisabled`: Срабатывает, если новое значение `false`
- `whenChange`: Срабатывает всегда при любом изменении значения

### 2. Реестр событий

Реестр событий позволяет:
- Регистрировать события для различных топиков.
- Обрабатывать события, проверяя условия их срабатывания.
- Просматривать текущую структуру реестра для отладки.

## Включение в скрипт

Сохраните файл `registry-event-processing.mod.js` в проект. Подключите его в
вашем коде:

```javascript
var eventModule = require('./registry-event-processing.mod.js');
```


## Использование

### 1. Создание реестра

Для начала работы создайте новый реестр событий:

```javascript
var eventModule = require('./registry-event-processing.mod.js');
var eventRegistry = eventModule.createEventRegistry();
```


### 2. Регистрация событий

Регистрируйте события для нужных топиков и типов

Всего есть 2 общих варианта регистрации

- Указывая топик и конкретный тип события
  Это базовый метод регистрации
- Используя объект {mqttTopicName: '...', behaviorType: '...'}
  Данный вариант полезен для обработки событий конфигурируемых
  пользователем из webui созданного через json-editor.

#### 2.1. Регистрация одного события

Это базовый метод

```javascript
function lightEnabled(value) {
  log.debug('Light enabled with value: ' + value);

  /* Обязательно вернуть true если все хорошо */
  return true;
}

function lightDisabled(value) {
  log.debug('Light disabled with value:' + value);

  /* Обязательно вернуть true если все хорошо */
  return true;
}

eventRegistry.registerEvent('home/light', 'whenEnabled', lightEnabled);
eventRegistry.registerEvent('home/light', 'whenDisabled', lightDisabled);
```

Обратите внимание - если зарегистрировать несколько разных событий
на один топик и в один момент произойдут оба изменения - то вызовутся все
обработчики.

Например - можно зарегистрировать три обработчика на один топик:

```javascript
tm.registerSingleEvent('topic1', 'whenEnabled', cbFuncEnbaled)
tm.registerSingleEvent('topic1', 'whenDisabled', cbFuncDisabled)
tm.registerSingleEvent('topic1', 'whenChange', cbFuncChanged)
```

В этом случае - вместе с cbFuncEnbaled и cbFuncDisabled каждый раз будет
вызываться еще и cbFuncChanged.

### 3. Обработка событий

Обрабатывайте события можно тремя способами

Будут обработаны все события которые вы ранее зарегистрировали.
Произошло событие или нет будет решать резолвер который получит новое
значение.

### 3.1. Полностью автоматически

В этом случае создается одно плавило которое отслеживает изменения всех
зарегистрированных топиков и вызывает нужные коллбеки когда происходят
указанные события.

Плюсы
- Автоматическое создание и запуск правила со всеми топиками
- Для всех плагинов автоматическая обработка

При работе так же вызываются процессоры всех зарегистрированных плагинов.

```javascript
todo пример
```

### 3.2. Используя непосредственных вызов общего процессора TM

В этом случае вы сами создаете нужные правила WB-rules и вставляете туда
общий обработчик TM.

Плюсы
- Вызываются процессоры всех плагинов
- Если есть необходимость - можно самому создать правило и пре/пост обработку

При работе так же вызываются процессоры всех зарегистрированных плагинов.

```javascript
todo пример
```

### 3.3. Напрямую вызывая вручную обработчик плагина

В этом случае вы сами создаете нужные правила WB-rules и вставляете туда
процессор плагина передавая имя топика и новое значение.

Плюсы
- Вызывается только процессор данного плагина
- Если есть необходимость - можно самому создать правило и пре/пост обработку

При использовании данного метода вы используете точечно один процессор одного
плагина - другие плагины не запускаются.

Пример:
```javascript
eventRegistry.processEvent('home/light', true);
```

Для проверки результата обработки можно получить итог обработки:
```javascript
var res = eventRegistry.processEvent(devName + '/' + cellName, newValue);
log.debug('doorOpenHandler res = ' + JSON.stringify(res));
```

Выведет в случае успеха:
```javascript
doorOpenHandler res = {"status":"processed_success","message":"Событие обработано успешно"}
```

В случае если не будет найдено обработчиков или из коллбека вернется некорректное значение
```javascript
doorOpenHandler res = {"status":"no_events_registered","message":"Нет обрабатываемых событий для данного топика"}
```

Это значит что был найден как топик, так и соответствующее событие
для обработки, а так же вызван обработчик события.

Возможные варианты статусов такие:
```javascript
status: 'processed_success' | 'processed_with_issue' | 'no_events_registered' | 'topic_not_found'
```

Данный функционал обработки результата будет полезен для выявления обратных
событий - например если вы зарегистрировали событие на обработку только
whenEnabled - и ваш контрол имеет тип bool - то вы сможете понять на сколько
часто происходит обратное событие.

Либо вы можете возвращать какую либо ошибку в случае ошибки в назначенном
коллбеке, например выход за границы установленных значений.

### 4. Отладка

Выведите текущую структуру реестра для проверки:

```javascript
var debugInfo = eventRegistry.getRegistryDebugView();
log.debug(debugInfo);
log.debug(JSON.stringify(debugInfo, null, 2));
```

Пример вывода:

```json
{
  "home/light": {
    "whenEnabled": {
      "callbackName": "lightEnabled"
    },
    "whenDisabled": {
      "callbackName": "lightDisabled"
    }
  }
}
```

## Структура файла

Модуль состоит из двух основных частей:

1. **Резолверы событий**:
- Хранятся в объекте `eventResolverRegistry`.
- Предназначены для проверки условий срабатывания событий

2. **Реестр событий**:
- Создаётся с помощью фабрики `createEventRegistry`
- Управляет регистрацией и обработкой событий

Главный файл содержит два главных метода
- registerSingleEvent() - базовый метод регистрирующий коллбек для
  определенного топика и типа события
- processEvent() - используется для поиска нужного коллбека по топику и типу
  события

---

## Экспортируемые функции

1. **`createEventRegistry`**
- Создаёт новый реестр событий.
- Возвращает объект с методами:
- `registerEvent(topic, eventType, callback)`: Регистрирует событие.
- `processEvent(topic, eventType, value)`: Обрабатывает событие.
- `getRegistryDebugView()`: Возвращает отладочный вид реестра.

2. **`eventResolverRegistry`**
- Объект с резолверами событий:
- `handler`: Функция проверки срабатывания события.
- `resetResolver`: Функция сброса состояния (если требуется).

---

## Примеры

### Без wb-rules для отладки

```javascript
// Подключение модуля с методами обработки событий
var eventModule = require("registry-event-processing.mod");

// Прописывание коллбеков
function lightEnabled(value) {
  log.debug('Light enabled with value:' + value);
}

function lightDisabled(value) {
  log.debug('Light disabled with value:' + value);
}

function lightSwitched(value) {
  log.debug('Light switched with value:' + value);
}

function main() {
  // Создание реестра
  var eventRegistry = eventModule.createRegistryForEvents();
  
  // Регистрация событий в реестре
  eventRegistry.registerEvent('home/light', 'whenEnabled', lightEnabled);
  eventRegistry.registerEvent('home/light', 'whenDisabled', lightDisabled);
  eventRegistry.registerEvent('home/light', 'whenChange', lightSwitched);
  
  // Обработка всех зарегистрированнных событий топика "home/light"
  eventRegistry.processEvent('home/light', true);
  
  // Отладка
  var debugInfo = eventRegistry.getRegistryDebugView();
  log.debug(JSON.stringify(debugInfo, null, 2));
}

main();
```

Выведет в дебаг:


```
2024-12-23 10:56:41Event registered: topic='home/light', type='whenEnabled'
2024-12-23 10:56:41Event registered: topic='home/light', type='whenDisabled'
2024-12-23 10:56:41Event registered: topic='home/light', type='whenChange'
2024-12-23 10:56:41Executing callback for topic 'home/light', event type 'whenEnabled'
2024-12-23 10:56:41Light enabled with value:true
2024-12-23 10:56:41Resolver rejected event 'whenDisabled' for topic 'home/light'
2024-12-23 10:56:41Executing callback for topic 'home/light', event type 'whenChange'
2024-12-23 10:56:41Light switched with value:true
2024-12-23 10:56:41{
  "home/light": {
    "whenEnabled": {
      "callbackName": "lightEnabled()"
    },
    "whenDisabled": {
      "callbackName": "lightDisabled()"
    },
    "whenChange": {
      "callbackName": "lightSwitched()"
    }
  }
}
```


### Вместе с wb-rules

```javascript
```

## Часто задаваемые вопросы

### Что произойдёт, если резолвер для события не найден?

Будет выведено сообщение:

```plaintext
Resolver not found for event type '<eventType>'
```

При этом обработка завершится.

### Можно ли зарегистрировать несколько событий для одного топика?

Да, вы можете зарегистрировать несколько событий для одного топика, если они
имеют разные типы (`eventType`).
