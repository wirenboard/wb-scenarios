/**
 * @file thermostat.mod.js
 * @description Module for initializing the thermostat algorithm
 *     based on user-specified parameters
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Comments formatted in JSDoc <https://jsdoc.app/> - Google styleguide
 */

var helpers = require('scenarios-general-helpers.mod');
var Logger = require('logger.mod').Logger;

var loggerFileLabel = 'WBSC-thermostat-mod'
var log = new Logger(loggerFileLabel);

/**
 * @typedef {Object} ThermostatConfig
 * @property {string} [idPrefix] Optional prefix for the name to identify
 *     the virtual device and rule:
 *     - If specified, the virtual device and rule will be named
 *       `wbsc_<!idPrefix!>` and `wbru_<!idPrefix!>`
 *     - If not specified (undefined), the name will be generated
 *       by transliterating the name passed to `init()`
 * @property {number} targetTemp Target temperature set by the user
 * @property {number} hysteresis Hysteresis value (switching range)
 * @property {number} tempLimitsMin Lower limit for temperature setting
 * @property {number} tempLimitsMax Upper limit for temperature setting
 * @property {string} tempSensor Name of the input control topic - monitored
 *     Example: temperature sensor whose value should be tracked
 *     'temp_sensor/temp_value'
 * @property {string} actuator Name of the output control topic - controlled
 *     Example: relay output to be controlled - 'relay_module/K2'
 */

/**
 * Validate the configuration parameters
 * @param {ThermostatConfig} cfg Configuration parameters
 * @returns {boolean} Validation status:
 *     - true: if the parameters are valid
 *     - false: if there is an error
 */
function isConfigValid(cfg) {
  var res = false;

  var isLimitsCorrect = cfg.tempLimitsMin <= cfg.tempLimitsMax;
  if (isLimitsCorrect !== true) {
    log.error(
      'Config temperature limit "Min" = {} must be less than "Max" = {}'
    );
  }

  var isTargetTempCorrect =
    cfg.targetTemp >= cfg.tempLimitsMin &&
    cfg.targetTemp <= cfg.tempLimitsMax;
  if (isTargetTempCorrect !== true) {
    log.error(
      'Target temperature "{}" must be in the range from "Min" to "Max"',
      cfg.targetTemp
    );
  }

  var tempSensorType = dev[cfg.tempSensor + '#type'];
  var actuatorType = dev[cfg.actuator + '#type'];
  var isTypesCorrect =
    (tempSensorType === 'value' || tempSensorType === 'temperature') &&
    actuatorType === 'switch';
  if (isTypesCorrect !== true) {
    log.error(
      'Sensor/actuator topic types must be "value","temperature"/"switch".' +
        ' But actual:"' +
        tempSensorType +
        '"/"' +
        actuatorType +
        '"'
    );
  }

  var isCfgValidated =
    isLimitsCorrect && isTargetTempCorrect && isTypesCorrect;
  if (isCfgValidated) res = true;

  return res;
}

/**
 * Generates the names to be used
 * @param {string} idPrefix Prefix for identifying this algorithm
 *     For example: 'warm_floor_in_bathroom'
 * @returns {Object} An object with names: { vDevice, rule }
 */
function generateNames(idPrefix) {
  var delimeter = '_';
  var scenarioPrefix = 'wbsc' + delimeter;

  var generatedNames = {
    vDevice: scenarioPrefix + idPrefix,
    rule: scenarioPrefix + idPrefix,
  };

  return generatedNames;
}

/**
 * Initializes a virtual device and defines a rule
 * for controlling the device
 * @param {string} deviceTitle Name of the virtual device
 * @param {ThermostatConfig} cfg Configuration parameters
 * @returns {boolean} Returns true if initialization is successful, otherwise false
 */
function init(deviceTitle, cfg) {
  var idPrefix = helpers.getIdPrefix(deviceTitle, cfg);
  log.setLabel(loggerFileLabel + '/' + idPrefix);
  var genNames = generateNames(idPrefix);

  // Create a minimal base virtual device to indicate errors if they occur
  /**
   * TODO: 1.
   * createBasicVD(genNames.vDevice, deviceTitle);
   */
  log.debug('genNames.vDevice = "{}"', genNames.vDevice);
  // При названии сценария 'Теплый пол в комнате' выведется 'wbsc_teplyy_pol_v_komnate'

  if (isConfigValid(cfg) !== true) {
    return false;
  }

  // TODO: 2. Create rules for events
  log.debug('genNames.rule = "{}"', genNames.rule);
  // При названии сценария 'Теплый пол в комнате' выведется 'wbsc_teplyy_pol_v_komnate'

  // TODO: 3. Add cells to VD

  return true;
}

exports.init = function (deviceTitle, cfg) {
  var res = init(deviceTitle, cfg);
  return res;
};
