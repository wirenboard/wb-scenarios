/**
 * @file Модуль для инициализации прямой или инвертированной связи
 *       между двумя switch топиками MQTT
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

/**
 * Инициализирует виртуальное устройство и определяет правило для управления
 * устройством
 * @param {string} idPrefix - Префикс сценария, используемое для
 *                                идентификации виртуального устройства
 * @param {string} inControl - Идентификатор входного контроля, значение
 *                                которого следует слушать
 *                                Пример: "vd_wall_switch/enabled"
 * @param {string} outControl - Идентификатор выходного контроля, значение
 *                                 которого следует контролировать
 *                                 Пример: "vd_pump/enabled"
 * @param {boolean} inverseLink - Указывает, должна ли связь быть
 *                                инвертированной
 */
function init(idPrefix, inControl, outControl, inverseLink) {
  device = defineVirtualDevice("GenVd_" + idPrefix, {
    title: "Generated VD: " + idPrefix, 
    cells: {
      enabled: {
        type: "switch",
        value: false
      },
    } 
  });

  defineRule("GenRule_" + idPrefix, {
    whenChanged: inControl,
    then: function (newValue, devName, cellName) {
      // Проверка инверсии и присваивание значения в зависимости от него
      if (inverseLink) {
        dev[outControl] = !newValue; // Инвертирование значения
      } else {
        dev[outControl] = newValue; // Прямое присваивание значения
      }
    }
  });
};

exports.init = function (idPrefix, inControl, outControl, inverseLink) {
  init(idPrefix, inControl, outControl, inverseLink);
};
