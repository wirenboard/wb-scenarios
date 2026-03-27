/**
 * @file pid-controller.mod.js - Hardcoded PID controller
 * @description Standalone wb-rules script for testing PID
 *     controller logic. Creates simulation device and PID
 *     controller virtual device with all controls.
 *
 *     Deploy for testing:
 *     1. Copy pid-engine.mod.js to modules path:
 *        /usr/share/wb-rules-modules/pid-engine.mod.js
 *     2. Copy this file to rules path:
 *        /etc/wb-rules/pid-controller.mod.js
 *     3. Restart wb-rules or wait for auto-reload
 *
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var PidEngine = require('pid-engine.mod').PidEngine;

// ============================================================
// HARDCODED CONFIG (for testing, pwmPeriod=30s)
// ============================================================
var CFG = {
  sensor: 'sim_room/temperature',
  setpoint: 22,
  setpointLimits: { min: 5, max: 35 },
  deadband: 0.2,
  pid: { kp: 10, ki: 0.005, kd: 2 },
  pwmPeriod: 30,
  minCycleDuration: 0,
  actuators: [
    {
      mqttTopicName: 'sim_room/heater',
      behaviorType: 'setEnable',
    },
  ],
};

var VD_NAME = 'wbsc_pid_test';
var SIM_NAME = 'sim_room';

// ============================================================
// STATE
// ============================================================
var pid = new PidEngine(
  CFG.pid.kp,
  CFG.pid.ki,
  CFG.pid.kd,
  CFG.deadband
);

var ctx = {
  enabled: true,
  cycleTimerId: null,
  offTimerId: null,
};

// ============================================================
// HELPERS
// ============================================================

/**
 * Apply heating state to all actuators.
 * Uses XNOR logic for setEnable/setDisable inversion.
 * Only writes when value actually changes.
 * @param {boolean} shouldHeat - Whether to heat
 */
function applyActuators(shouldHeat) {
  for (var i = 0; i < CFG.actuators.length; i++) {
    var act = CFG.actuators[i];
    var isSetEnable =
      act.behaviorType === 'setEnable';
    var desired = shouldHeat === isSetEnable;
    if (dev[act.mqttTopicName] !== desired) {
      dev[act.mqttTopicName] = desired;
    }
  }
}

/**
 * Cancel all active PWM timers
 */
function cancelTimers() {
  if (ctx.cycleTimerId !== null) {
    clearTimeout(ctx.cycleTimerId);
    ctx.cycleTimerId = null;
  }
  if (ctx.offTimerId !== null) {
    clearTimeout(ctx.offTimerId);
    ctx.offTimerId = null;
  }
}

/**
 * Update VD display controls for disabled state
 */
function setDisabledDisplay() {
  dev[VD_NAME + '/state'] = 'Отключен';
  dev[VD_NAME + '/actuator_status'] = false;
  dev[VD_NAME + '/on_off_time'] = '-';
}

// ============================================================
// PWM CYCLE
// ============================================================

/**
 * Compute PID output and log components.
 * @param {number} measurement - Current sensor value
 * @param {number} setpoint - Target value
 * @returns {number} PID output 0..100
 */
function computePidOutput(measurement, setpoint) {
  var output = pid.compute(
    setpoint,
    measurement,
    CFG.pwmPeriod
  );

  var st = pid.getState();
  log(
    'PID: val=' + measurement
    + ' sp=' + setpoint
    + ' P=' + st.p.toFixed(2)
    + ' I=' + st.i.toFixed(2)
    + ' D=' + st.d.toFixed(2)
    + ' out=' + output.toFixed(1) + '%'
  );

  return output;
}

/**
 * Calculate PWM ON/OFF times from PID output.
 * Applies minCycleDuration guard and recalculates
 * output to match actual timing.
 * @param {number} output - PID output 0..100
 * @param {number} periodMs - PWM period in ms
 * @returns {{onTimeMs: number, offTimeMs: number,
 *     output: number}}
 */
function calculatePwmTiming(output, periodMs) {
  var onTimeMs = periodMs * output / 100;
  var offTimeMs = periodMs - onTimeMs;

  if (CFG.minCycleDuration > 0) {
    var minMs = CFG.minCycleDuration * 1000;
    if (onTimeMs > 0 && onTimeMs < minMs) {
      onTimeMs = minMs;
      offTimeMs = periodMs - onTimeMs;
    } else if (
      offTimeMs > 0 && offTimeMs < minMs
    ) {
      offTimeMs = minMs;
      onTimeMs = periodMs - offTimeMs;
    }
    output = onTimeMs / periodMs * 100;
  }

  return {
    onTimeMs: onTimeMs,
    offTimeMs: offTimeMs,
    output: output,
  };
}

/**
 * Update VD display controls for active state.
 * @param {number} output - Effective output 0..100
 * @param {number} onTimeSec - ON phase in seconds
 * @param {number} offTimeSec - OFF phase in seconds
 */
function updateActiveDisplay(
  output, onTimeSec, offTimeSec
) {
  var isHeating = output > 0;

  dev[VD_NAME + '/output_power'] =
    Math.round(output * 10) / 10;
  dev[VD_NAME + '/actuator_status'] = isHeating;
  dev[VD_NAME + '/state'] =
    isHeating ? 'Активен' : 'Ожидает';
  dev[VD_NAME + '/on_off_time'] =
    Math.round(onTimeSec)
    + ' / ' + Math.round(offTimeSec);
}

/**
 * Apply actuators and schedule PWM timers.
 * @param {number} output - Effective output 0..100
 * @param {number} onTimeMs - ON phase duration in ms
 * @param {number} offTimeMs - OFF phase duration in ms
 * @param {number} periodMs - Full cycle period in ms
 */
function executePwm(
  output, onTimeMs, offTimeMs, periodMs
) {
  applyActuators(output > 0);

  if (output > 0 && output < 100) {
    ctx.offTimerId = setTimeout(
      function offPhaseTimer() {
        applyActuators(false);
        dev[VD_NAME + '/state'] = 'Ожидает';
        dev[VD_NAME + '/actuator_status'] = false;
        ctx.offTimerId = null;
        log(
          'PWM: OFF phase, next cycle in '
          + (offTimeMs / 1000).toFixed(0) + 's'
        );
      },
      onTimeMs
    );
  }

  ctx.cycleTimerId = setTimeout(
    function nextCycleTimer() {
      startWorkCycle();
    },
    periodMs
  );

  log(
    'PWM: period=' + (periodMs / 1000) + 's'
    + ' ON=' + (onTimeMs / 1000).toFixed(1) + 's'
    + ' OFF='
    + (offTimeMs / 1000).toFixed(1) + 's'
  );
}

/**
 * Start a new PWM work cycle.
 * Orchestrator: compute → timing → display → execute.
 *
 * Called on:
 * - Regular cycle start (setTimeout chain)
 * - Scenario enable
 */
function startWorkCycle() {
  cancelTimers();

  if (!ctx.enabled) {
    applyActuators(false);
    setDisabledDisplay();
    return;
  }

  var measurement = dev[CFG.sensor];
  var setpoint = dev[VD_NAME + '/setpoint'];
  dev[VD_NAME + '/current_value'] = measurement;

  var output = computePidOutput(measurement, setpoint);

  var periodMs = CFG.pwmPeriod * 1000;
  var timing = calculatePwmTiming(output, periodMs);

  updateActiveDisplay(
    timing.output,
    timing.onTimeMs / 1000,
    timing.offTimeMs / 1000
  );
  executePwm(
    timing.output,
    timing.onTimeMs,
    timing.offTimeMs,
    periodMs
  );
}

// ============================================================
// VIRTUAL DEVICES
// ============================================================

// Simulation device: room temperature + heater
defineVirtualDevice(SIM_NAME, {
  title: 'Симуляция комнаты (PID тест)',
  cells: {
    temperature: {
      type: 'range',
      value: 18,
      min: 0,
      max: 40,
      order: 1,
      title: {
        en: 'Room Temperature',
        ru: 'Температура комнаты',
      },
    },
    heater: {
      type: 'switch',
      value: false,
      readonly: true,
      order: 2,
      title: {
        en: 'Heater',
        ru: 'Нагреватель',
      },
    },
  },
});

// PID Controller virtual device
defineVirtualDevice(VD_NAME, {
  title: 'ПИД-регулятор (тест)',
  cells: {
    rule_enabled: {
      type: 'switch',
      value: true,
      order: 1,
      title: {
        en: 'Enable',
        ru: 'Включен',
      },
    },
    setpoint: {
      type: 'range',
      value: CFG.setpoint,
      min: CFG.setpointLimits.min,
      max: CFG.setpointLimits.max,
      order: 2,
      title: {
        en: 'Setpoint',
        ru: 'Уставка',
      },
    },
    current_value: {
      type: 'value',
      value: 0,
      readonly: true,
      order: 3,
      title: {
        en: 'Current Value',
        ru: 'Текущее значение',
      },
    },
    output_power: {
      type: 'range',
      value: 0,
      min: 0,
      max: 100,
      precision: 0.1,
      readonly: true,
      order: 4,
      title: {
        en: 'Output Power (%)',
        ru: 'Мощность (%)',
      },
    },
    cycle_period: {
      type: 'value',
      value: CFG.pwmPeriod,
      units: 's',
      readonly: true,
      order: 5,
      title: {
        en: 'Cycle Period',
        ru: 'Интервал регулирования',
      },
    },
    on_off_time: {
      type: 'text',
      value: '-',
      readonly: true,
      order: 6,
      title: {
        en: 'ON / OFF (s)',
        ru: 'Вкл / Выкл (с)',
      },
    },
    actuator_status: {
      type: 'switch',
      value: false,
      readonly: true,
      order: 7,
      title: {
        en: 'Actuator Status',
        ru: 'Статус актуатора',
      },
    },
    state: {
      type: 'text',
      value: 'Ожидает',
      readonly: true,
      order: 100,
      title: {
        en: 'State',
        ru: 'Состояние',
      },
    },
  },
});

// ============================================================
// RULES
// ============================================================

// Rule: Enable / Disable scenario
defineRule('pid_test_enable', {
  whenChanged: VD_NAME + '/rule_enabled',
  then: function onEnableChanged(newValue) {
    ctx.enabled = newValue;
    if (newValue) {
      log('Scenario enabled, starting cycle');
      startWorkCycle();
    } else {
      log('Scenario disabled, resetting PID');
      cancelTimers();
      applyActuators(false);
      pid.reset();
      setDisabledDisplay();
    }
  },
});

// Rule: Setpoint change → reset PID and restart cycle
defineRule('pid_test_setpoint', {
  whenChanged: VD_NAME + '/setpoint',
  then: function onSetpointChanged(newValue) {
    log('Setpoint changed: ' + newValue);
    if (ctx.enabled) {
      pid.reset();
      startWorkCycle();
    }
  },
});

// Rule: Sensor value update → sync to VD
defineRule('pid_test_sensor', {
  whenChanged: CFG.sensor,
  then: function onSensorChanged(newValue) {
    dev[VD_NAME + '/current_value'] = newValue;
  },
});

// ============================================================
// INITIAL START
// ============================================================
setTimeout(function initialStart() {
  log('PID Controller test starting...');
  log(
    'Config: Kp=' + CFG.pid.kp
    + ' Ki=' + CFG.pid.ki
    + ' Kd=' + CFG.pid.kd
    + ' period=' + CFG.pwmPeriod + 's'
    + ' deadband=' + CFG.deadband + '°C'
  );
  dev[VD_NAME + '/current_value'] =
    dev[CFG.sensor];
  startWorkCycle();
}, 1000);
