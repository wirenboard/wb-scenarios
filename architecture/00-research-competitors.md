# Исследование: астрономические таймеры в умных домах

## 1. Home Assistant — Sun Integration

**Источник:** home-assistant.io/integrations/sun/, home-assistant.io/docs/automation/trigger/#sun-trigger

### Поддерживаемые события

Сущность `sun.sun` предоставляет:

| Атрибут | Описание |
|---|---|
| `next_rising` | Следующий восход |
| `next_setting` | Следующий закат |
| `next_dawn` | Следующие сумерки (утро) |
| `next_dusk` | Следующие сумерки (вечер) |
| `next_noon` | Следующий солнечный полдень |
| `next_midnight` | Следующая солнечная полночь |
| `elevation` | Угол солнца над горизонтом (градусы) |
| `azimuth` | Азимут (градусы) |

Состояния: `above_horizon` / `below_horizon`

### Триггеры автоматизаций

**Sun Trigger** — два события: `sunrise`, `sunset`

**Offset** — смещение в формате `HH:MM:SS`, отрицательные значения = до события:
```yaml
triggers:
  - trigger: sun
    event: sunset
    offset: "-00:45:00"   # за 45 минут до заката
```

**Продвинутый вариант** — триггер по углу возвышения солнца:
```yaml
triggers:
  - trigger: numeric_state
    entity_id: sun.sun
    attribute: elevation
    below: -6    # гражданские сумерки
```

### UI
- Тип триггера: выбор "Sun" из dropdown
- Событие: "Sunrise" или "Sunset"
- Offset: текстовое поле HH:MM:SS
- Локация берётся из настроек Home

### Особенности
- Полностью офлайн — расчёт по координатам дома
- Можно комбинировать с другими триггерами
- Триггер по произвольному углу солнца

---

## 2. Яндекс Умный дом

**Источник:** alice.yandex.ru/support/ru/smart-home/scenarios/schedule

### Поддерживаемые события
- **Рассвет** (восход)
- **Закат**

Без различий между гражданскими/навигационными/астрономическими сумерками.

### Конфигурация
- Тип времени: "Точное время", "Рассвет", "Закат"
- Дни недели
- Локация из настроек "Дома" в приложении
- Задержка после события (но НЕТ отрицательного offset — нельзя "за 30 мин до заката")

### UI (мобильное приложение)
1. "+" → "Сценарий"
2. "Если" → "Время" → выбор "Рассвет"/"Закат"/"Точное время"
3. Выбор дней недели
4. "Тогда" → действия с устройствами

### Особенности
- Требует интернет (расчёт на сервере)
- Симуляция рассвета/заката для ламп (плавное изменение яркости 15 мин)
- Нет offset до события

---

## 3. OpenHAB — Astro Binding

**Источник:** openhab.org/addons/bindings/astro/

### Самая полная реализация

**Солнечные события:**

| Группа | Описание | Угол |
|---|---|---|
| `rise` / `set` | Восход / закат | 0° |
| `noon` | Солнечный полдень | max |
| `astroDawn` / `astroDusk` | Астрономические сумерки | -18° |
| `nauticDawn` / `nauticDusk` | Навигационные сумерки | -12° |
| `civilDawn` / `civilDusk` | Гражданские сумерки | -6° |
| `goldenHour` | Золотой час | +6° |
| `daylight` / `night` | День / ночь | |

**Лунные события:**
- rise / set
- phase (NEW, FULL, WAXING_CRESCENT и т.д.)
- illumination (%), age (дни)
- distance (км), perigee/apogee
- eclipse (total, partial, penumbral)

### Конфигурация
```
astro:sun:home [ geolocation="52.5200,13.4050,100", interval=60 ]
```

- **offset**: от -1440 до +1440 минут на канал
- **earliest/latest**: ограничение времени события (не раньше 06:00, не позже 22:00)
- **forceEvent**: принудительный запуск для высоких широт (полярный день/ночь)

### Особенности
- Затмения, зодиак, солнечная радиация, времена года
- `forceEvent` для высоких широт
- `earliest/latest` — практичные ограничения

---

## 4. ioBroker — JavaScript Adapter

**Источник:** github.com/ioBroker/ioBroker.javascript

### Поддерживаемые события (через suncalc)

| Событие | Описание |
|---|---|
| `sunrise` / `sunset` | Восход / закат |
| `sunriseEnd` / `sunsetStart` | Край диска солнца |
| `dawn` / `dusk` | Гражданские сумерки |
| `nauticalDawn` / `nauticalDusk` | Навигационные сумерки |
| `nightEnd` / `night` | Астрономические сумерки |
| `goldenHour` / `goldenHourEnd` | Золотой час |
| `solarNoon` / `nadir` | Полдень / надир |

### API
```javascript
schedule({astro: "sunset", shift: -30}, function() {
    log("30 минут до заката!");
});
```

- **shift**: смещение в минутах (+ и -)
- `isDaytime()` — проверка день/ночь
- `getAstroDate(pattern, date, offset)` — получить время события

---

## 5. Domoticz — dzVents

### Естественный язык:
```lua
timer = {
    'at 15 minutes before sunset',
    'at sunrise',
    'at nighttime at 07:00 on mon, tue'
}
```

### Особенности
- **Randomness** — случайное отклонение для имитации присутствия
- Sunrise, sunset, civil twilight start/end

---

## 6. Сравнительная таблица

| Возможность | Home Assistant | Яндекс | OpenHAB | ioBroker | Domoticz |
|---|---|---|---|---|---|
| Восход/закат | + | + | + | + | + |
| Гражданские сумерки | через угол | - | + | + | + |
| Навигационные сумерки | через угол | - | + | + | - |
| Астрономические сумерки | через угол | - | + | + | - |
| Золотой час | - | - | - | + | - |
| Фазы луны | addon | - | + | addon | - |
| Offset до/после | + | только после | + | + | + |
| Офлайн расчёт | + | - | + | + | + |
| Произвольный угол | + | - | - | - | - |
| earliest/latest | - | - | + | - | - |
| Рандомизация | - | - | - | - | + |

---

## 7. Node.js библиотеки для расчётов

### suncalc (оригинал)
- **npm:** ~79K загрузок/неделю
- **Размер:** ~3KB минифицированный
- **Лицензия:** BSD-2-Clause
- Чистый JS, без зависимостей
- Используется в ioBroker

**Солнечные события (14 штук):**

| Угол | Утро | Вечер |
|---|---|---|
| -0.833° | `sunrise` | `sunset` |
| -0.3° | `sunriseEnd` | `sunsetStart` |
| -6° | `dawn` | `dusk` |
| -12° | `nauticalDawn` | `nauticalDusk` |
| -18° | `nightEnd` | `night` |
| +6° | `goldenHourEnd` | `goldenHour` |
| — | `solarNoon` | `nadir` |

**API:**
```javascript
var SunCalc = require('suncalc');
var times = SunCalc.getTimes(new Date(), 55.75, 37.62);
// times.sunrise, times.sunset — объекты Date

var moonTimes = SunCalc.getMoonTimes(new Date(), 55.75, 37.62);
var moonIllum = SunCalc.getMoonIllumination(new Date());
```

**Луна:** moonrise/moonset, phase, illumination, distance

### suncalc3 (расширенный форк)
- TypeScript поддержка
- 22 события (вместо 14)
- Добавлены: blueHour, amateurDawn/Dusk, расширенные goldenHour
- Лучшая структура возвращаемых данных

### Рекомендация
**suncalc** — оптимальный выбор для wb-scenarios:
- Чистый ES5-совместимый JS
- Минимальный размер
- Нет зависимостей
- Проверен в production (ioBroker)
- Покрывает все основные события
