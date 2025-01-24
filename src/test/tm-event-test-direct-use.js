/**
 * @file tm-event-test-direct-use.js
 * @description Тест плагина eventPlugin для TopicManager нацеленный
 *     на прямое использование методов плагина - без TM процессинга
 */

var TopicManager = require('tm-main.mod').TopicManager;
var eventPlugin = require('tm-event-main.mod').eventPlugin;

// Создаем экземпляр TopicManager
var tm = new TopicManager();

// Подключаем плагин событий
tm.installPlugin(eventPlugin, { priority: 10, prefix: '[EventPlugin]' });

// Не корректный коллбек - так как нет возврата true
function cbFuncEnbaled(newValue) {
  log.debug('Run cbFuncEnbaled() with newValue=' + newValue);
}

function cbFuncDisabled(newValue) {
  log.debug('Run cbFuncDisabled() with newValue=' + newValue);
  return true;
}

function cbFuncChanged(newValue) {
  log.debug('Run cbFuncChanged() with newValue=' + newValue);
  return true;
}

// Функция проверки результатов теста
function checkTestResult(input, actual, expected) {
  var isEqual = JSON.stringify(actual) === JSON.stringify(expected);
  if (isEqual) {
    log.debug('Test passed for input ' + JSON.stringify(input));
  } else {
    log.error(
      'Test failed for input ' + JSON.stringify(input) +
      '. Expected: ' + JSON.stringify(expected, null, 2) +
      ', Got: ' + JSON.stringify(actual, null, 2)
    );
  }
}

function main() {
  // Регистрация событий
  tm.registerSingleEvent('topic1', 'whenChange', cbFuncChanged);
  tm.registerSingleEvent('topic1', 'whenEnabled', cbFuncEnbaled);
  tm.registerSingleEvent('topic1', 'whenDisabled', cbFuncDisabled);
  tm.registerSingleEvent('topic2', 'whenEnabled', cbFuncEnbaled);
  tm.registerBothEvents('topic3', 'whenEnabled', cbFuncEnbaled, cbFuncDisabled);
  
  // Обрабатываем события и проверяем результаты

  // Тест предупреждения - процессинг события с коллбеком без возвращаемого значения
  // Совпавшие событий: whenChange + whenEnabled
  var input = ['topic1', true];
  var expected = {
    status: 'processed_with_issue',
    message: 'События обработаны, но минимум один callback с ошибкой',
    details: [
      { eventType: 'whenChange', status: 'success' },
      { eventType: 'whenEnabled', status: 'processed_without_res' }
    ]
  };
  var actual = tm.processEvent(input[0], input[1]);
  log.debug(JSON.stringify(actual, null, 2));
  checkTestResult(input, actual, expected);

  // Тест корректный - процессинг одного события
  // Совпавшие события: whenChange
  input = ['topic1', 248];
  expected = {
    status: 'processed_success',
    message: 'Все события обработаны успешно',
    details: [{ eventType: 'whenChange', status: 'success' }]
  };
  actual = tm.processEvent(input[0], input[1]);
  log.debug(JSON.stringify(actual, null, 2));
  checkTestResult(input, actual, expected);

  // Тест корректный - процессинг двух одновоременных событий
  // Совпавшие события: whenChange + whenDisabled
  input = ['topic1', false];
  expected = {
    status: 'processed_success',
    message: 'Все события обработаны успешно',
    details: [
      { eventType: 'whenChange', status: 'success' },
      { eventType: 'whenDisabled', status: 'success' }
    ]
  };
  actual = tm.processEvent(input[0], input[1]);
  log.debug(JSON.stringify(actual, null, 2));
  checkTestResult(input, actual, expected);

  // Тест корректный - процессинг без совпавших зарегистрированных событий
  // Совпавшие события: нет
  input = ['topic2', 'hello'];
  expected = {
    status: 'no_events_registered',
    message: 'Нет обрабатываемых событий для данного топика',
    details: []
  };
  actual = tm.processEvent(input[0], input[1]);
  log.debug(JSON.stringify(actual, null, 2));
  checkTestResult(input, actual, expected);

  // Тест ошибки - процессинг не зарегистрированного топика
  // Совпавшие события: нет
  input = ['topic3', true];
  expected = {
    status: 'processed_with_issue',
    message: 'События обработаны, но минимум один callback с ошибкой',
    details: [
      { eventType: 'whenEnabled', status: 'processed_without_res' }
    ]
  };
  actual = tm.processEvent(input[0], input[1]);
  log.debug(JSON.stringify(actual, null, 2));
  checkTestResult(input, actual, expected);
  
  // Тест ошибки - процессинг не зарегистрированного топика
  // Совпавшие события: нет
  input = ['topic4', 'hello'];
  expected = {
    status: 'topic_not_found',
    message: 'Топик "topic4" не найден в реестре',
    details: []
  };
  actual = tm.processEvent(input[0], input[1]);
  log.debug(JSON.stringify(actual, null, 2));
  checkTestResult(input, actual, expected);

  // Вывод реестра
  tm.printRegistry();
  //   === Current Registry State ===
  //   {
  //     "topic1": {
  //       "whenChange": ,
  //       "whenEnabled": ,
  //       "whenDisabled": 
  //     },
  //     "topic2": {
  //       "whenEnabled": 
  //     },
  //     "topic3": {
  //       "whenEnabled": ,
  //       "whenDisabled": 
  //     }
  //   }
  // ==============================  
}

// Запускаем основную функцию
main();
