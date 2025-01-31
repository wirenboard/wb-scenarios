/**
 * @file topicmgr-main.js
 * @description Модуль с описанием базового объекта менеджера топиков.
 *     Данный объект нужен как фундамент для наслоения расширений.
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/> - Google styleguide
 */

/**
 * Базовый конструктор TopicManager
 */
function TopicManager() {
  // Реестр топиков - хранилище информации о топиках, событиях и тд
  this.topics = {};

  // Установленные плагины (по именам)
  this.installedPlugins = [];

  /**
   * Цепочки процессоров для разных типов правил
   * Процессор - это одна функция для обработки новых значений топика
   */
  this.processorChains = {
    general: [],
    service: [],
  };

  /**
   * @type {Object<string, RuleInstance>}
   * Реестр всех правил по их именам
   * Каждый объект правила содержит тип и экземпляр RuleInstance
   * @property {string} type Тип правила (см. MODES)
   * @property {RuleInstance} instance Экземпляр правила
   */
  this.rules = {};

  /**
   * Перечисление категорий для цепи процессоров и правил
   */
  this.MODES = {
    GENERAL: 'general',
    SERVICE: 'service',
  };
}

/**
 * Метод для подключения плагинов к объекту TopicManager
 * Ожидает объект с методом install
 *
 * @param {Object} plugin - Объект плагина с методом install
 * @param {Object} [options] - Опциональные параметры для плагина
 * @returns {boolean} Успешность установки плагина
 */
function installPlugin(plugin, options) {
  var isValidPlugin = plugin && typeof plugin.install === 'function';
  var hasValidName = plugin.name && typeof plugin.name === 'string';
  var isAlreadyInstalled = this.installedPlugins.indexOf(plugin.name) !== -1;

  if (!isValidPlugin) {
    log.error('Invalid plugin format - Plugin must have an install method');
    return false;
  }

  if (!hasValidName) {
    log.error('Plugin is missing a name field or it is not a string');
    return false;
  }

  if (isAlreadyInstalled) {
    log.error('Plugin is already installed: ' + plugin.name);
    return false;
  }

  // Проверка зависимостей
  var isPluginHaveDep =
    Array.isArray(plugin.dependencies) && plugin.dependencies.length > 0;
  if (isPluginHaveDep === true) {
    for (var i = 0; i < plugin.dependencies.length; i++) {
      var depName = plugin.dependencies[i];
      var isDepInstalled = this.installedPlugins.indexOf(depName) !== -1;
      if (isDepInstalled === false) {
        log.error(
          'Plugin "' +
            plugin.name +
            '" depends on "' +
            depName +
            '", but it is not installed yet.'
        );
        return false;
      }
    }
  }

  plugin.install(this, options);
  this.installedPlugins.push(plugin.name);
  log.debug('Plugin installed: ' + plugin.name);
  return true;
}

/**
 * Добавление процессора в указанную цепочку
 * @param {Function} processor Функция процессора, добавляемая в цепочку
 * @param {string} type Тип цепочки (см. MODES)
 * @param {number} [priority=0] (Опционально) Приоритет процессора
 *     (чем выше, тем раньше он будет вызван)
 */
function addProcessor(processor, type, priority) {
  if (!this.MODES[type.toUpperCase()]) {
    log.error('Invalid processor type:', type);
    return false;
  }

  var isValidProcessor = typeof processor === 'function';
  if (!isValidProcessor) {
    log.error('Invalid processor - must be a function');
    return false;
  }

  // Создаем объект для процессора с приоритетом по умолчанию если не указан
  var processorEntry = {
    fn: processor,
    priority: priority || 0,
  };
  insertProcessorIntoChain(this.processorChains[type], processorEntry);

  log.debug('Processor added to {} chain with priority: {}', type, priority);
  return true;
}

/**
 * Удаление процессора из цепочки
 * @param {Function} processor Функция процессора для удаления
 * @param {string} type - Тип приоритета (см. MODES)
 */
function removeProcessor(processor, type) {
  if (!this.processorChains[type]) {
    log.error('Invalid processor type:', type);
    return;
  }
  var chain = this.processorChains[type];

  var index = -1;
  for (var i = 0; i < chain.length; i++) {
    if (chain[i].fn === processor) {
      index = i;
      break;
    }
  }

  if (index !== -1) {
    chain.splice(index, 1);
    log.debug('Processor removed from {} chain', type);
  } else {
    log.warning('Processor not found in {} chain', type);
  }
}

/**
 * Обработка данных всеми плагинами
 * Запускает все процессоры указанного типа приоритета
 * @param {string} type Тип приоритета (см. MODES)
 * @param {string} topic Имя топика
 * @param {*} newValue Новое значение топика
 */
function runProcessors(type, topic, newValue) {
  var isChainEmpty =
    !this.processorChains[type] || this.processorChains[type].length === 0;
  if (isChainEmpty) {
    log.debug('No processors in the chain for type: {}', type);
    return;
  }

  // Прогоняем через все обработчики в цепочке
  for (var i = 0; i < this.processorChains[type].length; i++) {
    this.processorChains[type][i].fn(topic, newValue);
  }
}

/**
 * Создание и запуск правил для обработки всех зарегистрированных топиков
 * (обработка в порядке: сначала service, затем general)
 * @param {string} ruleName Имя правила
 * @returns {boolean} Успешность создания и запуска правила
 */
function initRulesForAllTopics(ruleName) {
  var ruleNameType = typeof ruleName;
  var isRuleNameTypeString = ruleNameType === 'string';
  if (isRuleNameTypeString === false) {
    log.error(
      'Invalid ruleName type, must be "string", but now: ' + ruleNameType
    );
    return false;
  }

  // Сбор всех зарегистрированных топиков
  var topics = Object.keys(this.topics);
  if (topics.length === 0) {
    log.warning('No registered topics found. Rules not created.');
    return false;
  }

  var isOk = false;

  var serviceFn = function (newValue, devName, cellName) {
    var topic = devName + '/' + cellName;
    this.runProcessors(this.MODES.SERVICE, topic, newValue);
  }.bind(this);
  isOk = this.defineServiceRule(ruleName + '_service', topics, serviceFn);
  if (!isOk) {
    log.error('Failed to create service rule for all topics');
    return false;
  }

  var generalFn = function (newValue, devName, cellName) {
    var topic = devName + '/' + cellName;
    this.runProcessors(this.MODES.GENERAL, topic, newValue);
  }.bind(this);
  isOk = this.defineGeneralRule(ruleName, topics, generalFn);
  if (!isOk) {
    log.error('Failed to create general rule for all topics');
    return false;
  }

  log.debug('Rules for service and general chains successfully created');
  return true;
}

/**
 * Отладочный вывод текущего реестра
 */
function printRegistry() {
  log.debug('=== Current Topics Registry State ===');
  var isRegistryEmpty = isEmptyObject(this.topics);
  if (isRegistryEmpty) {
    log.debug('Registry is empty');
  } else {
    log.debug(JSON.stringify(this.topics, null, 2));
  }
  log.debug('==============================');
}

/** ==================================================== */

/**
 * Конструктор RuleInstance для управления конкретным правилом
 * @param {string} name Имя правила
 * @param {string} ruleId Идентификатор правила
 * @param {string} type Тип правила (см. MODES)
 */
function RuleInstance(name, ruleId, type) {
  this.name = name;
  this.ruleId = ruleId;
  this.type = type;
}

/**
 * Отключение всех правил определенного типа
 * @param {string} ruleType Тип правила (см. MODES)
 */
function _disableAllRulesOfType(ruleType) {
  for (var ruleName in this.rules) {
    var curRule = this.rules[ruleName];
    var isRuleTypeMatch = curRule.type === ruleType;
    if (isRuleTypeMatch) {
      curRule.disable();
    }
  }
  log.debug('All rules of type "' + ruleType + '" have been disabled.');
}

/**
 * Включение всех правил определенного типа
 * @param {string} ruleType Тип правила (см. MODES)
 */
function _enableAllRulesOfType(ruleType) {
  for (var ruleName in this.rules) {
    var curRule = this.rules[ruleName];
    var isRuleTypeMatch = curRule.type === ruleType;
    if (isRuleTypeMatch) {
      curRule.enable();
    }
  }
  log.debug('All rules of type "' + ruleType + '" have been enabled.');
}

/**
 * Запуск всех правил определенного типа
 * @param {string} ruleType - Тип правила (см. MODES)
 */
function _runAllRulesOfType(ruleType) {
  for (var ruleName in this.rules) {
    var curRule = this.rules[ruleName];
    var isRuleTypeMatch = curRule.type === ruleType;
    if (isRuleTypeMatch) {
      curRule.run();
    }
  }
  log.debug('All rules of type "' + ruleType + '" have been executed.');
}

/**
 * Отключить правило
 */
function disable() {
  disableRule(this.ruleId);
  log.debug('Rule disabled: {}, {}', this.ruleId, this.ruleId);
}

/**
 * Включить правило
 */
function enable() {
  enableRule(this.ruleId);
  log.debug('Rule enabled: {}, {}', this.ruleId, this.ruleId);
}

/**
 * Запустить правило вручную
 */
function run() {
  runRule(this.ruleId);
  log.debug('Rule triggered manually: {}, {}', this.ruleId, this.ruleId);
}

/**
 * Включение всех правил общего назначения
 */
function enableAllRules() {
  this._enableAllRulesOfType(this.MODES.GENERAL);
}

/**
 * Отключение всех правил общего назначения
 */
function disableAllRules() {
  this._disableAllRulesOfType(this.MODES.GENERAL);
}

/**
 * ======================================================
 *                  Local functions
 * ======================================================
 */

/**
 * Проверка объекта на пустоту
 */
function isEmptyObject(obj) {
  return Object.keys(obj).length === 0;
}

/**
 * Вставка процессора в цепочку с учетом приоритета
 * @param {Array} chain Цепочка процессоров
 *     (массив объектов { fn, priority })
 * @param {Object} processorEntry Объект процессора { fn, priority }
 */
function insertProcessorIntoChain(chain, processorEntry) {
  var insertIndex = -1;

  // Ищем подходящее место для вставки
  for (var i = 0; i < chain.length; i++) {
    // Если приоритет нового процессора выше текущего в цепочке
    if (processorEntry.priority > chain[i].priority) {
      insertIndex = i;
      break;
    }
  }

  // Если место не найдено, добавляем процессор в конец
  if (insertIndex === -1) {
    chain.push(processorEntry);
  } else {
    // Иначе вставляем процессор в найденное место
    chain.splice(insertIndex, 0, processorEntry);
  }
}

/**
 * Создание правила для TM с добавлением нового объекта в rules{}
 * @param {string} name Имя правила
 * @param {Array<string>} topics Список топиков, которые отслеживает правило
 * @param {Function} action Действие, выполняемое правилом
 * @param {string} type Тип правила (см. MODES)
 * @returns {RuleInstance|null} Экземпляр объекта правила или null
 */
function _defineTmRule(name, topics, action, type) {
  var ruleId = defineRule(name, {
    whenChanged: topics,
    then: action,
  });

  if (!ruleId) {
    log.error('Failed to create the rule: {}. Topics: {}', name, topics);
    return null;
  }

  log.debug('Rule "' + name + '" successfully created with ID: ' + ruleId);
  return new RuleInstance(name, ruleId, type);
}

/**
 * Создание и сохранение правила в реестре
 * @param {string} ruleName Имя правила
 * @param {Array<string>} topics Топики, которые отслеживает правило
 * @param {Function} action Действие, выполняемое правилом
 * @param {string} category Категория правила (см. MODES)
 * @returns {boolean} Успешность создания и сохранения правила
 */
function _defineAndStoreRule(ruleName, topics, action, category) {
  if (!this.MODES[category.toUpperCase()]) {
    log.error('Invalid rule category: ' + category);
    return false;
  }

  /** Create rule */
  var rule = _defineTmRule(ruleName, topics, action, category);

  if (!rule) {
    log.error('Failed to create the rule: ' + ruleName);
    return false;
  }

  /** Store rule */
  this.rules[ruleName] = rule;
  log.debug('TM: Rule "' + ruleName + '" created and added to registry');
  return true;
}

/**
 * Создание и сохранение сервисного правила
 * @param {string} ruleName Имя правила
 * @param {Array<string>} topics Топики, которые отслеживает правило
 * @param {Function} action Действие, выполняемое правилом
 * @returns {boolean} Успешность создания правила
 */
function defineServiceRule(ruleName, topics, action) {
  var isOk = this._defineAndStoreRule(
    ruleName,
    topics,
    action,
    this.MODES.SERVICE
  );
  return isOk;
}

/**
 * Создание и сохранение правила общего назначения
 * @param {string} ruleName Имя правила
 * @param {Array<string>} topics Топики, которые отслеживает правило
 * @param {Function} action Действие, выполняемое правилом
 * @returns {boolean} Успешность создания правила
 */
function defineGeneralRule(ruleName, topics, action) {
  var isOk = this._defineAndStoreRule(
    ruleName,
    topics,
    action,
    this.MODES.GENERAL
  );
  return isOk;
}

/**
 * Internal methods
 */
TopicManager.prototype._defineAndStoreRule = _defineAndStoreRule;
TopicManager.prototype._disableAllRulesOfType = _disableAllRulesOfType;
TopicManager.prototype._enableAllRulesOfType = _enableAllRulesOfType;
TopicManager.prototype._runAllRulesOfType = _runAllRulesOfType;

/**
 * These methods are shared across all instances of TopicManager
 */
TopicManager.prototype.installPlugin = installPlugin;
TopicManager.prototype.addProcessor = addProcessor;
TopicManager.prototype.removeProcessor = removeProcessor;
TopicManager.prototype.runProcessors = runProcessors;

TopicManager.prototype.defineRule = defineGeneralRule;
TopicManager.prototype.defineServiceRule = defineServiceRule;
TopicManager.prototype.initRulesForAllTopics = initRulesForAllTopics;
TopicManager.prototype.disableAllRules = disableAllRules;
TopicManager.prototype.enableAllRules = enableAllRules;

TopicManager.prototype.printRegistry = printRegistry;
TopicManager.prototype.printRules = printRules;

RuleInstance.prototype.disable = disable;
RuleInstance.prototype.enable = enable;
RuleInstance.prototype.run = run;

exports.TopicManager = TopicManager;
