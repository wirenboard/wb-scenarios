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
  // Хранилище топиков и информации о них
  this.registry = {};

  // Хранилище установленных плагинов
  this.installedPlugins = [];
}

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

  plugin.install(this, options);
  this.installedPlugins.push(plugin.name);
  log.debug('Plugin installed: ' + plugin.name);
  return true;
};

/**
 * Отладочный вывод текущего реестра
 */
TopicManager.prototype.printRegistry = function () {
  log.debug('=== Current Registry State ===');
  var isRegistryEmpty = Object.keys(this.registry).length === 0;
  if (isRegistryEmpty) {
    log.debug('Registry is empty');
  } else {
    log.debug(JSON.stringify(this.registry, null, 2));
  }
  log.debug('==============================');
};

exports.TopicManager = TopicManager;
