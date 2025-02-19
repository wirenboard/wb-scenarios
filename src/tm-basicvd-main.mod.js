/**
 * @file tm-basicvd-main.mod.js
 * @description Плагин TM для создания базового виртуального устройства
 *     с функционалом управления правилами.
 *     Плагин добавляет метод для создания виртуального устройства
 *     и объект vd, который предоставляет методы для работы с устройством.
 *
 * @author Vitalii Gaponov <vitalii.gaponov@wirenboard.com>
 * @link Комментарии в формате JSDoc <https://jsdoc.app/> - Google styleguide
 */

/**
 * Устанавливает плагин создания виртуального устройства
 *
 * @param {Object} manager Экземпляр TopicManager
 * @param {Object} [options] Опциональные параметры
 */
function install(manager, options) {
  /**
   * Создаёт базовое виртуальное устройство для управления правилами, которое
   * содержит переключатель для включения/отключения пользовательских правил
   *
   * @param {string} devName Имя виртуального устройства
   *     Пример: 'my_dev'
   * @param {string} devTitle Заголовок виртуального устройства
   *     Пример: 'Мое классное устройство' или 'My cool device'
   * @returns {boolean} Успешность создания устройства
   */
  function createBasicVd(devName, devTitle) {
    if (manager.vd) {
      log.error('Виртуальное устройство уже инициализировано:', devName);
      return false;
    }

    var config = {
      title: devTitle,
      cells: {
        ruleEnabled: {
          title: {
            en: 'Enable rule',
            ru: 'Включить правило',
          },
          type: 'switch',
          value: true,
          readonly: false,
          order: 1,
        },
      },
    };

    var devObj = defineVirtualDevice(devName, config);

    if (!devObj) {
      log.error('Не удалось создать виртуальное устройство:', devName);
      return false;
    }

    log.debug('Виртуальное устройство создано:', devName);

    // Создание сервисного правила для переключателя
    function serviceFn(newValue) {
      var isEnabledNow = newValue === true;
      if (isEnabledNow) {
        manager.enableAllRules();
      } else {
        manager.disableAllRules();
      }
    }
    var switchRuleName = devName + '_switch_control';
    isOk = manager.defineServiceRule(
      switchRuleName,
      [devName + '/ruleEnabled'],
      serviceFn
    );
    if (!isOk) {
      log.error('Failed to create service rule for switch_control');
      return false;
    }

    // Создание объекта vd
    var vdResult = {
      devObj: devObj,
      name: devName,
      setTotalError: setTotalError,
      addCell: addCell,
      addAlarm: addAlarm,
    };

    manager.vd = vdResult;
    return true;

    /**
     *  = = = = Методы для работы с виртуальным устройством = = = =
     */

    /**
     * Установка ошибки на виртуальном устройстве в 2 шага
     * - Вывод ошибки в логе
     * - Установка ошибки на каждом контроле чтобы весь девайс стал красным
     *
     * @param {string} errorMsg Сообщение об ошибке
     */
    function setTotalError(errorMsg) {
      if (!devObj) {
        log.error('Виртуальное устройство не инициализировано');
        return;
      }

      log.error('ERROR: ' + errorMsg);

      devObj.controlsList().forEach(function (ctrl) {
        ctrl.setError('ERROR: ' + errorMsg);
      });
      // TODO: In this place may be add output to text field or create allert
    }

    /**
     * Добавляет ячейку в виртуальное устройство
     *
     * @param {string} cellName Имя ячейки
     * @param {Object} cellConfig Конфигурация ячейки
     */
    function addCell(cellName, cellConfig) {
      if (!devObj) {
        log.error('Виртуальное устройство не инициализировано');
        return;
      }

      /* Проверка на существование такой ячейки */
      var fullControlName = devName + '/' + cellName;
      if (devObj.getControl(fullControlName)) {
        log.error('Ячейка уже существует:', cellName);
        return;
      }

      devObj.addControl(cellName, cellConfig);
      log.debug('Ячейка добавлена в виртуальное устройство:', cellName);
    }
  }

  /**
   * Добавляет ячейку с типом "alarm" и именем alarm в виртуальное устройство
   *
   * @param {string} msg Текст аларма (Заголовок ячейки)
   */
  function addAlarm(msg) {
    manager.vd.addCell('alarm', {
      title: {
        en: msg,
        ru: msg,
      },
      type: 'alarm',
      readonly: true,
      value: true,
    });
  }

  manager.createBasicVd = createBasicVd;

  log.debug('TM: Plugin "Basic Virtual Device" successfully installed');
}

exports.basicVdPlugin = {
  name: 'basicVdPlugin',
  install: install,
  dependencies: [],
};
