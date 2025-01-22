# Описание используемого стиля и окружения

## Руководства по стилю

1) Основной и приоритетный
Style guide от Airbnb для js ES5
https://github.com/airbnb/javascript/tree/es5-deprecated/es5

2) Вспомогательный
Style guide от Google для jsdoc
https://google.github.io/styleguide/jsguide.html#jsdoc

## Линтеры и претифаеры

Для их установки прийдется установить любой менеджер пакетов типа NPM

### Установка в систему

Кроме установки расширений в VsCode нужно установить сами приложения
линтера и форматтера на вашу систему.

Проверить есть ли установленные уже в системе можно так

```shell
$ eslint -v
v9.18.0
$ prettier -v
3.4.2
$
```

Установка на машину глобально

```shell
$ npm install --g eslint
$ npm install --g prettier
```

### Расширения для VsCode

1) ESLint - линтер проверяющий ошибки, но не наводит красоту.
   Ссылка в VsCode маркет:
   - Microsoft: [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
2) Prettier - форматтер наводит красоту в коде, но не проверяющий ошибки.
   Ссылка в VsCode маркет:
   - Prettier: [Prettier - Code formatter](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

### Файлы настроек

В корне проекта лежат два файла настроек линтера и форматтера:
- .eslintrc.json
- .prettierrc.json
