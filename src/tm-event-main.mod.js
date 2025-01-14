/**
 * @file tm-event-main.mod.js
 * @description Плагин TM для обработки разных именованных событий топиков
 */

/**
 * Устанавливает плагин событий
 * 
 * @param {Object} manager Экземпляр TopicManager
 * @param {Object} [options] Опциональные параметры
 */
function install(manager, options) {
  /**
   * Логирование состояния реестра
   */
  function logRegistry() {
    var prefix = options && options.prefix ? options.prefix + ' ' : '';
    log.info(prefix + 'Current Registry:');
    if (Object.keys(manager.registry).length === 0) {
      log.info(prefix + 'Registry is empty');
    } else {
      log.info(prefix + JSON.stringify(manager.registry, null, 2));
    }
  }

  /**
   * Обработчик события
   * 
   * @param {string} topic Имя топика
   * @param {*} newValue Новое значение топика
   */
  function handleEvent(topic, newValue) {
    log.info('EventPlugin: Handling event for topic:', topic, 'with value:', newValue);

    // @todo: Точка для обработки событий
  }

  manager.addProcessor(handleEvent, options && options.priority || 5);

  manager.logRegistry = logRegistry;
}

exports.eventPlugin = {
  name: 'eventPlugin',
  install: install
};
