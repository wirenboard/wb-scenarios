/**
 * @file Модуль содержащий фукнции используемые для создания виртуальных
 *       устройств и их модификации
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

/**
 * Добавляет RO (read-only) связанный контрол к виртуальному девайсу.
 * Используется для отображения статуса других датчиков в списке виртуального устройства.
 *
 * @param {Object} srcMqttControl - Строка MQTT control ("deviceName/cellName")
 * @param {Object} vDevObj - Объект виртуального девайса (как результат defineVirtualDevice)
 * @param {string} cellBaseName - Название базовой ячейки (например "motion_sensor_0")
 * @param {string} cellType - Тип ячейки (например "value")
 * @param {string} titlePrefix - Префикс для заголовка (например "Motion:" или "Opening:")
 * @returns {boolean} Возвращает true если все ок
 */
function addLinkedControlRO(srcMqttControl,
                            vDevObj,
                            vDevName,
                            cellBaseName,
                            cellType,
                            titlePrefix) {
  var cellTitle = titlePrefix + " " + srcMqttControl;
  vDevObj.addControl(cellBaseName, {
    title: cellTitle,
    type: cellType,
    readonly: true,
    value: dev[srcMqttControl]
  });

  // Синхронизируем состояния устройства источника и создаваемого показометра
  defineRule({
    whenChanged: srcMqttControl,
    then: function (newValue, devName, cellName) {
      // log.debug("srcMqttControl '" + srcMqttControl + "' changed to: " + newValue);
      dev[vDevName + "/" + cellBaseName] = newValue;
    }
  });

  return true;
}

exports.addLinkedControlRO = function (srcMqttControl,
                                       vDevObj,
                                       vDevName,
                                       cellBaseName,
                                       cellType,
                                       titlePrefix) {
  var res = addLinkedControlRO(srcMqttControl,
                               vDevObj,
                               vDevName,
                               cellBaseName,
                               cellType,
                               titlePrefix);
  return res;
};