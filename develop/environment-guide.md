# Описание используемого стиля и окружения

## Руководства по стилю

1) Основной и приоритетный
Style guide от Airbnb для js ES5
https://github.com/airbnb/javascript/tree/es5-deprecated/es5

2) Вспомогательный
Style guide от Google для jsdoc
https://google.github.io/styleguide/jsguide.html#jsdoc

## Окончания в файлах

Для корректности диффов и работы линтера ESLint важно настроить на windows
то как git будет работать с окончаниями файлов.
Для этого в проект добавлен файл .gitattributes - который имеет настройку
окончания файлов.

```git
* text=auto eol=lf
```

Это позволяет ESLint работать в том числе на определение не корректных
окончаний строк в коде, так как git перестает в windowd менять все окончания
на CRLF.

## Линтеры и претифаеры

Линтер и претифаер нужны для того чтобы:

- Линтер - подсвечивает ошибки кода
- Форматтер (или бьютефаер) - автоматически приводит код к одному внешнему
  виду который принят в компании

В результате уменьшается вероятность больших PR которые необходимы для
форматирования кода в будующем.

Для их установки прийдется установить любой менеджер пакетов типа NPM

### Установка в систему

Перед установкой расширений в VsCode нужно установить сами приложения
линтера и форматтера на вашу систему.

Предварительно лучше проверить есть ли уже установленные в системе утилиты:

```shell
$ eslint -v
v9.18.0
$ prettier -v
3.4.2
$
```

Установка на машину локально
При установке ESLint (вместе с @eslint/eslintrc и prettier) глобально могут
возникать конфликты между глобальной и локальной конфигурацией ESLint
в проекте.

Вот так устанавливать НЕ нужно!
```shell
$ npm install --g eslint
$ npm install --g prettier
```

Проверить как установлены пакеты можно так
Данная команда отобразит только глобально установленные пакеты

```shell
npm ls -g --depth=0
C:\Users\gsv\AppData\Roaming\npm
├── @eslint/eslintrc@3.2.0
├── eslint@9.18.0
├── jshint@2.13.6
├── npm@11.0.0
└── prettier@3.4.2
```

Удилить их можно так и потом проверить результат

```shell
> npm uninstall -g eslint @eslint/eslintrc prettier

removed 112 packages in 593ms
> npm ls -g --depth=0
C:\Users\gsv\AppData\Roaming\npm
├── jshint@2.13.6
└── npm@11.0.0
```

Установка локально

```shell
npm install eslint eslint-plugin-prettier prettier --save-dev

```

Установите prettier в проекте Установите саму библиотеку prettier, так как плагин ESLint зависит от неё:

```shell
$ npm install prettier --save-dev
```

eslint-plugin-prettier установлен локально

```shell
$ npm install eslint-plugin-prettier --save-dev
```

Если вы устанавливали его глобально (--g), это может вызывать проблемы. Удалите глобальную установку:

```shell
$ npm uninstall -g eslint-plugin-prettier
```

### Диагностика

1. Убедитесь, что ESLint установлен локально в вашем проекте, а не глобально:

```shell
npm ls eslint
```

2. Посмотрите лог с помощью --debug

Если проблема сохраняется, выполните команду с флагом --debug, чтобы увидеть, какие файлы загружаются:

Проверьте ESLint Теперь снова проверьте файл:

```shell
$ eslint src/tm-event-main.mod.js --debug
```

2. Проверьте лог сервера ESLint

Откройте вывод ESLint в VSCode:

Нажмите Ctrl+Shift+P.
Выберите ESLint: Show Output.
Обратите внимание на ошибки или путь к загружаемому конфигурационному файлу. Если путь неверный, переместите файл конфигурации в указанный каталог.

3. Перезапустите сервер ESLint

После внесения изменений перезапустите ESLint сервер в VSCode:

Откройте командную палитру (Ctrl+Shift+P).
Выберите ESLint: Restart ESLint Server.

### Расширения для VsCode

Расширения НЕ работают без предварительной установки утилит в систему,
то есть расширения для VsCode НЕ являются самостоятельными и используют
уже устанавленные в систему утилиты.

По этой причине расширения лучше устанавливать уже после установки самих
инструментов в систему, когда вы проверили что данные утилиты корректно
работают через консоль.

1) ESLint - линтер проверяющий ошибки, но не наводит красоту.
   Ссылка в VsCode маркет:
   - Microsoft: [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)

2) Prettier - форматтер наводит красоту в коде, но не проверяющий ошибки.
   Ссылка в VsCode маркет:
   - Prettier: [Prettier - Code formatter](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

3) markdownlint - линтер и форматтер помогающий редактировать markdown файлв
   Ссылка в VsCode маркет:
   - David Anson: [markdownlint](https://marketplace.visualstudio.com/items?itemName=DavidAnson.vscode-markdownlint)

### Файлы настроек

В корне проекта лежат два файла настроек линтера и форматтера:
- Для линтера: `eslint.config.cjs`
- Для бьютефаера: .prettierrc.json

#### eslint.config.cjs

1) На счет имени файла
   ESLint версии 9.x, которая по умолчанию поддерживает только плоскую
   конфигурацию (eslint.config.js). Это означает, что ваш файл .eslintrc.json
   игнорируется, так как поддержка старого формата конфигурации была удалена.

2) Так как мы не используем ES 6 модули - то не создаем package.json
   с содержащимся в нем "type": "module". Это влияет на синтаксис
   конфига ESLint
3) Глобальный файл настроек в Windows
   Обратите внимание, что для корректной работы новых версий ESLint
   кроме локального файла конфига нужен еще и глобальный системный файл
   без которого ESLint не будет работать в VsCode - его нельзя удалять.
   Он находится по пути в Windows:

   ```path
   C:\Users\<!user_name!>\eslint.config.mjs
   ```

Таким образом:

- Нельзя использовать `.eslintrc.json` тк не поддреживается с версии 19
- Нельзя использовать `eslint.config.js` тк мы используем common js
   а при использовании `*.js` будут дополнительные ошибки при проверке
   конфига от ts и требования исопльзовать модули ES6 вместо reauire

По внутренностям:

func-names - Need any functions have name - no anonymous
log - Hide error - 'log' is not defined.

#### .prettierrc.json

Файл содержит основные настройки для автоматического форматирования кода

```json
{
  "trailingComma": "es5",
  "printWidth": 77,
  "tabWidth": 2,
  "semi": true,
  "useTabs": false,
  "singleQuote": true
}
```

#### .markdownlint.json

Содержит только одну диррективу отключающую проверку на inline html

```json
{
    "MD033": false
}
```
