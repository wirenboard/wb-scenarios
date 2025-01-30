/**
 * @file topicmgr-main.js
 * @description Модуль с описанием базового объекта менеджера топиков.
 *     Данный объект нужен как фундамент для наслоения расширений.
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

/**
 * Базовый конструктор TopicManager
 */
function TopicManager() {
  // Хранилище топиков и метаданных
  this.registry = {};

  // Установленные плагины (по именам)
  this.installedPlugins = [];

  // Цепочка функций (процессоров) для обработки новых значений топика
  this.pluginsProcessorsChain = [];

  // Объект для хранения правил по их именам вместе с мета информацией (Id)
  this.rules = {};
  this.serviceRules = {};
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
 * Добавление процессора в цепочку
 *
 * @param {Function} processor Функция процессора, добавляемая в цепочку
 * @param {number} [priority=0] (Опционально) Приоритет процессора
 *     (чем выше, тем раньше он будет вызван)
 */
function addProcessor(processor, priority) {
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
  insertProcessorIntoChain(this.pluginsProcessorsChain, processorEntry);

  log.debug('Processor added with priority:', processorEntry.priority);
  return true;
}

/**
 * Удаление обработчика из цепочки
 *
 * @param {Function} processor Функция процессора которую нужно удалить
 */
function removeProcessor(processor) {
  var index = -1;
  for (var i = 0; i < this.pluginsProcessorsChain.length; i++) {
    if (this.pluginsProcessorsChain[i].fn === processor) {
      index = i;
      break;
    }
  }

  if (index !== -1) {
    this.pluginsProcessorsChain.splice(index, 1);
    log.debug('Processor removed');
  } else {
    log.warning('Processor not found');
  }
}

/**
 * Обработка данных всеми плагинами
 *
 * @param {string} topic - Имя топика
 * @param {*} newValue - Новое значение топика
 */
function runProcessors(topic, newValue) {
  if (this.pluginsProcessorsChain.length === 0) {
    log.debug('No processors in the chain');
    return;
  }

  // Прогоняем через все обработчики в цепочке
  for (var i = 0; i < this.pluginsProcessorsChain.length; i++) {
    this.pluginsProcessorsChain[i].fn(topic, newValue);
  }
}

/**
 * Создание и запуск одного правила для обработки всех
 * зарегистрированных топиков
 *
 * @param {string} ruleName Имя правила
 * @returns {boolean} Успешность создания и запуска правила
 */
function initRulesForAllTopics(ruleName) {
  var ruleNameType = typeof ruleName;
  if (ruleNameType !== 'string') {
    log.error(
      'Invalid ruleName type, must be "string", but now: ' + ruleNameType
    );
    return false;
  }

  // Сбор всех зарегистрированных топиков
  var topics = Object.keys(this.registry);
  if (topics.length === 0) {
    log.warning('No registered topics found. Rule not created.');
    return false;
  }

  isOk = this._defineAndStoreTmRule(ruleName, topics);
  return isOk;
}

/**
 * Отладочный вывод текущего реестра
 */
function printRegistry() {
  log.debug('=== Current Registry State ===');
  var isRegistryEmpty = isEmptyObject(this.registry);
  if (isRegistryEmpty) {
    log.debug('Registry is empty');
  } else {
    log.debug(JSON.stringify(this.registry, null, 2));
  }
  log.debug('==============================');
}

/** ==================================================== */

/**
 * Конструктор RuleInstance для управления конкретным правилом
 * @param {string} name Имя правила
 * @param {string} ruleId Идентификатор правила
 */
function RuleInstance(name, ruleId) {
  this.name = name;
  this.ruleId = ruleId;
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
 * Включение всех правил
 */
function enableAllRules() {
  for (var ruleName in this.rules) {
    this.rules[ruleName].enable();
  }
  log.debug('Все правила включены');
}

/**
 * Отключение всех правил
 */
function disableAllRules() {
  for (var ruleName in this.rules) {
    this.rules[ruleName].disable();
  }
  log.debug('Все правила отключены');
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
 *
 * @param {Array} processorsChain  Цепочка процессоров
 *     (массив объектов { fn, priority })
 * @param {Object} processorEntry Объект процессора { fn, priority }
 */
function insertProcessorIntoChain(processorsChain, processorEntry) {
  var insertIndex = -1;

  // Ищем подходящее место для вставки
  for (var i = 0; i < processorsChain.length; i++) {
    // Если приоритет нового процессора выше текущего в цепочке
    if (processorEntry.priority > processorsChain[i].priority) {
      insertIndex = i;
      break;
    }
  }

  // Если место не найдено, добавляем процессор в конец
  if (insertIndex === -1) {
    processorsChain.push(processorEntry);
  } else {
    // Иначе вставляем процессор в найденное место
    processorsChain.splice(insertIndex, 0, processorEntry);
  }
}

/**
 * Создание правила для TM с добавлением нового объекта в rules{}
 * @param {string} name Имя правила
 * @param {Array<string>} topics Список топиков, которые отслеживает правило
 * @param {Function} action Действие, выполняемое правилом
 * @returns {RuleInstance|null} Экземпляр объекта правила или null
 */
function _defineTmRule(name, topics, action) {
  var ruleId = defineRule(name, {
    whenChanged: topics,
    then: action,
  });

  if (!ruleId) {
    log.error('Failed to create the rule: {}. Topics: {}', name, topics);
    return null;
  }

  log.debug('Rule "' + name + '" successfully created with ID:', ruleId);

  return new RuleInstance(name, ruleId);
}

/**
 * Создание и сохранение правила в выбранном реестре правил
 *
 * @param {string} ruleName Имя правила
 * @param {Array<string>} topics Топики, которые отслеживаются правилом
 * @param {Object} targetRegistry Целевой реестр (общий или сервисный)
 * @returns {boolean} Успешность создания правила
 */
function _defineAndStoreTmRule(ruleName, topics, targetRegistry) {
  /** Create rule */
  var rule = _defineTmRule(
    ruleName,
    topics,
    function (newValue, devName, cellName) {
      var topic = devName + '/' + cellName;
      this.runProcessors(topic, newValue);
    }.bind(this)
  );

  if (!rule) {
    log.error('Failed to create the rule: ' + ruleName);
    return false;
  }

  /** Store rule in the specified registry */
  targetRegistry[ruleName] = rule;
  log.debug('TM: Rule "' + ruleName + '" created and added to registry');
  return true;
}

/**
 * Создание и сохранение правила в сервисном реестре
 *
 * @param {string} ruleName - Имя правила
 * @param {Array<string>} topics - Топики, которые отслеживает правило
 * @returns {boolean} Успешность создания правила
 */
function _defineAndStoreServiceTmRule(ruleName, topics) {
  var isOk = this._defineAndStoreRule(ruleName, topics, this.serviceRules);
  return isOk;
}

/**
 * Создание и сохранение правила в общем реестре
 *
 * @param {string} ruleName - Имя правила
 * @param {Array<string>} topics - Топики, которые отслеживает правило
 * @returns {boolean} Успешность создания правила
 */
function _defineAndStoreGeneralTmRule(ruleName, topics) {
  var isOk = this._defineAndStoreRule(ruleName, topics, this.rules);
  return isOk;
}

/**
 * These methods are shared across all instances of TopicManager
 */
TopicManager.prototype.installPlugin = installPlugin;
TopicManager.prototype.addProcessor = addProcessor;
TopicManager.prototype.removeProcessor = removeProcessor;
TopicManager.prototype.runProcessors = runProcessors;

TopicManager.prototype.defineRule = _defineAndStoreGeneralTmRule;
TopicManager.prototype.defineServiceRule = _defineAndStoreServiceTmRule;
TopicManager.prototype.initRulesForAllTopics = initRulesForAllTopics;
TopicManager.prototype.disableAllRules = disableAllRules;
TopicManager.prototype.enableAllRules = enableAllRules;

TopicManager.prototype.printRegistry = printRegistry;
TopicManager.prototype.printRules = printRules;

RuleInstance.prototype.disable = disable;
RuleInstance.prototype.enable = enable;
RuleInstance.prototype.run = run;

exports.TopicManager = TopicManager;
