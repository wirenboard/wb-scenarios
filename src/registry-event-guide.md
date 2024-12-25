
# Руководство по модулю `registry-event-processing`

## Описание

Модуль `registry-event-processing` предназначен для управления событиями с
использованием реестров событий и резолверов. Он объединяет функционал:
- Регистрации событий и их обработчиков
- Проверки условий срабатывания событий через резолверы
- Обработки событий с вызовом обратных вызовов

Модуль полностью совместим с ES5 и легко интегрируется в скрипты описания
wb-rules

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

Регистрируйте события для нужных топиков и типов:

```javascript
function lightEnabled(value) {
  log.debug('Light enabled with value: ' + value);
}

function lightDisabled(value) {
  log.debug('Light disabled with value:' + value);
}

eventRegistry.registerEvent('home/light', 'whenEnabled', lightEnabled);
eventRegistry.registerEvent('home/light', 'whenDisabled', lightDisabled);
```

### 3. Обработка событий

Обрабатывайте события, передавая имя топика и новое значение.
Будут обработаны все события которые вы ранее зарегистрировали.
Произошло событие или нет будет решать резолвер который получит новое
значение.

Пример:
```javascript
eventRegistry.processEvent('home/light', true);
```


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


### С wb-rules

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
