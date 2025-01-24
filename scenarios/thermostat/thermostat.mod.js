/**
 * @file thermostat.mod.js
 * @description Модуль для инициализации алгоритма термостата (thermostat)
 *     на основе указанных пользователем параметров
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

/**
 * Инициализирует виртуальное устройство и определяет правило для управления
 * устройством
 * @param {string} deviceTitle Имя виртуального девайса указанный
 *     пользователем
 * @param {string} idPrefix Префикс сценария, используемый для идентификации
 *     виртуального устройства и правила
 * @param {number} targetTemperature Целевая температура, заданная пользователем
 * @param {number} hysteresis Значение гистерезиса (диапазон переключения)
 * @param {string} temperatureSensor Идентификатор входного отслеживаемого
 *     контрола датчика температуры значение которого следует слушать.
 *     Пример: 'temp_sensor/temp_value'
 * @param {string} actuator Идентификатор выходного контрола, выход реле
 *     которым следует управлять. Пример: 'relay_module/K2'
 * @returns {boolean} Возвращает true, при успешной инициализации
 *     иначе false
 */
function init(
  deviceTitle,
  idPrefix,
  targetTemperature,
  hysteresis,
  temperatureSensor,
  actuator
) {
  // @todo: Проверка входящей в функцию конфигурации параметров
  log.debug('temperatureSensor: "' + temperatureSensor + '"');
  log.debug('actuator: "' + actuator + '"');

  var genNames = generateNames(idPrefix);

  var vdev = defineVirtualDevice(genNames.vDevice, {
    title: deviceTitle,
    cells: {
      ruleEnabled: {
        title: {
          en: 'Enable rule',
          ru: 'Включить правило',
        },
        type: 'switch',
        value: true,
        order: 1,
      },
    },
  });
  if (!vdev) {
    log.debug('Error: Virtual device "' + deviceTitle + '" not created.');
    return false;
  }
  log.debug('Virtual device "' + deviceTitle + '" created successfully');

  var ruleIdNum = defineRule(genNames.rule, {
    whenChanged: [temperatureSensor],
    then: thenHandler,
  });
  if (!ruleIdNum) {
    log.debug('Error: WB-rule "' + genNames.rule + '" not created.');
    return false;
  }
  log.debug('WB-rule with IdNum "' + ruleIdNum + '" created successfully');
  return true;

  // ======================================================
  //                  Определения функций
  // ======================================================

  function generateNames(idPrefix) {
    var delimeter = '_';
    var scenarioPrefix = 'wbsc' + delimeter;
    var rulePrefix = 'wbru' + delimeter;

    var generatedNames = {
      vDevice: scenarioPrefix + idPrefix,
      rule: rulePrefix + idPrefix,
    };

    return generatedNames;
  }

  function thenHandler(newValue, devName, cellName) {
    var isActive = dev[genNames.vDevice + '/ruleEnabled'];
    if (!isActive) {
      // OK: Сценарий с корректным конфигом, но выключен внутри virtual device
      return true;
    }
    log.debug('WB-rule "' + genNames.rule + '" action handler started');

    var currentTemperature = newValue;
    var heatingState = dev[actuator];

    if (heatingState) {
      // Если нагреватель включен, проверяем, не нужно ли выключить его
      if (currentTemperature >= targetTemperature + hysteresis) {
        dev[actuator] = false;
        log.debug(
          'Heating turned OFF. Current temperature: ' + currentTemperature
        );
      }
    } else {
      // Если нагреватель выключен, проверяем, не нужно ли включить его
      if (currentTemperature <= targetTemperature - hysteresis) {
        dev[actuator] = true;
        log.debug(
          'Heating turned ON. Current temperature: ' + currentTemperature
        );
      }
    }
  }
}

exports.init = function (
  deviceTitle,
  idPrefix,
  targetTemperature,
  hysteresis,
  temperatureSensor,
  actuator
) {
  var res = init(
    deviceTitle,
    idPrefix,
    targetTemperature,
    hysteresis,
    temperatureSensor,
    actuator
  );
  return res;
};
