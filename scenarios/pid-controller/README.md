# ПИД-регулятор -- хардкод-скрипт для тестирования

Автономный wb-rules скрипт для проверки логики ПИД-регулятора
без интеграции с ScenarioBase / confed. Создаёт устройство-симулятор
комнаты и виртуальное устройство ПИД-регулятора со всеми контролами.

## Деплой

```bash
# Модуль PID-алгоритма
scp src/pid-engine.mod.js \
  root@192.168.1.144:/usr/share/wb-rules-modules/

# Хардкод-скрипт
scp scenarios/pid-controller/pid-controller.mod.js \
  root@192.168.1.144:/etc/wb-rules/pid-controller.js

# Перезапуск
ssh root@192.168.1.144 systemctl restart wb-rules
```

## Захардкоженный конфиг

| Параметр | Значение | Описание |
|---|---|---|
| sensor | `sim_room/temperature` | Симуляция датчика |
| setpoint | 22 | Уставка |
| deadband | 0.2 | Мёртвая зона |
| Kp / Ki / Kd | 10 / 0.005 / 2 | Коэффициенты ПИД |
| pwmPeriod | 30 с | Короткий период для тестов |
| minCycleDuration | 0 | Без мин. длительности |

## Виртуальные устройства

**sim_room** -- симуляция комнаты: слайдер температуры
(0-40) и переключатель нагревателя (readonly).

**wbsc_pid_test** -- ПИД-регулятор:

| Контрол | Тип | Описание |
|---|---|---|
| rule_enabled | switch | Включить / выключить |
| setpoint | range 5..35 | Уставка |
| current_value | value, RO | Показание датчика |
| output_power | range 0..100, RO | Мощность ПИД (%) |
| cycle_period | value, RO | Интервал регулирования (с) |
| on_off_time | text, RO | Вкл / Выкл в секундах |
| actuator_status | switch, RO | Состояние реле |
| state | text, RO | Активен / Ожидает / Отключен |

## Поведение

- ПИД вычисляет мощность каждые `pwmPeriod` секунд
- ШИМ разбивает цикл на фазы включения и выключения
- Смена уставки: `pid.reset()` + немедленный перезапуск цикла
- Выключение: отмена таймеров, выключение актуаторов, `pid.reset()`
- Изменение датчика: `current_value` обновляется в реальном времени

## Логи

```bash
ssh root@192.168.1.144 journalctl -u wb-rules -f
```

```
PID: val=20 sp=22 P=20.00 I=0.30 D=0.00 out=20.3%
PWM: period=30s ON=6.1s OFF=23.9s
PWM: OFF phase, next cycle in 24s
```

## Файлы

| Файл | Описание |
|---|---|
| `pid-controller.mod.js` | Хардкод-скрипт для тестирования |
| `dev-note-arc42.md` | Архитектурная документация |
| `src/pid-engine.mod.js` | Модуль ПИД-алгоритма |
