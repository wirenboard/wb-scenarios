/**
 * @file virtual-device-helpers.mod.js - ES5 module for wb-rules v2.28
 * @description Module containing functions used for creating virtual devices
 *   and their modification
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 */

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
 * @param {Object} srcMqttControl - Строка MQTT control ('deviceName/cellName')
 * @param {Object} vDevObj - Объект виртуального девайса (как результат defineVirtualDevice)
 * @param {string} cellBaseName - Название базовой ячейки (например 'motion_sensor_0')
 * @param {string} cellType - Тип ячейки (например 'value')
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
  var ruleName = cellBaseName;
  defineRule(ruleName, {
    whenChanged: srcMqttControl,
    then: function (newValue, devName, cellName) {
      dev[vDevName + '/' + cellBaseName] = newValue;
    },
  });

  return true;
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
 * @param {Array<number>} managedRulesId Array of rule IDs to toggle
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
 * Creates a basic virtual device with a rule switch if it not already exist
 * @param {string} vdName The name of the virtual device
 * @param {string} vdTitle The title of the virtual device
 * @param {Array<number>} managedRulesId Array of rule IDs to toggle on switch
 * @returns {Object|null} The virtual device object if created, otherwise null
 */
function createBasicVd(vdName, vdTitle, managedRulesId) {
  var ctrlRuleEnabled = 'rule_enabled';
  var ctrlInitStatus = 'state';

  var existingVdObj = getDevice(vdName);
  if (existingVdObj !== undefined) {
    log.error('Virtual device "{}" already exists in system', vdName);
    return null;
  }
  log.debug(
    'Virtual device "{}" does not exist in system -> create new VD',
    vdName
  );

  var vdCfg = {
    title: vdTitle,
    cells: {},
  };
  var vdObj = defineVirtualDevice(vdName, vdCfg);
  if (!vdObj) {
    log.error('Virtual device "{}" not created', vdTitle);
    return null;
  }

  // Saving all created virtual devices to persistent storage
  var psWBSC = new PersistentStorage("wb-scenarios", {global: true});
  if (psWBSC["VdList"] !== undefined) {
    psWBSC["VdList"][vdName] = true;
  } else {
    psWBSC["VdList"] = new StorableObject({});
    psWBSC["VdList"][vdName] = true;
  }
  
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
        en: 'Waiting for linked controls 10s...',
        ru: 'Ожидание связанных контролов 10с...',
      },
      3: {
        en: 'Linked controls ready',
        ru: 'Связанные контролы готовы' },
      4: {
        en: 'Config not valid',
        ru: 'Настройки не корректны',
      },
      5: {
        en: 'Linked controls not ready in 10s',
        ru: 'Связанные контролы не готовы за 10с',
      },
      6: {
        en: 'Normal',
        ru: 'В норме',
      },
    },
    order: 100,
  };
  vdObj.addControl(ctrlInitStatus, controlCfg);

  var ruleId = defineRule(vdName + '_change_' + ctrlRuleEnabled, {
    whenChanged: [vdName + '/' + ctrlRuleEnabled],
    then: function (newValue, devName, cellName) {
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

exports.addLinkedControlRO = addLinkedControlRO;
exports.addGroupTitleRO = addGroupTitleRO;
exports.addAlarm = addAlarm;
exports.toggleRules = toggleRules;
exports.setVdTotalError = setVdTotalError;
exports.createBasicVd = createBasicVd;
