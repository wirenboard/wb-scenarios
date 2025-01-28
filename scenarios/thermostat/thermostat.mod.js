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
 * @param {string} cfg.idPrefix Префикс сценария, используемый для идентификации
 *     виртуального устройства и правила
 * @param {number} cfg.targetTemperature Целевая температура, заданная пользователем
 * @param {number} cfg.hysteresis Значение гистерезиса (диапазон переключения)
 * @param {string} cfg.temperatureSensor Идентификатор входного отслеживаемого
 *     контрола датчика температуры значение которого следует слушать.
 *     Пример: 'temp_sensor/temp_value'
 * @param {string} cfg.actuator Идентификатор выходного контрола, выход реле
 *     которым следует управлять. Пример: 'relay_module/K2'
 * @returns {boolean} Возвращает true, при успешной инициализации
 *     иначе false
 */
function init(deviceTitle, cfg) {
  // @todo: Проверка входящей в функцию конфигурации параметров
  log.debug('cfg.temperatureSensor: "' + cfg.temperatureSensor + '"');
  log.debug('cfg.actuator: "' + cfg.actuator + '"');

  var genNames = generateNames(cfg.idPrefix);

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
    whenChanged: [cfg.temperatureSensor],
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

  function generateNames(prefix) {
    var delimeter = '_';
    var scenarioPrefix = 'wbsc' + delimeter;
    var rulePrefix = 'wbru' + delimeter;

    var generatedNames = {
      vDevice: scenarioPrefix + prefix,
      rule: rulePrefix + prefix,
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
    var heatingState = dev[cfg.actuator];

    if (heatingState) {
      // Если нагреватель включен, проверяем, не нужно ли выключить его
      if (currentTemperature >= cfg.targetTemperature + cfg.hysteresis) {
        dev[cfg.actuator] = false;
        log.debug(
          'Heating turned OFF. Current temperature: ' + currentTemperature
        );
      }
    } else {
      // Если нагреватель выключен, проверяем, не нужно ли включить его
      if (currentTemperature <= cfg.targetTemperature - cfg.hysteresis) {
        dev[cfg.actuator] = true;
        log.debug(
          'Heating turned ON. Current temperature: ' + currentTemperature
        );
      }
    }
  }
}

exports.init = function (deviceTitle, cfg) {
  var res = init(deviceTitle, cfg);
  return res;
};
