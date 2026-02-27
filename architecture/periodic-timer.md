# Periodic Timer — Architecture (ARC42)

## 1. Context & Scope

The Schedule scenario currently supports only absolute time triggers (HH:MM on
selected weekdays). The periodic timer extension adds a second mode: "execute
actions every N minutes, optionally auto-reverse after M minutes".

**Actors:**
- **User** — configures scenario via wb-mqtt-confed UI
- **wb-rules engine** — executes cron / setTimeout rules
- **MQTT devices** — receive control commands

## 2. Design Decisions

| Decision | Rationale |
|----------|-----------|
| Extend existing `schedule` scenario, not a new type | Avoids code duplication; user requirement |
| `scheduleMode` enum (`absoluteTime` / `periodicTimer`) | Clean branching, backward-compatible default |
| Auto-reverse on duration expiry | Natural UX: "turn on ventilation for 30 min" |
| Cron for clean intervals, setTimeout fallback | Cron survives restarts for dividers of 60 min; setTimeout for arbitrary values |
| `everyDay` boolean hides day-of-week checkboxes | Simplifies UI for the common "every day" case |
| `componentVersion` 1 → 2 | Schema migration gate |
| Save/restore values for `setValue` reverse | Only way to correctly reverse numeric set actions |

## 3. Component View

```
┌─────────────────────────────────────────────────┐
│  wb-scenarios.schema.json                       │
│  ┌───────────────┐  ┌────────────────────────┐  │
│  │ scheduleMode  │  │ periodicIntervalMinutes│  │
│  │ everyDay      │  │ periodicDurationMinutes│  │
│  └───────────────┘  └────────────────────────┘  │
└──────────────────────┬──────────────────────────┘
                       │ config
                       ▼
┌─────────────────────────────────────────────────┐
│  scenario-init-schedule.mod.js                  │
│  - Reads config, passes new fields              │
│  - reqVerScenario = 2                           │
└──────────────────────┬──────────────────────────┘
                       │ cfg
                       ▼
┌─────────────────────────────────────────────────┐
│  schedule.mod.js                                │
│                                                 │
│  ┌─ validateCfg ──────────────────────────────┐ │
│  │ absoluteTime: existing time validation     │ │
│  │ periodicTimer: interval/duration checks    │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ initSpecific ─────────────────────────────┐ │
│  │ absoluteTime: cron rule (existing)         │ │
│  │ periodicTimer:                             │ │
│  │   cron (clean intervals) OR setTimeout     │ │
│  │   + remaining_on_time VD control           │ │
│  │   + auto-reverse timer                     │ │
│  │   + disable-during-ON watcher              │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ scheduleHandler ──────────────────────────┐ │
│  │ Save current values (for reverse)          │ │
│  │ Execute forward actions                    │ │
│  │ Schedule auto-reverse setTimeout           │ │
│  │ Start countdown timer                      │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ executeAutoReverse ───────────────────────┐ │
│  │ toggle → toggle                            │ │
│  │ setEnable → setDisable                     │ │
│  │ setDisable → setEnable                     │ │
│  │ setValue → restore savedValues             │ │
│  │ increaseBy → decreaseBy                    │ │
│  │ decreaseBy → increaseBy                    │ │
│  └────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

## 4. Runtime Behavior

### Absolute Time Mode (unchanged)
```
cron("0 30 8 * * 1,3,5")  →  scheduleHandler  →  execute actions
```

### Periodic Timer Mode (duration = 0)
```
cron/setTimeout(every N min)  →  scheduleHandler  →  execute actions
```

### Periodic Timer Mode (duration > 0)
```
cron/setTimeout(every N min)
  → scheduleHandler
    → save current values
    → execute forward actions
    → setTimeout(duration)
      → executeAutoReverse (restore values)

countdown: 1s tick updates remaining_on_time VD control
```

### Disable During ON Phase
```
rule_enabled → false (while ON phase active)
  → immediate executeAutoReverse
  → cancel duration timer
  → cancel countdown timer
```

## 5. Data Flow

```
Config fields:
  scheduleMode:             "absoluteTime" | "periodicTimer"
  everyDay:                 boolean (default: true)
  periodicIntervalMinutes:  1..1440
  periodicDurationMinutes:  0..1440 (0 = no auto-reverse)

Runtime context:
  autoReverseTimerId:       setTimeout ID for duration expiry
  savedValues:              { controlName: previousValue, ... }
  isOnPhaseActive:          boolean
  periodicTimerId:          setTimeout ID (for non-cron intervals)
  countdownTimerId:         setTimeout ID for 1-second ticks
```
