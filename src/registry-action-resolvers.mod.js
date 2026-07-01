/**
 * @file Модуль реестра, содержащего описание выходных воздействий
 *       Описывает действия над контролами в зависимости
 *       от выбранного типа поведения
 *
 *       Модель «два значения»: launchResolver применяет значение включения,
 *       resetResolver — выключения. Switch игнорирует значение (вкл → true,
 *       выкл → false); число/текст/цвет применяют переданное значение.
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

/**
 * Действие включения switch-контрола
 * @param {boolean} actualValue - Актуальное состояние контрола
 * @param {*} value - Не используется
 * @returns {boolean} Всегда true
 */
function setEnable(actualValue, value) {
  return true;
}

/**
 * Действие выключения switch-контрола
 * @param {boolean} actualValue - Актуальное состояние контрола
 * @param {*} value - Не используется
 * @returns {boolean} Всегда false
 */
function setDisable(actualValue, value) {
  return false;
}

/**
 * Действие установки числового значения контрола
 * @param {number} actualValue - Актуальное состояние контрола
 * @param {number|string} value - Значение, заданное пользователем
 * @returns {number} Новое значение контрола
 */
function setValueNumeric(actualValue, value) {
  return Number(value);
}

/**
 * Действие установки текстового значения контрола
 * @param {string} actualValue - Актуальное состояние контрола
 * @param {string} value - Текст, заданный пользователем
 * @returns {string} Новое значение контрола
 */
function setText(actualValue, value) {
  return value;
}

/**
 * Действие установки цвета rgb-контрола
 * Виджет wb-dynamic-type отдаёт цвет hex-строкой (#rrggbb), а WB rgb-контрол
 * ожидает десятичный формат "R;G;B", поэтому конвертируем при публикации.
 * @param {string} actualValue - Актуальное состояние контрола
 * @param {string} value - Hex-цвет, заданный пользователем (напр. "#ff8040")
 * @returns {string} Цвет в формате "R;G;B" (напр. "255;128;64")
 */
function setColor(actualValue, value) {
  var hex = String(value).replace('#', '');
  var r = parseInt(hex.substr(0, 2), 16);
  var g = parseInt(hex.substr(2, 2), 16);
  var b = parseInt(hex.substr(4, 2), 16);
  // Guard against an empty or malformed hex (e.g. an untouched widget field)
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return '255;255;255'; // white fallback
  }
  return r + ';' + g + ';' + b;
}

/**
 * Реестр действий
 *
 * Содержит имя действия и соответствующие ему:
 * - Разрешённые типы контролов для данного действия
 * - launchResolver - обработчик включения (применяет значение включения)
 * - resetResolver  - обработчик выключения (применяет значение выключения)
 */
var actionsTable = {
  setEnable: {
    reqCtrlTypes: ['switch'],
    launchResolver: setEnable,
    resetResolver: setDisable,
  },
  setValueNumericInput: {
    reqCtrlTypes: ['value'],
    launchResolver: setValueNumeric,
    resetResolver: setValueNumeric,
  },
  setText: {
    reqCtrlTypes: ['text'],
    launchResolver: setText,
    resetResolver: setText,
  },
  setColor: {
    reqCtrlTypes: ['rgb'],
    launchResolver: setColor,
    resetResolver: setColor,
  },
};

exports.actionsTable = actionsTable;
