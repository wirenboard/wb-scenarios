(function () {
  'use strict';

  var HOMEUI = window.__HOMEUI__;
  if (!HOMEUI || !HOMEUI.pluginRegistry) return;
  var React = HOMEUI.React;
  if (!React) return;

  var h = React.createElement;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useCallback = React.useCallback;
  var useRef = React.useRef;

  var C = HOMEUI.components;
  var Switch = C.Switch;
  var Button = C.Button;
  var Card = C.Card;
  var Range = C.Range;
  var Table = C.Table;
  var TableRow = C.TableRow;
  var TableCell = C.TableCell;
  var PageLayout = C.PageLayout;

  // ─── Constants ────────────────────────────────────────────────────────
  var BUZZER_DEVICE = '/devices/buzzer/controls';
  var BUZZER_ENABLED = BUZZER_DEVICE + '/enabled';
  var BUZZER_FREQUENCY = BUZZER_DEVICE + '/frequency';
  var BUZZER_VOLUME = BUZZER_DEVICE + '/volume';

  var PRESETS = [
    { value: 'single', label: 'Single Beep', frequency: 1000, duration: 200, repeat: 1, pause: 0 },
    { value: 'double', label: 'Double Beep', frequency: 1200, duration: 150, repeat: 2, pause: 100 },
    { value: 'triple', label: 'Triple Beep', frequency: 1500, duration: 100, repeat: 3, pause: 80 },
  ];

  // ─── MQTT helpers ───────────────────────────────────────────────────
  function getMqtt() {
    var s = HOMEUI && HOMEUI.services;
    return s && s.mqttClient && s.mqttClient.isConnected() ? s.mqttClient : null;
  }

  function mqttSend(topic, value) {
    var mqtt = getMqtt();
    if (mqtt) { mqtt.send(topic + '/on', String(value)); return true; }
    return false;
  }

  // ─── Styles ─────────────────────────────────────────────────────────
  var rowBase = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', gap: '12px' };
  var styles = {
    row: Object.assign({}, rowBase, { borderBottom: '1px solid var(--light-gray-color, #eee)' }),
    rowNoBorder: rowBase,
    label: { fontSize: '14px', fontWeight: '500', flexShrink: 0 },
    sublabel: { fontSize: '12px', color: '#888', fontWeight: '400' },
    control: { display: 'flex', alignItems: 'center', flex: '1 1 0', justifyContent: 'flex-end', minWidth: 0 },
    section: { marginTop: '16px' },
    description: { fontSize: '14px', color: '#666', marginBottom: '16px' },
  };

  // ─── FormRow ────────────────────────────────────────────────────────
  function FormRow(props) {
    return h('div', { style: props.isLast ? styles.rowNoBorder : styles.row },
      h('div', null,
        h('div', { style: styles.label }, props.label),
        props.sublabel ? h('div', { style: styles.sublabel }, props.sublabel) : null
      ),
      h('div', { style: styles.control }, props.children)
    );
  }

  // ─── BuzzerPage ─────────────────────────────────────────────────────
  function BuzzerPage() {
    var _enabled = useState(false);
    var enabled = _enabled[0]; var setEnabled = _enabled[1];
    var _frequency = useState(1000);
    var frequency = _frequency[0]; var setFrequency = _frequency[1];
    var _duration = useState(200);
    var duration = _duration[0]; var setDuration = _duration[1];
    var _volume = useState(5);
    var volume = _volume[0]; var setVolume = _volume[1];
    var _isPlaying = useState(false);
    var isPlaying = _isPlaying[0]; var setIsPlaying = _isPlaying[1];

    var timersRef = useRef([]);

    // Read current values from MQTT on mount
    useEffect(function () {
      var mqtt = null;
      var topics = [BUZZER_VOLUME, BUZZER_FREQUENCY, BUZZER_ENABLED];
      function handler(data) {
        var val = data.payload;
        if (data.topic === BUZZER_VOLUME) {
          var v = parseInt(val, 10);
          if (!isNaN(v)) setVolume(v);
        } else if (data.topic === BUZZER_FREQUENCY) {
          var f = parseInt(val, 10);
          if (!isNaN(f)) setFrequency(f);
        } else if (data.topic === BUZZER_ENABLED) {
          setEnabled(val === '1');
        }
      }
      function trySubscribe() {
        mqtt = getMqtt();
        if (!mqtt) return;
        clearInterval(retryId);
        topics.forEach(function (t) { mqtt.addStickySubscription(t, handler); });
      }
      trySubscribe();
      var retryId = setInterval(trySubscribe, 1000);
      return function () {
        clearInterval(retryId);
        if (mqtt) topics.forEach(function (t) { mqtt.unsubscribe(t); });
      };
    }, []);

    var playSound = useCallback(function (freq, dur, repeat, pause) {
      repeat = repeat || 1;
      pause = pause || 100;
      setIsPlaying(true);

      // Cancel previous
      timersRef.current.forEach(function (t) { clearTimeout(t); });
      var timers = [];

      function scheduleBeep(i) {
        var onDelay = i * (dur + pause);
        var offDelay = onDelay + dur;
        timers.push(setTimeout(function () {
          mqttSend(BUZZER_FREQUENCY, freq);
          mqttSend(BUZZER_ENABLED, 1);
        }, onDelay));
        timers.push(setTimeout(function () {
          mqttSend(BUZZER_ENABLED, 0);
          if (i === repeat - 1) setIsPlaying(false);
        }, offDelay));
      }

      for (var i = 0; i < repeat; i++) scheduleBeep(i);
      timersRef.current = timers;
    }, []);

    var handleToggle = useCallback(function (val) {
      setEnabled(val);
      mqttSend(BUZZER_ENABLED, val ? 1 : 0);
      if (val) mqttSend(BUZZER_FREQUENCY, frequency);
      if (!val) setIsPlaying(false);
    }, [frequency]);

    var handleVolumeChange = useCallback(function (val) {
      var v = Number(val);
      if (!isNaN(v) && v >= 0 && v <= 100) {
        setVolume(v);
        mqttSend(BUZZER_VOLUME, v);
      }
    }, []);

    // ─── Render ─────────────────────────────────────────────────────
    return h(PageLayout, { title: 'Buzzer', hasRights: true },

      h('div', { style: styles.description },
        'Управление встроенным зуммером контроллера. Настройте частоту, длительность и громкость сигнала, или выберите один из готовых пресетов.'
      ),

      // ═══ Main controls ═══
      h(Card, { heading: 'Управление' },
        h(FormRow, { label: 'Включить', sublabel: 'Основной переключатель' },
          h(Switch, { value: enabled, onChange: handleToggle })
        ),
        h(FormRow, { label: 'Громкость', sublabel: '0 \u2013 100' },
          h(Range, {
            value: volume, min: 0, max: 100, step: 1,
            onChange: handleVolumeChange,
          })
        ),
        h(FormRow, { label: 'Частота', sublabel: '0 \u2013 7000 Гц' },
          h(Range, {
            value: frequency, min: 0, max: 7000, step: 100,
            units: 'Гц',
            onChange: function (v) { setFrequency(v); mqttSend(BUZZER_FREQUENCY, v); },
          })
        ),
        h(FormRow, { label: 'Длительность', sublabel: '50 \u2013 2000 мс', isLast: true },
          h(Range, {
            value: duration, min: 50, max: 2000, step: 50,
            units: 'мс',
            onChange: function (v) { setDuration(v); },
          })
        )
      ),

      // ═══ Presets ═══
      h('div', { style: styles.section },
        h(Card, { heading: 'Пресеты' },
          h(Table, { isFullWidth: true },
            h(TableRow, { isHeading: true },
              h(TableCell, null, 'Название'),
              h(TableCell, { align: 'center' }, 'Частота'),
              h(TableCell, { align: 'center' }, 'Длительность'),
              h(TableCell, { align: 'center' }, 'Повтор'),
              h(TableCell, { align: 'right' }, '')
            ),
            PRESETS.map(function (p) {
              return h(TableRow, { key: p.value },
                h(TableCell, null, h('strong', null, p.label)),
                h(TableCell, { align: 'center' }, p.frequency + ' Hz'),
                h(TableCell, { align: 'center' }, p.duration + ' ms'),
                h(TableCell, { align: 'center' }, p.repeat + '\u00d7'),
                h(TableCell, { align: 'right' },
                  h(Button, {
                    label: isPlaying ? '\u25B6\uFE0E' : '\u25B6',
                    variant: 'secondary',
                    size: 'small',
                    isDisabled: isPlaying,
                    onClick: function () {
                      playSound(p.frequency, p.duration, p.repeat, p.pause);
                    },
                  })
                )
              );
            })
          )
        )
      )
    );
  }

  HOMEUI.pluginRegistry.register({
    id: 'wb-buzzer',
    components: { BuzzerPage: BuzzerPage },
  });
})();
