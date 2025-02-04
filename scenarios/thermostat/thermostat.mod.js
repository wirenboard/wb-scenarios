/**
 * @file thermostat.mod.js
 * @description Модуль для инициализации алгоритма термостата (thermostat)
 *     на основе указанных пользователем параметров
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

var TopicManager = require('tm-main.mod').TopicManager;
var eventPlugin = require('tm-event-main.mod').eventPlugin;
var historyPlugin = require('tm-history-main.mod').historyPlugin;
var basicVdPlugin = require('tm-basicvd-main.mod').basicVdPlugin;
var transliterate = require('transliterate.mod').transliterate;

var tm = new TopicManager();
tm.installPlugin(historyPlugin);
tm.installPlugin(eventPlugin);
tm.installPlugin(basicVdPlugin);

/**
 * @typedef {Object} ThermostatConfig
 * @property {string} idPrefix Не обязательный префикс к имени для
 *     идентификации виртуального устройства и правила:
 *     - Если параметр указан, то ВУ и правило будут иметь имя вида
 *       `wbsc_<!idPrefix!>` и `wbru_<!idPrefix!>`
 *     - Если не указан (undefined), то правая часть создается методом
 *       транслитерации из имени переданного в `init()`
 * @property {number} targetTemp Целевая температура, заданная пользователем
 * @property {number} hysteresis Значение гистерезиса (диапазон переключения)
 * @property {number} tempLimitsMin Ограничение установки температуры снизу
 * @property {number} tempLimitsMax Ограничение установки температуры сверху
 * @property {string} tempSensor Имя топика входного контрола - отслеживаемый
 *     Пример: датчик температуры значение которого следует слушать
 *     'temp_sensor/temp_value'
 * @property {string} actuator Имя топика выходного контрола - управляемый
 *     Пример: выход реле которым следует управлять - 'relay_module/K2'
 */

/**
 * Проверяет параметры конфигурации на корректность
 * @param {ThermostatConfig} cfg Параметры конфигурации
 * @returns {boolean} Статус проверки параметров:
 *     - true: если параметры корректны
 *     - false: если есть ошибка
 */
function validateConfig(cfg) {
  var res = true;

  var isLimitsCorrect = cfg.tempLimitsMin <= cfg.tempLimitsMax;
  if (isLimitsCorrect !== true) {
    tm.vd.setTotalError(
      'Config temperature limit "Min" must be less than "Max"'
    );
    res = false;
  }

  var isTargetTempCorrect =
    cfg.targetTemp >= cfg.tempLimitsMin &&
    cfg.targetTemp <= cfg.tempLimitsMax;
  if (isTargetTempCorrect !== true) {
    tm.vd.setTotalError(
      'Target temperature must be in the range from "Min" to "Max"'
    );
    res = false;
  }

  var tempSensorType = dev[cfg.tempSensor + '#type'];
  var actuatorType = dev[cfg.actuator + '#type'];
  var isTypesCorrect =
    (tempSensorType === 'value' || tempSensorType === 'temperature') &&
    actuatorType === 'switch';
  if (isTypesCorrect !== true) {
    tm.vd.setTotalError(
      'Sensor/actuator topic types must be "value","temperature"/"switch".' +
        ' But actual:"' +
        tempSensorType +
        '"/"' +
        actuatorType +
        '"'
    );
    res = false;
  }

  return res;
}

/**
 * Инициализирует виртуальное устройство и определяет правило
 * для управления устройством
 * @param {string} deviceTitle Имя виртуального девайса
 * @param {ThermostatConfig} cfg Параметры конфигурации
 * @returns {boolean} Возвращает true, при успешной инициализации иначе false
 */
function init(deviceTitle, cfg) {
  /** Check if 'idPrefix' exists and is not empty */
  var idPrefix = '';
  var idPrefixProvided = cfg.idPrefix && cfg.idPrefix.trim() !== '';
  if (idPrefixProvided === true) {
    idPrefix = cfg.idPrefix;
  } else {
    idPrefix = transliterate(deviceTitle);
  }

  var genNames = generateNames(idPrefix);
  tm.createBasicVD(genNames.vDevice, deviceTitle);
  var isConfigValid = validateConfig(cfg);
  if (isConfigValid !== true) {
    return false;
  }

  tm.registerSingleEvent(cfg.tempSensor, 'whenChange', cbTempChange);

  tm.registerSingleEvent(
    cfg.tempSensor,
    'whenCrossUpper',
    cbTempCrossUpper,
    { actionValue: cfg.targetTemp + cfg.hysteresis }
  );
  tm.registerSingleEvent(
    cfg.tempSensor,
    'whenCrossLower',
    cbTempCrossLower,
    { actionValue: cfg.targetTemp - cfg.hysteresis }
  );

  var vdTargetTempTopic = genNames.vDevice + '/targetTemperature';
  tm.registerSingleEvent(
    vdTargetTempTopic,
    'whenChange',
    cbTargetTempChange
  );
  tm.registerSingleEvent(cfg.actuator, 'whenChange', cbActuatorChange);

  /** Create two service events for working after general rules disabled */
  var vdRuleStatusTopic = genNames.vDevice + '/ruleEnabled';
  tm.registerSingleEvent(vdRuleStatusTopic, 'whenEnabled', cbRuleEnabled, {
    mode: tm.MODES.SERVICE,
  });
  tm.registerSingleEvent(vdRuleStatusTopic, 'whenDisabled', cbRuleDisabled, {
    mode: tm.MODES.SERVICE,
  });

  tm.vd.addCell('targetTemperature', {
    title: {
      en: 'Temperature Setpoint',
      ru: 'Заданная температура',
    },
    type: 'range',
    value: cfg.targetTemp,
    min: cfg.tempLimitsMin,
    max: cfg.tempLimitsMax,
    order: 2,
  });

  var curTemp = dev[cfg.tempSensor];
  tm.vd.addCell('currentTemperature', {
    title: {
      en: 'Current Temperature',
      ru: 'Текущая температура',
    },
    type: 'value',
    units: 'deg C',
    value: curTemp,
    order: 3,
    readonly: true,
  });

  tm.vd.addCell('actuatorStatus', {
    title: {
      en: 'Heating Status',
      ru: 'Статус нагрева',
    },
    type: dev[cfg.actuator + '#type'],
    value: dev[cfg.actuator],
    order: 4,
    readonly: true,
  });

  tm.initRulesForAllTopics(genNames.rule);

  return true;

  // ======================================================
  //                    Local functions
  // ======================================================

  /**
   * Генерация имен
   * @param {string} prefix Префикс
   * @returns {Object} Объект с именами: { vDevice, rule }
   */
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

  /**
   * @typedef {Object} HeatingStateData
   * @property {number} curTemp - Текущая температура.
   * @property {number} targetTemp - Целевая температура.
   * @property {number} hysteresis - Значение гистерезиса.
   */

  /**
   * Обновление состояния нагрева, вычисляя новое состояние на основе
   * текущей температуры, целевой температуры и гистерезиса,
   * и устанавливает его, если оно изменилось
   * @param {string} actuator Идентификатор актуатора (ключ в объекте dev)
   * @param {HeatingStateData} data Объект с полями: curTemp, targetTemp, hysteresis
   * @returns {boolean} Новое состояние актуатора
   */
  function updateHeatingState(actuator, data) {
    var currentState = dev[actuator];
    var upperLimit = data.targetTemp + data.hysteresis;
    var lowerLimit = data.targetTemp - data.hysteresis;

    var isNeedTurnOffHeating =
      data.curTemp > upperLimit && currentState === true;
    var isNeedTurnOnHeating =
      data.curTemp < lowerLimit && currentState === false;

    var resultState = currentState;
    if (isNeedTurnOnHeating) {
      resultState = true;
    } else if (isNeedTurnOffHeating) {
      resultState = false;
    }

    if (resultState !== currentState) {
      dev[actuator] = resultState;
    }

    return resultState;
  }

  // ======================================================
  //                 TM Callback functions
  // ======================================================

  function cbTempCrossUpper(topic, event) {
    var curTemp = topic.val.new;
    dev[cfg.actuator] = false;
    return true;
  }

  function cbTempCrossLower(topic, event) {
    var curTemp = topic.val.new;
    dev[cfg.actuator] = true;
    return true;
  }

  function cbTempChange(topic, event) {
    var curTemp = topic.val.new;
    dev[genNames.vDevice + '/currentTemperature'] = curTemp;
    return true;
  }

  function cbTargetTempChange(topic, event) {
    var curTargetTemp = topic.val.new;

    /** Change hysteresis events configuration */
    var tempSensorEvents = tm.topics[cfg.tempSensor].events;
    tempSensorEvents['whenCrossUpper'].cfg.actionValue =
      curTargetTemp + cfg.hysteresis;
    tempSensorEvents['whenCrossLower'].cfg.actionValue =
      curTargetTemp - cfg.hysteresis;

    /** Check the need to change the actuator state  */
    var curTemp = dev[cfg.tempSensor];
    var data = {
      curTemp: curTemp,
      targetTemp: curTargetTemp,
      hysteresis: cfg.hysteresis,
    };
    updateHeatingState(cfg.actuator, data);
    return true;
  }

  function cbActuatorChange(topic, event) {
    var curState = topic.val.new;
    dev[genNames.vDevice + '/actuatorStatus'] = curState;
    return true;
  }

  function cbRuleEnabled(topic, event) {
    var curTemp = dev[cfg.tempSensor];
    var vdTargetTempTopic = genNames.vDevice + '/targetTemperature';
    var curTargetTemp = dev[vdTargetTempTopic];
    var data = {
      curTemp: curTemp,
      targetTemp: curTargetTemp,
      hysteresis: cfg.hysteresis,
    };
    updateHeatingState(cfg.actuator, data);
    /* Sync actual device status with VD **/
    dev[genNames.vDevice + '/currentTemperature'] = dev[cfg.tempSensor];
    return true;
  }

  function cbRuleDisabled(topic, event) {
    dev[cfg.actuator] = false;
    dev[genNames.vDevice + '/actuatorStatus'] = false;
    return true;
  }
}

exports.init = function (deviceTitle, cfg) {
  var res = init(deviceTitle, cfg);
  return res;
};
