# Модуль ожидания готовности контролов

Содержит функцию, которая проверяет полингом наличие готовых контролов
и далее вызывает указанную функцию-коллбек пользователя передавая ей результат

У `waitControls()` есть дефолтные параметры таймаута (5000мс) и периода
полинга (500мс), но можно так же установить кастомные значения если указать
их в объекте вторым параметром,  например `{ timeout: 10000, period: 1000 }`

## Коллбек

Коллбек имеет должен иметь следующий вид:

```javascript
user_cb_func(err, param1, param2, ...)
```

Первым параметром будет передан объект ошибки:

- Eсли контролы не были инициализированы объект будет заполнен
  В `err.notReadyCtrlList` будет содержаться список тех контролов которые
  не успели инициализироваться
- Либо null если все прошло успешно

Второй и последующие параметры опциональны - с помошью них передается то,
что было указано при вызове `waitControls()` после функции коллбека.

Например, если указать после функции коллбека три строки:

```javascript
var controlsToWait = ["wb-gpio/A1_OUT"];
waitControls(
  controlsToWait,
  user_cb_func,
  // - - Additional callback parameters - -
  "wbsc_teplyy_pol_v_komnate",  // Optional
  "rule_enabled",               // Optional
  "My string"                   // Optional
);
```

То в случае успеха коллбек будет вызван как:

```javascript
user_cb_func(null, "wbsc_teplyy_pol_v_komnate", "rule_enabled", "My string")
```

## Пример использования

В данном примере создается пользовательский коллбек `onWaitControlsReady`
который будет вызван максимум через 2000 мс полинга периодом 500 мс двух
контролов `wb-gpio/A1_OUT`, `wb-gpio/A3_IN`:

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
    log.error(err.message);
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
    log.debug("Triggered by change in 1122/my_switch");

    var controlsToWait = ["wb-gpio/A1_OUT", "wb-gpio/A3_IN"];
    var TIMEOUT_MS = 2000;
    var POLL_PERIOD_MS = 500;

    waitControls(
      controlsToWait,
      {
        timeout: TIMEOUT_MS,         // Optional
        period: POLL_PERIOD_MS       // Optional
      },
      onWaitControlsReady,
      // - Additional callback params -
      "wbsc_teplyy_pol_v_komnate2",  // Optional
      "rule_enabled",                // Optional
      "My string"                    // Optional
    );
  }
});

```

Вывод в случае успеха:

```log
2025-04-08 10:28:55  Triggered by change in 1122/my_switch
2025-04-08 10:28:55  Extra argument: My string
```

А в случае ошибки инициализации:

```log
2025-04-08 10:28:55  Triggered by change in 1122/my_switch
2025-04-08 10:28:06  WaitControls: Timeout expired waiting for 2 controls
2025-04-08 10:28:06  Not ready controls count: 2
2025-04-08 10:28:06  Control not ready: wb-gpio/A1_OUT
2025-04-08 10:28:06  Control not ready: wb-gpio/A3_IN
```