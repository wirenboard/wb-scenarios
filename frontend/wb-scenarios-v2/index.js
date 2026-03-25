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
  var Fragment = React.Fragment;

  var C = HOMEUI.components;
  var PageLayout = C.PageLayout;
  var Card = C.Card;
  var Button = C.Button;
  var Input = C.Input;
  var Dropdown = C.Dropdown;
  var Tag = C.Tag;
  var Alert = C.Alert;
  var Loader = C.Loader;
  var Dialog = C.Dialog;
  var Confirm = C.Confirm;
  var Checkbox = C.Checkbox;

  // ─── Constants ────────────────────────────────────────────────────────
  var SCHEMA_PATH = '/usr/share/wb-mqtt-confed/schemas/wb-scenarios.schema.json';
  var SUPPORTED_TYPES = ['devicesControl', 'schedule', 'astronomicalTimer'];

  var TYPE_LABELS = {
    devicesControl: 'Устройства',
    schedule: 'Расписание',
    astronomicalTimer: 'Астро таймер',
  };

  var TYPE_DESCRIPTIONS = {
    devicesControl: 'Реакция на события устройств',
    schedule: 'Действие по расписанию',
    astronomicalTimer: 'По восходу или закату',
  };

  var TYPE_TAG_VARIANTS = {
    devicesControl: 'primary',
    schedule: 'success',
    astronomicalTimer: 'warn',
  };

  var TYPE_OPTIONS = SUPPORTED_TYPES.map(function (t) {
    return { value: t, label: TYPE_LABELS[t] };
  });

  var DAYS = [
    { value: 'monday', label: 'Пн' },
    { value: 'tuesday', label: 'Вт' },
    { value: 'wednesday', label: 'Ср' },
    { value: 'thursday', label: 'Чт' },
    { value: 'friday', label: 'Пт' },
    { value: 'saturday', label: 'Сб' },
    { value: 'sunday', label: 'Вс' },
  ];
  var ALL_DAYS = DAYS.map(function (d) { return d.value; });

  var ASTRO_EVENTS = [
    { value: 'sunrise', label: 'Восход' },
    { value: 'sunset', label: 'Закат' },
  ];

  var IN_BEHAVIOR_TYPES = [
    { value: 'whenChange', label: 'При изменении' },
    { value: 'whenEnabled', label: 'При включении' },
    { value: 'whenDisabled', label: 'При выключении' },
  ];

  var OUT_BEHAVIOR_TYPES = [
    { value: 'setValue', label: 'Установить значение' },
    { value: 'setEnable', label: 'Включить' },
    { value: 'setDisable', label: 'Выключить' },
    { value: 'toggle', label: 'Переключить' },
    { value: 'increaseValueBy', label: 'Увеличить на' },
    { value: 'decreaseValueBy', label: 'Уменьшить на' },
  ];

  // ─── Styles ───────────────────────────────────────────────────────────
  var S = {
    section: { marginTop: '16px' },
    field: { marginBottom: '14px' },
    label: { display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '4px', color: '#555' },
    row: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' },
    rowBetween: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' },
    actions: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 },
    meta: { fontSize: '12px', color: '#888', marginTop: '2px' },
    buttons: { display: 'flex', gap: '8px', marginTop: '16px' },
    days: { display: 'flex', gap: '4px', flexWrap: 'wrap' },
    empty: { textAlign: 'center', padding: '40px 20px', color: '#999' },
    half: { flex: 1 },
    listItem: {
      marginBottom: '8px',
      padding: '10px', background: 'var(--light-gray-color, #f8f8f8)', borderRadius: '6px',
      position: 'relative', overflow: 'hidden',
    },
    listRow: {
      display: 'flex', gap: '8px', alignItems: 'flex-end',
    },
    listField: { flex: 1, minWidth: 0 },
    removeBtn: { position: 'absolute', top: '6px', right: '6px' },
  };

  // ─── MQTT Topics Provider ─────────────────────────────────────────────
  function useMqttTopics() {
    var _topics = useState([]);
    var topics = _topics[0];
    var setTopics = _topics[1];
    var collected = useRef({});

    useEffect(function () {
      var subscribed = false;
      var retryInterval = null;
      var topic = '/devices/+/controls/+/meta';

      function doSubscribe() {
        var mqtt = HOMEUI.services && HOMEUI.services.mqttClient;
        if (!mqtt || !mqtt.isConnected() || subscribed) return;
        subscribed = true;
        if (retryInterval) clearInterval(retryInterval);
        mqtt.addStickySubscription(topic, handler);
      }

      function handler(data) {
        var parts = data.topic.split('/');
        if (parts.length >= 6) {
          var deviceId = parts[2];
          var controlId = parts[4];
          if (deviceId.indexOf('system__') === 0) return;
          var key = deviceId + '/' + controlId;
          if (!collected.current[key]) {
            var meta = {};
            try { meta = JSON.parse(data.payload); } catch (e) {}
            var title = meta.title ? (meta.title.ru || meta.title.en || '') : '';
            collected.current[key] = {
              value: key,
              label: title ? title + ' [' + key + ']' : key,
            };
            setTopics(Object.values(collected.current));
          }
        }
      }

      doSubscribe();
      retryInterval = setInterval(doSubscribe, 1000);

      return function () {
        clearInterval(retryInterval);
        var mqtt = HOMEUI.services && HOMEUI.services.mqttClient;
        if (mqtt && subscribed) mqtt.unsubscribe(topic);
      };
    }, []);

    return topics;
  }

  // ─── TopicInput — Dropdown with search ────────────────────────────────
  function TopicInput(props) {
    var topics = props.topics;
    var value = props.value;
    var onChange = props.onChange;
    var placeholder = props.placeholder || 'device/control';

    // Always show searchable Dropdown
    return h(Dropdown, {
      options: topics || [],
      value: value || null,
      placeholder: placeholder,
      isSearchable: true,
      isClearable: true,
      onChange: function (opt) { onChange(opt ? opt.value : ''); },
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────
  function getProxy() {
    var s = HOMEUI && HOMEUI.services;
    return s && s.ConfigEditorProxy ? s.ConfigEditorProxy : null;
  }

  function describeScenario(s) {
    switch (s.scenarioType) {
      case 'devicesControl':
        return (s.inControls || []).length + ' событие(й), ' + (s.outControls || []).length + ' действие(й)';
      case 'schedule':
        return (s.scheduleTime || '?') + ', ' + (s.scheduleDaysOfWeek || []).length + ' дн.';
      case 'astronomicalTimer':
        var e = s.eventSettings || {};
        return (e.astroEvent === 'sunset' ? 'закат' : 'восход') + (e.offset ? ' \u00b1' + e.offset + ' мин' : '');
      default:
        return '';
    }
  }

  function makeDefault(type) {
    switch (type) {
      case 'devicesControl':
        return {
          scenarioType: 'devicesControl', componentVersion: 1, enable: true, name: '',
          inControls: [{ control: '', behaviorType: 'whenChange' }],
          outControls: [{ control: '', behaviorType: 'setValue', actionValue: 0 }],
        };
      case 'schedule':
        return {
          scenarioType: 'schedule', componentVersion: 1, enable: true, name: '',
          scheduleTime: '12:00',
          scheduleDaysOfWeek: ALL_DAYS.slice(),
          outControls: [{ control: '', behaviorType: 'setValue', actionValue: 0 }],
        };
      case 'astronomicalTimer':
        return {
          scenarioType: 'astronomicalTimer', componentVersion: 1, name: '',
          coordinates: { latitude: 55.7558, longitude: 37.6176 },
          eventSettings: { astroEvent: 'sunrise', offset: 0 },
          scheduleDaysOfWeek: ALL_DAYS.slice(),
          outControls: [{ control: '', behaviorType: 'setValue', actionValue: 0 }],
        };
    }
  }

  // ─── ActionsList Component ────────────────────────────────────────────
  function ActionsList(props) {
    var items = props.items || [];
    var onChange = props.onChange;
    var topics = props.topics;
    var label = props.label || 'Действия';
    var behaviorOptions = props.behaviorOptions || OUT_BEHAVIOR_TYPES;
    var controlField = props.controlField || 'control';
    var showValue = props.showValue !== false;

    function updateItem(idx, key, val) {
      var next = items.map(function (it, i) {
        return i === idx ? Object.assign({}, it, (function () { var o = {}; o[key] = val; return o; })()) : it;
      });
      onChange(next);
    }

    function addItem() {
      var item = {}; item[controlField] = ''; item.behaviorType = behaviorOptions[0].value;
      if (showValue) item.actionValue = 0;
      onChange(items.concat([item]));
    }

    function removeItem(idx) {
      onChange(items.filter(function (_, i) { return i !== idx; }));
    }

    return h('div', { style: S.field },
      h('label', { style: S.label }, label),
      items.map(function (item, idx) {
        return h('div', { key: idx, style: S.listItem },
          h('div', { style: S.removeBtn },
            h(Button, {
              label: '\u00d7',
              variant: 'danger',
              size: 'small',
              isOutlined: true,
              onClick: function () { removeItem(idx); },
            })
          ),
          h('div', { style: { marginBottom: '6px' } },
            h('div', { style: { fontSize: '11px', color: '#999', marginBottom: '2px' } }, 'MQTT топик'),
            h(TopicInput, {
              topics: topics,
              value: item[controlField] || '',
              onChange: function (v) { updateItem(idx, controlField, v); },
            })
          ),
          h('div', { style: S.listRow },
            h('div', { style: S.listField },
              h('div', { style: { fontSize: '11px', color: '#999', marginBottom: '2px' } }, 'Действие'),
              h(Dropdown, {
                options: behaviorOptions,
                value: item.behaviorType || behaviorOptions[0].value,
                onChange: function (opt) { if (opt) updateItem(idx, 'behaviorType', opt.value); },
              })
            ),
            showValue ? h('div', { style: { width: '100px', flexShrink: 0 } },
              h('div', { style: { fontSize: '11px', color: '#999', marginBottom: '2px' } }, 'Значение'),
              h(Input, {
                type: 'number',
                value: String(item.actionValue != null ? item.actionValue : ''),
                size: 'small',
                onChange: function (v) { updateItem(idx, 'actionValue', Number(v) || 0); },
              })
            ) : null
          )
        );
      }),
      h(Button, {
        label: '+ Добавить',
        variant: 'secondary',
        size: 'small',
        isOutlined: true,
        onClick: addItem,
      })
    );
  }

  // ─── DaysSelector ─────────────────────────────────────────────────────
  function DaysSelector(props) {
    var selected = props.value || [];
    var onChange = props.onChange;

    function toggle(day) {
      var next = selected.slice();
      var idx = next.indexOf(day);
      if (idx >= 0) next.splice(idx, 1); else next.push(day);
      onChange(next);
    }

    return h('div', { style: S.field },
      h('label', { style: S.label }, 'Дни недели'),
      h('div', { style: S.days },
        DAYS.map(function (d) {
          return h(Checkbox, {
            key: d.value,
            checked: selected.indexOf(d.value) >= 0,
            title: d.label,
            variant: 'button',
            onChange: function () { toggle(d.value); },
          });
        })
      )
    );
  }

  // ─── ScenarioForm ─────────────────────────────────────────────────────
  function ScenarioForm(props) {
    var s = props.scenario;
    var onChange = props.onChange;
    var topics = props.topics;

    function set(key, val) {
      var u = Object.assign({}, s); u[key] = val; onChange(u);
    }
    function setNested(path, val) {
      var u = JSON.parse(JSON.stringify(s));
      var keys = path.split('.');
      var obj = u;
      for (var i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
      obj[keys[keys.length - 1]] = val;
      onChange(u);
    }

    var type = s.scenarioType;

    return h(Fragment, null,
      // Name
      h('div', { style: S.field },
        h('label', { style: S.label }, 'Название'),
        h(Input, {
          value: s.name || '',
          placeholder: 'Название сценария',
          isFullWidth: true,
          onChange: function (v) { set('name', v); },
        })
      ),

      // === devicesControl ===
      type === 'devicesControl' ? h(Fragment, null,
        h(ActionsList, {
          label: 'События (входы)',
          items: s.inControls || [],
          topics: topics,
          behaviorOptions: IN_BEHAVIOR_TYPES,
          showValue: false,
          onChange: function (v) { set('inControls', v); },
        }),
        h(ActionsList, {
          label: 'Действия (выходы)',
          items: s.outControls || [],
          topics: topics,
          onChange: function (v) { set('outControls', v); },
        })
      ) : null,

      // === schedule ===
      type === 'schedule' ? h(Fragment, null,
        h('div', { style: S.field },
          h('label', { style: S.label }, 'Время запуска'),
          h(Input, {
            value: s.scheduleTime || '12:00',
            placeholder: '12:00',
            onChange: function (v) { set('scheduleTime', v); },
          })
        ),
        h(DaysSelector, {
          value: s.scheduleDaysOfWeek || [],
          onChange: function (v) { set('scheduleDaysOfWeek', v); },
        }),
        h(ActionsList, {
          label: 'Действия',
          items: s.outControls || [],
          topics: topics,
          onChange: function (v) { set('outControls', v); },
        })
      ) : null,

      // === astronomicalTimer ===
      type === 'astronomicalTimer' ? h(Fragment, null,
        h('div', { style: S.field },
          h('label', { style: S.label }, 'Событие'),
          h(Dropdown, {
            options: ASTRO_EVENTS,
            value: (s.eventSettings || {}).astroEvent || 'sunrise',
            onChange: function (opt) { if (opt) setNested('eventSettings.astroEvent', opt.value); },
          })
        ),
        h('div', { style: S.field },
          h('label', { style: S.label }, 'Смещение (мин)'),
          h(Input, {
            type: 'number',
            value: String((s.eventSettings || {}).offset || 0),
            onChange: function (v) { setNested('eventSettings.offset', Number(v) || 0); },
          })
        ),
        h('div', { style: Object.assign({}, S.field, { display: 'flex', gap: '12px' }) },
          h('div', { style: S.half },
            h('label', { style: S.label }, 'Широта'),
            h(Input, {
              type: 'number',
              value: String((s.coordinates || {}).latitude || 55.7558),
              isFullWidth: true,
              onChange: function (v) { setNested('coordinates.latitude', Number(v) || 0); },
            })
          ),
          h('div', { style: S.half },
            h('label', { style: S.label }, 'Долгота'),
            h(Input, {
              type: 'number',
              value: String((s.coordinates || {}).longitude || 37.6176),
              isFullWidth: true,
              onChange: function (v) { setNested('coordinates.longitude', Number(v) || 0); },
            })
          )
        ),
        h(DaysSelector, {
          value: s.scheduleDaysOfWeek || [],
          onChange: function (v) { set('scheduleDaysOfWeek', v); },
        }),
        h(ActionsList, {
          label: 'Действия',
          items: s.outControls || [],
          topics: topics,
          onChange: function (v) { set('outControls', v); },
        })
      ) : null
    );
  }

  // ─── ScenariosPage ────────────────────────────────────────────────────
  function ScenariosPage() {
    var _loading = useState(true);
    var loading = _loading[0]; var setLoading = _loading[1];
    var _saving = useState(false);
    var saving = _saving[0]; var setSaving = _saving[1];
    var _error = useState(null);
    var error = _error[0]; var setError = _error[1];
    var _allScenarios = useState([]);
    var allScenarios = _allScenarios[0]; var setAllScenarios = _allScenarios[1];

    // Editor
    var _showEditor = useState(false);
    var showEditor = _showEditor[0]; var setShowEditor = _showEditor[1];
    var _editIndex = useState(-1);
    var editIndex = _editIndex[0]; var setEditIndex = _editIndex[1];
    var _editScenario = useState(null);
    var editScenario = _editScenario[0]; var setEditScenario = _editScenario[1];

    // Create type picker
    var _showCreate = useState(false);
    var showCreate = _showCreate[0]; var setShowCreate = _showCreate[1];

    // Delete
    var _showDelete = useState(false);
    var showDelete = _showDelete[0]; var setShowDelete = _showDelete[1];
    var _deleteIndex = useState(-1);
    var deleteIndex = _deleteIndex[0]; var setDeleteIndex = _deleteIndex[1];

    var topics = useMqttTopics();

    // Load
    var loadScenarios = useCallback(function () {
      var proxy = getProxy();
      if (!proxy) { setError('ConfigEditorProxy not available'); setLoading(false); return; }
      proxy.Load({ path: SCHEMA_PATH }).then(function (r) {
        var content = typeof r.content === 'string' ? JSON.parse(r.content) : r.content;
        setAllScenarios(content.scenarios || []);
        setLoading(false);
        setError(null);
      }).catch(function (err) {
        setError('Load failed: ' + (err.message || err));
        setLoading(false);
      });
    }, []);

    useEffect(function () {
      loadScenarios();
    }, [loadScenarios]);

    // Save
    var saveAll = useCallback(function (updated) {
      var proxy = getProxy();
      if (!proxy) { setError('ConfigEditorProxy not available'); return; }
      setSaving(true);
      var config = { configVersion: 1, scenarios: updated };
      proxy.Save({ path: SCHEMA_PATH, content: config }).then(function () {
        setAllScenarios(updated);
        setSaving(false);
        setError(null);
      }).catch(function (err) {
        setError('Save failed: ' + (err.message || err));
        setSaving(false);
      });
    }, []);

    // Handlers
    var handleCreateType = useCallback(function (type) {
      setShowCreate(false);
      setEditScenario(makeDefault(type));
      setEditIndex(-1);
      setShowEditor(true);
    }, []);

    var handleEdit = useCallback(function (gi) {
      setEditScenario(JSON.parse(JSON.stringify(allScenarios[gi])));
      setEditIndex(gi);
      setShowEditor(true);
    }, [allScenarios]);

    var handleSave = useCallback(function () {
      if (!editScenario || !editScenario.name) return;
      var updated = allScenarios.slice();
      if (editIndex >= 0) updated[editIndex] = editScenario;
      else updated.push(editScenario);
      saveAll(updated);
      setShowEditor(false);
    }, [editScenario, editIndex, allScenarios, saveAll]);

    var handleDelete = useCallback(function () {
      if (deleteIndex < 0) return;
      var updated = allScenarios.slice();
      updated.splice(deleteIndex, 1);
      saveAll(updated);
      setShowDelete(false);
      setDeleteIndex(-1);
    }, [deleteIndex, allScenarios, saveAll]);

    // Filtered
    var items = [];
    allScenarios.forEach(function (s, i) {
      if (SUPPORTED_TYPES.indexOf(s.scenarioType) >= 0) items.push({ s: s, gi: i });
    });

    // Render
    return h(PageLayout, {
      title: 'Сценарии V2',
      hasRights: true,
      isLoading: loading,
      actions: h(Button, {
        label: 'Создать',
        variant: 'primary',
        size: 'small',
        onClick: function () { setShowCreate(true); },
      }),
    },
      loading ? h(Loader, { caption: 'Загрузка\u2026' }) : h(Fragment, null,

        error ? h('div', { style: S.section },
          h(Alert, { variant: 'danger', onClose: function () { setError(null); } }, error)
        ) : null,

        items.length === 0
          ? h('div', { style: S.empty },
              h('div', { style: { fontSize: '16px', marginBottom: '8px' } }, 'Нет сценариев'),
              h('div', null, 'Нажмите «Создать» чтобы добавить сценарий')
            )
          : items.map(function (item) {
              var s = item.s; var gi = item.gi;
              return h(Card, { key: gi, heading: s.name || 'Без названия' },
                h('div', { style: S.rowBetween },
                  h('div', { style: { flex: 1 } },
                    h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
                      h(Tag, { variant: TYPE_TAG_VARIANTS[s.scenarioType] }, TYPE_LABELS[s.scenarioType])
                    ),
                    h('div', { style: S.meta }, describeScenario(s))
                  ),
                  h('div', { style: S.actions },
                    h(Button, {
                      label: 'Изменить',
                      variant: 'primary',
                      size: 'small',
                      onClick: function () { handleEdit(gi); },
                    }),
                    h(Button, {
                      label: 'Удалить',
                      variant: 'danger',
                      size: 'small',
                      isOutlined: true,
                      onClick: function () { setDeleteIndex(gi); setShowDelete(true); },
                    })
                  )
                )
              );
            }),

        // Create type picker dialog
        h(Dialog, {
          heading: 'Создать сценарий',
          isOpened: showCreate,
          onClose: function () { setShowCreate(false); },
          width: 400,
        },
          h('div', { style: { fontSize: '14px', color: '#555', marginBottom: '16px' } },
            'Выберите тип сценария:'
          ),
          TYPE_OPTIONS.map(function (opt) {
            return h('div', {
              key: opt.value,
              style: {
                padding: '14px 16px', marginBottom: '8px', borderRadius: '8px', cursor: 'pointer',
                border: '1px solid var(--light-gray-color, #ddd)',
                transition: 'background 0.15s, border-color 0.15s',
              },
              onClick: function () { handleCreateType(opt.value); },
              onMouseEnter: function (e) { e.currentTarget.style.borderColor = 'var(--primary-color, #3498db)'; e.currentTarget.style.background = 'var(--light-gray-color, #f8f9fa)'; },
              onMouseLeave: function (e) { e.currentTarget.style.borderColor = 'var(--light-gray-color, #ddd)'; e.currentTarget.style.background = ''; },
            },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
                h(Tag, { variant: TYPE_TAG_VARIANTS[opt.value] }, opt.label),
                h('span', { style: { fontSize: '13px', color: '#888' } },
                  TYPE_DESCRIPTIONS[opt.value] || ''
                )
              )
            );
          })
        ),

        // Editor dialog
        h(Dialog, {
          heading: editIndex >= 0 ? 'Изменить сценарий' : 'Новый сценарий',
          isOpened: showEditor,
          onClose: function () { setShowEditor(false); },
          width: 600,
        },
          editScenario ? h(Fragment, null,
            h('div', { style: { marginBottom: '12px' } },
              h(Tag, { variant: TYPE_TAG_VARIANTS[editScenario.scenarioType] },
                TYPE_LABELS[editScenario.scenarioType]
              )
            ),
            h(ScenarioForm, {
              scenario: editScenario,
              onChange: setEditScenario,
              topics: topics,
            }),
            h('div', { style: S.buttons },
              h(Button, {
                label: 'Отмена', variant: 'secondary',
                onClick: function () { setShowEditor(false); },
              }),
              h(Button, {
                label: saving ? 'Сохранение\u2026' : 'Сохранить',
                variant: 'primary', isLoading: saving,
                isDisabled: !editScenario.name || saving,
                onClick: handleSave,
              })
            )
          ) : null
        ),

        // Delete confirm
        h(Confirm, {
          heading: 'Удалить сценарий',
          isOpened: showDelete,
          confirmCallback: handleDelete,
          closeCallback: function () { setShowDelete(false); },
          acceptLabel: 'Удалить', cancelLabel: 'Отмена', variant: 'danger',
        },
          deleteIndex >= 0 && allScenarios[deleteIndex]
            ? 'Удалить сценарий \u00ab' + (allScenarios[deleteIndex].name || '') + '\u00bb?'
            : ''
        )
      )
    );
  }

  HOMEUI.pluginRegistry.register({
    id: 'wb-scenarios-v2',
    components: { ScenariosPage: ScenariosPage },
  });
  console.log('[wb-scenarios-v2] Plugin registered');
})();
