/**
 * @file Модуль для инициализации связи между множеством входных и выходных
 *       топиков MQTT. Поддерживаемые типы контролов:
 *         - 'switch'
 *         - 'value'
 *       При изменении любого из входных топиков по настроенному
 *       событию - все выходные топики изменяют состояние в соответствии
 *       с настроенным действием
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */


/**
 * Таблицы событий и действий
 * Так как логика подразумевает связь трех сущностей между собой - будем
 * хранить их в одной таблице
 *   - Ключ Тип события/действия
 * @param reqCtrlTypes Required Control Types
 *                     Разрешенные типы контрол топиков MQTT для данного
 *                     события/действия
 * @param handler      Обработчик данного события/действия
 */
/**
 * Отключает контрол.
 * @param {string} controlName - Имя контрола.
 * @returns {boolean} Всегда возвращает false.
 */
function setDisable(controlName) {
  return false;
}

/**
 * Включает контрол.
 * @param {string} controlName - Имя контрола.
 * @returns {boolean} Всегда возвращает true.
 */
function setEnable(controlName) {
  return true;
}

/**
 * Переключает состояние контрола.
 * @param {string} controlName - Имя контрола.
 * @returns {boolean} Возвращает противоположное текущему состояние контрола.
 */
function toggle(controlName) {
  var newState = !dev[controlName];
  return newState;
}

/**
 * Событие активации контрола.
 * @param {boolean} newValue - Новое состояние контрола.
 * @returns {boolean} Возвращает true, если контрол включен.
 */
function whenEnabled(newValue) {
  return newValue === true;
}

/**
 * Событие деактивации контрола.
 * @param {boolean} newValue - Новое состояние контрола.
 * @returns {boolean} Возвращает true, если контрол выключен.
 */
function whenDisabled(newValue) {
  return newValue === false;
}

/**
 * Событие изменения состояния контрола.
 * @param {any} newValue - Новое состояние контрола.
 * @returns {boolean} Всегда возвращает true.
 */
function whenChange(newValue) {
  return true; // Всегда срабатывает при изменении
}

// Обновление таблиц с использованием именованных функций
var actionsTable = {
  'toggle': {
    reqCtrlTypes: ['switch'],
    handler: toggle
  },
  'setEnable': {
    reqCtrlTypes: ['switch'],
    handler: setEnable
  },
  'setDisable': {
    reqCtrlTypes: ['switch'],
    handler: setDisable
  }
};

var eventsTable = {
  'whenChange': {
    reqCtrlTypes: ['switch'],
    handler: whenChange
  },
  'whenDisabled': {
    reqCtrlTypes: ['switch'],
    handler: whenDisabled
  },
  'whenEnabled': {
    reqCtrlTypes: ['switch'],
    handler: whenEnabled
  }
};


/**
 * Проверяет, входит ли тип контрола в список допустимых типов
 *
 * @param {string} controlName - Имя контрола
 * @param {Array<string>} reqCtrlTypes - Список допустимых типов
 * @returns {boolean} Возвращает true, если тип контрола допустим, иначе false
 */
function isControlTypeValid(controlName, reqCtrlTypes) {
  var controlType = dev[controlName + "#type"];
  
  // Обработка на случай не существования контрола
  if (!controlType) {
    log("Control type for " + controlName + " not found, return: " + controlType);
    return false;
  }
  log("Control: " + controlName + " | Type: " + controlType);

  var isTypeValid = (reqCtrlTypes.indexOf(controlType) !== -1);
  return isTypeValid;
}


/**
 * Проверяет типов всех контролов в массиве на соответсвие
 * требованиям в таблице
 *
 * @param {Array<Object>} controls - Массив конфигураций контролов
 * @param {Object} table - Таблица, содержащая допустимые типы для
 *                         каждого события/действия
 * @returns {boolean} - Возвращает true, если все контролы имеют
 *                      допустимые типы, иначе false
 */
function validateControls(controls, table) {
  for (var i = 0; i < controls.length; i++) {
    var curCtrlName = controls[i].control;
    var curBehaviorType = controls[i].behaviorType;
    var reqCtrlTypes = table[curBehaviorType].reqCtrlTypes;
    
    if (!isControlTypeValid(curCtrlName, reqCtrlTypes)) {
      log("Error: Control '" + curCtrlName + "' is not of a valid type");
      return false;
    }
  }
  return true;
}

/**
 * Основная функция для проверки всех входных и выходных контролов
 * Проверяет соответствие типов контролов и событий/действий
 * В случае несоответствия типа контролов, логирует ошибку и прерывает выполнение
 *
 * @param {Array<Object>} inControls - Массив конфигураций входных контролов
 * @param {Array<Object>} outControls - Массив конфигураций выходных контролов
 * @returns {void}
 */
function checkControls(inControls, outControls) {
  log("Input Controls conf: " + JSON.stringify(inControls));
  log("Output Controls conf: " + JSON.stringify(outControls));

  // @todo:vg Добавить проверку существования указанных контролов перед работой
  //          чтобы мы были уверенны что каждый контрол реально существует

  var isInputControlsValid = validateControls(inControls, eventsTable);
  var isOutputControlsValid = validateControls(outControls, actionsTable);

  var isAllCtrlTypesValid = (isInputControlsValid && isOutputControlsValid);
  if (!isAllCtrlTypesValid) {
    log("Error: One or more controls are not of a valid type. Operation aborted!");
    return;
  }

  log("All controls have valid types");
}


/**
 * Инициализирует виртуальное устройство и определяет правило для управления
 * множеством выходных топиков на основе множества входных топиков
 * @param {string} idPrefix - Префикс сценария, используемый для идентификации
 *                            виртуального устройства и правила
 * @param {Array<Object>} inControls - Массив входных контролов, значения
 *                          которых нужно слушать. Каждый объект содержит:
 *                            - Имя контрола
 *                            - Тип события которое ловится
 *                          Пример:
 *                          [
 *                            {
 *                              "control": "vd-wall-switch1/enabled",
 *                              "behaviorType": "whenChange"
 *                            },
 *                            {
 *                              "control": "vd-wall-switch2/enabled",
 *                              "behaviorType": "whenDisabled"
 *                            }
 *                          ]
 * @param {Array<Object>} outControls - Массив выходных контролов, значения
 *                          которых будут изменены. Каждый объект содержит:
 *                            - Имя контрола
 *                            - Тип выполняемого с контролом действия
 *                            - Значение для установки (актуально для value)
 *                            Пример:
 *                            [
 *                              {
 *                                "control": "vd-pump1/enabled",
 *                                "behaviorType": "setDisable",
 *                                "actionValue": 0
 *                              },
 *                              {
 *                                "control": "vd-pump2/enabled",
 *                                "behaviorType": "setValue",
 *                                "actionValue": 22
 *                              }
 *                            ]
 * @returns {void}
 */
function init(idPrefix, inControls, outControls) {

  function thenHandler(newValue, devName, cellName) {
    var controlFullName = devName + '/' + cellName;
    var matchedInControl = null;
  
    // Ищем контрол вызвавший изменение, получаем прослушиваемый тип события
    for (var i = 0; i < inControls.length; i++) {
      if (inControls[i].control === controlFullName) {
        matchedInControl = inControls[i];
        break;
      }
    }
    if (!matchedInControl) return;
    var eventType = matchedInControl.behaviorType;
  
    // Проверяем настроенное условие срабатывания
    // @note: Для "whenChange" продолжаем всегда
    if (eventType === "whenDisabled" && newValue) return;
    if (eventType === "whenEnabled" && !newValue) return;
  
    // Выполняем действия на выходных контролах
    // Не усложняем проверками так как проверили все заранее в инициализации
    for (var j = 0; j < outControls.length; j++) {
      var curCtrlName = outControls[j].control;
      var curUserAction = outControls[j].behaviorType;
      var newCtrlState = false;
  
      newCtrlState = actionsTable[curUserAction].handler(curCtrlName);
      dev[curCtrlName] = newCtrlState;
  
      log("Control " + curCtrlName + " updated to state: " + newCtrlState);
    }
  
    log("Output controls updated for generate 'idPrefix222': " + idPrefix);
  }  

  // Проверка входящей в функцию конфигурации параметров
  checkControls(inControls, outControls);

  defineVirtualDevice("GenVd_" + idPrefix, {
    title: "Generated VD: " + idPrefix,
    cells: {
      enabled: {
        type: "switch",
        value: false
      },
    }
  });

  // Предварительно извлекаем имена контролов
  var inControlNames = [];
  for (var i = 0; i < inControls.length; i++) {
    inControlNames.push(inControls[i].control);
  }

  var generatedRuleName = "GenRule_" + idPrefix;
  defineRule(generatedRuleName, {
             whenChanged: inControlNames,
             then: thenHandler
            });
}

exports.init = function (idPrefix, inControls, outControls) {
  init(idPrefix, inControls, outControls);
};
