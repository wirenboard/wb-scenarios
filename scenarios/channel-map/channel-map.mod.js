/**
 * @file channel-map.mod.js - ES5 module for wb-rules v2.38
 * @description Channel Map scenario class that extends ScenarioBase.
 *   Copies values between MQTT controls according to direction (forward, backward, or both).
 *   Uses a single whenChanged rule with a source → targets lookup map.
 * @author Valerii Trofimov <valeriy.trofimov@wirenboard.com>
 */

var ScenarioBase = require('wbsc-scenario-base.mod').ScenarioBase;
var ScenarioState = require('virtual-device-helpers.mod').ScenarioState;
var Logger = require('logger.mod').Logger;

var loggerFileLabel = 'WBSC-channel-map-mod';
var log = new Logger(loggerFileLabel);

var VALID_DIRECTIONS = ['forward', 'backward', 'both'];

/**
 * @typedef {Object} LinkEntry
 * @property {string} mqttTopicA - First MQTT topic 'device/control'
 * @property {string} direction - Direction: 'forward', 'backward', or 'both'
 * @property {string} mqttTopicB - Second MQTT topic 'device/control'
 */

/**
 * @typedef {Object} ChannelMapConfig
 * @property {string} [idPrefix] - Optional prefix for scenario ID
 * @property {Array<LinkEntry>} mqttTopicsLinks - List of links
 */

/**
 * @typedef {Object<string, string[]>} SourceMap
 * Map of source MQTT topic to array of target MQTT topics.
 * Example: { 'wb-gpio/A1_OUT': ['wb-gpio/A2_OUT', 'wb-gpio/A3_OUT'] }
 */

/**
 * Channel Map scenario implementation
 * @class ChannelMapScenario
 * @extends ScenarioBase
 */
function ChannelMapScenario() {
  ScenarioBase.call(this);

  /**
   * Context object for storing scenario runtime state
   * @type {Object}
   */
  this.ctx = {
    hasIncorrectLinks: false,   // Flag indicating if any link has type or min/max mismatches
  };
}

// Set up inheritance
ChannelMapScenario.prototype = Object.create(ScenarioBase.prototype);
ChannelMapScenario.prototype.constructor = ChannelMapScenario;

/**
 * Generates name identifiers for virtual device and rules
 * @param {string} idPrefix - ID prefix for this scenario instance
 * @returns {Object} Generated names
 */
ChannelMapScenario.prototype.generateNames =
  function (idPrefix) {
    var scenarioPrefix = 'wbsc_';
    return {
      vDevice: scenarioPrefix + idPrefix,
      ruleMap: scenarioPrefix + idPrefix + '_map',
      ruleEnable: scenarioPrefix + idPrefix + '_enable',
    };
  };

/**
 * Get configuration for waiting for controls
 * @param {ChannelMapConfig} cfg - Configuration object
 * @returns {Object} Waiting configuration object
 */
ChannelMapScenario.prototype.defineControlsWaitConfig = function(cfg) {
  var allTopics = [];
  for (var i = 0; i < cfg.mqttTopicsLinks.length; i++) {
    var l = cfg.mqttTopicsLinks[i];
    if (allTopics.indexOf(l.mqttTopicA) === -1) {
      allTopics.push(l.mqttTopicA);
    }
    if (allTopics.indexOf(l.mqttTopicB) === -1) {
      allTopics.push(l.mqttTopicB);
    }
  }
  return { controls: allTopics };
};

/**
 * Configuration validation
 * @param {ChannelMapConfig} cfg - Configuration object
 * @returns {boolean} True if configuration is valid
 */
ChannelMapScenario.prototype.validateCfg = function (cfg) {
  if (!Array.isArray(cfg.mqttTopicsLinks) || cfg.mqttTopicsLinks.length === 0) {
    log.error('At least one link is required');
    return false;
  }

  for (var i = 0; i < cfg.mqttTopicsLinks.length; i++) {
    var l = cfg.mqttTopicsLinks[i];

    if (!l.mqttTopicA || !l.mqttTopicB) {
      log.error('Link [{}]: both channels are required', i);
      return false;
    }

    // Direct loop check
    if (l.mqttTopicA === l.mqttTopicB) {
      log.error('Link [{}]: channels must differ: "{}"', i, l.mqttTopicA);
      return false;
    }

    if (VALID_DIRECTIONS.indexOf(l.direction) === -1) {
      log.error('Link [{}]: invalid direction "{}"', i, l.direction);
      return false;
    }

    // Duplicate/overlap check against all previous links
    for (var j = 0; j < i; j++) {
      var prev = cfg.mqttTopicsLinks[j];
      var samePair =
        (l.mqttTopicA === prev.mqttTopicA &&
          l.mqttTopicB === prev.mqttTopicB) ||
        (l.mqttTopicA === prev.mqttTopicB &&
          l.mqttTopicB === prev.mqttTopicA);

      if (!samePair) continue;

      // When A/B are swapped, forward↔backward are inverted
      var existingDir = prev.direction;
      if (existingDir !== 'both' &&
          l.mqttTopicA === prev.mqttTopicB &&
          l.mqttTopicB === prev.mqttTopicA) {
        existingDir = existingDir === 'forward'
          ? 'backward' : 'forward';
      }

      if (existingDir === 'both') {
        log.warning(
          'Link [{}]: already covered by link [{}]' +
            ' ("{}" both "{}"), this link has no effect',
          i, j, prev.mqttTopicA, prev.mqttTopicB
        );
      } else if (l.direction === 'both') {
        log.warning(
          'Link [{}]: "both" covers link [{}]' +
            ' ("{}" {} "{}"), link [{}] has no effect',
          i, j, prev.mqttTopicA, prev.direction,
          prev.mqttTopicB, j
        );
      } else if (l.direction === existingDir) {
        log.warning(
          'Link [{}]: duplicate of link [{}]' +
            ' ("{}" {} "{}"), this link has no effect',
          i, j, prev.mqttTopicA, prev.direction,
          prev.mqttTopicB
        );
      }
    }

    var typeA = dev[l.mqttTopicA + '#type'];
    var typeB = dev[l.mqttTopicB + '#type'];

    // Type mismatch check
    if (typeA && typeB && typeA !== typeB) {
      log.warning(
        'Link [{}]: type mismatch: "{}" ({}) and "{}" ({})',
        i,
        l.mqttTopicA,
        typeA,
        l.mqttTopicB,
        typeB
      );
      this.ctx.hasIncorrectLinks = true;
    }

    var minA = dev[l.mqttTopicA + '#min'];
    var maxA = dev[l.mqttTopicA + '#max'];
    var minB = dev[l.mqttTopicB + '#min'];
    var maxB = dev[l.mqttTopicB + '#max'];
    
    // Min/max constraints check (if both controls have numeric constraints)
    if ((minA !== undefined || maxA !== undefined) && (minB !== undefined || maxB !== undefined)) {
      if (minA !== minB || maxA !== maxB) {
        log.warning(
          'Link [{}]: min/max constraints differ: "{}" (min:{}, max:{}) and "{}" (min:{}, max:{})',
          i,
          l.mqttTopicA,
          minA,
          maxA,
          l.mqttTopicB,
          minB,
          maxB
        );
        this.ctx.hasIncorrectLinks = true;
      }
    }
  }

  return true;
};

/**
 * Builds a lookup map: source topic -> array of target topics
 * @param {Array<LinkEntry>} mqttTopicsLinks - List of links
 * @returns {SourceMap} Map of source -> targets
 */
function buildSourceMap(mqttTopicsLinks) {
  var map = {};
  for (var i = 0; i < mqttTopicsLinks.length; i++) {
    var l = mqttTopicsLinks[i];
    
    if (l.direction === 'forward') {
      addToMap(map, l.mqttTopicA, l.mqttTopicB);
    } else if (l.direction === 'backward') {
      addToMap(map, l.mqttTopicB, l.mqttTopicA);
    } else if (l.direction === 'both') {
      addToMap(map, l.mqttTopicA, l.mqttTopicB);
      addToMap(map, l.mqttTopicB, l.mqttTopicA);
    }
  }
  return map;
}

/**
 * Adds a mapping from source to target in the map, avoiding duplicates
 * @param {SourceMap} map - The map to modify
 * @param {string} source - Source MQTT topic
 * @param {string} target - Target MQTT topic
 */
function addToMap(map, source, target) {
  if (!map[source]) {
    map[source] = [];
  }
  if (map[source].indexOf(target) === -1) {
    map[source].push(target);
  }
}

/**
 * Copies current source values to all targets
 * @param {SourceMap} sourceMap - Map of source -> targets
 */
function initialSync(sourceMap) {
  for (var source in sourceMap) {
    var sourceValue = dev[source];
    var targets = sourceMap[source];

    for (var i = 0; i < targets.length; i++) {
      var target = targets[i];
      var currentValue = dev[target];

      if (currentValue !== sourceValue) {
        dev[target] = sourceValue;
      }
    }
  }
}

/**
 * Adds custom controls to virtual device
 * @param {ChannelMapScenario} self - Reference to the ChannelMapScenario instance
 */
function addCustomControlsToVirtualDevice(self) {
  if (self.ctx.hasIncorrectLinks) {
    self.vd.devObj.addControl('warning', {
      title: {
        en: 'Some links are incorrect, see logs',
        ru: 'Некоторые связи работают некорректно, см. логи',
      },
      type: 'text',
      value: '',
      readonly: true,
      forceDefault: true,
      order: 2,
    });
  }
}

/**
 * Creates the link rule that copies values from sources to targets.
 * Uses a generation counter to prevent infinite loops with pushbutton controls.
 *
 * For non-pushbutton controls: standard value comparison (dev[target] !== newValue).
 * For pushbutton controls: each user press increments a generation counter.
 *   All writes within the same cascade share the same generation number.
 *   If a target was already written in the current generation, it is skipped.
 *   This handles all topologies: pairs, chains, meshes, and cycles.
 *
 * @param {ChannelMapScenario} self - Scenario instance
 * @param {SourceMap} sourceMap - Map of source -> targets
 * @returns {boolean} True if rule created successfully
 */
function createLinkRule(self, sourceMap) {
  log.debug('Creating link rule');
  var sources = Object.keys(sourceMap);

  // Cascade counter: incremented on each user press, shared across the wave
  var pbGeneration = 0;
  // Topic → generation number when it was last written in a cascade
  var pbWrittenGen = {};
  // Topic → true if we wrote to it (consumed on echo to distinguish from user press)
  var pbWrittenByUs = {};

  var ruleId = defineRule(self.genNames.ruleMap, {
    whenChanged: sources,
    then: function onSourceChanged(newValue, devName, cellName) {
      var source = devName + '/' + cellName;
      var targets = sourceMap[source];

      if (!targets) return;

      var isPbSource = dev[source + '#type'] === 'pushbutton';
      var isEcho = isPbSource && pbWrittenByUs[source];

      if (isPbSource) {
        if (isEcho) {
          delete pbWrittenByUs[source];
        } else {
          pbGeneration++;
          pbWrittenGen[source] = pbGeneration;
        }
      } else {
        // Non-pushbutton source starts a new generation so stale
        // pbWrittenGen entries from previous cascades don't block writes
        pbGeneration++;
      }

      for (var i = 0; i < targets.length; i++) {
        var target = targets[i];
        var isPbTarget = dev[target + '#type'] === 'pushbutton';

        if (isPbTarget) {
          if (pbWrittenGen[target] === pbGeneration) {
            continue;
          }
          pbWrittenByUs[target] = true;
          pbWrittenGen[target] = pbGeneration;
          dev[target] = newValue;
        } else {
          if (dev[target] !== newValue) {
            dev[target] = newValue;
          }
        }
      }
    },
  });

  if (!ruleId) {
    log.error('Failed to create link rule');
    return false;
  }
  log.debug('Link rule created');
  self.addRule(ruleId);
  return true;
}

/**
 * Creates a rule that re-syncs values when the scenario is re-enabled.
 * Intentionally NOT registered via addRule() so it stays active
 * even when the scenario is disabled.
 * @param {ChannelMapScenario} self - Scenario instance
 * @param {SourceMap} sourceMap - Map of source -> targets
 * @returns {boolean} True if rule created successfully
 */
function createEnableRule(self, sourceMap) {
  log.debug('Creating enable rule');

  var ruleId = defineRule(self.genNames.ruleEnable, {
    whenChanged: [self.genNames.vDevice + '/rule_enabled'],
    then: function onRuleEnabledChanged(newValue) {
      if (newValue) {
        log.debug('Scenario re-enabled, syncing values');
        initialSync(sourceMap);
      }
    },
  });

  if (!ruleId) {
    log.error('Failed to create enable rule');
    return false;
  }
  log.debug('Enable rule created');
  return true;
}

/**
 * Create all rules for the scenario.
 * @param {ChannelMapScenario} self - Scenario instance
 * @param {SourceMap} sourceMap - Map of source -> targets
 * @returns {boolean} True if all rules created successfully
 */
function createRules(self, sourceMap) {
  log.debug('Creating all rules');

  if (!createLinkRule(self, sourceMap)) {
    return false;
  }
  if (!createEnableRule(self, sourceMap)) {
    return false;
  }

  return true;
}

/**
 * Scenario initialization
 * @param {string} deviceTitle - Virtual device title
 * @param {ChannelMapConfig} cfg - Configuration object
 * @returns {boolean} True if initialization succeeded
 */
ChannelMapScenario.prototype.initSpecific = function (deviceTitle, cfg) {
  /**
   * NOTE: This method is executed ONLY when:
   * - Base initialization is complete
   * - Configuration is valid
   * - All referenced controls exist in the system
   *
   * The async initialization chain guarantees that all prerequisites are met.
   * No need to re-validate or check control existence here.
   */
  log.debug('Start init channel map scenario');
  log.setLabel(loggerFileLabel + '/' + this.idPrefix);

  addCustomControlsToVirtualDevice(this);

  var sourceMap = buildSourceMap(cfg.mqttTopicsLinks);
  var rulesCreated = createRules(this, sourceMap);

  if (rulesCreated) {
    initialSync(sourceMap);

    this.setState(ScenarioState.NORMAL);
    log.debug(
      'Channel Map scenario initialized for device "{}"',
      deviceTitle
    );
  }

  return rulesCreated;
};

exports.ChannelMapScenario = ChannelMapScenario;
