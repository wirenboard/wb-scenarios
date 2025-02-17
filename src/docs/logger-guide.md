# Модуль логирования

Добавляет возможность лейблов для логов, а так же динамическокго включения
и выключения по ходу скрипта

## Пример использования

В данном примере создается логгер с лейблом `MyModule`

```javascript
var Logger = require('logger.mod').Logger;
var scLog = new Logger('MyModule');

var variable = 'newWbLogger';

scLog.debug('Debugging details here and var = "{}" in text', variable);
scLog.info('Some useful information.');
scLog.warning('This is a warning!');
scLog.error('An error occurred.');

log.debug('--- Disabling Logger ---');
scLog.disable();
scLog.debug('This message will not be shown.');

log.debug('--- Enabling Logger Again ---');
scLog.enable();
scLog.debug('Logging is back on.');
```

Выведет в лог WEBUI

```log
2025-02-17 05:11:17[MyModule] : Debugging details here and var = "newWbLogger" in text
2025-02-17 05:11:17[MyModule] : Some useful information.
2025-02-17 05:11:17[MyModule] : This is a warning!
2025-02-17 05:11:17[MyModule] : An error occurred.
2025-02-17 05:11:17--- Disabling Logger ---
2025-02-17 05:11:17--- Enabling Logger Again ---
2025-02-17 05:11:17[MyModule] : Logging is back on.
```

Обратите внимание на два момента:

- Добавленный ко всем строчкам лейбл `[MyModule]`
- Отсутствие лога после строки `--- Disabling Logger ---`, хотя в коде скрипта
  там есть вывод лога `scLog.debug('This message will not be shown.');`

Так же можно назвать объект логгера log - тогда синтаксис лога будет
идентичным ранее используемому в wb-rules, но новый объект заменит глобальный

Такая конструкция отработает корректно:

```javascript
var Logger = require('logger.mod').Logger;
var log = new Logger('MyModule');

var variable = 'newWbLogger';
log.debug('Debugging details here and var = "{}" in text', variable);
```

И выведет в лог

```log
2025-02-17 05:19:39[MyModule] : Debugging details here and var = "newWbLogger" in text
```

Можно изменить лейбл логов в уже созданном объекте, это удобно, если вы
создаете глобальный объект лога в файле и после инициализации вашего
приложения хотите добавить в лейбл дополнительную информацию, например
id устройства. Для этого нужно написать:

```javascript
logger.setLable('NewLable')
```
