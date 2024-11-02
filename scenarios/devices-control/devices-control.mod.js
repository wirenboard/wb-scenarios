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
 *                              "eventType": "whenChange"
 *                            },
 *                            {
 *                              "control": "vd-wall-switch2/enabled",
 *                              "eventType": "whenDisabled"
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
 *                                "actionType": "setDisable",
 *                                "actionValue": 0
 *                              },
 *                              {
 *                                "control": "vd-pump2/enabled",
 *                                "actionType": "setValue",
 *                                "actionValue": 22
 *                              }
 *                            ]
 * @returns {void}
 */
function init(idPrefix, inControls, outControls) {
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

      // Ищем контрол, который вызвал изменение и его тип изменения
      for (var i = 0; i < inControls.length; i++) {
        if (inControls[i].control === controlFullName) {
          matchedInControl = inControls[i];
          break;
        }
      }
      if (!matchedInControl) return;
      var eventType = matchedInControl.eventType;

      // @todo:vg Реализовать нормальную обработку счетчиков
      //          Для этого нужно изменить обработку чтобы
      //          не было инверсии !newValue

      // Проверяем настроенное условие срабатывания
      if (eventType === "onEnabled" && !newValue) return;
      if (eventType === "onDisabled" && newValue) return;
      // Для "onChange" продолжаем всегда

      // Выполняем действия на выходных контролах
      for (var j = 0; j < outControls.length; j++) {
        var curControlName = outControls[j].control;
        var curUserAction = outControls[j].actionType;
        var resAction = false; // По умолчанию - выключаем

        if (curUserAction === 'toggle')
          resAction = !dev[curControlName];
        else if (curUserAction === 'setOn')
          resAction = true;

        dev[curControlName] = resAction;
        log("Control " + curControlName + " updated to state: " + resAction);
      }

      log("Output controls updated for " + idPrefix);
    }
  });
}

exports.init = function (idPrefix, inControls, outControls) {
  init(idPrefix, inControls, outControls);
};
