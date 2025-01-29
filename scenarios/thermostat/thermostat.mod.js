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

  function cbFuncCrossUpper(topic, event) {
    var currentTemperature = topic.val.new;
    dev[cfg.actuator] = false;
    log.debug(
      'Heating turned OFF. Current temperature: ' + currentTemperature
    );
    return true;
  }

  function cbFuncCrossLower(topic, event) {
    var currentTemperature = topic.val.new;
    dev[cfg.actuator] = true;
    log.debug(
      'Heating turned ON. Current temperature: ' + currentTemperature
    );
    return true;
  }

  tm.registerSingleEvent(
    cfg.temperatureSensor,
    'whenCrossUpper',
    cbFuncCrossUpper,
    { actionValue: cfg.targetTemperature + cfg.hysteresis }
  );
  tm.registerSingleEvent(
    cfg.temperatureSensor,
    'whenCrossLower',
    cbFuncCrossLower,
    { actionValue: cfg.targetTemperature - cfg.hysteresis }
  );

  tm.initVirtualDevice(genNames.vDevice, deviceTitle);

  tm.initRulesForAllTopics(genNames.rule);

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
}

exports.init = function (deviceTitle, cfg) {
  var res = init(deviceTitle, cfg);
  return res;
};
