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
                            titlePrefix) {
  var cellTitle = titlePrefix + " " + srcMqttControl;
  var srcControlType = dev[srcMqttControl + "#type"];
  vDevObj.addControl(cellBaseName, {
    title: cellTitle,
    type: srcControlType,
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

/**
 * Добавляет RO (read-only) контрол типа текст.
 * Используется для отделения групп топиков в виртуальном девайсе.
 */

function addGroupTitleRO(vDevObj,
                         vDevName,
                         cellBaseName,
                         cellTitleRu,
                         cellTitleEn) {
  vDevObj.addControl(cellBaseName, {
                     title: {
                       en: ">  " + cellTitleEn + ":",
                       ru: ">  " + cellTitleRu + ":"
                     },
                     type: "text",
                     readonly: true,
                     value: ""});

  return true;
}

function addAlarm(vDevObj,
                  cellBaseName,
                  cellTitleRu,
                  cellTitleEn) {
  vDevObj.addControl(cellBaseName, {
                        title: {
                          en: cellTitleEn,
                          ru: cellTitleRu
                        },
                        type: "alarm",
                        readonly: true,
                        value: true});

  return true;
}

exports.addLinkedControlRO = function (srcMqttControl,
                                       vDevObj,
                                       vDevName,
                                       cellBaseName,
                                       titlePrefix) {
  var res = addLinkedControlRO(srcMqttControl,
                               vDevObj,
                               vDevName,
                               cellBaseName,
                               titlePrefix);
  return res;
};

exports.addGroupTitleRO = function (vDevObj,
                                    vDevName,
                                    cellBaseName,
                                    cellTitleRu,
                                    cellTitleEn) {
  var res = addGroupTitleRO(vDevObj,
                            vDevName,
                            cellBaseName,
                            cellTitleRu,
                            cellTitleEn);
  return res;
};

exports.addAlarm = function (vDevObj,
                             cellBaseName,
                             cellTitleRu,
                             cellTitleEn) {
  var res = addAlarm(vDevObj,
                     cellBaseName,
                     cellTitleRu,
                     cellTitleEn);
  return res;
};
