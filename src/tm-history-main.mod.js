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

    var history = manager.registry[topic].valHistory;

    history.push({
      value: newValue,
      timestamp: Date.now()
    });

    // Если достигнут лимит — удаляем самую старую запись
    var isLimit = maxLength > 0 && history.length > maxLength;
    if (isLimit === true) {
      history.shift();
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
   * Возвращает значение из истории по индексу
   * @param {string} topic Имя топика
   * @param {number} index Индекс: 0 = текущее, -1 = предыдущее, -2 = ещё раньше
   * @returns {*} Значение (value) или null, если данных нет
   */
  function getValueAt(topic, index) {
    var history = getHistory(topic);
  
    // Проверка на некорректный индекс
    var isIndexCorrect = (index <= 0 && Math.abs(index) <= history.length);
    if (!isIndexCorrect) {
      return null;
    }

    // Преобразуем указанный пользователем индекс в реальный индекс массива
    arrIndex = (history.length + index) - 1; // - 1 для преобразования в индекс

    // Переходим к значению с конца (0 = последний, -1 = предпоследний и т.д.)
    var record = history[arrIndex];
    var retValue = record ? record.value : null;
    return retValue;
  }

  /**
   * Возвращает предыдущее значение (последнее перед текущим)
   * @param {string} topic Имя топика
   * @returns {*} Значение (value) или null, если данных недостаточно
   */
  function getPrevValue(topic) {
    return getValueAt(topic, -1);
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
  manager.getValueAt = getValueAt;
  manager.getPrevValue = getPrevValue;

  /**
   * Добавляем общий обработчик в цепочку
   * Важно чтобы этот приоритет был выше чем у плагина событий
   */
  
  var priority = 6;
  manager.addProcessor(historyProcessor, priority);

  log.debug('History plugin installed, maxLength=' + maxLength);
}

exports.historyPlugin = {
  name: 'historyPlugin',
  install: install,
  dependencies: []
};
