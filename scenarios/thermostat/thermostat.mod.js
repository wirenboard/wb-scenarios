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

var tm = new TopicManager();
tm.installPlugin(historyPlugin);
tm.installPlugin(eventPlugin);
tm.installPlugin(basicVdPlugin);

/**
 * Инициализирует виртуальное устройство и определяет правило для управления
 * устройством
 * @param {string} deviceTitle Имя виртуального девайса указанный
 *     пользователем
 * @param {string} cfg.idPrefix Префикс сценария, используемый для идентификации
 *     виртуального устройства и правила
 * @param {number} cfg.targetTemp Целевая температура, заданная пользователем
 * @param {number} cfg.hysteresis Значение гистерезиса (диапазон переключения)
 * @param {number} cfg.tempLimitsMin Ограничение установки температуры снизу
 * @param {number} cfg.tempLimitsMax Ограничение установки температуры сверху
 * @param {string} cfg.tempSensor Идентификатор входного отслеживаемого
 *     контрола датчика температуры значение которого следует слушать.
 *     Пример: 'temp_sensor/temp_value'
 * @param {string} cfg.actuator Идентификатор выходного контрола, выход реле
 *     которым следует управлять. Пример: 'relay_module/K2'
 * @returns {boolean} Возвращает true, при успешной инициализации
 *     иначе false
 */
function init(deviceTitle, cfg) {
  var genNames = generateNames(cfg.idPrefix);

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

  vdTargetTempTopic = genNames.vDevice + '/targetTemperature';
  tm.registerSingleEvent(
    vdTargetTempTopic,
    'whenChange',
    cbTargetTempChange
  );

  tm.registerSingleEvent(cfg.actuator, 'whenChange', cbActuatorChange);

  tm.initVirtualDevice(genNames.vDevice, deviceTitle);

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

  // ======================================================
  //                 TM Callback functions
  // ======================================================

  function cbTempCrossUpper(topic, event) {
    var curTemp = topic.val.new;
    dev[cfg.actuator] = false;
    log.debug('Heating turned OFF. Current temperature: ' + curTemp);
    return true;
  }

  function cbTempCrossLower(topic, event) {
    var curTemp = topic.val.new;
    dev[cfg.actuator] = true;
    log.debug('Heating turned ON. Current temperature: ' + curTemp);
    return true;
  }

  function cbTempChange(topic, event) {
    var curTemp = topic.val.new;
    dev[genNames.vDevice + '/currentTemperature'] = curTemp;
    return true;
  }

  function cbTargetTempChange(topic, event) {
    var curTargetTemp = topic.val.new;
    log.debug('Target temperature changed to: ' + curTargetTemp);

    /** Change hysteresis events configuration */
    var tempSensorEvents = tm.registry[cfg.tempSensor].events;
    tempSensorEvents['whenCrossUpper'].cfg.actionValue =
      curTargetTemp + cfg.hysteresis;
    tempSensorEvents['whenCrossLower'].cfg.actionValue =
      curTargetTemp - cfg.hysteresis;

    /** Check the need to change the actuator state  */
    var curTemp = dev[cfg.tempSensor];
    var upperLimit = curTargetTemp + cfg.hysteresis;
    var lowerLimit = curTargetTemp - cfg.hysteresis;
    var curState = dev[cfg.actuator];
    log.debug('curTemp: ' + curTemp);
    log.debug('upperLimit: ' + upperLimit);
    log.debug('lowerLimit: ' + lowerLimit);
    log.debug('curState: ' + curState);

    var isNeedTurnOffHeating = curTemp > upperLimit && curState === true;
    var isNeedTurnOnHeating = curTemp < lowerLimit && curState === false;
    log.debug('isNeedTurnOffHeating: ' + isNeedTurnOffHeating);
    log.debug('isNeedTurnOnHeating: ' + isNeedTurnOnHeating);
    if (isNeedTurnOffHeating) {
      dev[cfg.actuator] = false;
      log.debug('Heating turned OFF. Current temperature: ' + curTemp);
    } else if (isNeedTurnOnHeating) {
      dev[cfg.actuator] = true;
      log.debug('Heating turned ON. Current temperature: ' + curTemp);
    }

    return true;
  }

  function cbActuatorChange(topic, event) {
    var curState = topic.val.new;
    dev[genNames.vDevice + '/actuatorStatus'] = curState;
    return true;
  }
}

exports.init = function (deviceTitle, cfg) {
  var res = init(deviceTitle, cfg);
  return res;
};
