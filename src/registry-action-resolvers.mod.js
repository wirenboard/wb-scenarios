/**
 * @file Модуль реестра, содержащего описание выходных воздействий
 *       Описывает действия над контролами в зависимости
 *       от выбранного типа поведения
 *
 *       Модель «два значения»:
 *        launchResolver — выполнение действия,
 *        resetResolver — отмена действия.
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/>
 */

/**
 * Действие включения switch-контрола
 * @param {boolean} actualValue - Актуальное состояние контрола
 * @param {*} actionValue - Не используется
 * @returns {boolean} Всегда true
 */
function setEnable(actualValue, actionValue) {
  var newCtrlValue = true;
  return newCtrlValue;
}

/**
 * Действие выключения switch-контрола
 * @param {boolean} actualValue - Актуальное состояние контрола
 * @param {*} actionValue - Не используется
 * @returns {boolean} Всегда false
 */
function setDisable(actualValue, actionValue) {
  var newCtrlValue = false;
  return newCtrlValue;
}

/**
 * Действие установки числового значения контрола
 * @param {number} actualValue - Актуальное состояние контрола
 * @param {number|string} actionValue - Значение, заданное пользователем
 * @returns {number} Новое значение контрола
 */
function setValueNumericInput(actualValue, actionValue) {
  var newCtrlValue = Number(actionValue);
  return newCtrlValue;
}

/**
 * Действие установки текстового значения контрола
 * @param {string} actualValue - Актуальное состояние контрола
 * @param {string} actionValue - Текст, заданный пользователем
 * @returns {string} Новое значение контрола
 */
function setText(actualValue, actionValue) {
  var newCtrlValue = actionValue;
  return newCtrlValue;
}

/**
 * Действие установки цвета rgb-контрола
 * Виджет wb-dynamic-type отдаёт цвет hex-строкой (#rrggbb), а WB rgb-контрол
 * ожидает десятичный формат "R;G;B", поэтому конвертируем при публикации.
 * @param {string} actualValue - Актуальное состояние контрола
 * @param {string} actionValue - Hex-цвет, заданный пользователем (напр. "#ff8040")
 * @returns {string} Цвет в формате "R;G;B" (напр. "255;128;64")
 */
function setColor(actualValue, actionValue) {
  var hex = String(actionValue).replace('#', '');
  var r = parseInt(hex.substr(0, 2), 16);
  var g = parseInt(hex.substr(2, 2), 16);
  var b = parseInt(hex.substr(4, 2), 16);

  var newCtrlValue;

  // Guard against an empty or malformed hex (e.g. an untouched widget field)
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    newCtrlValue = '255;255;255'; // white fallback
  } else {
    newCtrlValue = r + ';' + g + ';' + b;
  }

  return newCtrlValue;
}

/**
 * Реестр действий
 *
 * Содержит имя действия и соответствующие ему:
 * - Разрешённые типы контролов для данного действия
 * - launchResolver - обработчик выполнения действия
 * - resetResolver  - обработчик отмены действия
 */
var actionsTable = {
  setEnable: {
    reqCtrlTypes: ['switch'],
    launchResolver: setEnable,
    resetResolver: setDisable,
  },
  setDisable: {
    reqCtrlTypes: ['switch'],
    launchResolver: setDisable,
    resetResolver: setEnable,
  },
  setValueNumericInput: {
    reqCtrlTypes: ['value'],
    launchResolver: setValueNumericInput,
    resetResolver: setValueNumericInput,
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
