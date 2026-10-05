/**
 * @file virtual-device-helpers.mod.js - ES5 module for wb-rules v2.47
 * @description Module containing functions used for creating virtual devices
 *   and their modification
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 */

var scenarioPersistentStorage =
  require('wbsc-persistent-storage.mod').getInstance();

/**
 * Scenario state enum - defines all possible scenario states
 * Used for setting and checking scenario state in the virtual device
 * @enum {number}
 */
var ScenarioState = {
  CREATED: 0,
  INIT_STARTED: 1,
  WAITING_CONTROLS: 2,
  LINKED_CONTROLS_READY: 3,
  CONFIG_INVALID: 4,
  LINKED_CONTROLS_TIMEOUT: 5,
  ACTIVE: 6,
  USED_CONTROL_ERROR: 7,
  WAITING: 8,
  DISABLED: 9,
};

/**
 * Проверяет, существует ли контрол
 *
 * @param {string} controlName - Имя контрола ('deviceName/cellName')
 * @returns {boolean} Возвращает true, если контрол существует, иначе false
 */
function isControlExists(controlName) {
  var isExist = dev[controlName] !== null;
  if (!isExist) {
    log.error(
      'Control "' +
        controlName +
        '" not found, ' +
        'return value: ' +
        dev[controlName]
    );
    return false;
  }
  return true;
}

/**
 * Добавляет RO (read-only) связанный контрол к виртуальному девайсу.
 * Используется для отображения статуса других датчиков в списке виртуального устройства.
 *
 * @param {string} srcMqttControl - Строка MQTT control ('deviceName/cellName')
 * @param {Object} vDevObj - Объект виртуального девайса (как результат defineVirtualDevice)
 * @param {string} vDevName - Имя виртуального девайса (используется в имени правила и топика)
 * @param {string} cellBaseName - Название базовой ячейки (например 'motion_sensor_0')
 * @param {string} titlePrefix - Префикс для заголовка (например 'Motion:' или 'Opening:')
 * @returns {boolean} Возвращает true если все ок
 */
function addLinkedControlRO(
  srcMqttControl,
  vDevObj,
  vDevName,
  cellBaseName,
  titlePrefix
) {
  if (!isControlExists(srcMqttControl)) return false;
  var cellTitle = titlePrefix + ' ' + srcMqttControl;
  var srcControlType = dev[srcMqttControl + '#type'];

  vDevObj.addControl(cellBaseName, {
    title: cellTitle, // Титл автогенерируемый из имени топика, поэтому без RU
    type: srcControlType,
    readonly: true,
    value: dev[srcMqttControl],
  });

  // Синхронизируем состояния устройства источника и создаваемого показометра
  var ruleName = vDevName + '_' + cellBaseName;

  try {
    defineRule(ruleName, {
      whenChanged: srcMqttControl,
      then: function (newValue, devName, cellName) {
        dev[vDevName + '/' + cellBaseName] = newValue;
      },
    });
    return true;
  } catch (error) {
    log.error('Error in addLinkedControlRO:', error.message);
    return false;
  }
}

/**
 * Добавляет RO (read-only) контрол типа текст.
 * Используется для отделения групп топиков в виртуальном девайсе.
 */

function addGroupTitleRO(
  vDevObj,
  vDevName,
  cellBaseName,
  cellTitleRu,
  cellTitleEn
) {
  vDevObj.addControl(cellBaseName, {
    title: {
      en: cellTitleEn,
      ru: cellTitleRu,
    },
    type: 'text',
    readonly: true,
    value: '',
  });

  return true;
}

function addAlarm(vDevObj, cellBaseName, cellTitleRu, cellTitleEn) {
  vDevObj.addControl(cellBaseName, {
    title: {
      en: cellTitleEn,
      ru: cellTitleRu,
    },
    type: 'alarm',
    readonly: true,
    value: true,
  });

  return true;
}

/**
 * Toggles rules based on the provided value
 * @param {Array<RuleId>} managedRulesId Array of rule IDs to toggle
 * @param {boolean} newValue Whether to enable or disable rules
 */
function toggleRules(managedRulesId, newValue) {
  for (var i = 0; i < managedRulesId.length; i++) {
    if (newValue) {
      enableRule(managedRulesId[i]);
    } else {
      disableRule(managedRulesId[i]);
    }
  }
}

/**
 * Sets an error on a virtual device in three steps:
 *   - Logs the error message
 *   - Sets an error on each control to turn the entire device red
 * @param {Object} vdObj The virtual device object
 * @param {string} errorMsg The error message to log
 */
function setVdTotalError(vdObj, errorMsg) {
  if (vdObj === undefined) {
    log.error('Virtual device does not exist in the system');
    return;
  }
  log.error(errorMsg);
  vdObj.controlsList().forEach(function (ctrl) {
    /**
     * The error type can be 'r', 'w', or 'p'
     * Our goal is to highlight the control in red
     */
    ctrl.setError('r');
  });
}

/**
 * Describes controls of an external device as cells for defineVirtualDevice
 * @param {Object} devObj External device object
 * @returns {Object} Cells with the same names, types, values and limits
 */
function describeLeftoverCells(devObj) {
  var cells = {};
  devObj.controlsList().forEach(function describeOne(ctrl) {
    var type = ctrl.getType() || 'value';
    var cell = { type: type };
    if (type !== 'pushbutton') {
      try {
        cell.value = ctrl.getValue();
      } catch (err) {
        cell.value = type === 'switch' || type === 'alarm' ? false : 0;
      }
    }
    // Unset limits are reported as +-Number.MAX_VALUE
    if (Math.abs(ctrl.getMin()) < Number.MAX_VALUE) {
      cell.min = ctrl.getMin();
    }
    if (Math.abs(ctrl.getMax()) < Number.MAX_VALUE) {
      cell.max = ctrl.getMax();
    }
    cells[ctrl.getId()] = cell;
  });
  return cells;
}

/**
 * Removes a device left in the broker by a previous wb-rules session
 * @param {Object} devObj Device object from getDevice() or getDevicesList()
 * @returns {boolean} True if the device was a leftover and is removed
 */
function removeLeftoverVd(devObj) {
  var vdName = devObj.getId();
  var erroredIds;

  try {
    if (devObj.isVirtual()) {
      return false;
    }
    var driverId = devObj.getDriverId();
    if (driverId !== 'wb-rules' && driverId !== '') {
      return false;
    }
    erroredIds = devObj
      .controlsList()
      .filter(function hasError(ctrl) {
        return !!ctrl.getError();
      })
      .map(function getId(ctrl) {
        return ctrl.getId();
      });

    // Controls missing from the cells are dropped with their topics kept
    defineVirtualDevice(vdName, {
      title: vdName,
      cells: describeLeftoverCells(devObj),
    });
    removeVirtualDevice(vdName);
  } catch (err) {
    log.error(
      'Leftover device "{}" not removed: {}',
      vdName,
      err.message || err
    );
    return false;
  }

  // Driver removal keeps the legacy meta/error topic
  erroredIds.forEach(function clearError(ctrlId) {
    publish(
      '/devices/' + vdName + '/controls/' + ctrlId + '/meta/error',
      '',
      2,
      true
    );
  });

  log.info('Leftover device "{}" removed', vdName);
  return true;
}

/**
 * Creates a basic virtual device with a rule switch, removing a leftover one
 * @param {string} idPrefix Scenario ID prefix
 * @param {string} vdName The name of the virtual device
 * @param {string} vdTitle The title of the virtual device
 * @param {Array<RuleId>} managedRulesId Array of rule IDs to toggle on switch
 * @returns {Object|null} The virtual device object if created, otherwise null
 */
function createBasicVd(idPrefix, vdName, vdTitle, managedRulesId) {
  var ctrlRuleEnabled = 'rule_enabled';
  var ctrlInitStatus = 'state';

  var existingVdObj = getDevice(vdName);
  if (existingVdObj !== undefined && !removeLeftoverVd(existingVdObj)) {
    log.error(
      'Virtual device "{}" for scenario "{}" not created: the name is ' +
        'taken by {} device of driver "{}"',
      vdName,
      vdTitle,
      existingVdObj.isVirtual() ? 'a virtual' : 'an external',
      existingVdObj.getDriverId()
    );
    return null;
  }

  var vdCfg = {
    title: vdTitle,
    cells: {},
  };
  var vdObj = defineVirtualDevice(vdName, vdCfg);
  if (!vdObj) {
    log.error('Virtual device "{}" not created', vdTitle);
    return null;
  }

  /** @type {ControlOptions} */
  var controlCfg = {
    title: {
      en: 'Activate scenario rule',
      ru: 'Активировать правило сценария',
    },
    type: 'switch',
    value: true,
    forceDefault: true, // Always must start from enabled state
    order: 1,
  };
  vdObj.addControl(ctrlRuleEnabled, controlCfg);

  controlCfg = {
    title: {
      en: 'State',
      ru: 'Состояние',
    },
    type: 'value',
    readonly: true,
    forceDefault: true, // Always must start from init string state
    value: 0,
    enum: {
      0: {
        en: 'Created, not initialized',
        ru: 'Создан, не инициализирован',
      },
      1: {
        en: 'Initialisation started...',
        ru: 'Инициализация запущена...',
      },
      2: {
        en: 'Waiting for used channels...',
        ru: 'Ожидание используемых каналов...',
      },
      3: {
        en: 'Used channels ready',
        ru: 'Используемые каналы готовы',
      },
      4: {
        en: 'Config not valid',
        ru: 'Настройки не корректны',
      },
      5: {
        en: 'Used channels not ready',
        ru: 'Используемые каналы не готовы',
      },
      6: {
        en: 'Active',
        ru: 'Активен',
      },
      7: {
        en: 'Used channel has error',
        ru: 'Используемый канал в ошибке',
      },
      8: {
        en: 'Waiting',
        ru: 'Ожидает',
      },
      9: {
        en: 'Disabled',
        ru: 'Отключен',
      },
    },
    order: 100,
  };
  vdObj.addControl(ctrlInitStatus, controlCfg);

  var ruleId = defineRule(vdName + '_change_' + ctrlRuleEnabled, {
    whenChanged: [vdName + '/' + ctrlRuleEnabled],
    then: function (newValue, devName, cellName) {
      scenarioPersistentStorage.setUserSetting(
        idPrefix,
        ctrlRuleEnabled,
        newValue
      );
      toggleRules(managedRulesId, newValue);
    },
  });

  if (!ruleId) {
    log.error('Failed to create the rule: {}', vdName);
    return null;
  }

  log.debug('Base VD and rule with names "{}" created successfully', vdName);
  return vdObj;
}

exports.ScenarioState = ScenarioState;
exports.addLinkedControlRO = addLinkedControlRO;
exports.addGroupTitleRO = addGroupTitleRO;
exports.addAlarm = addAlarm;
exports.toggleRules = toggleRules;
exports.setVdTotalError = setVdTotalError;
exports.removeLeftoverVd = removeLeftoverVd;
exports.createBasicVd = createBasicVd;
