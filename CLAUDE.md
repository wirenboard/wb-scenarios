# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**wb-scenarios** — ready-to-use automation scenarios for Wiren Board controllers. Scenarios let users configure common device use-cases (linking inputs to outputs, light control, thermostat, schedule) via a web UI without writing scripts. They run on the **wb-rules** engine (ES5 JavaScript, no Node.js/npm runtime).

## Build & Install

```bash
# Install directly to controller via Makefile (copies files to system paths)
make

# Build a .deb package
dpkg-buildpackage -rfakeroot -us -uc

# Install the built package
apt install -y ../wb-scenarios_*.deb
```

There is no `npm install` or `package.json` — the project is pure ES5 modules loaded by wb-rules via `require()`.

## Linting

ESLint and Prettier must be installed locally (not globally) via npm for development only:

```bash
npm install eslint eslint-plugin-prettier prettier --save-dev
eslint <file.js>
```

Config files: `eslint.config.cjs`, `.prettierrc.json`, `.markdownlint.json`

Key formatting rules: 2-space indent, single quotes, printWidth 77, trailing commas (es5), no anonymous functions (`func-names: error`).

## Architecture

### Runtime Environment

Code runs inside **wb-rules** (v2.28+), NOT Node.js. The global `log`, `dev`, `defineRule`, `runShellCommand`, `PersistentStorage` objects are provided by wb-rules. ES5 only — no ES6 modules, `let`/`const`, arrow functions, template literals, or `class` syntax.

### Module System

- `*.mod.js` — modules loaded via `require('module-name.mod')` (no path prefix needed at runtime)
- `*.js` — rule scripts auto-executed by wb-rules
- Modules export via `exports.Foo = Foo` (CommonJS-style, ES5)

### Core Components (`src/`)

| Module | Purpose |
|--------|---------|
| `wbsc-scenario-base.mod.js` | Abstract base class all scenarios inherit from |
| `virtual-device-helpers.mod.js` | Virtual device creation, `ScenarioState` enum |
| `wbsc-wait-controls.mod.js` | Async waiting for MQTT controls to become available |
| `wbsc-persistent-storage.mod.js` | Singleton for scenario persistent storage |
| `logger.mod.js` | Logger with labels and `{}` format placeholders |
| `scenarios-general-helpers.mod.js` | Config reading, ID prefix generation |
| `table-handling-events.mod.js` | Event type table (input triggers) |
| `table-handling-actions.mod.js` | Action type table (output actions) |
| `registry-action-resolvers.mod.js` | Action resolver registry |
| `translit.mod.js` | Cyrillic-to-Latin transliteration for IDs |

### Scenario Structure

Each scenario type lives in `scenarios/<name>/` with exactly these files:

- `<name>.mod.js` — scenario class extending `ScenarioBase`
- `scenario-init-<name>.mod.js` — reads config, filters by type, creates instances

Entry point: `scenarios/scenario-init-main.js` — sequentially calls each scenario type's `setup()`.

### ScenarioBase Contract

Every scenario class must:
1. Call `ScenarioBase.call(this)` in constructor
2. Set prototype: `YourScenario.prototype = Object.create(ScenarioBase.prototype)`
3. Implement three required methods:
   - `generateNames(idPrefix)` — return object with `vDevice` and rule name keys
   - `validateCfg(cfg)` — return `true` if config is valid
   - `initSpecific(name, cfg)` — create rules, set state to `ScenarioState.NORMAL`, return `true`
4. Optionally override `defineControlsWaitConfig(cfg)` to wait for MQTT controls

**Do NOT override** `init()` — it orchestrates the full lifecycle.

### Scenario Lifecycle States

`CREATED(0)` → `INIT_STARTED(1)` → `WAITING_CONTROLS(2)` → `LINKED_CONTROLS_READY(3)` → `NORMAL(6)`

Error states: `CONFIG_INVALID(4)`, `LINKED_CONTROLS_TIMEOUT(5)`, `USED_CONTROL_ERROR(7)`

### Configuration Flow

1. User edits config in web UI (json-editor driven by `schema/wb-scenarios.schema.json`)
2. Config saved to `/etc/wb-scenarios.conf` (JSON with `configVersion` and `scenarios` array)
3. `wb-scenarios-reloader` service touches init script to trigger wb-rules reload
4. `scenario-init-main.js` re-runs, calling each scenario type's `setup()`

## Conventions

- **File names**: kebab-case (`my-scenario.mod.js`)
- **JS variables**: camelCase
- **JSON schema property names**: camelCase (new properties only; legacy `id_prefix` exists for backward compat)
- **Style guide**: Airbnb ES5
- **JSDoc**: Google style
- **Line endings**: LF only (enforced via `.gitattributes`)
- **Scenario folder naming**: kebab-case under `scenarios/`

## Packaging

Debian package built via `dpkg-buildpackage`. The `Makefile` `install` target copies files to:
- `/etc/wb-scenarios.conf` — default config
- `/usr/share/wb-mqtt-confed/schemas/` — JSON schema
- `/usr/share/wb-rules-system/rules/` — rule scripts (`.js`)
- `/usr/share/wb-rules-modules/` — modules (`.mod.js`)
- `/var/www/images/wb-scenarios/` — schema images
- `/usr/lib/wb-scenarios/` — reloader script

CI: Jenkins (`Jenkinsfile` → `buildDebArchAll`).
