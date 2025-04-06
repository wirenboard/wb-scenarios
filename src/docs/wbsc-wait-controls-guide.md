# Модуль ожидания готовности контролов

Содержит функцию которая проверяет полингом наличие готовых контролов
и далее вызывает указанную функцию-коллбек пользователя передавая ей результат

## Пример использования

В данном примере создается пользовательский коллбек `onWaitControlsReady`
который будет вызван через 5000 мс полинга периодом 500 мс двух контролов
`wb-gpio/A1_OUT2`, `wb-gpio/A3_IN2`:

```javascript
/**
 * Example callback function that processes the result of waitControls
 * @param {ControlsTimeoutError|null} err Result of waiting for controls readiness
 *        - null: all controls are ready
 *        - ControlsTimeoutError: one or more controls are not ready
 *
 * Some user-provided parameters:
 * @param {string} deviceName - Device name to manipulate
 * @param {string} controlName - Control name to manipulate
 * @param {string} someString - Additional user parameter
 *
 * @example Usage with waitControls
 * waitControls(
 *   ["wb-gpio/A1_OUT"],
 *   { timeout: 5000, period: 500 },
 *   onWaitControlsReady, 
 *   "device1", 
 *   "enable", 
 *   "additional info"
 * );
 **/
function onWaitControlsReady(err, deviceName, controlName, someString) {
  if (err !== null) {
    log.error("WaitControls:", err.message);
    log.error("Not ready controls count:", err.notReadyCtrlList.length);
    for (var i = 0; i < err.notReadyCtrlList.length; i++) {
      log.error("Control not ready:", err.notReadyCtrlList[i]);
    }
    return;
  }

  // If err === null, controls are ready
  log.debug("Controls are ready for:", deviceName, controlName);
  log.debug("Extra argument:", someString);
  dev[deviceName][controlName] = true; // Example user action
}

/**
 * Example usage in wb-rules
 **/
defineRule("example_wait_controls", {
  whenChanged: "1122/my_switch",
  then: function() {
    log.error("Triggered by change in 1122/my_switch");

    var controlsToWait = ["wb-gpio/A1_OUT2", "wb-gpio/A3_IN2"];
    var TIMEOUT_MS = 2000;
    var POLL_PERIOD_MS = 500;

    waitControls(
      controlsToWait,
      {
        timeout: TIMEOUT_MS,   // Optional
        period: POLL_PERIOD_MS // Optional
      },
      onWaitControlsReady,
      // - - Additional callback parameters - -
      "wbsc_teplyy_pol_v_komnate2",
      "rule_enabled",
      "My string"
    );
  }
});

```
