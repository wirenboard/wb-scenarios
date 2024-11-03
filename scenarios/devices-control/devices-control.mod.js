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
 * хранить их в одной таблице:
 *   - Тип события/действия
 *   - Разрешенные типы топиков
 *   - Обработчик
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
  const newState = !dev[controlName];
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
    requiredTypes: ['switch'],
    handler: toggle
  },
  'setEnable': {
    requiredTypes: ['switch'],
    handler: setEnable
  },
  'setDisable': {
    requiredTypes: ['switch'],
    handler: setDisable
  }
};

var eventsTable = {
  'whenChange': {
    requiredTypes: ['switch'],
    handler: whenChange
  },
  'whenDisabled': {
    requiredTypes: ['switch'],
    handler: whenDisabled
  },
  'whenEnabled': {
    requiredTypes: ['switch'],
    handler: whenEnabled
  }
};


/**
 * Проверяет соответствие типов контролов и событий/действий
 * В случае несоответствия типа контролов, логирует ошибку и прерывает выполнение.
 *
 * @param {Array<Object>} inControls - Массив конфигураций входных контролов.
 * @param {Array<Object>} outControls - Массив конфигураций выходных контролов.
 * @returns {void}
 */
function checkControls(inControls, outControls) {
  log("Input Controls conf: " + JSON.stringify(inControls));
  log("Output Controls conf: " + JSON.stringify(outControls));

  // @todo:vg Добавить проверку существования указанных контролов перед работой
  // @todo:vg Реализовать нормальную обработку счетчиков
  //          Для этого нужно изменить обработку входных параметров

  // Проверка входных контролов
  var isAllInputsSwitchTypes = true;
  for (var i = 0; i < inControls.length; i++) {
    var curInControl = inControls[i].control;
    var inputType = dev[curInControl + "#type"];
    log("Input control: " + curInControl + " | Type: " + inputType);

    if (inputType !== "switch") {
      isAllInputsSwitchTypes = false;
      log("Error: Input control '" + curInControl + "' is not of type 'switch'");
      break;
    }
  }

  var isAllOutputsSwitchTypes = true;
  for (var j = 0; j < outControls.length; j++) {
    var curOutControl = outControls[j].control;
    var outputType = dev[curOutControl + "#type"];
    log("Output control: " + curOutControl + " | Type: " + outputType);

    if (outputType !== "switch") {
      isAllOutputsSwitchTypes = false;
      log("Error: Output control '" + curOutControl + "' is not of type 'switch'");
      break;
    }
  }

  var isValidTypes = (isAllInputsSwitchTypes && isAllOutputsSwitchTypes);
  if (!isValidTypes) {
    log("Error: One or more controls are not of type 'switch'. Operation aborted!");
    return;
  }
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
  // Проверка входящих в функцию параметров
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

  defineRule("GenRule_" + idPrefix, {
    whenChanged: inControlNames,
    then: function (newValue, devName, cellName) {
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

      // @todo:vg Реализовать нормальную обработку счетчиков
      //          Для этого нужно изменить обработку чтобы
      //          не было инверсии !newValue

      // Проверяем настроенное условие срабатывания
      // @note: Для "whenChange" продолжаем всегда
      if (eventType === "whenDisabled" && newValue) return;
      if (eventType === "whenEnabled" && !newValue) return;

      // Выполняем действия на выходных контролах
      // Не усложняем проверками так как проверили все заранее в инициализации
      for (var j = 0; j < outControls.length; j++) {
        var curControlName = outControls[j].control;
        var curUserAction = outControls[j].behaviorType;
        var newControlState = false;

        newControlState = actionsTable[curUserAction].handler(curControlName);
        dev[curControlName] = newControlState;

        log("Control " + curControlName + " updated to state: " + newControlState);
      }

      log("Output controls updated for Prefix:" + idPrefix);
    }
  });
}

exports.init = function (idPrefix, inControls, outControls) {
  init(idPrefix, inControls, outControls);
};
