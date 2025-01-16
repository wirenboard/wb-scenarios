/**
 * @file tm-history-main.mod.js
 * @description Плагин TM для ведения истории значений. 
 *     История хранится внутри manager.registry[topic].valHistory, где для
 *     каждого значения сохраняются дополнительные данные (например, время).
 * 
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

/**
 * Устанавливает плагин ведения истории значений
 * 
 * @param {Object} manager Экземпляр TopicManager
 * @param {Object} [options] Опции плагина
 * @param {number} [options.maxLength=5] Макс. кол-во записей (0=без лимита)
 */
function install(manager, options) {
  var defaultMaxLength = 5;
  var maxLength = defaultMaxLength;

  if (options && typeof options.maxLength === 'number') {
    maxLength = options.maxLength;
  }

  /**
   * Добавляет новое значение в историю топика
   *
   * @param {string} topic Имя топика вида "device/control"
   * @param {*} newValue Значение для записи
   */
  function storeRecord(topic, newValue) {
    if (!manager.registry[topic]) {
      manager.registry[topic] = {};
    }
    if (!manager.registry[topic].valHistory) {
      manager.registry[topic].valHistory = [];
    }

    manager.registry[topic].valHistory.push({
      value: newValue,
      timestamp: Date.now()
    });

    // Если достигнут лимит — удаляем самую старую запись
    isLimit = maxLength > 0 && manager.registry[topic].valHistory.length > maxLength;
    if (isLimit === true) {
      manager.registry[topic].valHistory.shift();
    }
  }

  /**
   * Возвращает массив объектов истории для заданного топика
   *
   * @param {string} topic Имя топика
   * @returns {Array} Массив исторических записей вида {value, timestamp}
   *     или [] если пусто
   */
  function getHistory(topic) {
    if (!manager.registry[topic] ||
      !manager.registry[topic].valHistory) {
      return [];
    }

    var history = manager.registry[topic].valHistory;
    return history;
  }

  /**
   * Процессор, автоматически вызывающий storeRecord при приходе
   * нового значения (topic, newValue).
   *
   * @param {string} topic Имя топика
   * @param {*} newValue Новое значение
   */
  function historyProcessor(topic, newValue) {
    storeRecord(topic, newValue);
  }

  // Экспортируем методы в сам manager (для ручного вызова при желании)
  manager.storeRecord = storeRecord;
  manager.getHistory = getHistory;

  // Добавляем общий обработчик в цепочку
  var priority = 3;
  manager.addProcessor(historyProcessor, priority);

  log.debug('History plugin installed, maxLength=' + maxLength);
}

exports.historyPlugin = {
  name: 'historyPlugin',
  install: install
};
