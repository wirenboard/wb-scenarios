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

  // Id созданного правила WB-rules
  this.ruleId;
}

/**
 * Вставка процессора в цепочку с учетом приоритета
 * 
 * @param {Array} processorsChain  Цепочка процессоров
 *     (массив объектов { fn, priority })
 * @param {Object} processorEntry Объект процессора { fn, priority }
 */
function insertProcessorIntoChain(processorsChain , processorEntry) {
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
 * Добавление процессора в цепочку
 * 
 * @param {Function} processor Функция процессора, добавляемая в цепочку
 * @param {number} [priority=0] (Опционально) Приоритет процессора
 *     (чем выше, тем раньше он будет вызван)
 */
TopicManager.prototype.addProcessor = function (processor, priority) {
  var isValidProcessor = typeof processor === 'function';
  if (!isValidProcessor) {
    log.error('Invalid processor - must be a function');
    return false;
  }

  // Создаем объект для процессора с приоритетом по умолчанию если не указан
  var processorEntry = {
    fn: processor,
    priority: priority || 0
  };
  insertProcessorIntoChain(this.pluginsProcessorsChain, processorEntry);

  log.debug('Processor added with priority:', processorEntry.priority);
  return true;
};

/**
 * Удаление обработчика из цепочки
 * 
 * @param {Function} processor Функция процессора которую нужно удалить
 */
TopicManager.prototype.removeProcessor = function (processor) {
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
    log.warn('Processor not found');
  }
};

/**
 * Обработка данных всеми плагинами
 * 
 * @param {string} topic - Имя топика
 * @param {*} newValue - Новое значение топика
 */
TopicManager.prototype.runProcessors = function (topic, newValue) {
  if (this.pluginsProcessorsChain.length === 0) {
    log.debug('No processors in the chain');
    return;
  }

  // Прогоняем через все обработчики в цепочке
  for (var i = 0; i < this.pluginsProcessorsChain.length; i++) {
    this.pluginsProcessorsChain[i].fn(topic, newValue);
  }
};

/**
 * Создание и запуск правила для всех зарегистрированных топиков
 * Создаёт одно правило для обработки всех зарегистрированных топиков
 *
 * @param {string} ruleName Имя правила
 */
TopicManager.prototype.initRulesForAllTopics = function (ruleName) {
  var ruleNameType = typeof ruleName;
  if (ruleNameType !== 'string') {
    log.error(
      'Имя правила (ruleName) должно быть строкой, а сейчас:' + ruleNameType
    );
    return false;
  }

  // Сбор всех зарегистрированных топиков
  var topics = Object.keys(this.registry);
  if (topics.length === 0) {
    log.warn('Нет зарегистрированных топиков. Правило не создано.');
    return false;
  }

  // Создаем правило
  this.ruleId = defineRule(
    ruleName, {
    whenChanged: topics,
    then: function (newValue, devName, cellName) {
      var topic = devName + '/' + cellName;
      this.runProcessors(topic, newValue);
    }.bind(this),
  });

  if (!this.ruleId) {
    log.error('Failed to create the rule:', ruleName);
    return false;
  }

  log.debug('Rule "' + ruleName + '" successfully created with ID:', this.ruleId);
  return true;
};


/**
 * Метод для подключения плагинов к объекту TopicManager
 * Ожидает объект с методом install
 * 
 * @param {Object} plugin - Объект плагина с методом install
 * @param {Object} [options] - Опциональные параметры для плагина
 * @returns {boolean} Успешность установки плагина
 */
TopicManager.prototype.installPlugin = function (plugin, options) {
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
  var isPluginHaveDep = (Array.isArray(plugin.dependencies) && plugin.dependencies.length > 0);
  if (isPluginHaveDep === true) {
    for (var i = 0; i < plugin.dependencies.length; i++) {
      var depName = plugin.dependencies[i];
      var isDepInstalled = (this.installedPlugins.indexOf(depName) !== -1);
      if (isDepInstalled === false) {
        log.error(
          'Plugin "' + plugin.name + '" depends on "' + depName +
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
};

/**
 * Проверка объекта на пустоту
 */
function isEmptyObject(obj) {
  return Object.keys(obj).length === 0;
}

/**
 * Отладочный вывод текущего реестра
 */
TopicManager.prototype.printRegistry = function () {
  log.debug('=== Current Registry State ===');
  var isRegistryEmpty = isEmptyObject(this.registry);
  if (isRegistryEmpty) {
    log.debug('Registry is empty');
  } else {
    log.debug(JSON.stringify(this.registry, null, 2));
  }
  log.debug('==============================');
};

exports.TopicManager = TopicManager;
